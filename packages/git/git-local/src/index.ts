/**
 * Host-local provider for `ctx.git`: reads the repository that contains a
 * directory by running the machine-readable git commands through the shared
 * no-shell runner (`runNativeCommand`), the same boundary the host's other
 * one-shot OS integrations use.
 *
 * Every classification rides git's exit code, not its stderr: the messages are
 * localized, while the codes are git's stable machine vocabulary. Exit 128 from
 * the toplevel probe — outside any repository, inside a bare one, or a
 * repository too broken to name its work tree — is the `absent` answer, because
 * no repository contains the directory as a work tree. A failure the runner
 * raised before git could answer is `GIT_UNAVAILABLE`; a command that ran and
 * failed past those two is `GIT_COMMAND_FAILED`.
 *
 * One snapshot costs three bounded commands — `status --porcelain=v2 --branch
 * -z`, `for-each-ref`, and `log -n` — each naming the repository root through
 * git's own `-C` argument (the runner has no working-directory option), so
 * every path the snapshot carries is root-relative.
 *
 * Nothing here writes to the repository: every command is a read, and
 * `--no-optional-locks` keeps `status` from taking the index lock an
 * opportunistic refresh would take.
 * @module @deepseek-ai/dsh-git-local
 */

import { stat } from 'node:fs/promises'
import { GitError, GitObserver, MAX_OBSERVATION_ITEMS } from '@deepseek-ai/dsh-git'
import type { GitObservation } from '@deepseek-ai/dsh-git'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { parseBranchList, parseHistory, parseStatusPorcelain } from './parse.ts'

export { parseBranchList, parseHistory, parseStatusPorcelain } from './parse.ts'

/** Injectable process boundary; production keeps the shared no-shell runner. */
export interface GitLocalInternals {
  /** Runner replacing `runNativeCommand` in tests. */
  run?: NativeCommandRunner
}

/** The provider's name for loader diagnostics. */
export const name = 'git-local'

/** `log --format` with the parsers' control-character separators. */
const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e'

/** `for-each-ref --format` with the parsers' control-character separators. */
const BRANCH_FORMAT = '%(refname:short)%1f%(objectname)%1e'

/** git's exit code for a request it cannot tie to a work tree. */
const NO_WORK_TREE = 128

/**
 * The local git observation service: registers as `ctx.git`, one instance per
 * context.
 */
export class LocalGitObserver extends GitObserver {
  /** Test hook replacing the process boundary; production uses the shared runner. */
  internals: GitLocalInternals = {}

  /**
   * Observe the repository containing one directory.
   * @param cwd - the directory to observe from.
   * @param signal - caller cancellation; aborts the running command.
   * @returns the bounded snapshot, `absent` when no repository contains the
   *   directory as a work tree, and the unborn-repository snapshot (empty
   *   history, no HEAD oid) when the branch has no commit yet.
   */
  override async observe(cwd: string, signal: AbortSignal): Promise<GitObservation> {
    // A directory that does not exist contains no repository; that is the
    // absent answer, not a process failure to report.
    if (!await isDirectory(cwd)) return { kind: 'absent' }
    let root: string
    try {
      root = (await this.run(cwd, ['rev-parse', '--show-toplevel'], signal)).stdout.trim()
    } catch (error: unknown) {
      if (signal.aborted) throw error
      // Exit 128 — outside any repository, inside a bare one, or a repository
      // too broken to name its work tree — means no repository contains the
      // directory as a work tree.
      if (exitCodeOf(error) === NO_WORK_TREE) return { kind: 'absent' }
      throw this.failure(error, 'rev-parse')
    }
    const [status, branches] = await Promise.all([
      this.git('status', root, ['status', '--porcelain=v2', '--branch', '-z'], signal)
        .then(output => parseStatusPorcelain(output.stdout)),
      this.git('for-each-ref', root, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads/'], signal)
        .then(output => parseBranchList(output.stdout)),
    ])
    // An unborn HEAD has no history to read; the snapshot says so by leaving it empty.
    const history = status.head.oid === undefined
      ? []
      : parseHistory((await this.git('log', root, ['log', `-n${MAX_OBSERVATION_ITEMS + 1}`, `--format=${LOG_FORMAT}`], signal)).stdout)
    return {
      kind: 'repository',
      root,
      head: status.head,
      branches: branches.slice(0, MAX_OBSERVATION_ITEMS),
      branchesTruncated: branches.length > MAX_OBSERVATION_ITEMS,
      history: history.slice(0, MAX_OBSERVATION_ITEMS),
      historyTruncated: history.length > MAX_OBSERVATION_ITEMS,
      worktree: status.entries.slice(0, MAX_OBSERVATION_ITEMS),
      worktreeTruncated: status.entries.length > MAX_OBSERVATION_ITEMS,
    }
  }

  /**
   * Run one read-only git command and classify its failure by exit code.
   *
   * A cancelled read rejects with its own abort reason, not a git failure:
   * the caller chose to stop, and the seam's error vocabulary has no word
   * for that.
   * @param command - the command's name, for diagnostics.
   * @param cwd - the command's working directory.
   * @param args - the command's arguments.
   * @param signal - caller cancellation.
   * @returns the command's stdout and stderr.
   */
  private async git(
    command: string,
    cwd: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.run(cwd, args, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw error
      throw this.failure(error, command)
    }
  }

  /** Classify one command failure: git never answered, or answered with a failure. */
  private failure(error: unknown, command: string): GitError {
    if (exitCodeOf(error) === undefined) return unavailable(error, command)
    return commandFailed(error, command)
  }

  /**
   * Run one read-only git command in a directory through the injectable boundary.
   *
   * The directory travels as git's own `-C` argument, the one way a one-shot
   * command names its tree.
   * @param cwd - the command's working directory.
   * @param args - the command's arguments, after `-C`.
   * @param signal - caller cancellation.
   * @returns the command's stdout and stderr.
   */
  private async run(cwd: string, args: readonly string[], signal: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    return await (this.internals.run ?? runNativeCommand)('git', ['--no-optional-locks', '-C', cwd, ...args], signal)
  }
}

/** Whether a path is an existing directory; any failure reads as "no". */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The exit status of a command that ran, whatever language its message prints.
 * A spawn failure carries a string code such as `ENOENT`, so it answers
 * `undefined`: git never answered.
 */
function exitCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code } = error as { code?: unknown }
  return typeof code === 'number' ? code : undefined
}

/** A git command that ran and failed where the contract expects success. */
function commandFailed(error: unknown, command: string): GitError {
  return new GitError(`git ${command} failed in the workspace repository`, 'GIT_COMMAND_FAILED', { cause: error })
}

/** A failure the runner raised before git could answer. */
function unavailable(error: unknown, command: string): GitError {
  return new GitError(
    `git could not be run for "${command}": ${error instanceof Error ? error.message : String(error)}`,
    'GIT_UNAVAILABLE',
    { cause: error },
  )
}

export default LocalGitObserver

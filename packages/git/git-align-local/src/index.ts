/**
 * Host-local provider for `ctx.gitAlign`: executes the seam's repository
 * operations by running git through the shared no-shell runner
 * (`runNativeCommand`), the same boundary the host's read-only git observer
 * uses.
 *
 * Three properties shape every method here. First, each command is bounded:
 * the runner has no timeout and no output cap of its own, so the provider
 * composes the caller's signal with its own timeout and reads only compact
 * machine-readable forms (`--numstat -z`, `--name-only -z`, count-free
 * listings) that never carry a full patch. Second, a caller cancellation
 * rejects with its own abort reason, never with a git failure, because the
 * caller chose to stop. Third, the operation set cannot push, rebase, or
 * rewrite history: no method builds such an argv.
 *
 * `probe` prefers `git merge-tree --write-tree`, which builds the merged tree in
 * the object database without touching the work tree, and falls back to an
 * isolated `git worktree` when that command is unavailable. The choice is
 * decided by running the command and reading its exit status, never by
 * inferring a capability from a version number.
 *
 * @module @deepseek-ai/dsh-git-align-local
 */

import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { GitAligner, GitAlignRequestError } from '@deepseek-ai/dsh-git-align'
import type {
  AlignRequest,
  AlignSpec,
  AlignStrategy,
  ApplyResult,
  ChangeFacts,
  ChangeFactsResult,
  CommitRequest,
  CommitResult,
  FetchResult,
  GitAlignFailure,
  IgnoreResult,
  ProbeRequest,
  ProbeResult,
  PushedResult,
} from '@deepseek-ai/dsh-git-align'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import {
  assertCommitPaths,
  boundConflicts,
  detailOf,
  exitCodeOf,
  parseLineSeparated,
  parseMergeTreeConflicts,
  parseNullSeparated,
  parseNumstatZ,
  stdoutOf,
} from './parse.ts'

export {
  assertCommitPaths,
  boundConflicts,
  detailOf,
  exitCodeOf,
  parseLineSeparated,
  parseMergeTreeConflicts,
  parseNullSeparated,
  parseNumstatZ,
  stdoutOf,
} from './parse.ts'

/** Injectable process boundary; production keeps the shared no-shell runner. */
export interface GitAlignLocalInternals {
  /** Runner replacing `runNativeCommand` in tests. */
  run?: NativeCommandRunner
}

/** Provider configuration: the one bound that varies by deployment. */
export interface Config {
  /** Milliseconds one git command may run before the provider aborts it. */
  commandTimeoutMs?: number
}

/** Validated provider configuration. */
export const Config: Schema<Config> = z.object({
  commandTimeoutMs: z.natural().min(1000).default(60_000),
})

/** The provider's fallback command bound when a caller supplies no configuration. */
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

/** git's exit status for a request it could not parse, which is how an unsupported flag answers. */
const USAGE_EXIT = 129

/** The most severe failure a probe's own scratch-tree cleanup can report. */
const SCRATCH_CLEANUP_FAILED: GitAlignFailure = {
  code: 'command-failed',
  detail: 'the probe scratch worktree could not be removed',
}

/** One completed command's stdout. */
interface CommandSuccess {
  readonly ok: true
  readonly stdout: string
}

/** One failed command: its classified failure, the exit status when it ran, and whatever stdout it printed. */
interface CommandFailure {
  readonly ok: false
  readonly exitCode?: number
  readonly stdout: string
  readonly failure: GitAlignFailure
}

/** The answer to one bounded git command. */
type CommandOutcome = CommandSuccess | CommandFailure

/**
 * The local git alignment service: registers as `ctx.gitAlign`, one instance
 * per context.
 */
export class LocalGitAligner extends GitAligner {
  /** The class carries the schema, not a module export: the Loader reads this one. */
  static Config: Schema<Config> = Config

  /** Test hook replacing the process boundary; production uses the shared runner. */
  internals: GitAlignLocalInternals = {}

  private readonly commandTimeoutMs: number

  /**
   * @param ctx - the owning context.
   * @param config - the deployment's command bound; the schema default applies when omitted.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const commandTimeoutMs = config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs < 1000) {
      throw new Error('git-align-local: commandTimeoutMs must be an integer of at least 1000')
    }
    this.commandTimeoutMs = commandTimeoutMs
  }

  /**
   * Split the tracked branch into the remote and ref name a fetch names.
   * @param request - the coordinates observed by the consumer.
   * @returns the resolved target.
   * @throws {GitAlignRequestError} when the tracked branch has no `remote/ref` spelling.
   */
  override resolve(request: AlignRequest): AlignSpec {
    const separator = request.upstream.indexOf('/')
    const remote = separator === -1 ? '' : request.upstream.slice(0, separator)
    const refspec = separator === -1 ? '' : request.upstream.slice(separator + 1)
    if (remote.length === 0 || refspec.length === 0) {
      throw new GitAlignRequestError(
        `git-align: upstream '${request.upstream}' is not a 'remote/ref' branch spelling`,
      )
    }
    return { ...request, remote, refspec }
  }

  /**
   * Fetch the target's upstream ref into its remote-tracking ref.
   * @param spec - the resolved target.
   * @param signal - caller cancellation.
   * @returns the classified fetch answer.
   */
  override async fetch(spec: AlignSpec, signal: AbortSignal): Promise<FetchResult> {
    const outcome = await this.command(
      spec.root,
      'fetch',
      ['fetch', '--no-tags', spec.remote, `+refs/heads/${spec.refspec}:refs/remotes/${spec.upstream}`],
      signal,
    )
    return outcome.ok ? { kind: 'fetched' } : { kind: 'failed', failure: outcome.failure }
  }

  /**
   * Probe whether the upstream merges into HEAD cleanly, touching neither the
   * target work tree, its index, nor its refs.
   * @param spec - the resolved target.
   * @param request - the scratch-tree location and conflict-list bound.
   * @param signal - caller cancellation.
   * @returns the classified probe answer.
   */
  override async probe(
    spec: AlignSpec,
    request: ProbeRequest,
    signal: AbortSignal,
  ): Promise<ProbeResult> {
    const direct = await this.command(
      spec.root,
      'merge-tree',
      ['merge-tree', '--write-tree', '--name-only', spec.upstream, 'HEAD'],
      signal,
    )
    if (direct.ok) return { kind: 'clean' }
    // Exit 1 is the documented conflicting answer; exit 129 is git refusing the
    // flags, which is the only signal that the isolated-worktree path is needed.
    if (direct.exitCode === 1) {
      return { kind: 'conflicted', conflicts: boundConflicts(parseMergeTreeConflicts(direct.stdout), request.maxConflictPaths) }
    }
    if (direct.exitCode !== USAGE_EXIT) return { kind: 'failed', failure: direct.failure }
    return await this.probeInScratchWorktree(spec, request, signal)
  }

  /**
   * Align HEAD to the upstream, or roll back the attempt this call started.
   * @param spec - the resolved target.
   * @param strategy - how the attempt reaches the upstream revision.
   * @param signal - caller cancellation.
   * @returns the classified write answer.
   */
  override async apply(
    spec: AlignSpec,
    strategy: AlignStrategy,
    signal: AbortSignal,
  ): Promise<ApplyResult> {
    const args = strategy === 'ff-only'
      ? ['merge', '--ff-only', spec.upstream]
      : ['merge', '--no-ff', '--no-edit', spec.upstream]
    const merged = await this.command(spec.root, 'merge', args, signal)
    if (merged.ok) return { kind: 'aligned', strategy }
    const inProgress = await this.command(spec.root, 'rev-parse', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], signal)
    // Nothing to roll back when the attempt never recorded a merge in progress.
    if (!inProgress.ok) return { kind: 'merge-failed', failure: merged.failure }
    const aborted = await this.command(spec.root, 'merge --abort', ['merge', '--abort'], signal)
    return aborted.ok
      ? { kind: 'merge-failed', failure: merged.failure }
      : { kind: 'merge-failed-dirty', failure: aborted.failure }
  }

  /**
   * Read diff facts for exactly one path set, relative to HEAD.
   * @param spec - the resolved target.
   * @param paths - repository-relative paths, already bounded by the consumer.
   * @param signal - caller cancellation.
   * @returns the classified facts answer.
   */
  override async changeFacts(
    spec: AlignSpec,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<ChangeFactsResult> {
    if (paths.length === 0) {
      return { kind: 'facts', facts: { files: [], insertions: 0, deletions: 0 } }
    }
    const recorded = await this.command(spec.root, 'add', ['add', '--intent-to-add', '--', ...paths], signal)
    if (!recorded.ok) return { kind: 'failed', failure: recorded.failure }
    const diffed = await this.command(
      spec.root,
      'diff',
      ['diff', 'HEAD', '--numstat', '-z', '--no-renames', '--', ...paths],
      signal,
    )
    if (!diffed.ok) return { kind: 'failed', failure: diffed.failure }
    let files: ChangeFacts['files']
    try {
      files = parseNumstatZ(diffed.stdout)
    } catch (error: unknown) {
      return {
        kind: 'failed',
        failure: { code: 'command-failed', detail: detailOf(error) },
      }
    }
    return {
      kind: 'facts',
      facts: {
        files,
        insertions: files.reduce((total, file) => total + file.insertions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
      },
    }
  }

  /**
   * Report which of the given paths git's own ignore rules match.
   * @param spec - the resolved target.
   * @param paths - repository-relative paths, already bounded by the consumer.
   * @param signal - caller cancellation.
   * @returns the classified ignore answer.
   */
  override async ignoredPaths(
    spec: AlignSpec,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<IgnoreResult> {
    if (paths.length === 0) return { kind: 'checked', ignored: [] }
    // `check-ignore -z` is meaningful only with `--stdin` (which this no-shell
    // runner cannot provide), so the answer is read line by line and reduced to
    // the requested set: an entry git quotes or wraps is dropped rather than
    // reported as a path the caller never named.
    const outcome = await this.command(
      spec.root,
      'check-ignore',
      ['-c', 'core.quotePath=false', 'check-ignore', '--', ...paths],
      signal,
    )
    // Exit 1 is git's answer that none of the paths matched an ignore rule.
    if (!outcome.ok && outcome.exitCode === 1) return { kind: 'checked', ignored: [] }
    if (!outcome.ok) return { kind: 'failed', failure: outcome.failure }
    const listed = new Set(parseLineSeparated(outcome.stdout))
    return { kind: 'checked', ignored: paths.filter(path => listed.has(path)) }
  }

  /**
   * Create one commit containing exactly the supplied paths.
   * @param spec - the resolved target.
   * @param request - the path set, message, and whether repository hooks run.
   * @param signal - caller cancellation.
   * @returns the classified commit answer.
   */
  override async commit(
    spec: AlignSpec,
    request: CommitRequest,
    signal: AbortSignal,
  ): Promise<CommitResult> {
    assertCommitPaths(request.paths)
    // `git commit -- <paths>` takes each path's worktree content and ignores what
    // other paths have staged, but it refuses a path git does not know yet, so a
    // new file is first recorded as intent-to-add. That records the path only:
    // no content is staged, and no path outside the set is named.
    const recorded = await this.command(spec.root, 'add', ['add', '--intent-to-add', '--', ...request.paths], signal)
    if (!recorded.ok) return { kind: 'failed', failure: recorded.failure, indexRestored: true }
    const args = ['commit', '-m', request.message]
    if (!request.runHooks) args.push('--no-verify')
    args.push('--', ...request.paths)
    const committed = await this.command(spec.root, 'commit', args, signal)
    if (committed.ok) return { kind: 'committed' }
    const restored = await this.command(spec.root, 'reset', ['reset', '-q', '--', ...request.paths], signal)
    return { kind: 'failed', failure: committed.failure, indexRestored: restored.ok }
  }

  /**
   * Report whether any remote-tracking ref already contains one commit.
   * @param spec - the resolved target.
   * @param oid - full object id of the commit to test.
   * @param signal - caller cancellation.
   * @returns the classified answer.
   */
  override async pushedToRemote(spec: AlignSpec, oid: string, signal: AbortSignal): Promise<PushedResult> {
    const outcome = await this.command(
      spec.root,
      'for-each-ref',
      ['for-each-ref', '--format=%(refname)', `--contains=${oid}`, 'refs/remotes/'],
      signal,
    )
    if (!outcome.ok) return { kind: 'failed', failure: outcome.failure }
    return { kind: 'checked', pushed: outcome.stdout.trim().length > 0 }
  }

  /**
   * Probe through a detached scratch worktree, the path used when
   * `git merge-tree --write-tree` is unavailable.
   *
   * The scratch tree lives under the configured root rather than inside the
   * target, so probing never makes the target work tree dirty. Its removal is
   * part of the answer: a probe that leaves a registered worktree behind
   * reports failure instead of a conflict list nobody can trust.
   * @param spec - the resolved target.
   * @param request - the scratch-tree location and conflict-list bound.
   * @param signal - caller cancellation.
   * @returns the classified probe answer.
   */
  private async probeInScratchWorktree(
    spec: AlignSpec,
    request: ProbeRequest,
    signal: AbortSignal,
  ): Promise<ProbeResult> {
    const scratch = join(request.worktreeRoot, request.scratchName)
    const added = await this.command(spec.root, 'worktree add', ['worktree', 'add', '--detach', scratch, 'HEAD'], signal)
    if (!added.ok) return { kind: 'failed', failure: added.failure }
    let answer: ProbeResult = { kind: 'clean' }
    try {
      answer = await this.mergeInScratch(spec, scratch, request.maxConflictPaths, signal)
    } finally {
      const removed = await this.command(spec.root, 'worktree remove', ['worktree', 'remove', '--force', scratch], signal)
      if (removed.ok) await this.command(spec.root, 'worktree prune', ['worktree', 'prune'], signal)
      else answer = { kind: 'failed', failure: SCRATCH_CLEANUP_FAILED }
    }
    return answer
  }

  /**
   * Classify one merge attempt inside the scratch worktree.
   * @param spec - the resolved target.
   * @param scratch - absolute path of the detached scratch worktree.
   * @param maxConflictPaths - maximum conflicting paths the answer lists.
   * @param signal - caller cancellation.
   * @returns the classified probe answer for that attempt.
   */
  private async mergeInScratch(
    spec: AlignSpec,
    scratch: string,
    maxConflictPaths: number,
    signal: AbortSignal,
  ): Promise<ProbeResult> {
    const merged = await this.command(scratch, 'merge', ['merge', '--no-commit', '--no-ff', spec.upstream], signal)
    if (merged.ok) return { kind: 'clean' }
    const unmerged = await this.command(scratch, 'diff', ['diff', '--name-only', '--diff-filter=U', '-z'], signal)
    if (!unmerged.ok) return { kind: 'failed', failure: unmerged.failure }
    const conflicts = parseNullSeparated(unmerged.stdout)
    // A failed merge with no unmerged entry never reached conflict resolution,
    // so it is a plain failure rather than a conflict report.
    return conflicts.length === 0
      ? { kind: 'failed', failure: merged.failure }
      : { kind: 'conflicted', conflicts: boundConflicts(conflicts, maxConflictPaths) }
  }

  /**
   * Run one bounded git command from a repository directory and classify its failure.
   * @param root - the directory git's own `-C` argument names.
   * @param args - the command's arguments, after `-C`.
   * @param signal - caller cancellation.
   * @returns the command's stdout, or its classified failure.
   */
  private async command(
    root: string,
    name: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<CommandOutcome> {
    const timeout = AbortSignal.timeout(this.commandTimeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    try {
      const { stdout } = await (this.internals.run ?? runNativeCommand)(
        'git',
        ['--no-optional-locks', '-C', root, ...args],
        combined,
      )
      return { ok: true, stdout }
    } catch (error: unknown) {
      if (signal.aborted) throw signal.reason
      const stdout = stdoutOf(error)
      if (timeout.aborted) {
        return {
          ok: false,
          stdout,
          failure: { code: 'timeout', detail: `git ${name} exceeded ${this.commandTimeoutMs}ms` },
        }
      }
      const exitCode = exitCodeOf(error)
      if (exitCode === undefined) {
        return {
          ok: false,
          stdout,
          failure: {
            code: 'git-unavailable',
            detail: `git could not be run for '${name}': ${detailOf(error)}`,
          },
        }
      }
      return {
        ok: false,
        exitCode,
        stdout,
        failure: { code: 'command-failed', detail: `git ${name} exited ${exitCode}` },
      }
    }
  }
}

export default LocalGitAligner

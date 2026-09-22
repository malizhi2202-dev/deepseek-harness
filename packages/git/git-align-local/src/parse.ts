/**
 * Pure decoding for the git alignment provider: exit-status extraction, the
 * three machine-readable command outputs it reads, and the request guards that
 * run before any command is built.
 *
 * Each parser is total over its command's documented format and throws on an
 * undocumented record, because a command's output is a real boundary: the
 * provider classifies a throw as `command-failed` rather than trusting a
 * half-decoded answer.
 *
 * @module @deepseek-ai/dsh-git-align-local/parse
 */

import { GitAlignRequestError } from '@deepseek-ai/dsh-git-align'
import type { ChangeFact, ConflictPaths } from '@deepseek-ai/dsh-git-align'

/**
 * The exit status of a command that ran, whatever language its message prints.
 * A spawn failure carries a string code such as `ENOENT`, so it answers
 * `undefined`: git never answered.
 * @param error - the rejection a command runner raised.
 * @returns the numeric exit status, or `undefined` when the process never ran.
 */
export function exitCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code } = error as { code?: unknown }
  return typeof code === 'number' ? code : undefined
}

/**
 * The stdout a failed command produced, when the runner captured any.
 * @param error - the rejection a command runner raised.
 * @returns the captured stdout, or an empty string.
 */
export function stdoutOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const { stdout } = error as { stdout?: unknown }
  return typeof stdout === 'string' ? stdout : ''
}

/**
 * Render a thrown value as a failure detail.
 * @param error - the value a command or a parser threw.
 * @returns the error's message, or the string form of a non-Error throw.
 */
export function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Require a commit path set the provider can name safely on an argv.
 *
 * The guard runs before any command exists, because an empty path set turns
 * `git commit -- ` into a commit of the whole index — the one failure mode this
 * seam exists to prevent — and a pathspec-magic or absolute entry would name
 * something outside the attribution set.
 * @param paths - repository-relative paths the consumer derived.
 * @throws {GitAlignRequestError} when the set is empty or holds an unusable entry.
 */
export function assertCommitPaths(paths: readonly string[]): void {
  if (paths.length === 0) {
    throw new GitAlignRequestError('git-align: a commit path set must not be empty')
  }
  for (const path of paths) {
    if (path.length === 0
      || path === '.'
      || path === '..'
      || path.startsWith('/')
      || path.startsWith(':')
      || path.includes('\0')) {
      throw new GitAlignRequestError(`git-align: '${path}' is not a repository-relative commit path`)
    }
  }
}

/**
 * Decode one `git diff --numstat -z --no-renames` output.
 *
 * With `-z` a record is `<added>\t<deleted>\t<path>` followed by NUL, the path
 * unquoted; git reports `-` for both counts of a binary entry. The two counts
 * are located by their tabs rather than by splitting on every tab, so a path
 * containing a tab stays one path.
 * @param stdout - the command's stdout.
 * @returns one fact per differing path, in git's order.
 * @throws {Error} when a record is not the documented three-field form.
 */
export function parseNumstatZ(stdout: string): ChangeFact[] {
  const facts: ChangeFact[] = []
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab === -1 ? -1 : record.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) {
      throw new Error(`unparsable numstat record: ${JSON.stringify(record)}`)
    }
    const added = record.slice(0, firstTab)
    const deleted = record.slice(firstTab + 1, secondTab)
    const path = record.slice(secondTab + 1)
    if (path.length === 0) throw new Error('unparsable numstat record: empty path')
    const binary = added === '-' || deleted === '-'
    if (binary) {
      facts.push({ path, insertions: 0, deletions: 0, binary: true })
      continue
    }
    const insertions = Number(added)
    const deletions = Number(deleted)
    if (!Number.isSafeInteger(insertions) || !Number.isSafeInteger(deletions)
      || insertions < 0 || deletions < 0) {
      throw new Error(`unparsable numstat counts in record: ${JSON.stringify(record)}`)
    }
    facts.push({ path, insertions, deletions, binary: false })
  }
  return facts
}

/**
 * Decode one `git merge-tree --write-tree --name-only` stdout produced for a
 * conflicting merge: the merged tree's object id on the first line, then one
 * conflicted path per line.
 * @param stdout - the command's stdout.
 * @returns the conflicted paths, in git's order.
 */
export function parseMergeTreeConflicts(stdout: string): string[] {
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const first = lines[0]
  const head = first !== undefined && /^[0-9a-f]{40,64}$/.test(first) ? lines.slice(1) : lines
  return head
}

/**
 * Decode one NUL-separated path listing, such as `git diff --name-only -z` or
 * `git check-ignore -z`.
 * @param stdout - the command's stdout.
 * @returns the listed paths, in git's order.
 */
export function parseNullSeparated(stdout: string): string[] {
  return stdout.split('\0').filter(entry => entry.length > 0)
}

/**
 * Decode one newline-separated path listing, such as `git check-ignore`.
 * @param stdout - the command's stdout.
 * @returns the listed lines, in git's order.
 */
export function parseLineSeparated(stdout: string): string[] {
  return stdout.split('\n').filter(line => line.length > 0)
}

/**
 * Cut a conflict-path list to the reporting bound while retaining the true total.
 * @param paths - every conflicted path the probe found.
 * @param max - maximum paths the report lists.
 * @returns the listed prefix and the total count.
 */
export function boundConflicts(paths: readonly string[], max: number): ConflictPaths {
  return { paths: paths.slice(0, max), total: paths.length }
}

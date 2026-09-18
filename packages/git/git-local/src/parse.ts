/**
 * Pure parsers for the git machine-readable outputs the local provider reads:
 * `status --porcelain=v2 --branch -z`, `for-each-ref`, and `log --format`.
 *
 * The separators are the control characters git interpolates (`%1f`, `%1e`, and
 * the NUL `-z` mode writes), so a subject carrying a space, tab, or newline
 * cannot shift a field. Each parser is total over its command's documented
 * output: an unknown record shape throws, because a shape git did not document
 * is a contract change to handle, not a row to drop silently.
 * @module @deepseek-ai/dsh-git-local/parse
 */

import type { GitBranch, GitCommit, GitHeadState, GitWorktreeEntry } from '@deepseek-ai/dsh-git'
import type { GitChangeKind } from '@deepseek-ai/dsh-git'

/** `log --format` field separator, written as `%x1f`. */
const FIELD = '\x1f'
/** `log --format` and `for-each-ref` record terminator, written as `%x1e`. */
const RECORD = '\x1e'

/** The change letter porcelain v2 writes, mapped to the seam's kind. */
const CHANGE_OF_LETTER: Readonly<Record<string, GitChangeKind>> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'type-changed',
  U: 'unmerged',
}

/**
 * Map one porcelain v2 status slot letter to the seam's change kind.
 * @param letter - the `XY` pair's single letter for one side.
 * @returns the change kind, or `undefined` for the letters that say "nothing
 *   happened on this side" — a space, or the dot that marks an unmerged entry's
 *   incomparable side.
 */
function changeOf(letter: string): GitChangeKind | undefined {
  return CHANGE_OF_LETTER[letter]
}

/**
 * HEAD facts as the headers fill them in; readonly once the parse is complete.
 */
type HeadDraft = { -readonly [K in keyof GitHeadState]: GitHeadState[K] }

/**
 * Parse `git status --porcelain=v2 --branch -z` output.
 *
 * Every NUL-terminated segment is one header or one change record, and a
 * rename or copy record consumes the segment after it as the pre-rename path.
 * The branch headers are positional facts about HEAD, not a directory listing,
 * so an output holding only headers is a complete clean-tree answer. Untracked
 * entries collapse per directory, as the command's own default reports them.
 * Headers the seam does not read (such as `# stash`) are ignored, so a newer
 * git adding one stays readable; an unrecognized change record is a contract
 * change and throws.
 * @param output - the command's complete stdout.
 * @returns HEAD's state and every worktree entry, in the command's order.
 * @throws Error when a change record does not carry its documented shape.
 */
export function parseStatusPorcelain(output: string): { head: GitHeadState; entries: GitWorktreeEntry[] } {
  const segments = output.split('\0').filter(segment => segment !== '')
  const head: HeadDraft = {}
  const entries: GitWorktreeEntry[] = []
  /** Segments a `2` record consumed as its pre-rename path, skipped as records. */
  const consumed = new Set<number>()
  for (const [index, segment] of segments.entries()) {
    if (consumed.has(index)) continue
    if (segment.startsWith('#')) {
      readHeader(segment, head)
      continue
    }
    const kind = segment.slice(0, 1)
    if (kind === '?') {
      entries.push({ kind: 'untracked', path: segment.slice(2) })
      continue
    }
    // An `!` record appears only under `--ignored`, which this seam never asks
    // for, so it is a record the contract says cannot occur.
    if (kind === '!') {
      throw new Error(`git-local: ignored record outside the contract "${segment}"`)
    }
    if (kind === 'u') {
      const path = segment.split(' ').slice(10).join(' ')
      if (path === '') throw new Error(`git-local: unmerged record without a path "${segment}"`)
      entries.push({ kind: 'changed', path, staged: 'unmerged' })
      continue
    }
    if (kind === '1' || kind === '2') {
      const fields = segment.split(' ')
      const pair = fields[1]
      if (pair === undefined || pair.length !== 2) {
        throw new Error(`git-local: unrecognized porcelain record "${segment}"`)
      }
      entries.push(readTracked(kind, pair, segment, fields, segments[index + 1]))
      // A `2` record's pre-rename path is the next segment; it is consumed here.
      if (kind === '2') consumed.add(index + 1)
      continue
    }
    throw new Error(`git-local: unrecognized porcelain record "${segment}"`)
  }
  return { head, entries }
}

/** Read one `# branch.*` header into the accumulating HEAD state; unread headers are ignored. */
function readHeader(segment: string, head: HeadDraft): void {
  const rest = segment.slice(2)
  if (rest.startsWith('branch.oid ')) {
    const oid = rest.slice('branch.oid '.length)
    if (oid !== '(initial)') head.oid = oid
    return
  }
  if (rest.startsWith('branch.head ')) {
    const name = rest.slice('branch.head '.length)
    if (name !== '(detached)') head.branch = name
    return
  }
  if (rest.startsWith('branch.upstream ')) {
    head.upstream = rest.slice('branch.upstream '.length)
    return
  }
  const ab = /^branch\.ab \+(\d+) -(\d+)$/.exec(rest)
  if (ab !== null) {
    head.ahead = Number(ab[1])
    head.behind = Number(ab[2])
  }
}

/** One tracked change record's parsed entry, mutable while it is being read. */
interface TrackedEntry {
  readonly kind: 'changed'
  readonly path: string
  origPath?: string
  staged?: GitChangeKind
  unstaged?: GitChangeKind
}

/**
 * Read one tracked change record.
 * @param kind - the record's leading kind character, `1` or `2`.
 * @param pair - the record's `XY` slot pair.
 * @param segment - the complete record, for diagnostics.
 * @param fields - the record split on single spaces.
 * @param origSegment - the segment after a `2` record: its pre-rename path.
 * @returns the entry, carrying `origPath` only on a rename or copy.
 * @throws Error when the record lacks its path field, or a rename lacks its
 *   pre-rename segment.
 */
function readTracked(
  kind: string,
  pair: string,
  segment: string,
  fields: string[],
  origSegment: string | undefined,
): Extract<GitWorktreeEntry, { kind: 'changed' }> {
  // The path is everything after the eighth space-delimited field, because a
  // path may itself contain spaces; `2` records carry one more field (`R100`).
  const fixed = kind === '2' ? 9 : 8
  const path = fields.slice(fixed).join(' ')
  if (path === '') throw new Error(`git-local: tracked record without a path "${segment}"`)
  const entry: TrackedEntry = { kind: 'changed', path }
  const staged = changeOf(pair.charAt(0))
  const unstaged = changeOf(pair.charAt(1))
  // Under exactOptionalPropertyTypes an absent side is an absent property, so
  // each optional member is written only when it was read.
  if (staged !== undefined) entry.staged = staged
  if (unstaged !== undefined) entry.unstaged = unstaged
  if (kind === '2') {
    if (origSegment === undefined || origSegment === '') {
      throw new Error(`git-local: rename record without its pre-rename path "${segment}"`)
    }
    entry.origPath = origSegment
  }
  return entry
}

/**
 * Parse `git for-each-ref --format='%(refname:short)%1f%(objectname)%1e' refs/heads/` output.
 *
 * Each record ends with the terminator followed by a newline, so a record after
 * the first opens with that newline.
 * @param output - the command's complete stdout.
 * @returns the branch heads in the command's order.
 * @throws Error when a record does not carry both fields.
 */
export function parseBranchList(output: string): GitBranch[] {
  const branches: GitBranch[] = []
  for (const raw of output.split(RECORD)) {
    if (raw === '' || raw === '\n') continue
    const record = raw.startsWith('\n') ? raw.slice(1) : raw
    const [name, tip] = record.split(FIELD)
    if (name === undefined || tip === undefined || name === '' || tip === '') {
      throw new Error(`git-local: unrecognized branch record "${record}"`)
    }
    branches.push({ name, tip })
  }
  return branches
}

/**
 * Parse `git log --format='%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e'` output.
 *
 * Each record ends with the terminator followed by a newline, so a record after
 * the first opens with that newline.
 * @param output - the command's complete stdout.
 * @returns the commits in the command's order, newest first.
 * @throws Error when a record does not carry all five fields.
 */
export function parseHistory(output: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const raw of output.split(RECORD)) {
    if (raw === '' || raw === '\n') continue
    const record = raw.startsWith('\n') ? raw.slice(1) : raw
    const fields = record.split(FIELD)
    const oid = fields[0]
    const parents = fields[1]
    const author = fields[2]
    const authoredAt = fields[3]
    const subject = fields[4]
    if (oid === undefined || parents === undefined || author === undefined
      || authoredAt === undefined || subject === undefined) {
      throw new Error(`git-local: unrecognized commit record "${record}"`)
    }
    commits.push({
      oid,
      parents: parents.split(' ').filter(parent => parent !== ''),
      author,
      authoredAt,
      subject,
    })
  }
  return commits
}

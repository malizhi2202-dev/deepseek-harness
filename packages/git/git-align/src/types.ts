/**
 * Vocabulary for the git alignment capability seam (`ctx.gitAlign`). Types only:
 * the Service Definition and its providers import this module without runtime code.
 *
 * The seam is the write half of repository handling, beside the read-only
 * `ctx.git` observation seam. Every operation answers a discriminated value
 * instead of throwing for an expected git failure, because the consumer records
 * the answer in a durable ledger and never retries it; the only throw is a
 * caller cancellation, which is the caller's own decision.
 *
 * @module @deepseek-ai/dsh-git-align/types
 */

/** How one alignment attempt reaches the target revision. */
export type AlignStrategy = 'ff-only' | 'merge'

/**
 * Raw coordinates of one alignment target, as the consumer observed them.
 *
 * `upstream` is git's short spelling of the tracked branch (`origin/main`); the
 * provider splits it into a remote and a ref name in {@link AlignSpec}.
 */
export interface AlignRequest {
  /** Absolute directory of the repository work tree; travels as git's own `-C` argument. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling, such as `origin/main`. */
  readonly upstream: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}

/**
 * One resolved alignment target: the request plus the remote and ref name a
 * fetch names, derived once by the provider so no operation re-derives them.
 */
export interface AlignSpec {
  /** Absolute directory of the repository work tree. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling. */
  readonly upstream: string
  /** Remote the upstream ref lives on. */
  readonly remote: string
  /** Ref name the fetch asks that remote for. */
  readonly refspec: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}

/** Stable failure codes every operation reports as a value. */
export type GitAlignFailureCode =
  | 'timeout'
  | 'git-unavailable'
  | 'command-failed'

/** One bounded git failure: a code, plus a diagnostic that carries no repository content. */
export interface GitAlignFailure {
  /** Which bound or boundary produced the failure. */
  readonly code: GitAlignFailureCode
  /** Short diagnostic naming the git command and its own exit status. */
  readonly detail: string
}

/** The answer to one fetch attempt. */
export type FetchResult =
  | { readonly kind: 'fetched' }
  | { readonly kind: 'failed'; readonly failure: GitAlignFailure }

/** A bounded conflict-path report: the listed prefix plus the true total. */
export interface ConflictPaths {
  /** Conflicting paths relative to the repository root, cut to the requested bound. */
  readonly paths: readonly string[]
  /** Total conflicting paths; greater than `paths.length` when the bound cut the list. */
  readonly total: number
}

/** What one probe asks beyond the target. */
export interface ProbeRequest {
  /** Absolute directory the isolated-worktree fallback creates its scratch tree under. */
  readonly worktreeRoot: string
  /** Scratch tree directory name; unique per alignment target. */
  readonly scratchName: string
  /** Maximum conflicting paths the answer lists. */
  readonly maxConflictPaths: number
}

/** The answer to one merge probe, which never touches the worktree. */
export type ProbeResult =
  | { readonly kind: 'clean' }
  | { readonly kind: 'conflicted'; readonly conflicts: ConflictPaths }
  | { readonly kind: 'failed'; readonly failure: GitAlignFailure }

/**
 * The answer to one alignment write.
 *
 * The aligned case carries no object id: the consumer re-observes HEAD through
 * `ctx.git` after every write, and that observation is the single authority for
 * what HEAD became.
 */
export type ApplyResult =
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'merge-failed'; readonly failure: GitAlignFailure }
  | { readonly kind: 'merge-failed-dirty'; readonly failure: GitAlignFailure }

/** One path's line accounting in the worktree relative to HEAD. */
export interface ChangeFact {
  /** Path relative to the repository root. */
  readonly path: string
  /** Lines added; `0` for a binary entry, which git reports without counts. */
  readonly insertions: number
  /** Lines deleted; `0` for a binary entry. */
  readonly deletions: number
  /** Whether git reports the entry as binary. */
  readonly binary: boolean
}

/** Bounded diff facts for one path set, all read from the same path set. */
export interface ChangeFacts {
  /** One entry per path that differs from HEAD. */
  readonly files: readonly ChangeFact[]
  /** Total lines added across {@link files}. */
  readonly insertions: number
  /** Total lines deleted across {@link files}. */
  readonly deletions: number
}

/** The answer to one diff-facts read. */
export type ChangeFactsResult =
  | { readonly kind: 'facts'; readonly facts: ChangeFacts }
  | { readonly kind: 'failed'; readonly failure: GitAlignFailure }

/** The answer to one ignore check, listing the subset of the input paths git ignores. */
export type IgnoreResult =
  | { readonly kind: 'checked'; readonly ignored: readonly string[] }
  | { readonly kind: 'failed'; readonly failure: GitAlignFailure }

/** What one commit asks beyond the target. */
export interface CommitRequest {
  /** Paths relative to the repository root; the commit contains exactly these. */
  readonly paths: readonly string[]
  /** Complete commit message, already bounded by the consumer. */
  readonly message: string
  /** Whether the repository's own commit hooks run. */
  readonly runHooks: boolean
}

/**
 * The answer to one commit attempt. The created commit's identity is read from
 * the post-write HEAD observation the consumer performs regardless, so this
 * answer states only that a commit landed.
 */
export type CommitResult =
  | { readonly kind: 'committed' }
  | {
    readonly kind: 'failed'
    readonly failure: GitAlignFailure
    /** Whether the index mutation this attempt made was rolled back. */
    readonly indexRestored: boolean
  }

/** The answer to one "does a remote-tracking ref already hold this commit" check. */
export type PushedResult =
  | { readonly kind: 'checked'; readonly pushed: boolean }
  | { readonly kind: 'failed'; readonly failure: GitAlignFailure }

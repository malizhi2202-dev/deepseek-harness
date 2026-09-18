/**
 * Vocabulary for the git observation capability seam (`ctx.git`). Types only:
 * the Service Definition and providers import this module without runtime code.
 *
 * The seam observes; it never mutates. Every fact is a read-only answer about
 * the repository that contains a working directory, and the observation is one
 * discriminated answer — a repository, or the explicit absence of one — so a
 * consumer never mistakes "no repository here" for a failure.
 *
 * @module @deepseek-ai/dsh-git/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** What one tracked worktree entry did on one side of the index. */
export type GitChangeKind =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type-changed'
  | 'unmerged'

/** One entry of the worktree status read. */
export type GitWorktreeEntry =
  | {
    /** A tracked entry with changes on the index side, the worktree side, or both. */
    readonly kind: 'changed'
    /** The entry's path, relative to the repository root. */
    readonly path: string
    /** The path before a rename or copy, present only on such entries. */
    readonly origPath?: string
    /** The staged side; absent when the index matches the commit. */
    readonly staged?: GitChangeKind
    /** The worktree side; absent when the worktree matches the index. */
    readonly unstaged?: GitChangeKind
  }
  | {
    /** A path present in neither the commit nor the index, as git's own
     *  summary reports it: an untracked directory collapses to one entry. */
    readonly kind: 'untracked'
    /** The entry's path, relative to the repository root. */
    readonly path: string
  }

/** One local branch head. */
export interface GitBranch {
  /** The branch's short name, as `refs/heads/` strips it. */
  readonly name: string
  /** Full object id of the branch's tip commit. */
  readonly tip: string
}

/** What HEAD points at, and where its branch stands against its upstream. */
export interface GitHeadState {
  /** Full object id of the commit HEAD points at; absent while the branch is unborn. */
  readonly oid?: string
  /** The checked-out branch's short name; absent when HEAD is detached. */
  readonly branch?: string
  /** The branch HEAD tracks; absent when the branch tracks nothing or HEAD is detached. */
  readonly upstream?: string
  /** Commits on HEAD that the upstream does not hold; absent without an upstream. */
  readonly ahead?: number
  /** Commits on the upstream that HEAD does not hold; absent without an upstream. */
  readonly behind?: number
}

/** One commit of the bounded history read, newest first. */
export interface GitCommit {
  /** Full object id of the commit. */
  readonly oid: string
  /** Full object ids of the commit's parents, in git's own order. */
  readonly parents: readonly string[]
  /** The author's name exactly as the commit records it. */
  readonly author: string
  /** The author date as ISO-8601 with offset, exactly as the commit records it. */
  readonly authoredAt: string
  /** The commit's subject line. */
  readonly subject: string
}

/** The bounded observation of one repository. */
export interface GitRepositorySnapshot {
  /** The repository's work-tree root as git reports it, in the provider's execution world. */
  readonly root: string
  /** What HEAD points at. */
  readonly head: GitHeadState
  /** Local branch heads in git's own order, bounded by {@link MAX_OBSERVATION_ITEMS}. */
  readonly branches: readonly GitBranch[]
  /** Whether more branch heads exist past the branch bound. */
  readonly branchesTruncated: boolean
  /** Commits reachable from HEAD, newest first, bounded by {@link MAX_OBSERVATION_ITEMS}. */
  readonly history: readonly GitCommit[]
  /** Whether older commits exist past the history bound. */
  readonly historyTruncated: boolean
  /** Worktree entries with changes, untracked, or ignored, bounded by {@link MAX_OBSERVATION_ITEMS}. */
  readonly worktree: readonly GitWorktreeEntry[]
  /** Whether more worktree entries exist past the worktree bound. */
  readonly worktreeTruncated: boolean
}

/** One observation read's complete answer. */
export type GitObservation =
  | {
    /** The directory is not inside a git work tree; there is nothing to observe. */
    readonly kind: 'absent'
  }
  | {
    /** The directory is inside a git work tree. */
    readonly kind: 'repository'
  } & GitRepositorySnapshot

/** Stable codes for the git observation seam's own failures. */
export type GitErrorCode =
  | 'GIT_UNAVAILABLE'
  | 'GIT_COMMAND_FAILED'

/**
 * Typed git observation error. Extends `HarnessError` so it carries a stable
 * {@link GitErrorCode} and chains `cause`. The vocabulary is closed: a provider
 * that cannot run git at all raises `GIT_UNAVAILABLE`, and a git command that
 * fails where the contract expects it to succeed raises `GIT_COMMAND_FAILED`.
 * "Not a repository" is not an error — it is the `absent` observation.
 */
export class GitError extends HarnessError {
  override readonly code: GitErrorCode

  constructor(message: string, code: GitErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

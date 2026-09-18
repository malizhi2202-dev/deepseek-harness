/**
 * Service Definition for the git observation capability seam (`ctx.git`): a
 * read-only view of the git repository that contains a working directory.
 *
 * The seam answers one question per read — what the repository at a directory
 * looks like right now — and its answer is total: `absent` when the directory
 * is not inside a git work tree, a {@link GitRepositorySnapshot} when it is, or
 * a {@link GitError} when git itself could not answer. A consumer never guesses
 * between "no repository" and "the read failed".
 *
 * What the seam will never do is mutate: no checkout, commit, push, or pull
 * crosses this contract. Providers translate the contract into their own
 * execution world's git; consumers own what an observation means.
 *
 * Every list the snapshot carries is bounded by {@link MAX_OBSERVATION_ITEMS},
 * the seam's single safety bound: it caps the history walk, the branch listing,
 * and the worktree status read together, so no repository size turns one read
 * into an unbounded pull. A list cut at the bound says so with its truncated
 * flag instead of dropping entries silently.
 * @module @deepseek-ai/dsh-git
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { GitObservation } from './types.ts'

export { GitError } from './types.ts'
export type {
  GitBranch,
  GitChangeKind,
  GitCommit,
  GitErrorCode,
  GitHeadState,
  GitObservation,
  GitRepositorySnapshot,
  GitWorktreeEntry,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitObserver
  }
}

/**
 * The single safety bound on one observation read.
 *
 * One number bounds every list the seam returns — the commits the history walk
 * reads, the branch heads the listing carries, and the entries the worktree
 * status read reports — whatever the repository's history, branch count, or
 * working state contains. A list cut at the bound reports `truncated`, so a
 * consumer says "more exists" instead of showing a shorter list as the whole
 * one.
 */
export const MAX_OBSERVATION_ITEMS = 200

/**
 * Abstract git observation service. Subclass, implement {@link observe}, and
 * load the subclass as a plugin — it registers as `ctx.git` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - {@link observe} resolves `absent` for a directory outside any git work
 *   tree; that is an answer, not a failure.
 * - Every list in the snapshot is cut to {@link MAX_OBSERVATION_ITEMS} with its
 *   truncated flag set when the bound dropped entries.
 * - `signal` aborts the read; an aborted read rejects with the abort reason.
 * - Nothing in the implementation writes to the repository.
 */
export abstract class GitObserver extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * Observe the git repository that contains one working directory.
   * @param cwd - the directory to observe from; the repository's work-tree root
   *   is whatever git reports for it, not necessarily the directory itself.
   * @param signal - caller cancellation.
   * @returns the repository's bounded snapshot, or `absent` outside any work tree.
   */
  abstract observe(cwd: string, signal: AbortSignal): Promise<GitObservation>
}

export default GitObserver

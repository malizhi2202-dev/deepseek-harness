/**
 * Pure presentation folds over a repository snapshot: the history lanes the
 * graph draws, the worktree counts the status line reads, and the oid short
 * form the rows show.
 *
 * Every fold is deterministic over the snapshot alone — no clock, no locale —
 * so the component renders their output directly and the specs pin them with
 * plain data.
 * @module @deepseek-ai/dsh-client-ui-sidebar-git/history
 */

import type { GitCommit, GitWorktreeEntry } from '@deepseek-ai/dsh-api-workspace-git/types'

/**
 * Assign each commit a graph lane, newest first.
 *
 * The fold keeps one expected oid per lane: a commit found at a lane keeps it,
 * its first parent inherits the lane, and every further parent opens a lane of
 * its own. A commit reachable from two lanes keeps the first and closes the
 * second, so a lane ends once its history merges back.
 * @param commits - the bounded history, newest first.
 * @returns each commit's lane index, in the same order.
 */
export function historyLanes(commits: readonly GitCommit[]): number[] {
  /** Lane i expects `waiting[i]`; `null` is a free lane. */
  const waiting: (string | null)[] = []
  const firstFreeLane = (): number => {
    const at = waiting.indexOf(null)
    if (at >= 0) return at
    waiting.push(null)
    return waiting.length - 1
  }
  return commits.map((commit) => {
    let lane = waiting.indexOf(commit.oid)
    if (lane < 0) lane = firstFreeLane()
    for (let other = 0; other < waiting.length; other += 1) {
      // A second lane waiting on this same commit ends here; its history has
      // merged back into the lane that keeps it.
      if (other !== lane && waiting[other] === commit.oid) waiting[other] = null
    }
    const [first, ...rest] = commit.parents
    waiting[lane] = first ?? null
    for (const parent of rest) {
      if (waiting.includes(parent)) continue
      const open = firstFreeLane()
      waiting[open] = parent
    }
    return lane
  })
}

/** What the status line counts over the worktree entries. */
export interface WorktreeCounts {
  /** Entries with a staged change, including unmerged ones. */
  readonly staged: number
  /** Entries with an unstaged change. */
  readonly unstaged: number
  /** Untracked entries, one per collapsed directory. */
  readonly untracked: number
}

/**
 * Count the worktree's changes for the status line.
 * @param entries - the snapshot's worktree entries.
 * @returns the three counts the line shows.
 */
export function countWorktree(entries: readonly GitWorktreeEntry[]): WorktreeCounts {
  const counts = { staged: 0, unstaged: 0, untracked: 0 }
  for (const entry of entries) {
    if (entry.kind === 'untracked') {
      counts.untracked += 1
      continue
    }
    if (entry.staged !== undefined) counts.staged += 1
    if (entry.unstaged !== undefined) counts.unstaged += 1
  }
  return counts
}

/**
 * The short oid form the rows show.
 * @param oid - a full object id.
 * @returns its first seven hex digits.
 */
export function shortOid(oid: string): string {
  return oid.slice(0, 7)
}

/**
 * The date part of a commit's author date.
 * @param authoredAt - the ISO-8601 author date the commit records.
 * @returns its `YYYY-MM-DD` prefix.
 */
export function commitDay(authoredAt: string): string {
  return authoredAt.slice(0, 10)
}

/**
 * The pure presentation folds over a repository snapshot: lane assignment,
 * worktree counts, and the two short forms the rows show.
 */
import { describe, expect, it } from 'vitest'
import { commitDay, countWorktree, historyLanes, shortOid } from '../src/client/history.ts'
import type { GitCommit, GitWorktreeEntry } from '@deepseek-ai/dsh-api-workspace-git/types'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

function commit(oid: string, parents: readonly string[], subject: string): GitCommit {
  return { oid, parents, author: 'probe', authoredAt: '2026-09-18T13:20:05+08:00', subject }
}

describe('historyLanes', () => {
  it('keeps a single-parent line in one lane', () => {
    const commits = [commit(C, [B], 'third'), commit(B, [A], 'second'), commit(A, [], 'first')]
    expect(historyLanes(commits)).toEqual([0, 0, 0])
  })

  it('draws a further parent\'s history on the lane the merge opened for it', () => {
    // C merges B and A; B is the first parent and keeps lane 0, while A\'s
    // history draws on lane 1 once the first-parent line ends.
    const X = 'x'.repeat(40)
    const commits = [
      commit(C, [B, A], 'merge'),
      commit(B, [X], 'on the first parent line'),
      commit(X, [], 'first-parent root'),
      commit(A, [], 'second-parent root'),
    ]
    expect(historyLanes(commits)).toEqual([0, 0, 0, 1])
  })

  it('closes the second lane when its history merges back into the first', () => {
    // C merges B and A, and B already descends from A: A lands on lane 0, and
    // the lane that waited for it closes.
    const commits = [commit(C, [B, A], 'merge'), commit(B, [A], 'side'), commit(A, [], 'root')]
    expect(historyLanes(commits)).toEqual([0, 0, 0])
  })

  it('offers a closed lane to the next parent that needs one', () => {
    // After the merge above closed lane 1, a later merge\'s second parent
    // reuses it instead of opening a third.
    const D = 'd'.repeat(40)
    const E = 'e'.repeat(40)
    const F = 'f'.repeat(40)
    const commits = [
      commit(C, [B, A], 'first merge'),
      commit(B, [A], 'side'),
      commit(A, [], 'root'),
      commit(D, [E, F], 'second merge'),
      commit(E, [], 'second-merge first parent'),
      commit(F, [], 'second-merge second parent'),
    ]
    expect(historyLanes(commits)).toEqual([0, 0, 0, 0, 0, 1])
  })

  it('does not open a lane for a further parent another lane already expects', () => {
    const D = 'd'.repeat(40)
    const E = 'e'.repeat(40)
    // The second merge's further parent A is already lane 1's expectation, so
    // only its first parent opens a lane.
    const commits = [commit(C, [B, A], 'merge'), commit(D, [E, A], 'second merge')]
    expect(historyLanes(commits)).toEqual([0, 2])
  })

  it('opens a new lane for a commit no lane expects', () => {
    // A commit that is nobody\'s expected parent yet takes the first free
    // lane; with none free, it opens the next one.
    const commits = [commit(C, [B, A], 'merge'), commit(B, [A], 'side'), commit(C, [B], 'unrelated')]
    expect(historyLanes(commits).at(-1)).toBe(2)
  })

  it('answers an empty history with no lanes', () => {
    expect(historyLanes([])).toEqual([])
  })

  it('draws two roots on one lane when the first ends before the second starts', () => {
    // After a parentless commit, its lane expects nothing; a second root
    // reuses it rather than claiming a fresh one.
    const commits = [commit(A, [], 'root'), commit(B, [], 'other root')]
    expect(historyLanes(commits)).toEqual([0, 0])
  })
})

describe('countWorktree', () => {
  it('counts each side and the untracked separately', () => {
    const entries: GitWorktreeEntry[] = [
      { kind: 'changed', path: 'a.txt', staged: 'modified', unstaged: 'modified' },
      { kind: 'changed', path: 'b.txt', staged: 'added' },
      { kind: 'changed', path: 'c.txt', unstaged: 'deleted' },
      { kind: 'untracked', path: 'd.txt' },
    ]
    expect(countWorktree(entries)).toEqual({ staged: 2, unstaged: 2, untracked: 1 })
  })

  it('counts an unmerged entry as staged only', () => {
    const entries: GitWorktreeEntry[] = [{ kind: 'changed', path: 'conflict.txt', staged: 'unmerged' }]
    expect(countWorktree(entries)).toEqual({ staged: 1, unstaged: 0, untracked: 0 })
  })

  it('answers zero for a clean tree', () => {
    expect(countWorktree([])).toEqual({ staged: 0, unstaged: 0, untracked: 0 })
  })
})

describe('shortOid', () => {
  it('keeps the first seven hex digits', () => {
    expect(shortOid('868919447ee24b11c2ae361450fbe8cbbcf2596a')).toBe('8689194')
  })
})

describe('commitDay', () => {
  it('keeps the date part of the author date', () => {
    expect(commitDay('2026-09-18T13:20:05+08:00')).toBe('2026-09-18')
  })
})

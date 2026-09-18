// @vitest-environment jsdom
/**
 * The body against a scripted observation.
 *
 * What is asserted is the reader's contract: the panel asks for its observation
 * on mount, draws each section of the snapshot with the current branch and the
 * head's facts reading stronger, shows the truncation notes the snapshot asks
 * for, replaces the whole panel for each unsettled state, and the reload
 * button asks for the observation again.
 */
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { mountBody } from './mount.client.tsx'
import type { GitRepositorySnapshot } from '@deepseek-ai/dsh-api-workspace-git/types'

const OID = '868919447ee24b11c2ae361450fbe8cbbcf2596a'
const OTHER = 'bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e'

/** Earlier mounts leave their nodes behind; each test draws only its own. */
afterEach(() => { cleanup() })

function snapshot(over: Partial<GitRepositorySnapshot> = {}): GitRepositorySnapshot {
  return {
    root: '/work/repo',
    head: { oid: OID, branch: 'main' },
    branches: [{ name: 'main', tip: OID }],
    branchesTruncated: false,
    history: [],
    historyTruncated: false,
    worktree: [],
    worktreeTruncated: false,
    ...over,
  }
}

describe('GitBody', () => {
  it('shows the no-workspace state for a session without a working directory and asks for nothing', () => {
    const { script, view } = mountBody(null)
    expect(view.getByText('这个会话没有工作区目录。')).toBeDefined()
    expect(script.calls).toEqual([])
  })

  it('asks for the observation on mount and shows the loading line until it settles', () => {
    const { script, view } = mountBody()
    expect(script.calls.length).toBe(1)
    expect(view.getByText('正在读取仓库状态…')).toBeDefined()
  })

  it('shows the absent line when the workspace is not inside a repository', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(view.getByText('这个会话的工作区不在 git 仓库里。')).toBeDefined()
  })

  it('shows the unavailable line for a host that cannot run git', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: false, error: new RemoteError('workspace-git/unavailable', 'spawn git ENOENT', {}) })
    expect(view.getByText('无法在这个主机上运行 git：spawn git ENOENT')).toBeDefined()
  })

  it('shows the failed line for an observation that ran and failed', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: false, error: new RemoteError('workspace-git/failed', 'broken repository', {}) })
    expect(view.getByText('读取仓库状态失败：broken repository')).toBeDefined()
  })

  it('draws the head facts, the branch list, and the repository title', async () => {
    const { script, view } = mountBody('/work/repo')
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          head: { oid: OID, branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 },
          branches: [{ name: 'main', tip: OID }, { name: 'feature', tip: OTHER }],
        }),
      },
    })
    expect(view.getByText('repo')).toBeDefined()
    expect(view.getAllByText('main').length).toBe(2)
    expect(view.getByText('跟踪 origin/main')).toBeDefined()
    expect(view.getByText('领先 2 个提交，落后 1 个')).toBeDefined()
    expect(view.getByText(`当前提交 ${OID.slice(0, 7)}`)).toBeDefined()
    const current = view.container.querySelector<HTMLLIElement>('[data-git-branches-row="main"]')
    expect(current?.dataset.gitBranchesCurrent).toBe('true')
    const other = view.container.querySelector<HTMLLIElement>('[data-git-branches-row="feature"]')
    expect(other?.dataset.gitBranchesCurrent).toBeUndefined()
  })

  it('names a detached head and an unborn branch without inventing a commit', async () => {
    const detached = mountBody()
    await detached.script.settle({
      ok: true,
      value: { kind: 'repository', ...snapshot({ head: { oid: OID } }) },
    })
    expect(detached.view.getByText('分离头指针（不在线上分支）')).toBeDefined()
    const unborn = mountBody()
    await unborn.script.settle({
      ok: true,
      value: { kind: 'repository', ...snapshot({ head: { branch: 'main' }, history: [] }) },
    })
    expect(unborn.view.getByText('这个分支还没有提交。')).toBeDefined()
    // The detached mount above also shows the empty-history note, so scope
    // this query to the unborn mount's own tree.
    expect(unborn.view.container.querySelector('[data-git-history-row="empty"]')?.textContent).toBe('还没有提交。')
  })

  it('draws the history with lane gutters and the author-date day', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          history: [
            { oid: OTHER, parents: [OID], author: 'probe', authoredAt: '2026-09-18T13:20:05+08:00', subject: 'second' },
            { oid: OID, parents: [], author: 'probe', authoredAt: '2026-09-17T09:00:00+08:00', subject: 'first' },
          ],
        }),
      },
    })
    expect(view.getByText('second')).toBeDefined()
    expect(view.getByText('first')).toBeDefined()
    expect(view.getByText('probe · 2026-09-18')).toBeDefined()
    const rows = view.container.querySelectorAll('[data-git-commit]')
    expect(rows.length).toBe(2)
    expect(rows[0]?.getAttribute('data-git-lane')).toBe('0')
    expect(rows[1]?.getAttribute('data-git-lane')).toBe('0')
  })

  it('shows the truncation note only when the snapshot says the history was cut', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          history: [{ oid: OID, parents: [], author: 'probe', authoredAt: '2026-09-18T13:20:05+08:00', subject: 'only' }],
          historyTruncated: true,
        }),
      },
    })
    expect(view.getByText('提交太多，只显示最近的 1 条。')).toBeDefined()
  })

  it('draws the worktree entries with their side badges and the status counts', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          worktree: [
            { kind: 'changed', path: 'a.txt', staged: 'modified', unstaged: 'modified' },
            { kind: 'changed', path: 'b.txt', staged: 'renamed', origPath: 'old.txt' },
            { kind: 'changed', path: 'c.txt', unstaged: 'deleted' },
            { kind: 'untracked', path: 'd.txt' },
          ],
        }),
      },
    })
    expect(view.getByText('已暂存 2 · 未暂存 2 · 未跟踪 1')).toBeDefined()
    expect(view.getByText('a.txt')).toBeDefined()
    expect(view.getByText('b.txt ← old.txt')).toBeDefined()
    expect(view.getByText('c.txt')).toBeDefined()
    expect(view.getByText('d.txt')).toBeDefined()
    expect(view.getByText('已暂存 修改')).toBeDefined()
    expect(view.getByText('未暂存 修改')).toBeDefined()
    expect(view.getByText('已暂存 重命名')).toBeDefined()
    expect(view.getByText('未暂存 删除')).toBeDefined()
    expect(view.getByText('未跟踪')).toBeDefined()
  })

  it('says so when the repository has no branches at all', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          head: { branch: 'main' },
          branches: [],
          history: [],
        }),
      },
    })
    expect(view.getByText('还没有本地分支。')).toBeDefined()
  })

  it('shows the branch truncation note when the snapshot was cut', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: { kind: 'repository', ...snapshot({ branchesTruncated: true }) },
    })
    expect(view.getByText('分支太多，只显示了一部分。')).toBeDefined()
  })

  it('shows the ahead/behind line only when the head carries both counts', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: { kind: 'repository', ...snapshot({ head: { oid: OID, branch: 'main', ahead: 2 } }) },
    })
    expect(view.queryByText('领先 2 个提交，落后 1 个')).toBeNull()
  })

  it('titles a repository whose root is nothing but separators with the root itself', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: { kind: 'repository', ...snapshot({ root: '/' }) },
    })
    expect(view.getByText('/')).toBeDefined()
  })

  it('names every change kind a worktree side can carry', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          worktree: [
            { kind: 'changed', path: 'a.txt', staged: 'added', unstaged: 'copied' },
            { kind: 'changed', path: 'b.txt', staged: 'type-changed', unstaged: 'unmerged' },
          ],
        }),
      },
    })
    expect(view.getByText('已暂存 新增')).toBeDefined()
    expect(view.getByText('未暂存 复制')).toBeDefined()
    expect(view.getByText('已暂存 类型变更')).toBeDefined()
    expect(view.getByText('未暂存 未合并')).toBeDefined()
  })

  it('says the working tree is clean when it has no entries', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: true, value: { kind: 'repository', ...snapshot() } })
    expect(view.getByText('工作区是干净的。')).toBeDefined()
    expect(view.getByText('已暂存 0 · 未暂存 0 · 未跟踪 0')).toBeDefined()
  })

  it('shows the worktree truncation note when the snapshot was cut', async () => {
    const { script, view } = mountBody()
    await script.settle({
      ok: true,
      value: {
        kind: 'repository',
        ...snapshot({
          worktree: [{ kind: 'untracked', path: 'd.txt' }],
          worktreeTruncated: true,
        }),
      },
    })
    expect(view.getByText('改动太多，只显示了一部分。')).toBeDefined()
  })

  it('asks again from the reload button and replaces the panel with the new answer', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: true, value: { kind: 'repository', ...snapshot() } })
    fireEvent.click(view.getByRole('button', { name: '重新读取' }))
    expect(script.calls.length).toBe(2)
    expect(view.getByText('正在读取仓库状态…')).toBeDefined()
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(view.getByText('这个会话的工作区不在 git 仓库里。')).toBeDefined()
  })

  it('asks exactly once for a tab that holds a settled state', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(script.calls.length).toBe(1)
    expect(view.getByText('这个会话的工作区不在 git 仓库里。')).toBeDefined()
  })
})

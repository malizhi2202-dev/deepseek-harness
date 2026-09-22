// @vitest-environment jsdom
/**
 * The body against a scripted ledger read.
 *
 * What is asserted is the reader's contract, and the design's metric for this
 * panel: the four questions every run must answer, in order; a sentence rather
 * than an empty card for every outcome, including the ones that refused, were
 * superseded, or correctly did nothing; the workspace's own state with its
 * bounds; and one read control that asks for the ledger again. Nothing here
 * writes, so no test can find a control that would.
 */
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteError, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AutomationLedgerView } from '@deepseek-ai/dsh-api-workspace-automation/types'
import { outcomeLine } from '../src/client/lines.ts'
import type { AutomationTranslate } from '../src/client/lines.ts'
import { zh } from '../src/client/locales.ts'
import {
  COMMIT, EVERY_OUTCOME, WORKSPACE_ID, WORKSPACE_PATH, WORKSPACE_TITLE,
  pathsOf, recordedLedger, runOf, withoutCommit,
} from './fixtures.client.ts'
import { mountBody } from './mount.client.tsx'

const t: AutomationTranslate = makeTranslate(zh)

/** Earlier mounts leave their nodes behind; each test draws only its own. */
afterEach(() => { cleanup() })

/** Mount, then answer the panel's read with one ledger. */
async function settleWith(value: AutomationLedgerView) {
  const mounted = mountBody()
  await mounted.script.settle({ ok: true, value })
  return mounted
}

/** The runs one recorded ledger carries, newest first as the projection orders them. */
const ALL_RUNS = EVERY_OUTCOME.map((outcome, index) => runOf(outcome, {
  id: `run-${String(index)}`,
  trigger: index % 2 === 0 ? 'due' : 'turn-end',
}))

describe('AutomationBody states', () => {
  it('shows the no-workspace line for a session in no registered workspace and asks for nothing', () => {
    const { script, view } = mountBody({ workspace: null })
    expect(view.getByText('这个会话不属于任何已注册的工作区，没有工作区台账可读。')).toBeDefined()
    expect(view.container.querySelector('[data-automation-state="no-workspace"]')).not.toBeNull()
    expect(script.calls).toEqual([])
  })

  it('asks for the ledger on mount and shows the loading line until it settles', () => {
    const { script, view } = mountBody()
    expect(script.calls.length).toBe(1)
    expect(view.container.querySelector('[data-automation-state="loading"]')).not.toBeNull()
    expect(view.getByText('正在读取自动化台账…')).toBeDefined()
  })

  it('asks for nothing for a record that already ended', () => {
    const { script, view } = mountBody({ aborted: true })
    expect(script.calls).toEqual([])
    expect(view.container.querySelector('[data-automation-state="loading"]')).not.toBeNull()
  })

  it('shows the failed line when the ledger could not be read at all', async () => {
    const mounted = mountBody()
    await mounted.script.settle({ ok: false, error: new RemoteError('gateway/internal', 'ledger unreadable', {}) })
    expect(mounted.view.getByText('读取自动化台账失败：ledger unreadable')).toBeDefined()
  })

  it('says a workspace has no run yet rather than showing an empty ledger', async () => {
    const { view } = await settleWith({ kind: 'unrecorded', workspaceId: WORKSPACE_ID })
    expect(view.container.querySelector('[data-automation-state="unrecorded"]')).not.toBeNull()
    expect(view.getByText('这个工作区还没有运行记录：定时器可能还没到点，或者从未启用。')).toBeDefined()
  })

  it('draws the workspace it belongs to and asks for the ledger again on the one control', async () => {
    const { script, view } = await settleWith({ kind: 'recorded', ...recordedLedger([]) })
    expect(view.getByText(WORKSPACE_TITLE)).toBeDefined()
    expect(view.getByText(WORKSPACE_PATH)).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '重新读取台账' }))
    expect(script.calls.length).toBe(2)
    expect(script.outstanding()).toBe(1)
  })
})

describe('AutomationBody workspace state', () => {
  it('draws an armed writable workspace with its baseline and last run', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([], { uncommittedPaths: pathsOf(['src/left.ts', 'src/also.ts'], 5) }),
    })
    expect(view.getByText('定时器已启用')).toBeDefined()
    expect(view.getByText('可写')).toBeDefined()
    expect(view.getByText('已对齐到 1111111')).toBeDefined()
    expect(view.getByText('上次运行：2026-09-21T10:00:02.000Z')).toBeDefined()
    expect(view.getByText('未提交余量 5 项')).toBeDefined()
    const paths = [...view.container.querySelectorAll('[data-automation-path]')].map(node => node.textContent)
    expect(paths).toEqual(['src/left.ts', 'src/also.ts'])
  })

  it('draws an off, observing, suspended workspace with no baseline and no run yet', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([], {
        enabled: false,
        mode: 'observe',
        consecutiveFailures: 3,
        baselineUpstreamOid: null,
        lastRunAt: null,
        nextEarliestRunAt: '2026-09-21T11:00:00.000Z',
        suspendedReason: 'three consecutive failures',
      }),
    })
    expect(view.getByText('定时器已停用')).toBeDefined()
    expect(view.getByText('只观察')).toBeDefined()
    expect(view.getByText('连续失败 3 次')).toBeDefined()
    expect(view.getByText('还没有对齐基线')).toBeDefined()
    expect(view.getByText('还没有运行过')).toBeDefined()
    expect(view.getByText('下次可运行：2026-09-21T11:00:00.000Z')).toBeDefined()
    expect(view.getByText('已挂起：three consecutive failures')).toBeDefined()
    expect(view.getByText('没有未提交余量')).toBeDefined()
  })
})

describe('AutomationBody runs', () => {
  it('answers the four questions for every outcome the wire can carry, in the design\'s order', async () => {
    const { view } = await settleWith({ kind: 'recorded', ...recordedLedger(ALL_RUNS) })
    const cards = [...view.container.querySelectorAll('[data-automation-run]')]
    expect(cards).toHaveLength(EVERY_OUTCOME.length)
    for (const [index, card] of cards.entries()) {
      const outcome = EVERY_OUTCOME[index] as (typeof EVERY_OUTCOME)[number]
      // The four questions, in the order the design lists them.
      expect([...card.querySelectorAll('[data-automation-question]')].map(node => node.getAttribute('data-automation-question')))
        .toEqual(['compared', 'outcome', 'paths', 'next'])
      // What was compared: the baseline it started from and the head it observed.
      expect(card.querySelector('[data-automation-comparison]')?.textContent).toBe(
        outcome.kind === 'no-op' || outcome.kind === 'failed'
          ? '基线 1111111 → 观察到 未记录'
          : '基线 1111111 → 观察到 2222222',
      )
      // What it did, or why it did not: the outcome's own sentence, never a tag.
      expect(card.querySelector('[data-automation-did]')?.textContent).toBe(outcomeLine(t, outcome))
      expect(card.querySelector('[data-automation-did]')?.textContent).not.toBe('')
      // What happens next: the design's outcome table, as copy.
      expect(card.querySelector('[data-automation-next]')?.textContent?.length).toBeGreaterThan(0)
    }
  })

  it('explains the failure paths the design calls out, in words', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([
        runOf({ kind: 'superseded' }, { id: 'r1' }),
        runOf({ kind: 'skipped-locked' }, { id: 'r2' }),
        runOf({ kind: 'refused', reason: 'secrets', paths: pathsOf(['.env'], 1) }, { id: 'r3' }),
      ]),
    })
    expect(view.getByText('运行期间 .git 被改动，本轮中止且不重试。')).toBeDefined()
    expect(view.getByText('另一轮运行持有锁，本轮什么都没做。')).toBeDefined()
    expect(view.getByText('待提交内容筛查到密钥，拒绝提交。')).toBeDefined()
    expect(view.getByText('.env')).toBeDefined()
  })

  it('draws the paths a run named, the count that did not fit, and the explicit line for none', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([
        runOf({ kind: 'conflicted', paths: pathsOf(['src/a.ts', 'src/b.ts'], 12) }, { id: 'r1' }),
        runOf({ kind: 'no-op', reason: 'up-to-date' }, { id: 'r2' }),
        runOf({ kind: 'refused', reason: 'colocated-vcs', paths: pathsOf([], 0) }, { id: 'r3' }),
      ]),
    })
    const conflicted = view.container.querySelector('[data-automation-run="r1"]')
    expect(conflicted?.querySelector('[data-automation-paths="listed"]')?.textContent).toBe('src/a.tssrc/b.ts')
    expect(conflicted?.querySelector('[data-automation-paths-more]')?.textContent).toBe('另有 10 项未显示。')
    // A run that named no path still answers the question rather than leaving a blank.
    const noop = view.container.querySelector('[data-automation-run="r2"]')
    expect(noop?.querySelector('[data-automation-paths="empty"]')?.textContent).toBe('没有记录路径。')
    const emptyRefusal = view.container.querySelector('[data-automation-run="r3"]')
    expect(emptyRefusal?.querySelector('[data-automation-paths="empty"]')?.textContent).toBe('没有记录路径。')
  })

  it('draws what a commit contains and how a person withdraws it', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([runOf({ kind: 'committed', sessionId: 's-1', turn: 2 }, { id: 'r1', job: 'commit' })], {
        runCount: 1,
      }),
    })
    const card = view.container.querySelector('[data-automation-run="r1"]')
    expect(card?.querySelector('[data-automation-commit]')?.getAttribute('data-automation-commit')).toBe(COMMIT.oid)
    expect(card?.querySelector('[data-automation-commit-title]')?.textContent).toBe('提交 a1b2c3d')
    expect(card?.querySelector('[data-automation-commit-parent]')?.textContent).toBe('父提交 0011223')
    expect(card?.querySelector('[data-automation-commit-subject]')?.textContent).toBe(COMMIT.subject)
    expect(card?.querySelector('[data-automation-commit-body]')?.textContent).toBe('Merged origin/main.\nKept the local edits.')
    expect(card?.querySelector('[data-automation-commit-source]')?.textContent).toBe('摘要来源：agent')
    expect(card?.querySelector('[data-automation-commit-paths]')?.textContent).toBe('包含 2 个路径')
    expect(card?.querySelector('[data-automation-commit-withdrawable]')?.textContent).toBe('远端还没有这个提交，可以撤销。')
    expect(card?.querySelector('[data-automation-commit-soft]')?.textContent).toBe('保留暂存：git reset --soft HEAD~1')
    expect(card?.querySelector('[data-automation-commit-mixed]')?.textContent).toBe('保留工作区：git reset --mixed HEAD~1')
    // The commit's own paths answer the third question for a committed run.
    expect(card?.querySelector('[data-automation-paths="listed"]')?.textContent).toBe('src/a.tssrc/b.ts')
  })

  it('says a pushed commit cannot be withdrawn and offers no command for it', async () => {
    const pushed = { ...COMMIT, withdrawable: false }
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([runOf({ kind: 'committed', sessionId: 's-1', turn: 2 }, { id: 'r1', commit: pushed })]),
    })
    const card = view.container.querySelector('[data-automation-run="r1"]')
    expect(card?.querySelector('[data-automation-commit-withdrawable]')?.textContent).toBe('远端已包含这个提交，不能撤销。')
    expect(card?.querySelector('[data-automation-commit-soft]')).toBeNull()
    expect(card?.querySelector('[data-automation-commit-mixed]')).toBeNull()
  })

  it('answers a committed outcome the ledger recorded without its commit detail', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([withoutCommit(runOf({ kind: 'committed', sessionId: 's-1', turn: 2 }, { id: 'r1' }))]),
    })
    const card = view.container.querySelector('[data-automation-run="r1"]')
    expect(card?.querySelector('[data-automation-commit]')).toBeNull()
    expect(card?.querySelector('[data-automation-paths="empty"]')?.textContent).toBe('没有记录路径。')
  })

  it('draws the failure detail beside the reason and omits what the ledger did not record', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([runOf({ kind: 'failed', reason: 'fetch', detail: 'origin unreachable' }, { id: 'r1' })]),
    })
    const card = view.container.querySelector('[data-automation-run="r1"]')
    expect(card?.querySelector('[data-automation-did]')?.textContent).toBe('拉取上游失败。')
    expect(card?.querySelector('[data-automation-detail]')?.textContent).toBe('细节：origin unreachable')
    // A failed run recorded neither an observed head nor a baseline after it,
    // and the panel says so instead of inventing one.
    expect(card?.querySelector('[data-automation-expected-head]')?.textContent).toBe('运行时本地 HEAD：3333333')
    expect(card?.querySelector('[data-automation-baseline-after]')).toBeNull()
  })

  it('omits the run window lines a run did not record', async () => {
    const run = runOf({ kind: 'aligned', strategy: 'ff-only' }, {
      id: 'r1',
      comparison: {
        baselineBefore: '1111111111111111111111111111111111111111',
        observedUpstreamOid: null,
        expectedHeadOid: null,
        baselineAfter: null,
      },
    })
    const { view } = await settleWith({ kind: 'recorded', ...recordedLedger([run]) })
    const card = view.container.querySelector('[data-automation-run="r1"]')
    expect(card?.querySelector('[data-automation-comparison]')?.textContent).toBe('基线 1111111 → 观察到 未记录')
    expect(card?.querySelector('[data-automation-expected-head]')).toBeNull()
    expect(card?.querySelector('[data-automation-baseline-after]')).toBeNull()
  })

  it('names the job and the trigger of each run and its window', async () => {
    const { view } = await settleWith({
      kind: 'recorded',
      ...recordedLedger([
        runOf({ kind: 'no-op', reason: 'up-to-date' }, { id: 'r1', job: 'align', trigger: 'due' }),
        runOf({ kind: 'no-op', reason: 'no-upstream' }, { id: 'r2', job: 'commit', trigger: 'turn-end' }),
      ]),
    })
    const first = view.container.querySelector('[data-automation-run="r1"]')
    expect(first?.querySelector('[data-automation-job]')?.textContent).toBe('对齐')
    expect(first?.querySelector('[data-automation-trigger]')?.textContent).toBe('定时')
    expect(first?.querySelector('[data-automation-window]')?.textContent)
      .toBe('2026-09-21T10:00:00.000Z → 2026-09-21T10:00:02.000Z')
    const second = view.container.querySelector('[data-automation-run="r2"]')
    expect(second?.querySelector('[data-automation-job]')?.textContent).toBe('提交')
    expect(second?.querySelector('[data-automation-trigger]')?.textContent).toBe('回合结束')
  })

  it('says the ledger holds no run yet, and how many runs the bound hid', async () => {
    const empty = await settleWith({ kind: 'recorded', ...recordedLedger([], { runCount: 40 }) })
    expect(empty.view.getByText('台账里还没有运行记录。')).toBeDefined()
    expect(empty.view.getByText('台账保留 40 条运行记录，这里显示最新的 0 条。')).toBeDefined()
    const one = await settleWith({ kind: 'recorded', ...recordedLedger([runOf({ kind: 'skipped-locked' }, { id: 'r1' })]) })
    expect(one.view.container.querySelector('[data-automation-runs-bounded]')).toBeNull()
  })
})

/**
 * The panel's pure lines: one explanation per outcome and per next step.
 *
 * The design's metric for this panel is that a run which refused, was
 * superseded, or correctly did nothing still reads as an explanation. So every
 * variant the wire can carry is asked for its line, and the spec holds the two
 * properties that make an explanation: each one is copy from the dictionary
 * rather than a leaked key or an empty string, and no two variants share a
 * sentence.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AutomationRunOutcome } from '@deepseek-ai/dsh-api-workspace-automation/types'
import { failureLine, nextStepLine, oidOrNone, outcomeLine, runPaths, shortOid } from '../src/client/lines.ts'
import type { AutomationTranslate } from '../src/client/lines.ts'
import { zh } from '../src/client/locales.ts'
import { COMMIT, EVERY_OUTCOME, runOf, withoutCommit } from './fixtures.client.ts'

const t: AutomationTranslate = makeTranslate(zh)

/** The nine next steps the wire can carry. */
const NEXT_STEPS = [
  'none', 'withdraw-commit', 'human-resolves-conflict', 'human-clears-condition',
  'human-reviews-paths', 'next-round', 'no-retry', 'backoff', 'human-clears-suspension',
] as const

describe('outcomeLine', () => {
  it('explains every outcome the wire can carry, and explains it differently', () => {
    const lines = EVERY_OUTCOME.map(outcome => outcomeLine(t, outcome))
    expect(lines).toHaveLength(EVERY_OUTCOME.length)
    for (const [index, line] of lines.entries()) {
      const outcome = EVERY_OUTCOME[index] as AutomationRunOutcome
      expect(line.length).toBeGreaterThan(0)
      // A key that reached the reader unchanged means the dictionary lost the
      // variant; the reader would see `outcome.no-op.up-to-date`, not a sentence.
      expect(line).not.toContain('outcome.')
      expect(line).not.toBe(outcome.kind)
    }
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('names the session and turn a commit happened in', () => {
    expect(outcomeLine(t, { kind: 'committed', sessionId: 's-9', turn: 4 }))
      .toBe('已在会话 s-9 第 4 回合提交。')
  })

  it('counts the paths an ambiguous attribution could not charge to the turn', () => {
    expect(outcomeLine(t, { kind: 'ambiguous-attribution', paths: { paths: ['src/a.ts'], total: 3 } }))
      .toBe('有 3 个路径无法归属，安全网没有提交。')
  })

  it('carries the failure reason as its own sentence and the suspension reason inside it', () => {
    expect(outcomeLine(t, { kind: 'failed', reason: 'merge-dirty', detail: 'x' })).toBe('合并因工作树不干净而失败。')
    expect(outcomeLine(t, { kind: 'suspended', reason: 'three failures' })).toBe('连续失败已达阈值，自动运行停止：three failures')
  })

  it('says what a run that correctly did nothing did not do', () => {
    expect(outcomeLine(t, { kind: 'no-op', reason: 'observe-only' })).toBe('当前是只观察模式，没有写操作。')
    expect(outcomeLine(t, { kind: 'refused', reason: 'colocated-vcs', paths: { paths: [], total: 0 } }))
      .toBe('仓库里有 .jj 共置工作区，按设计拒绝改动。')
  })
})

describe('nextStepLine', () => {
  it('names every next step, distinctly', () => {
    const lines = NEXT_STEPS.map(next => nextStepLine(t, next))
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0)
      expect(line).not.toContain('next.')
    }
    expect(new Set(lines).size).toBe(lines.length)
  })
})

describe('failureLine', () => {
  it('shows the settled failure message the carrier gave', () => {
    const failure = new RemoteError('gateway/internal', 'the ledger is unreadable', {})
    expect(failureLine(t, failure)).toBe('读取自动化台账失败：the ledger is unreadable')
  })
})

describe('runPaths', () => {
  it('answers with the paths a commit contains', () => {
    expect(runPaths(runOf({ kind: 'committed', sessionId: 's-1', turn: 1 }))).toEqual(COMMIT.paths)
  })

  it('answers with nothing for a committed outcome the ledger recorded without its commit', () => {
    const run = withoutCommit(runOf({ kind: 'committed', sessionId: 's-1', turn: 1 }))
    expect(runPaths(run)).toBeUndefined()
  })

  it('answers with the paths a conflict, a refusal, and an ambiguous attribution named', () => {
    const conflicted = runOf({ kind: 'conflicted', paths: { paths: ['src/a.ts'], total: 9 } })
    expect(runPaths(conflicted)).toEqual({ paths: ['src/a.ts'], total: 9 })
    const refused = runOf({ kind: 'refused', reason: 'secrets', paths: { paths: ['src/.env'], total: 1 } })
    expect(runPaths(refused)).toEqual({ paths: ['src/.env'], total: 1 })
    const ambiguous = runOf({ kind: 'ambiguous-attribution', paths: { paths: ['src/c.ts'], total: 2 } })
    expect(runPaths(ambiguous)).toEqual({ paths: ['src/c.ts'], total: 2 })
  })

  it('answers with nothing for an outcome that named no path', () => {
    const named = EVERY_OUTCOME.filter(outcome => runPaths(runOf(outcome)) !== undefined)
    expect(named.map(outcome => outcome.kind)).toEqual([
      'committed', 'conflicted', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused',
      'ambiguous-attribution',
    ])
  })
})

describe('shortOid and oidOrNone', () => {
  it('shortens an id and says so when the ledger recorded none', () => {
    expect(shortOid(COMMIT.oid)).toBe('a1b2c3d')
    expect(shortOid('abc')).toBe('abc')
    expect(oidOrNone(COMMIT.oid, t)).toBe('a1b2c3d')
    expect(oidOrNone(null, t)).toBe('未记录')
  })
})

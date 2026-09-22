import { describe, expect, it } from 'vitest'
import {
  alignmentDecision,
  ambiguousPaths,
  clearedBackoff,
  conflictCooldown,
  countsAsFailure,
  describeOutcome,
  failureBackoff,
  leaseIsHeld,
  nextRunDelayMs,
  retainLedger,
  scanForSecrets,
  stagingDecision,
  undoReport,
  resolveAutomationPolicy,
  resolveSecretPatterns,
} from '@deepseek-ai/dsh-workspace-automation'
import type { AutomationOutcome, HeadFacts, RunRecord } from '@deepseek-ai/dsh-workspace-automation'
import { INITIAL_AUTOMATION_STATE } from '@deepseek-ai/dsh-workspace-automation'

const OBSERVING = resolveAutomationPolicy({ enabled: true, intervalSeconds: 600 })
const ALIGNING = resolveAutomationPolicy({ enabled: true, intervalSeconds: 600, mode: 'align', worktreeRoot: '/scratch' })
const EXTERNAL = resolveAutomationPolicy({ enabled: true, mode: 'align', worktreeRoot: '/scratch', downstreamVerification: 'external' })

const HEAD: HeadFacts = { repository: true, detached: false, hasUpstream: true, ahead: 0, behind: 3 }

describe('alignmentDecision', () => {
  it('reports a directory outside any repository', () => {
    expect(alignmentDecision({ ...HEAD, repository: false }, ALIGNING, false))
      .toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('refuses a detached HEAD rather than choosing a branch', () => {
    expect(alignmentDecision({ ...HEAD, detached: true }, ALIGNING, false))
      .toEqual({ kind: 'refused', reason: 'detached-head', paths: [] })
  })

  it('reports a branch with no upstream', () => {
    expect(alignmentDecision({ ...HEAD, hasUpstream: false }, ALIGNING, false))
      .toEqual({ kind: 'no-op', reason: 'no-upstream' })
  })

  it('reports up-to-date when the branch is behind by less than the threshold', () => {
    expect(alignmentDecision({ ...HEAD, behind: 0 }, ALIGNING, false)).toEqual({ kind: 'no-op', reason: 'up-to-date' })
  })

  it('acts when the branch is behind by exactly the threshold', () => {
    const policy = resolveAutomationPolicy({ mode: 'align', worktreeRoot: '/scratch', behindThreshold: 3 })
    expect(alignmentDecision(HEAD, policy, false)).toEqual({ kind: 'proceed', strategy: 'ff-only' })
  })

  it('defers to a downstream verifier that already covers a clean advance', () => {
    expect(alignmentDecision(HEAD, EXTERNAL, false))
      .toEqual({ kind: 'no-op', reason: 'deferred-to-downstream-verification' })
  })

  it('probes without writing in observe mode', () => {
    expect(alignmentDecision(HEAD, OBSERVING, false)).toEqual({ kind: 'probe-only' })
  })

  it('refuses a dirty work tree when the policy says so', () => {
    expect(alignmentDecision(HEAD, ALIGNING, true)).toEqual({ kind: 'refused', reason: 'dirty', paths: [] })
  })

  it('proceeds over a dirty work tree when the policy attributes it first', () => {
    const policy = resolveAutomationPolicy({ mode: 'align', worktreeRoot: '/scratch', dirtyPolicy: 'commit-attributable' })
    expect(alignmentDecision(HEAD, policy, true)).toEqual({ kind: 'proceed', strategy: 'ff-only' })
  })

  it('proceeds with the merge strategy when the deployment chose it', () => {
    const policy = resolveAutomationPolicy({ mode: 'align', worktreeRoot: '/scratch', alignStrategy: 'merge' })
    expect(alignmentDecision(HEAD, policy, false)).toEqual({ kind: 'proceed', strategy: 'merge' })
  })
})

describe('countsAsFailure', () => {
  it('counts only failures and suspensions', () => {
    const outcomes: AutomationOutcome[] = [
      { kind: 'no-op', reason: 'up-to-date' },
      { kind: 'aligned', strategy: 'ff-only' },
      { kind: 'committed', sessionId: 's', turn: 1 },
      { kind: 'conflicted', paths: [], total: 0 },
      { kind: 'refused', reason: 'dirty', paths: [] },
      { kind: 'ambiguous-attribution', paths: [] },
      { kind: 'skipped-locked' },
      { kind: 'superseded' },
    ]
    expect(outcomes.map(countsAsFailure)).toEqual(outcomes.map(() => false))
    expect(countsAsFailure({ kind: 'failed', reason: 'fetch', detail: 'x' })).toBe(true)
    expect(countsAsFailure({ kind: 'suspended', reason: 'x' })).toBe(true)
  })
})

describe('failureBackoff', () => {
  const policy = resolveAutomationPolicy({ backoffBaseSeconds: 100, backoffMaxSeconds: 300, backoffSuspendAfter: 4 })
  const now = Date.parse('2026-01-01T00:00:00.000Z')

  it('doubles the delay from the base and stops at the ceiling', () => {
    expect(failureBackoff({ ...INITIAL_AUTOMATION_STATE, consecutiveFailures: 0 }, policy, now).nextEarliestRunAt)
      .toBe('2026-01-01T00:01:40.000Z')
    expect(failureBackoff({ ...INITIAL_AUTOMATION_STATE, consecutiveFailures: 1 }, policy, now).nextEarliestRunAt)
      .toBe('2026-01-01T00:03:20.000Z')
    expect(failureBackoff({ ...INITIAL_AUTOMATION_STATE, consecutiveFailures: 2 }, policy, now).nextEarliestRunAt)
      .toBe('2026-01-01T00:05:00.000Z')
  })

  it('suspends the workspace at the threshold', () => {
    const update = failureBackoff({ ...INITIAL_AUTOMATION_STATE, consecutiveFailures: 3 }, policy, now)
    expect(update).toEqual({
      consecutiveFailures: 4,
      nextEarliestRunAt: null,
      suspendedReason: '4 consecutive failures; resume the workspace to retry',
    })
  })
})

describe('clearedBackoff', () => {
  it('resets the failure count and carries the cooldown', () => {
    expect(clearedBackoff('2026-01-01T01:00:00.000Z')).toEqual({
      consecutiveFailures: 0,
      suspendedReason: null,
      nextEarliestRunAt: '2026-01-01T01:00:00.000Z',
    })
    expect(clearedBackoff(null).nextEarliestRunAt).toBe(null)
  })
})

describe('conflictCooldown', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')

  it('imposes the configured cooldown', () => {
    expect(conflictCooldown(resolveAutomationPolicy({ conflictCooldownSeconds: 60 }), now))
      .toBe('2026-01-01T00:01:00.000Z')
  })

  it('imposes no cooldown when it is zero', () => {
    expect(conflictCooldown(resolveAutomationPolicy({ conflictCooldownSeconds: 0 }), now)).toBe(null)
  })
})

describe('nextRunDelayMs', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')
  const policy = resolveAutomationPolicy({ enabled: true, intervalSeconds: 600, jitterRatio: 0.5 })

  it('arms nothing while the runtime is disabled', () => {
    expect(nextRunDelayMs(resolveAutomationPolicy({}), INITIAL_AUTOMATION_STATE, now, () => 0.5)).toBe(undefined)
  })

  it('arms nothing while the workspace is suspended', () => {
    const state = { ...INITIAL_AUTOMATION_STATE, suspendedReason: 'stopped' }
    expect(nextRunDelayMs(policy, state, now, () => 0.5)).toBe(undefined)
  })

  it('waits for the whole cooldown while it is in the future', () => {
    const state = { ...INITIAL_AUTOMATION_STATE, nextEarliestRunAt: '2026-01-01T00:05:00.000Z' }
    expect(nextRunDelayMs(policy, state, now, () => 0.5)).toBe(300_000)
  })

  it('treats an elapsed cooldown and an unusable timestamp as due', () => {
    const elapsed = { ...INITIAL_AUTOMATION_STATE, nextEarliestRunAt: '2025-12-31T23:00:00.000Z' }
    expect(nextRunDelayMs(policy, elapsed, now, () => 0.5)).toBe(600_000)
    const unusable = { ...INITIAL_AUTOMATION_STATE, nextEarliestRunAt: 'not a date' }
    expect(nextRunDelayMs(policy, unusable, now, () => 0.5)).toBe(600_000)
  })

  it('applies the jitter fraction in both directions', () => {
    expect(nextRunDelayMs(policy, INITIAL_AUTOMATION_STATE, now, () => 0)).toBe(300_000)
    expect(nextRunDelayMs(policy, INITIAL_AUTOMATION_STATE, now, () => 1)).toBe(900_000)
  })

  it('never arms a negative delay', () => {
    const wide = resolveAutomationPolicy({ enabled: true, intervalSeconds: 300, jitterRatio: 1 })
    expect(nextRunDelayMs(wide, INITIAL_AUTOMATION_STATE, now, () => 0)).toBe(0)
  })
})

describe('leaseIsHeld', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')

  it('is false without a lease', () => {
    expect(leaseIsHeld(INITIAL_AUTOMATION_STATE, now)).toBe(false)
    expect(leaseIsHeld({ ...INITIAL_AUTOMATION_STATE, leaseOwner: 'a' }, now)).toBe(false)
    expect(leaseIsHeld({ ...INITIAL_AUTOMATION_STATE, leaseUntil: '2026-01-01T00:01:00.000Z' }, now)).toBe(false)
  })

  it('is true while an unexpired lease is held', () => {
    const state = { ...INITIAL_AUTOMATION_STATE, leaseOwner: 'a', leaseUntil: '2026-01-01T00:01:00.000Z' }
    expect(leaseIsHeld(state, now)).toBe(true)
    expect(leaseIsHeld(state, Date.parse('2026-01-01T00:02:00.000Z'))).toBe(false)
  })

  it('is false when the lease expiry is unusable', () => {
    expect(leaseIsHeld({ ...INITIAL_AUTOMATION_STATE, leaseOwner: 'a', leaseUntil: 'nope' }, now)).toBe(false)
  })
})

describe('scanForSecrets', () => {
  const patterns = resolveSecretPatterns(['sk-[A-Za-z0-9]{4}', 'TOKEN'])

  it('reports the path where a pattern matched and counts inspected bytes', () => {
    const scan = scanForSecrets([
      { path: 'a.ts', text: 'const k = "sk-abcd"' },
      { path: 'b.ts', text: 'const k = "TOKEN"' },
      { path: 'c.ts', text: 'clean' },
    ], patterns, 1024)
    expect(scan.hits).toEqual(['a.ts', 'b.ts'])
    expect(scan.bytes).toBe(41)
  })

  it('inspects only the bounded prefix', () => {
    const scan = scanForSecrets([{ path: 'a.ts', text: 'xxxxxsk-abcd' }], patterns, 5)
    expect(scan.hits).toEqual([])
    expect(scan.bytes).toBe(5)
  })

  it('matches again on a later path despite a global pattern', () => {
    const scan = scanForSecrets([
      { path: 'a.ts', text: 'sk-abcd' },
      { path: 'b.ts', text: 'sk-abcd' },
    ], patterns, 1024)
    expect(scan.hits).toEqual(['a.ts', 'b.ts'])
  })
})

describe('stagingDecision', () => {
  it('stages a set within the bound', () => {
    expect(stagingDecision(['a', 'b'], 2)).toEqual({ kind: 'staged', paths: ['a', 'b'] })
  })

  it('refuses an empty set as an unattributable remainder', () => {
    expect(stagingDecision([], 2)).toEqual({ kind: 'refused', reason: 'unattributable-remainder', paths: [] })
  })

  it('refuses an over-bound set without trimming it silently', () => {
    expect(stagingDecision(['a', 'b', 'c'], 2))
      .toEqual({ kind: 'refused', reason: 'too-many-paths', paths: ['a', 'b'] })
  })
})

describe('ambiguousPaths', () => {
  it('reports the target paths an earlier work unit also wrote', () => {
    expect(ambiguousPaths(['a', 'b', 'c'], ['c', 'd'])).toEqual(['c'])
    expect(ambiguousPaths(['a'], ['b'])).toEqual([])
  })
})

describe('undoReport', () => {
  it('offers two non-destructive withdrawals', () => {
    expect(undoReport('parent-1', true)).toEqual({
      withdrawable: true,
      softReset: 'git reset --soft parent-1',
      mixedReset: 'git reset --mixed parent-1',
    })
    expect(undoReport('parent-1', false).withdrawable).toBe(false)
  })
})

describe('retainLedger', () => {
  const record = (id: string): RunRecord => ({
    id,
    job: 'align',
    trigger: 'due',
    startedAt: 't',
    finishedAt: 't',
    outcome: { kind: 'superseded' },
    expectedHeadOid: null,
    observedUpstreamOid: null,
    baselineBefore: null,
    baselineAfter: null,
    commit: null,
  })

  it('appends the record', () => {
    expect(retainLedger([record('1')], record('2'), 5).map(entry => entry.id)).toEqual(['1', '2'])
  })

  it('retains only the newest records', () => {
    expect(retainLedger([record('1'), record('2')], record('3'), 2).map(entry => entry.id)).toEqual(['2', '3'])
  })
})

describe('describeOutcome', () => {
  it('names every outcome with a stable kind and reason', () => {
    expect(describeOutcome({ kind: 'no-op', reason: 'up-to-date' })).toBe('no-op:up-to-date')
    expect(describeOutcome({ kind: 'aligned', strategy: 'merge' })).toBe('aligned:merge')
    expect(describeOutcome({ kind: 'committed', sessionId: 's', turn: 2 })).toBe('committed:s/2')
    expect(describeOutcome({ kind: 'conflicted', paths: [], total: 4 })).toBe('conflicted:4')
    expect(describeOutcome({ kind: 'refused', reason: 'secrets', paths: [] })).toBe('refused:secrets')
    expect(describeOutcome({ kind: 'ambiguous-attribution', paths: ['a', 'b'] })).toBe('ambiguous-attribution:2')
    expect(describeOutcome({ kind: 'skipped-locked' })).toBe('skipped-locked')
    expect(describeOutcome({ kind: 'superseded' })).toBe('superseded')
    expect(describeOutcome({ kind: 'failed', reason: 'fetch', detail: 'x' })).toBe('failed:fetch')
    expect(describeOutcome({ kind: 'suspended', reason: 'x' })).toBe('suspended')
  })
})

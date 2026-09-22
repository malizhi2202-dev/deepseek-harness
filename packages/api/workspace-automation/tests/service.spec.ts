/**
 * Tests for the `workspaceAutomationLedger` Remote service and the projection
 * under it.
 *
 * The ledger is authoritative, so what is asserted is that every value on the
 * wire is the stored one, cut to the configured bounds: the state, the runs
 * newest first with the ledger's own count beside them, one explanation per
 * outcome the runtime can record, and the paths each question named. A
 * workspace the runtime stores nothing for is a reading, not a failure.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  AutomationOutcome,
  CommitReport,
  RunRecord,
  WorkspaceAutomationReport,
} from '@deepseek-ai/dsh-workspace-automation'
import type { FailureReason, NoOpReason, RefusalReason } from '@deepseek-ai/dsh-workspace-automation'
import WorkspaceAutomationLedger from '../src/index.ts'
import { nextStepOf, projectLedger, projectOutcome } from '../src/projection.ts'
import type { ProjectionBounds } from '../src/projection.ts'

const WORKSPACE = 'ws-1' as WorkspaceId
const OTHER = 'ws-2' as WorkspaceId
const OID = '1111111111111111111111111111111111111111'

const NO_OP_REASONS = Object.keys({
  'up-to-date': true,
  'no-repository': true,
  'no-upstream': true,
  'observe-only': true,
  'deferred-to-downstream-verification': true,
  'no-attributable-paths': true,
  'already-committed': true,
} satisfies Record<NoOpReason, true>) as readonly NoOpReason[]

const REFUSAL_REASONS = Object.keys({
  'detached-head': true,
  dirty: true,
  secrets: true,
  'colocated-vcs': true,
  'too-many-paths': true,
  'unattributable-remainder': true,
  'unreadable-path': true,
} satisfies Record<RefusalReason, true>) as readonly RefusalReason[]

const FAILURE_REASONS = Object.keys({
  fetch: true,
  probe: true,
  merge: true,
  'merge-dirty': true,
  'superseded-write': true,
  observe: true,
  resolve: true,
  commit: true,
  ledger: true,
} satisfies Record<FailureReason, true>) as readonly FailureReason[]

/** One recorded outcome per variant and reason the runtime can write. */
const EVERY_OUTCOME: readonly AutomationOutcome[] = [
  ...NO_OP_REASONS.map(reason => ({ kind: 'no-op', reason }) as const),
  { kind: 'aligned', strategy: 'ff-only' },
  { kind: 'aligned', strategy: 'merge' },
  { kind: 'committed', sessionId: 's-1', turn: 2 },
  { kind: 'conflicted', paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'], total: 9 },
  ...REFUSAL_REASONS.map(reason => ({
    kind: 'refused',
    reason,
    paths: reason === 'colocated-vcs' ? [] : [`src/${reason}.ts`],
  }) as const),
  { kind: 'ambiguous-attribution', paths: ['src/d.ts', 'src/e.ts'] },
  { kind: 'skipped-locked' },
  { kind: 'superseded' },
  ...FAILURE_REASONS.map(reason => ({ kind: 'failed', reason, detail: `detail for ${reason}` }) as const),
  { kind: 'suspended', reason: 'three consecutive failures' },
]

/** The next step the design's outcome table assigns to one outcome. */
const NEXT_STEPS: Readonly<Record<string, string>> = {
  'no-op': 'none',
  aligned: 'none',
  committed: 'withdraw-commit',
  conflicted: 'human-resolves-conflict',
  refused: 'human-clears-condition',
  'ambiguous-attribution': 'human-reviews-paths',
  'skipped-locked': 'next-round',
  superseded: 'no-retry',
  failed: 'backoff',
  suspended: 'human-clears-suspension',
}

const COMMIT: CommitReport = {
  oid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  parentOid: '00112233445566778899aabbccddeeff00112233',
  paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  subject: 'align: merge upstream',
  body: ['Merged origin/main.'],
  summarySource: 'agent',
  summaryNotes: ['consulted once'],
  scanBytes: 4096,
  withdrawable: true,
  softReset: 'git reset --soft HEAD~1',
  mixedReset: 'git reset --mixed HEAD~1',
}

/**
 * One ledger record.
 * @param outcome - the recorded outcome.
 * @param over - fields to replace.
 * @returns the record.
 */
function record(outcome: AutomationOutcome, over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: `run-${outcome.kind}`,
    job: 'align',
    trigger: 'due',
    startedAt: '2026-09-21T10:00:00.000Z',
    finishedAt: '2026-09-21T10:00:02.000Z',
    outcome,
    expectedHeadOid: '3333333333333333333333333333333333333333',
    observedUpstreamOid: null,
    baselineBefore: OID,
    baselineAfter: null,
    commit: null,
    ...over,
  }
}

/**
 * One runtime report.
 * @param ledger - retained records, newest last as the runtime keeps them.
 * @param over - fields to replace.
 * @returns the report.
 */
function report(ledger: readonly RunRecord[], over: Partial<WorkspaceAutomationReport> = {}): WorkspaceAutomationReport {
  return {
    workspaceId: WORKSPACE,
    enabled: true,
    mode: 'align',
    suspendedReason: null,
    consecutiveFailures: 0,
    nextEarliestRunAt: null,
    baselineUpstreamOid: OID,
    lastRunAt: '2026-09-21T10:00:02.000Z',
    lastOutcome: null,
    uncommittedPaths: [],
    ledger,
    ...over,
  }
}

/** The service over a scripted runtime, at one deployment's bounds. */
function harness(bounds: Partial<ProjectionBounds> = {}) {
  const reports = new Map<string, WorkspaceAutomationReport>()
  const ctx = new Context()
  ctx.provide('workspaceAutomation', {
    report: (workspaceId: string) => reports.get(workspaceId),
  } as never)
  const endpoint = new WorkspaceAutomationLedger(ctx, {
    maxRuns: bounds.maxRuns ?? 20,
    maxPaths: bounds.maxPaths ?? 10,
  })
  return { endpoint, reports }
}

describe('WorkspaceAutomationLedger.Config', () => {
  it('fills the run and path bounds a deployment did not set', () => {
    expect(WorkspaceAutomationLedger.Config({})).toEqual({ maxRuns: 20, maxPaths: 10 })
  })

  it('rejects a bound that would return nothing', () => {
    expect(() => WorkspaceAutomationLedger.Config({ maxRuns: 0 })).toThrow()
    expect(() => WorkspaceAutomationLedger.Config({ maxPaths: 0 })).toThrow()
    expect(() => WorkspaceAutomationLedger.Config({ maxRuns: 2.5 })).toThrow()
  })
})

describe('WorkspaceAutomationLedger.automationLedger', () => {
  it('answers unrecorded for a workspace the runtime stores nothing for', () => {
    const { endpoint } = harness()
    expect(endpoint.automationLedger(OTHER)).toEqual({ kind: 'unrecorded', workspaceId: OTHER })
  })

  it('copies the stored state and the ledger\'s own run count', () => {
    const { endpoint, reports } = harness()
    reports.set(WORKSPACE, report([record({ kind: 'skipped-locked' })], {
      enabled: false,
      mode: 'observe',
      suspendedReason: 'three consecutive failures',
      consecutiveFailures: 3,
      nextEarliestRunAt: '2026-09-21T11:00:00.000Z',
      baselineUpstreamOid: null,
      lastRunAt: null,
      uncommittedPaths: ['src/left.ts'],
    }))
    expect(endpoint.automationLedger(WORKSPACE)).toEqual({
      kind: 'recorded',
      workspaceId: WORKSPACE,
      enabled: false,
      mode: 'observe',
      suspendedReason: 'three consecutive failures',
      consecutiveFailures: 3,
      nextEarliestRunAt: '2026-09-21T11:00:00.000Z',
      baselineUpstreamOid: null,
      lastRunAt: null,
      uncommittedPaths: { paths: ['src/left.ts'], total: 1 },
      runs: [{
        id: 'run-skipped-locked',
        job: 'align',
        trigger: 'due',
        startedAt: '2026-09-21T10:00:00.000Z',
        finishedAt: '2026-09-21T10:00:02.000Z',
        comparison: {
          baselineBefore: OID,
          observedUpstreamOid: null,
          expectedHeadOid: '3333333333333333333333333333333333333333',
          baselineAfter: null,
        },
        outcome: { kind: 'skipped-locked' },
        nextStep: 'next-round',
      }],
      runCount: 1,
    })
  })

  it('returns the newest runs first and keeps the ledger count beside them', () => {
    const { endpoint, reports } = harness({ maxRuns: 2 })
    reports.set(WORKSPACE, report([
      record({ kind: 'no-op', reason: 'up-to-date' }, { id: 'oldest' }),
      record({ kind: 'skipped-locked' }, { id: 'middle' }),
      record({ kind: 'superseded' }, { id: 'newest' }),
    ]))
    const view = endpoint.automationLedger(WORKSPACE)
    if (view.kind !== 'recorded') throw new Error('expected a recorded ledger')
    // The bound keeps the newest records the runtime retained, and the count
    // tells the reader what the bound hid.
    expect(view.runs.map(run => run.id)).toEqual(['newest', 'middle'])
    expect(view.runCount).toBe(3)
  })

  it('cuts every path list to the configured bound and keeps the count it was drawn from', () => {
    const { endpoint, reports } = harness({ maxPaths: 1 })
    reports.set(WORKSPACE, report([
      record({ kind: 'conflicted', paths: ['src/a.ts', 'src/b.ts'], total: 9 }),
      record({ kind: 'refused', reason: 'too-many-paths', paths: ['src/c.ts', 'src/d.ts'] }),
      record({ kind: 'ambiguous-attribution', paths: ['src/e.ts', 'src/f.ts'] }),
      record({ kind: 'committed', sessionId: 's-1', turn: 2 }, { commit: COMMIT }),
    ], { uncommittedPaths: ['src/g.ts', 'src/h.ts'] }))
    const view = endpoint.automationLedger(WORKSPACE)
    if (view.kind !== 'recorded') throw new Error('expected a recorded ledger')
    // Newest first: the commit run, then the ambiguous one, then the refusal,
    // then the conflict.
    const [committed, ambiguous, refused, conflicted] = view.runs
    // A conflict records its own total, so the reader learns how many paths clashed.
    expect(conflicted?.outcome).toEqual({ kind: 'conflicted', paths: { paths: ['src/a.ts'], total: 9 } })
    // A refusal's and an ambiguous attribution's lists carry no total of their
    // own, so the count is the length the ledger held.
    expect(refused?.outcome).toEqual({
      kind: 'refused', reason: 'too-many-paths', paths: { paths: ['src/c.ts'], total: 2 },
    })
    expect(ambiguous?.outcome).toEqual({
      kind: 'ambiguous-attribution', paths: { paths: ['src/e.ts'], total: 2 },
    })
    expect(committed?.commit?.paths).toEqual({ paths: ['src/a.ts'], total: 3 })
    expect(view.uncommittedPaths).toEqual({ paths: ['src/g.ts'], total: 2 })
  })

  it('keeps a path list whole when the bound is exactly its length', () => {
    const { endpoint, reports } = harness({ maxPaths: 3, maxRuns: 1 })
    reports.set(WORKSPACE, report([record({ kind: 'conflicted', paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'], total: 3 })]))
    const view = endpoint.automationLedger(WORKSPACE)
    if (view.kind !== 'recorded') throw new Error('expected a recorded ledger')
    expect(view.runs[0]?.outcome).toEqual({
      kind: 'conflicted', paths: { paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'], total: 3 },
    })
  })

  it('explains every outcome the runtime can record and names its next move', () => {
    const { endpoint, reports } = harness({ maxRuns: 100 })
    reports.set(WORKSPACE, report(EVERY_OUTCOME.map((outcome, index) => record(outcome, { id: `run-${String(index)}` }))))
    const view = endpoint.automationLedger(WORKSPACE)
    if (view.kind !== 'recorded') throw new Error('expected a recorded ledger')
    expect(view.runs).toHaveLength(EVERY_OUTCOME.length)
    for (const run of view.runs) {
      expect(run.outcome.kind.length).toBeGreaterThan(0)
      expect(run.nextStep).toBe(NEXT_STEPS[run.outcome.kind])
    }
    // The four questions are all answerable from one run, and a run that wrote
    // nothing carries no commit for the panel to draw.
    const aligned = view.runs.find(run => run.outcome.kind === 'aligned')
    expect(aligned?.commit).toBeUndefined()
    expect(aligned?.comparison.baselineBefore).toBe(OID)
  })
})

describe('projectOutcome', () => {
  it('projects each variant with its own fields and nothing invented', () => {
    for (const outcome of EVERY_OUTCOME) {
      expect(projectOutcome(outcome, 10).kind).toBe(outcome.kind)
    }
    expect(projectOutcome({ kind: 'committed', sessionId: 's-9', turn: 4 }, 10))
      .toEqual({ kind: 'committed', sessionId: 's-9', turn: 4 })
    expect(projectOutcome({ kind: 'failed', reason: 'fetch', detail: 'origin unreachable' }, 10))
      .toEqual({ kind: 'failed', reason: 'fetch', detail: 'origin unreachable' })
    expect(projectOutcome({ kind: 'suspended', reason: 'three failures' }, 10))
      .toEqual({ kind: 'suspended', reason: 'three failures' })
  })
})

describe('projectLedger', () => {
  it('answers unrecorded without a report and keeps the id it was asked for', () => {
    expect(projectLedger(OTHER, undefined, { maxRuns: 1, maxPaths: 1 }))
      .toEqual({ kind: 'unrecorded', workspaceId: OTHER })
  })

  it('drops the commit when the run recorded none', () => {
    const view = projectLedger(WORKSPACE, report([record({ kind: 'no-op', reason: 'no-upstream' })]), { maxRuns: 5, maxPaths: 5 })
    if (view.kind !== 'recorded') throw new Error('expected a recorded ledger')
    expect(view.runs[0]?.commit).toBeUndefined()
    expect('commit' in (view.runs[0] as object)).toBe(false)
  })
})

describe('nextStepOf', () => {
  it('reads the design\'s outcome table', () => {
    for (const outcome of EVERY_OUTCOME) {
      expect(nextStepOf(outcome)).toBe(NEXT_STEPS[outcome.kind])
    }
  })
})

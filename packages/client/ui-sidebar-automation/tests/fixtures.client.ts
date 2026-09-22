/**
 * Ledger fixtures: the workspace the panel resolves, one run per outcome the
 * wire can carry, and a recorded ledger to hold them.
 *
 * The outcome list is built from `satisfies Record<Reason, true>` tables, so a
 * reason added to the wire union fails this file's compile instead of quietly
 * leaving a variant unrendered — which is the same guarantee the panel's own
 * copy switch gives.
 */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  AutomationCommitView,
  AutomationNextStep,
  AutomationPaths,
  AutomationRecordedView,
  AutomationRunOutcome,
  AutomationRunView,
  FailureReason,
  NoOpReason,
  RefusalReason,
} from '@deepseek-ai/dsh-api-workspace-automation/types'

export const SESSION = 's-test' as SessionId
export const WORKSPACE_ID = 'ws-1' as WorkspaceId
export const WORKSPACE_PATH = '/work/repo'
export const WORKSPACE_TITLE = 'repo'

/** The workspace row the panel resolves this session to. */
export function workspaceView(over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: WORKSPACE_ID,
    path: WORKSPACE_PATH,
    title: WORKSPACE_TITLE,
    sessionIds: [SESSION],
    createdAt: '2026-09-21T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
    ...over,
  }
}

/**
 * One bounded path list.
 * @param paths - the retained paths.
 * @param total - the count before the bound.
 * @returns the wire's path list.
 */
export function pathsOf(paths: readonly string[], total: number): AutomationPaths {
  return { paths, total }
}

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

/** One outcome per variant and reason the wire can carry, in the union's order. */
export const EVERY_OUTCOME: readonly AutomationRunOutcome[] = [
  ...NO_OP_REASONS.map(reason => ({ kind: 'no-op', reason }) as const),
  { kind: 'aligned', strategy: 'ff-only' },
  { kind: 'aligned', strategy: 'merge' },
  { kind: 'committed', sessionId: SESSION, turn: 3 },
  { kind: 'conflicted', paths: pathsOf(['src/a.ts', 'src/b.ts'], 12) },
  ...REFUSAL_REASONS.map(reason => ({
    kind: 'refused',
    reason,
    // A refusal may name no path at all: the colocated-VCS check refuses before
    // it looks at one.
    paths: reason === 'colocated-vcs' ? pathsOf([], 0) : pathsOf([`src/${reason}.ts`], 1),
  }) as const),
  { kind: 'ambiguous-attribution', paths: pathsOf(['src/c.ts', 'src/d.ts'], 4) },
  { kind: 'skipped-locked' },
  { kind: 'superseded' },
  ...FAILURE_REASONS.map(reason => ({ kind: 'failed', reason, detail: `detail for ${reason}` }) as const),
  { kind: 'suspended', reason: 'three consecutive failures' },
]

/** The commit one `committed` run carries. */
export const COMMIT: AutomationCommitView = {
  oid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  parentOid: '00112233445566778899aabbccddeeff00112233',
  subject: 'align: merge upstream',
  body: ['Merged origin/main.', 'Kept the local edits.'],
  summarySource: 'agent',
  paths: pathsOf(['src/a.ts', 'src/b.ts'], 2),
  withdrawable: true,
  softReset: 'git reset --soft HEAD~1',
  mixedReset: 'git reset --mixed HEAD~1',
}

/**
 * The next step the design's outcome table assigns to one outcome.
 * @param outcome - the recorded outcome.
 * @returns its next-step tag.
 */
export function nextStepOf(outcome: AutomationRunOutcome): AutomationNextStep {
  switch (outcome.kind) {
    case 'no-op':
    case 'aligned':
      return 'none'
    case 'committed':
      return 'withdraw-commit'
    case 'conflicted':
      return 'human-resolves-conflict'
    case 'refused':
      return 'human-clears-condition'
    case 'ambiguous-attribution':
      return 'human-reviews-paths'
    case 'skipped-locked':
      return 'next-round'
    case 'superseded':
      return 'no-retry'
    case 'failed':
      return 'backoff'
    case 'suspended':
      return 'human-clears-suspension'
    default:
      return assertNever(outcome, 'AutomationRunOutcome')
  }
}

/**
 * One run's id: stable per variant, so a card list holds unique keys.
 * @param outcome - the recorded outcome.
 * @returns the run id.
 */
function outcomeId(outcome: AutomationRunOutcome): string {
  switch (outcome.kind) {
    case 'no-op':
    case 'refused':
    case 'failed':
      return `${outcome.kind}-${outcome.reason}`
    case 'aligned':
      return `${outcome.kind}-${outcome.strategy}`
    default:
      return outcome.kind
  }
}

/**
 * One projected run around an outcome.
 * @param outcome - the outcome the run recorded.
 * @param over - fields to replace.
 * @returns the run.
 */
export function runOf(outcome: AutomationRunOutcome, over: Partial<AutomationRunView> = {}): AutomationRunView {
  return {
    id: outcomeId(outcome),
    job: outcome.kind === 'committed' ? 'commit' : 'align',
    trigger: 'due',
    startedAt: '2026-09-21T10:00:00.000Z',
    finishedAt: '2026-09-21T10:00:02.000Z',
    comparison: {
      baselineBefore: '1111111111111111111111111111111111111111',
      // A run that did nothing, and one that failed before it looked, have no
      // observed head to report.
      observedUpstreamOid: outcome.kind === 'no-op' || outcome.kind === 'failed'
        ? null
        : '2222222222222222222222222222222222222222',
      expectedHeadOid: '3333333333333333333333333333333333333333',
      baselineAfter: outcome.kind === 'failed' ? null : '2222222222222222222222222222222222222222',
    },
    outcome,
    nextStep: nextStepOf(outcome),
    ...(outcome.kind === 'committed' ? { commit: COMMIT } : {}),
    ...over,
  }
}

/**
 * The same run without the commit detail a `committed` outcome normally carries.
 * @param run - the run to strip.
 * @returns the run, with no `commit` field at all.
 */
export function withoutCommit(run: AutomationRunView): AutomationRunView {
  const { commit: _commit, ...rest } = run
  return rest
}

/**
 * One recorded ledger.
 * @param runs - the retained runs, newest first as the projection orders them.
 * @param over - fields to replace.
 * @returns the ledger.
 */
export function recordedLedger(
  runs: readonly AutomationRunView[],
  over: Partial<AutomationRecordedView> = {},
): AutomationRecordedView {
  return {
    workspaceId: WORKSPACE_ID,
    enabled: true,
    mode: 'align',
    suspendedReason: null,
    consecutiveFailures: 0,
    nextEarliestRunAt: null,
    baselineUpstreamOid: '1111111111111111111111111111111111111111',
    lastRunAt: '2026-09-21T10:00:02.000Z',
    uncommittedPaths: pathsOf([], 0),
    runs,
    runCount: runs.length,
    ...over,
  }
}

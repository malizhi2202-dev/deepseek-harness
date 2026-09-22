/**
 * Pure projection from the automation ledger to the Remote read.
 *
 * The ledger is authoritative: every value here is copied from a `RunRecord`,
 * from the stored state, or from the write it recorded. Nothing is recomputed
 * from git state, and every path list and run list is cut to the bound the
 * Remote's Config declares.
 */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  AutomationOutcome,
  CommitReport,
  RunRecord,
  WorkspaceAutomationReport,
} from '@deepseek-ai/dsh-workspace-automation'
import type {
  AutomationCommitView,
  AutomationComparison,
  AutomationLedgerView,
  AutomationNextStep,
  AutomationPaths,
  AutomationRunOutcome,
  AutomationRunView,
} from './types.ts'

/** The bounds this projection applies, resolved from the Remote's Config. */
export interface ProjectionBounds {
  /** Most runs one read returns, newest first. */
  readonly maxRuns: number
  /** Most paths one path list carries. */
  readonly maxPaths: number
}

/**
 * Project one workspace's ledger.
 * @param workspaceId - the workspace whose ledger is read; the runtime keys the same value.
 * @param report - the runtime's report for that workspace, absent when it stores none.
 * @param bounds - the resolved item bounds.
 * @returns the wire view, `unrecorded` when the runtime holds no state.
 */
export function projectLedger(
  workspaceId: AutomationLedgerView['workspaceId'],
  report: WorkspaceAutomationReport | undefined,
  bounds: ProjectionBounds,
): AutomationLedgerView {
  if (report === undefined) return { kind: 'unrecorded', workspaceId }
  const runs = report.ledger.slice(-bounds.maxRuns)
  return {
    kind: 'recorded',
    workspaceId,
    enabled: report.enabled,
    mode: report.mode,
    suspendedReason: report.suspendedReason,
    consecutiveFailures: report.consecutiveFailures,
    nextEarliestRunAt: report.nextEarliestRunAt,
    baselineUpstreamOid: report.baselineUpstreamOid,
    lastRunAt: report.lastRunAt,
    uncommittedPaths: bounded(report.uncommittedPaths, bounds.maxPaths, report.uncommittedPaths.length),
    runs: runs.map(record => projectRun(record, bounds.maxPaths)).reverse(),
    runCount: report.ledger.length,
  }
}

/**
 * Project one run.
 * @param record - the ledger record.
 * @param maxPaths - most paths one of its path lists carries.
 * @returns the wire view.
 */
export function projectRun(record: RunRecord, maxPaths: number): AutomationRunView {
  const comparison: AutomationComparison = {
    baselineBefore: record.baselineBefore,
    observedUpstreamOid: record.observedUpstreamOid,
    expectedHeadOid: record.expectedHeadOid,
    baselineAfter: record.baselineAfter,
  }
  const commit = record.commit === null ? undefined : projectCommit(record.commit, maxPaths)
  return {
    id: record.id,
    job: record.job,
    trigger: record.trigger,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    comparison,
    outcome: projectOutcome(record.outcome, maxPaths),
    nextStep: nextStepOf(record.outcome),
    ...(commit === undefined ? {} : { commit }),
  }
}

/**
 * Project one run's outcome.
 * @param outcome - the recorded outcome.
 * @param maxPaths - most paths one of its path lists carries.
 * @returns the wire outcome, with every path list cut to the bound.
 */
export function projectOutcome(outcome: AutomationOutcome, maxPaths: number): AutomationRunOutcome {
  switch (outcome.kind) {
    case 'no-op':
      return { kind: 'no-op', reason: outcome.reason }
    case 'aligned':
      return { kind: 'aligned', strategy: outcome.strategy }
    case 'committed':
      return { kind: 'committed', sessionId: outcome.sessionId, turn: outcome.turn }
    case 'conflicted':
      return { kind: 'conflicted', paths: bounded(outcome.paths, maxPaths, outcome.total) }
    case 'refused':
      return {
        kind: 'refused',
        reason: outcome.reason,
        paths: bounded(outcome.paths, maxPaths, outcome.paths.length),
      }
    case 'ambiguous-attribution':
      return {
        kind: 'ambiguous-attribution',
        paths: bounded(outcome.paths, maxPaths, outcome.paths.length),
      }
    case 'skipped-locked':
      return { kind: 'skipped-locked' }
    case 'superseded':
      return { kind: 'superseded' }
    case 'failed':
      return { kind: 'failed', reason: outcome.reason, detail: outcome.detail }
    case 'suspended':
      return { kind: 'suspended', reason: outcome.reason }
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'AutomationOutcome')
  }
}

/**
 * Read the next move the design's outcome table assigns to one run.
 * @param outcome - the recorded outcome.
 * @returns the next-step tag.
 */
export function nextStepOf(outcome: AutomationOutcome): AutomationNextStep {
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
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'AutomationOutcome')
  }
}

/**
 * Project one run's commit report.
 * @param commit - the recorded commit.
 * @param maxPaths - most paths the commit's path list carries.
 * @returns the wire view.
 */
export function projectCommit(commit: CommitReport, maxPaths: number): AutomationCommitView {
  return {
    oid: commit.oid,
    parentOid: commit.parentOid,
    subject: commit.subject,
    body: commit.body,
    summarySource: commit.summarySource,
    paths: bounded(commit.paths, maxPaths, commit.paths.length),
    withdrawable: commit.withdrawable,
    softReset: commit.softReset,
    mixedReset: commit.mixedReset,
  }
}

/**
 * Cut one path list to the bound.
 * @param paths - the list the ledger held.
 * @param maxPaths - most paths to keep.
 * @param total - the count the list was drawn from.
 * @returns the retained prefix and a total no smaller than it.
 */
function bounded(paths: readonly string[], maxPaths: number, total: number): AutomationPaths {
  return { paths: paths.slice(0, maxPaths), total: Math.max(total, paths.length) }
}

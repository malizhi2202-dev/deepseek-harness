/**
 * Vocabulary for the workspace automation runtime and the durable records it
 * owns. Types only.
 *
 * @module @deepseek-ai/dsh-workspace-automation/types
 */

import type { AlignStrategy } from '@deepseek-ai/dsh-git-align'

/** Which of the two jobs one run belongs to. */
export type AutomationJob = 'align' | 'commit'

/** What asked for one run. */
export type RunTrigger = 'due' | 'turn-end'

/** Why a run correctly did nothing. */
export type NoOpReason =
  | 'up-to-date'
  | 'no-repository'
  | 'no-upstream'
  | 'observe-only'
  | 'deferred-to-downstream-verification'
  | 'no-attributable-paths'
  | 'already-committed'

/** Why a run refused to act. */
export type RefusalReason =
  | 'detached-head'
  | 'dirty'
  | 'secrets'
  | 'colocated-vcs'
  | 'too-many-paths'
  | 'unattributable-remainder'
  | 'unreadable-path'

/** Why a run failed. */
export type FailureReason =
  | 'fetch'
  | 'probe'
  | 'merge'
  | 'merge-dirty'
  | 'superseded-write'
  | 'observe'
  | 'resolve'
  | 'commit'
  | 'ledger'

/**
 * The closed outcome of one run. `no-op` and `refused` are correct answers, not
 * failures; only `failed` and `suspended` advance the failure backoff.
 */
export type AutomationOutcome =
  | { readonly kind: 'no-op'; readonly reason: NoOpReason }
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'committed'; readonly sessionId: string; readonly turn: number }
  | { readonly kind: 'conflicted'; readonly paths: readonly string[]; readonly total: number }
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly paths: readonly string[] }
  | { readonly kind: 'ambiguous-attribution'; readonly paths: readonly string[] }
  | { readonly kind: 'skipped-locked' }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly reason: FailureReason; readonly detail: string }
  | { readonly kind: 'suspended'; readonly reason: string }

/** What one created commit was, and how a human withdraws it. */
export interface CommitReport {
  /** Created commit id. */
  readonly oid: string
  /** Parent commit id. */
  readonly parentOid: string
  /** Paths the commit contains, and no others. */
  readonly paths: readonly string[]
  /** Accepted subject line. */
  readonly subject: string
  /** Accepted body lines, empty when the message has none. */
  readonly body: readonly string[]
  /** Whether a provider or the mechanical fallback supplied the message. */
  readonly summarySource: string
  /** Every summary consultation note. */
  readonly summaryNotes: readonly string[]
  /** Bytes the credential screen read. */
  readonly scanBytes: number
  /** Whether no remote-tracking ref contains the commit yet. */
  readonly withdrawable: boolean
  /** Withdrawal command that keeps the changes staged. */
  readonly softReset: string
  /** Withdrawal command that keeps the changes in the work tree only. */
  readonly mixedReset: string
}

/** One retained run record; the ledger is the authoritative record. */
export interface RunRecord {
  /** Stable record id. */
  readonly id: string
  /** Job this run belonged to. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** Closed outcome. */
  readonly outcome: AutomationOutcome
  /** HEAD recorded before the first write of the run, when observed. */
  readonly expectedHeadOid: string | null
  /** Upstream commit id the run observed. */
  readonly observedUpstreamOid: string | null
  /** Baseline before the run. */
  readonly baselineBefore: string | null
  /** Baseline after the run. */
  readonly baselineAfter: string | null
  /** The commit this run created, when it created one. */
  readonly commit: CommitReport | null
}

/** Everything durable the runtime owns for one workspace. */
export interface AutomationStateRecord {
  /** Upstream commit id the workspace is aligned to. */
  readonly baselineUpstreamOid: string | null
  /** Local commit id the baseline was taken at. */
  readonly baselineLocalOid: string | null
  /** Tracked branch the baseline belongs to. */
  readonly baselineBranch: string | null
  /** When the last run finished, ISO-8601. */
  readonly lastRunAt: string | null
  /** The last run's outcome kind and reason, for a one-line report. */
  readonly lastOutcome: string | null
  /** Consecutive failures; reset by any non-failure outcome. */
  readonly consecutiveFailures: number
  /** Earliest time the next run may act, ISO-8601. */
  readonly nextEarliestRunAt: string | null
  /** Why the workspace is suspended, when it is. */
  readonly suspendedReason: string | null
  /** Owner of the run lease, when one is held. */
  readonly leaseOwner: string | null
  /** Lease expiry, ISO-8601. */
  readonly leaseUntil: string | null
  /** Last committed turn per session id. */
  readonly commitWatermarks: Record<string, number>
  /** Paths the last commit job left uncommitted, bounded. */
  readonly uncommittedPaths: readonly string[]
  /** Retained run records, newest last. */
  readonly ledger: readonly RunRecord[]
}

/** The narrow workspace facts the runtime needs. */
export interface WorkspaceRef {
  /** Workspace id. */
  readonly id: string
  /** Absolute workspace directory. */
  readonly path: string
  /** Sessions the workspace owns, in display order. */
  readonly sessionIds: readonly string[]
}

/** One attributed work unit: the paths one turn wrote and was proven to have written. */
export interface Attribution {
  /** Repository-relative paths the turn wrote. */
  readonly paths: readonly string[]
  /** Calls that named a path but produced no successful result. */
  readonly unresolved: number
}

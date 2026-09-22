/**
 * Wire vocabulary of the `workspace` Remote namespace's automation-ledger read.
 *
 * Types only: the generated Remote client for this package consumes this
 * module, so nothing here may reach Host runtime code.
 */
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Which of the runtime's two jobs one run belonged to. */
export type AutomationJob = 'align' | 'commit'

/** What asked for one run. */
export type RunTrigger = 'due' | 'turn-end'

/** Whether the workspace's timer is armed and its runs may write. */
export type AutomationMode = 'observe' | 'align'

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

/** How an aligning run advanced the branch. */
export type AlignStrategy = 'ff-only' | 'merge'

/**
 * One path list with the count it was drawn from: the ledger's own total where
 * it records one, and the length of the list the ledger held otherwise.
 */
export interface AutomationPaths {
  /** Paths the projection retained, at most its configured bound. */
  readonly paths: readonly string[]
  /** Paths the ledger held before the bound; never smaller than `paths.length`. */
  readonly total: number
}

/**
 * What one run did, or why it did not act.
 *
 * Restates the producer's closed outcome union for the wire; `src/projection.ts`
 * maps every variant and fails to compile if the producer adds one.
 */
export type AutomationRunOutcome =
  | { readonly kind: 'no-op'; readonly reason: NoOpReason }
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'committed'; readonly sessionId: string; readonly turn: number }
  | { readonly kind: 'conflicted'; readonly paths: AutomationPaths }
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly paths: AutomationPaths }
  | { readonly kind: 'ambiguous-attribution'; readonly paths: AutomationPaths }
  | { readonly kind: 'skipped-locked' }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly reason: FailureReason; readonly detail: string }
  | { readonly kind: 'suspended'; readonly reason: string }

/**
 * What the design's outcome table says happens after one run. One tag per row,
 * so a reader learns the next move without knowing the run's internals.
 */
export type AutomationNextStep =
  | 'none'
  | 'withdraw-commit'
  | 'human-resolves-conflict'
  | 'human-clears-condition'
  | 'human-reviews-paths'
  | 'next-round'
  | 'no-retry'
  | 'backoff'
  | 'human-clears-suspension'

/** What one run compared: the recorded baseline, the head it expected, and the id it observed. */
export interface AutomationComparison {
  /** Upstream commit id the workspace was aligned to when the run started; absent before the first alignment. */
  readonly baselineBefore: string | null
  /** Commit id the run recorded under `observedUpstreamOid`; absent when the run recorded none. */
  readonly observedUpstreamOid: string | null
  /** Commit id HEAD pointed at when the run recorded it; absent when the run wrote nothing. */
  readonly expectedHeadOid: string | null
  /** Upstream commit id the run left the workspace aligned to. */
  readonly baselineAfter: string | null
}

/** The commit one run created, and how a human withdraws it. */
export interface AutomationCommitView {
  /** Object id of the commit. */
  readonly oid: string
  /** Object id of the commit HEAD pointed at before it. */
  readonly parentOid: string
  /** The message's subject line. */
  readonly subject: string
  /** The message's body lines. */
  readonly body: readonly string[]
  /** Where the message came from: a consulting provider or the mechanical fallback. */
  readonly summarySource: string
  /** Paths the commit contains. */
  readonly paths: AutomationPaths
  /** Whether no remote-tracking ref held the commit when the run checked. */
  readonly withdrawable: boolean
  /** Command that withdraws the commit and keeps its content staged. */
  readonly softReset: string
  /** Command that withdraws the commit and keeps its content in the worktree. */
  readonly mixedReset: string
}

/** One retained run, answering the four questions the design requires of every run. */
export interface AutomationRunView {
  /** The ledger record's id. */
  readonly id: string
  /** Which job ran. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** What the run compared. */
  readonly comparison: AutomationComparison
  /** What the run did, or why it did not act. */
  readonly outcome: AutomationRunOutcome
  /** What happens next. */
  readonly nextStep: AutomationNextStep
  /** The commit the run created; present only when it created one. */
  readonly commit?: AutomationCommitView
}

/** The workspace's automation state, bounded runs, and their counts. */
export interface AutomationRecordedView {
  /** The workspace this ledger belongs to. */
  readonly workspaceId: WorkspaceId
  /** Whether the timer is armed for this workspace. */
  readonly enabled: boolean
  /** Whether the workspace's runs observe only or may write. */
  readonly mode: AutomationMode
  /** Why the workspace is suspended, when it is. */
  readonly suspendedReason: string | null
  /** Consecutive failed runs the runtime counted. */
  readonly consecutiveFailures: number
  /** Earliest instant the next run may act, ISO-8601. */
  readonly nextEarliestRunAt: string | null
  /** Upstream commit id the workspace is currently aligned to; absent before the first alignment. */
  readonly baselineUpstreamOid: string | null
  /** When the last run finished, ISO-8601. */
  readonly lastRunAt: string | null
  /** Paths the last commit job left uncommitted. */
  readonly uncommittedPaths: AutomationPaths
  /** Retained runs, newest first, at most the configured run bound. */
  readonly runs: readonly AutomationRunView[]
  /** Runs the ledger retains in total, at least `runs.length`. */
  readonly runCount: number
}

/**
 * One ledger read. A workspace the runtime stores nothing for is a normal
 * answer rather than an error: the timer may never have run there.
 */
export type AutomationLedgerView =
  | { readonly kind: 'unrecorded'; readonly workspaceId: WorkspaceId }
  | ({ readonly kind: 'recorded' } & AutomationRecordedView)

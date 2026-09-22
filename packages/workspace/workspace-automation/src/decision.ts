/**
 * Every decision the workspace automation runtime makes, as pure functions: the
 * staleness gate, the failure backoff, the next-run delay, the credential
 * screen, the commit staging set, attribution ambiguity, and the withdrawal
 * report.
 *
 * Keeping these decisions here rather than in the runtime is what makes them
 * testable at their exact limits — a tiny byte budget, a zero-second cooldown,
 * a threshold met exactly.
 *
 * @module @deepseek-ai/dsh-workspace-automation/decision
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { truncateUtf8 } from '@deepseek-ai/dsh-work-summary'
import type { AlignStrategy } from '@deepseek-ai/dsh-git-align'
import type { AutomationPolicy } from './config.ts'
import type { AutomationOutcome, RefusalReason, RunRecord } from './types.ts'
import type { StoredAutomationState } from './spec.ts'

/** The observed head facts one alignment decision is made from. */
export interface HeadFacts {
  /** Whether the workspace directory is inside a repository work tree. */
  readonly repository: boolean
  /** Whether HEAD is detached. */
  readonly detached: boolean
  /** Whether the tracked branch has an upstream. */
  readonly hasUpstream: boolean
  /** Commits the local branch is ahead of its upstream. */
  readonly ahead: number
  /** Commits the local branch is behind its upstream. */
  readonly behind: number
}

/** What one alignment decision resolved to. */
export type AlignmentDecision =
  | { readonly kind: 'proceed'; readonly strategy: AlignStrategy }
  | { readonly kind: 'probe-only' }
  | AutomationOutcome

/**
 * Decide what an alignment run may do, from observed head facts alone.
 *
 * A clean result is `proceed` (act) or `probe-only` (observe mode still probes
 * so a conflict stays visible); every other answer is a terminal outcome.
 * @param head - the observed head facts.
 * @param policy - the resolved policy for the workspace.
 * @param dirty - whether the work tree carries uncommitted changes.
 * @returns the decision.
 */
export function alignmentDecision(head: HeadFacts, policy: AutomationPolicy, dirty: boolean): AlignmentDecision {
  if (!head.repository) return { kind: 'no-op', reason: 'no-repository' }
  if (head.detached) return { kind: 'refused', reason: 'detached-head', paths: [] }
  if (!head.hasUpstream) return { kind: 'no-op', reason: 'no-upstream' }
  if (head.behind < policy.behindThreshold) return { kind: 'no-op', reason: 'up-to-date' }
  if (policy.downstreamVerification === 'external') {
    return { kind: 'no-op', reason: 'deferred-to-downstream-verification' }
  }
  if (policy.mode === 'observe') return { kind: 'probe-only' }
  if (dirty && policy.dirtyPolicy === 'refuse') return { kind: 'refused', reason: 'dirty', paths: [] }
  return { kind: 'proceed', strategy: policy.alignStrategy }
}

/**
 * Whether one outcome advances the failure backoff.
 * @param outcome - the closed run outcome.
 * @returns `true` only for failures and suspensions.
 */
export function countsAsFailure(outcome: AutomationOutcome): boolean {
  switch (outcome.kind) {
    case 'no-op':
    case 'aligned':
    case 'committed':
    case 'conflicted':
    case 'refused':
    case 'ambiguous-attribution':
    case 'skipped-locked':
    case 'superseded':
      return false
    case 'failed':
    case 'suspended':
      return true
    /* v8 ignore next 2 -- AutomationOutcome is closed and every member is handled above. */
    default:
      return assertNever(outcome)
  }
}

/** The backoff fields one failure updates. */
export interface BackoffUpdate {
  /** Consecutive failures after this one. */
  readonly consecutiveFailures: number
  /** Earliest time the next run may act, ISO-8601, or `null` when suspended. */
  readonly nextEarliestRunAt: string | null
  /** Why the workspace is suspended, or `null` while it is not. */
  readonly suspendedReason: string | null
}

/**
 * Advance the failure backoff by one failure.
 * @param state - the workspace's stored state.
 * @param policy - the resolved policy for the workspace.
 * @param now - current time in epoch milliseconds.
 * @returns the updated backoff fields.
 */
export function failureBackoff(state: StoredAutomationState, policy: AutomationPolicy, now: number): BackoffUpdate {
  const consecutiveFailures = state.consecutiveFailures + 1
  if (consecutiveFailures >= policy.backoff.suspendAfter) {
    return {
      consecutiveFailures,
      nextEarliestRunAt: null,
      suspendedReason: `${consecutiveFailures} consecutive failures; resume the workspace to retry`,
    }
  }
  const seconds = Math.min(policy.backoff.baseSeconds * 2 ** (consecutiveFailures - 1), policy.backoff.maxSeconds)
  return { consecutiveFailures, nextEarliestRunAt: new Date(now + seconds * 1000).toISOString(), suspendedReason: null }
}

/** The state fields a non-failure run resets. */
export interface ClearedBackoff {
  /** Always zero. */
  readonly consecutiveFailures: number
  /** Always `null`. */
  readonly suspendedReason: null
  /** Earliest time the next run may act. */
  readonly nextEarliestRunAt: string | null
}

/**
 * Reset the failure backoff after a non-failure outcome.
 * @param cooldownUntil - the conflict cooldown to impose, or `null` for none.
 * @returns the reset backoff fields.
 */
export function clearedBackoff(cooldownUntil: string | null): ClearedBackoff {
  return { consecutiveFailures: 0, suspendedReason: null, nextEarliestRunAt: cooldownUntil }
}

/**
 * The conflict cooldown a conflicted workspace is left alone for.
 * @param policy - the resolved policy for the workspace.
 * @param now - current time in epoch milliseconds.
 * @returns the cooldown expiry, or `null` when no cooldown is configured.
 */
export function conflictCooldown(policy: AutomationPolicy, now: number): string | null {
  if (policy.conflictCooldownSeconds === 0) return null
  return new Date(now + policy.conflictCooldownSeconds * 1000).toISOString()
}

/**
 * How long to wait before the next timer run for one workspace.
 * @param policy - the resolved policy for the workspace.
 * @param state - the workspace's stored state.
 * @param now - current time in epoch milliseconds.
 * @param random - source of the jitter fraction, in `[0, 1)`.
 * @returns the delay in milliseconds, or `undefined` when no run should be armed.
 */
export function nextRunDelayMs(
  policy: AutomationPolicy,
  state: StoredAutomationState,
  now: number,
  random: () => number,
): number | undefined {
  if (!policy.enabled) return undefined
  if (state.suspendedReason !== null) return undefined
  const earliest = state.nextEarliestRunAt === null ? Number.NaN : Date.parse(state.nextEarliestRunAt)
  if (Number.isFinite(earliest) && earliest > now) return earliest - now
  const interval = policy.intervalSeconds * 1000
  return Math.max(0, Math.round(interval * (1 + policy.jitterRatio * (random() * 2 - 1))))
}

/**
 * Whether another writer currently holds the workspace's run lease.
 * @param state - the workspace's stored state.
 * @param now - current time in epoch milliseconds.
 * @returns `true` while an unexpired lease is held.
 */
export function leaseIsHeld(state: StoredAutomationState, now: number): boolean {
  if (state.leaseOwner === null || state.leaseUntil === null) return false
  const until = Date.parse(state.leaseUntil)
  return Number.isFinite(until) && until > now
}

/** One path's text as offered to the credential screen. */
export interface ScannableFile {
  /** Repository-relative path. */
  readonly path: string
  /** The path's current text. */
  readonly text: string
}

/** The credential screen's answer. */
export interface SecretScan {
  /** Paths where a declared pattern matched. */
  readonly hits: readonly string[]
  /** Bytes the screen inspected. */
  readonly bytes: number
}

/**
 * Screen path contents for the declared credential shapes.
 *
 * The screen reads at most `maxScanBytes` of each path. A match always refuses;
 * the pattern set is configurable, the refusal is not.
 * @param files - the paths to inspect.
 * @param patterns - compiled credential patterns.
 * @param maxScanBytes - maximum bytes inspected per path.
 * @returns the hit paths and the inspected byte count.
 */
export function scanForSecrets(
  files: readonly ScannableFile[],
  patterns: readonly RegExp[],
  maxScanBytes: number,
): SecretScan {
  const hits: string[] = []
  let bytes = 0
  for (const file of files) {
    const inspected = truncateUtf8(file.text, maxScanBytes)
    bytes += Buffer.byteLength(inspected, 'utf8')
    if (patterns.some((pattern) => {
      pattern.lastIndex = 0
      return pattern.test(inspected)
    })) hits.push(file.path)
  }
  return { hits, bytes }
}

/** The commit staging decision. */
export type StagingDecision =
  | { readonly kind: 'staged'; readonly paths: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly paths: readonly string[] }

/**
 * Decide whether one commit may contain the attributed paths.
 * @param paths - the paths the work unit was proven to have written.
 * @param maxPathsPerCommit - the staging-set bound.
 * @returns the staging decision; an over-bound set is refused, never trimmed.
 */
export function stagingDecision(paths: readonly string[], maxPathsPerCommit: number): StagingDecision {
  if (paths.length === 0) return { kind: 'refused', reason: 'unattributable-remainder', paths: [] }
  if (paths.length > maxPathsPerCommit) {
    return { kind: 'refused', reason: 'too-many-paths', paths: paths.slice(0, maxPathsPerCommit) }
  }
  return { kind: 'staged', paths }
}

/**
 * Paths this work unit wrote that an earlier uncommitted work unit also wrote.
 * @param target - the paths attributed to the work unit being committed.
 * @param earlier - the paths attributed to earlier uncommitted work units.
 * @returns the ambiguous paths, in the target's order.
 */
export function ambiguousPaths(target: readonly string[], earlier: readonly string[]): string[] {
  const other = new Set(earlier)
  return target.filter(path => other.has(path))
}

/** How a human withdraws one created commit. */
export interface UndoReport {
  /** Whether no remote-tracking ref contains the commit yet. */
  readonly withdrawable: boolean
  /** Withdrawal command that keeps the changes staged. */
  readonly softReset: string
  /** Withdrawal command that keeps the changes in the work tree only. */
  readonly mixedReset: string
}

/**
 * The withdrawal report for one created commit.
 *
 * Both commands keep every change; neither is destructive, and the report
 * states that plainly because a destructive withdrawal is not offered.
 * @param parentOid - the created commit's parent.
 * @param withdrawable - whether no remote-tracking ref contains the commit yet.
 * @returns the withdrawal report.
 */
export function undoReport(parentOid: string, withdrawable: boolean): UndoReport {
  return {
    withdrawable,
    softReset: `git reset --soft ${parentOid}`,
    mixedReset: `git reset --mixed ${parentOid}`,
  }
}

/**
 * Append one run record to the ledger and retain only the newest records.
 * @param ledger - the retained records, newest last.
 * @param record - the record to append.
 * @param limit - maximum records to retain.
 * @returns the new ledger.
 */
export function retainLedger(
  ledger: readonly RunRecord[],
  record: RunRecord,
  limit: number,
): readonly RunRecord[] {
  return [...ledger, record].slice(-limit)
}

/**
 * The one-line summary of an outcome recorded in the workspace's state.
 * @param outcome - the closed run outcome.
 * @returns a stable `kind:reason` string.
 */
export function describeOutcome(outcome: AutomationOutcome): string {
  switch (outcome.kind) {
    case 'no-op':
      return `no-op:${outcome.reason}`
    case 'aligned':
      return `aligned:${outcome.strategy}`
    case 'committed':
      return `committed:${outcome.sessionId}/${outcome.turn}`
    case 'conflicted':
      return `conflicted:${outcome.total}`
    case 'refused':
      return `refused:${outcome.reason}`
    case 'ambiguous-attribution':
      return `ambiguous-attribution:${outcome.paths.length}`
    case 'skipped-locked':
      return 'skipped-locked'
    case 'superseded':
      return 'superseded'
    case 'failed':
      return `failed:${outcome.reason}`
    case 'suspended':
      return 'suspended'
    /* v8 ignore next 2 -- AutomationOutcome is closed and every member is handled above. */
    default:
      return assertNever(outcome)
  }
}

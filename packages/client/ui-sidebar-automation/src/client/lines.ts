/**
 * The panel's pure lines: one sentence per outcome and per next step, the paths
 * a run named, and the short form of a commit id.
 *
 * Every closed union in this file is switched exhaustively, so a new variant on
 * the wire fails the build here instead of reaching the panel as an empty card:
 * the design's metric is that a run which refused, was superseded, or correctly
 * did nothing still reads as an explanation.
 */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AlignStrategy,
  AutomationNextStep,
  AutomationPaths,
  AutomationRunOutcome,
  AutomationRunView,
  FailureReason,
  NoOpReason,
  RefusalReason,
} from '@deepseek-ai/dsh-api-workspace-automation/types'
import type { SidebarAutomationKey } from './locales.ts'

/** The translate seat this panel's lines are written against. */
export type AutomationTranslate = TranslateNS<'sidebarAutomation'>

/** How many leading characters of a commit id the panel shows. */
const SHORT_OID_LENGTH = 7

/**
 * Shorten one commit id for a line.
 * @param oid - the full object id.
 * @returns its leading characters, or the id itself when it is already short.
 */
export function shortOid(oid: string): string {
  return oid.slice(0, SHORT_OID_LENGTH)
}

/**
 * Render one commit id, or the word for a value the ledger did not record.
 * @param oid - the recorded id, or null.
 * @param t - namespace-bound translate.
 * @returns the id's short form, or the not-recorded line.
 */
export function oidOrNone(oid: string | null, t: AutomationTranslate): string {
  return oid === null ? t('comparison.none') : shortOid(oid)
}

/**
 * Say what one run did, or why it did not act.
 * @param t - namespace-bound translate.
 * @param outcome - the recorded outcome.
 * @returns the line for that outcome.
 */
export function outcomeLine(t: AutomationTranslate, outcome: AutomationRunOutcome): string {
  switch (outcome.kind) {
    case 'no-op':
      return t(noOpKey(outcome.reason))
    case 'aligned':
      return t(strategyKey(outcome.strategy))
    case 'committed':
      return t('outcome.committed', { session: outcome.sessionId, turn: outcome.turn })
    case 'conflicted':
      return t('outcome.conflicted')
    case 'refused':
      return t(refusalKey(outcome.reason))
    case 'ambiguous-attribution':
      return t('outcome.ambiguous-attribution', { count: outcome.paths.total })
    case 'skipped-locked':
      return t('outcome.skipped-locked')
    case 'superseded':
      return t('outcome.superseded')
    case 'failed':
      return t(failureKey(outcome.reason))
    case 'suspended':
      return t('outcome.suspended', { reason: outcome.reason })
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'AutomationRunOutcome')
  }
}

/**
 * Say what the design's outcome table assigns to one run next.
 * @param t - namespace-bound translate.
 * @param next - the next-step tag.
 * @returns the line for that tag.
 */
export function nextStepLine(t: AutomationTranslate, next: AutomationNextStep): string {
  switch (next) {
    case 'none':
      return t('next.none')
    case 'withdraw-commit':
      return t('next.withdraw-commit')
    case 'human-resolves-conflict':
      return t('next.human-resolves-conflict')
    case 'human-clears-condition':
      return t('next.human-clears-condition')
    case 'human-reviews-paths':
      return t('next.human-reviews-paths')
    case 'next-round':
      return t('next.next-round')
    case 'no-retry':
      return t('next.no-retry')
    case 'backoff':
      return t('next.backoff')
    case 'human-clears-suspension':
      return t('next.human-clears-suspension')
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(next, 'AutomationNextStep')
  }
}

/**
 * Say why the ledger could not be read at all.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the panel.
 */
export function failureLine(t: AutomationTranslate, failure: RemoteFailure): string {
  // Carrier and unclassified Host failures reach the reader as themselves:
  // this panel declares no failure code of its own, so it knows nothing
  // useful to add to a transport-level message.
  return t('error.failed', { message: failure.message })
}

/**
 * The paths one run named, whichever question they answer.
 *
 * A commit names the paths it contains, a conflict names the paths that clash,
 * and a refusal or an unattributable remainder names the paths it would not
 * commit. A run that named none answers with nothing, which the panel renders
 * as the same explicit line as an empty list.
 * @param run - the projected run.
 * @returns the run's bounded path list, or undefined when it named none.
 */
export function runPaths(run: AutomationRunView): AutomationPaths | undefined {
  switch (run.outcome.kind) {
    case 'committed':
      return run.commit?.paths
    case 'conflicted':
    case 'refused':
    case 'ambiguous-attribution':
      return run.outcome.paths
    case 'no-op':
    case 'aligned':
    case 'skipped-locked':
    case 'superseded':
    case 'failed':
    case 'suspended':
      return undefined
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(run.outcome, 'AutomationRunOutcome')
  }
}

/**
 * The copy key for one no-op reason.
 * @param reason - the recorded reason.
 * @returns its key.
 */
function noOpKey(reason: NoOpReason): SidebarAutomationKey {
  switch (reason) {
    case 'up-to-date':
      return 'outcome.no-op.up-to-date'
    case 'no-repository':
      return 'outcome.no-op.no-repository'
    case 'no-upstream':
      return 'outcome.no-op.no-upstream'
    case 'observe-only':
      return 'outcome.no-op.observe-only'
    case 'deferred-to-downstream-verification':
      return 'outcome.no-op.deferred-to-downstream-verification'
    case 'no-attributable-paths':
      return 'outcome.no-op.no-attributable-paths'
    case 'already-committed':
      return 'outcome.no-op.already-committed'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(reason, 'NoOpReason')
  }
}

/**
 * The copy key for one refusal reason.
 * @param reason - the recorded reason.
 * @returns its key.
 */
function refusalKey(reason: RefusalReason): SidebarAutomationKey {
  switch (reason) {
    case 'detached-head':
      return 'outcome.refused.detached-head'
    case 'dirty':
      return 'outcome.refused.dirty'
    case 'secrets':
      return 'outcome.refused.secrets'
    case 'colocated-vcs':
      return 'outcome.refused.colocated-vcs'
    case 'too-many-paths':
      return 'outcome.refused.too-many-paths'
    case 'unattributable-remainder':
      return 'outcome.refused.unattributable-remainder'
    case 'unreadable-path':
      return 'outcome.refused.unreadable-path'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(reason, 'RefusalReason')
  }
}

/**
 * The copy key for one failure reason.
 * @param reason - the recorded reason.
 * @returns its key.
 */
function failureKey(reason: FailureReason): SidebarAutomationKey {
  switch (reason) {
    case 'fetch':
      return 'outcome.failed.fetch'
    case 'probe':
      return 'outcome.failed.probe'
    case 'merge':
      return 'outcome.failed.merge'
    case 'merge-dirty':
      return 'outcome.failed.merge-dirty'
    case 'superseded-write':
      return 'outcome.failed.superseded-write'
    case 'observe':
      return 'outcome.failed.observe'
    case 'resolve':
      return 'outcome.failed.resolve'
    case 'commit':
      return 'outcome.failed.commit'
    case 'ledger':
      return 'outcome.failed.ledger'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(reason, 'FailureReason')
  }
}

/**
 * The copy key for one alignment strategy.
 * @param strategy - the recorded strategy.
 * @returns its key.
 */
function strategyKey(strategy: AlignStrategy): SidebarAutomationKey {
  switch (strategy) {
    case 'ff-only':
      return 'outcome.aligned.ff-only'
    case 'merge':
      return 'outcome.aligned.merge'
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return assertNever(strategy, 'AlignStrategy')
  }
}

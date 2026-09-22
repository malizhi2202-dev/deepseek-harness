/**
 * The panel's body: one workspace's automation ledger, drawn whole.
 *
 * The reader is a person, not a model, and the design's metric for this panel is
 * that every run explains itself. So each run answers the four questions the
 * design requires, in its order: what it compared, what it did or why it did
 * not, which paths it named, and what happens next. A run that refused, was
 * superseded, or correctly did nothing renders the same four answers with its
 * own sentence rather than an empty card.
 *
 * The ledger is keyed by workspace while the tab is session-scoped, so the
 * workspace is resolved from the framework's workspace hook and the read is
 * started with it. A session that belongs to no registered workspace says so and
 * asks for nothing.
 *
 * Nothing here writes: the panel has no enable, disable, retry, or schedule
 * control, because the design leaves every one of those to a person outside the
 * panel. The one control is reading the ledger again.
 */
import { useEffect, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IconAlarmClockOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AutomationCommitView,
  AutomationLedgerView,
  AutomationPaths,
  AutomationRecordedView,
  AutomationRunView,
} from '@deepseek-ai/dsh-api-workspace-automation/types'
import type { AutomationInjected } from './face.ts'
import type {} from './locales.ts'
import { failureLine, nextStepLine, oidOrNone, outcomeLine, runPaths, shortOid } from './lines.ts'
import type { AutomationTranslate } from './lines.ts'
import type { createAutomationStore } from './store.ts'
import css from './AutomationBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type AutomationBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createAutomationStore>>
  & AutomationInjected
  & PropsLocale<'sidebarAutomation'>

/** The four questions the design requires of every run, in its order. */
type QuestionName = 'compared' | 'outcome' | 'paths' | 'next'

/** One question's block: its label, then its answer. */
function Question({ name, label, children }: { name: QuestionName; label: string; children: ReactNode }): ReactNode {
  return (
    <div className={css.question} data-automation-question={name}>
      <span className={css.questionLabel}>{label}</span>
      <div className={css.answer}>{children}</div>
    </div>
  )
}

/**
 * The paths one run named, bounded, with the count that did not fit.
 * @param props - the run's path list, absent when it named none, and the copy.
 * @returns the list, or the explicit line for a run that named no path.
 */
function PathList({ paths, t }: { paths: AutomationPaths | undefined; t: AutomationTranslate }): ReactNode {
  if (paths === undefined || paths.paths.length === 0) {
    return <p className={css.note} data-automation-paths="empty">{t('paths.empty')}</p>
  }
  return (
    <>
      <ul className={css.paths} data-automation-paths="listed">
        {paths.paths.map(path => <li key={path} className={css.path} data-automation-path={path}>{path}</li>)}
      </ul>
      {paths.total > paths.paths.length
        && (
          <p className={css.note} data-automation-paths-more>
            {t('paths.more', { count: paths.total - paths.paths.length })}
          </p>
        )}
    </>
  )
}

/**
 * What one run committed, and how a person withdraws it.
 * @param props - the recorded commit and the copy.
 * @returns the commit's identity, message, and withdrawal commands.
 */
function CommitDetail({ commit, t }: { commit: AutomationCommitView; t: AutomationTranslate }): ReactNode {
  return (
    <div className={css.commit} data-automation-commit={commit.oid}>
      <p className={css.line} data-automation-commit-title>
        {t('commit.title', { oid: shortOid(commit.oid) })}
      </p>
      <p className={css.sub} data-automation-commit-parent>
        {t('commit.parent', { oid: shortOid(commit.parentOid) })}
      </p>
      <p className={css.subject} data-automation-commit-subject>{commit.subject}</p>
      {commit.body.length > 0
        && <p className={css.body} data-automation-commit-body>{commit.body.join('\n')}</p>}
      <p className={css.sub} data-automation-commit-source>
        {t('commit.source', { source: commit.summarySource })}
      </p>
      <p className={css.sub} data-automation-commit-paths>
        {t('commit.paths', { count: commit.paths.total })}
      </p>
      <p className={css.sub} data-automation-commit-withdrawable={String(commit.withdrawable)}>
        {t(commit.withdrawable ? 'commit.withdrawable' : 'commit.pushed')}
      </p>
      {commit.withdrawable
        && (
          <>
            <code className={css.command} data-automation-commit-soft>
              {t('commit.soft', { command: commit.softReset })}
            </code>
            <code className={css.command} data-automation-commit-mixed>
              {t('commit.mixed', { command: commit.mixedReset })}
            </code>
          </>
        )}
    </div>
  )
}

/**
 * One run's four answers.
 * @param props - the projected run and the copy.
 * @returns the run's card.
 */
function RunCard({ run, t }: { run: AutomationRunView; t: AutomationTranslate }): ReactNode {
  const { comparison } = run
  return (
    <li
      className={css.run}
      data-automation-run={run.id}
      data-automation-outcome={run.outcome.kind}
      data-automation-started={run.startedAt}
      data-automation-finished={run.finishedAt}
    >
      <div className={css.runHead}>
        <span className={css.job} data-automation-job={run.job}>
          {t(run.job === 'commit' ? 'run.job.commit' : 'run.job.align')}
        </span>
        <span className={css.trigger} data-automation-trigger={run.trigger}>
          {t(run.trigger === 'turn-end' ? 'run.trigger.turn-end' : 'run.trigger.due')}
        </span>
        <span className={css.window} data-automation-window>
          {t('run.window', { started: run.startedAt, finished: run.finishedAt })}
        </span>
      </div>
      <Question name="compared" label={t('question.compared')}>
        <p className={css.line} data-automation-comparison>
          {t('comparison.line', {
            before: oidOrNone(comparison.baselineBefore, t),
            after: oidOrNone(comparison.observedUpstreamOid, t),
          })}
        </p>
        {comparison.expectedHeadOid !== null
          && (
            <p className={css.sub} data-automation-expected-head>
              {t('comparison.expected', { oid: shortOid(comparison.expectedHeadOid) })}
            </p>
          )}
        {comparison.baselineAfter !== null
          && (
            <p className={css.sub} data-automation-baseline-after>
              {t('comparison.after', { oid: shortOid(comparison.baselineAfter) })}
            </p>
          )}
      </Question>
      <Question name="outcome" label={t('question.outcome')}>
        <p className={css.line} data-automation-did>{outcomeLine(t, run.outcome)}</p>
        {run.outcome.kind === 'failed'
          && <p className={css.sub} data-automation-detail>{t('outcome.detail', { detail: run.outcome.detail })}</p>}
        {run.commit !== undefined && <CommitDetail commit={run.commit} t={t} />}
      </Question>
      <Question name="paths" label={t('question.paths')}>
        <PathList paths={runPaths(run)} t={t} />
      </Question>
      <Question name="next" label={t('question.next')}>
        <p className={css.line} data-automation-next>{nextStepLine(t, run.nextStep)}</p>
      </Question>
    </li>
  )
}

/**
 * The workspace's own state: whether its timer is armed, what it may do, and
 * where its baseline, backoff, and uncommitted remainder stand.
 * @param props - the recorded ledger and the copy.
 * @returns the state section.
 */
function StateSection({ ledger, t }: { ledger: AutomationRecordedView; t: AutomationTranslate }): ReactNode {
  return (
    <section className={css.section} data-automation-section="state">
      <h2 className={css.sectionTitle}>{t('state.title')}</h2>
      <div className={css.chips}>
        <span className={css.chip} data-automation-enabled={String(ledger.enabled)}>
          {t(ledger.enabled ? 'state.enabled' : 'state.disabled')}
        </span>
        <span className={css.chip} data-automation-mode={ledger.mode}>
          {t(ledger.mode === 'align' ? 'state.mode.align' : 'state.mode.observe')}
        </span>
        {ledger.consecutiveFailures > 0
          && <span className={css.chip} data-automation-failures>{t('state.failures', { count: ledger.consecutiveFailures })}</span>}
      </div>
      <p className={css.line} data-automation-baseline>
        {ledger.baselineUpstreamOid === null
          ? t('state.baselineNone')
          : t('state.baseline', { oid: shortOid(ledger.baselineUpstreamOid) })}
      </p>
      <p className={css.line} data-automation-last-run>
        {ledger.lastRunAt === null ? t('state.never') : t('state.lastRun', { at: ledger.lastRunAt })}
      </p>
      {ledger.nextEarliestRunAt !== null
        && <p className={css.sub} data-automation-next-run>{t('state.nextRun', { at: ledger.nextEarliestRunAt })}</p>}
      {ledger.suspendedReason !== null
        && <p className={css.sub} data-automation-suspended>{t('state.suspended', { reason: ledger.suspendedReason })}</p>}
      <p className={css.sub} data-automation-uncommitted={ledger.uncommittedPaths.total}>
        {ledger.uncommittedPaths.total === 0
          ? t('state.uncommittedNone')
          : t('state.uncommitted', { count: ledger.uncommittedPaths.total })}
      </p>
      {ledger.uncommittedPaths.paths.length > 0 && <PathList paths={ledger.uncommittedPaths} t={t} />}
    </section>
  )
}

/**
 * The retained runs, newest first, and the ledger's own count beside them.
 * @param props - the recorded ledger and the copy.
 * @returns the runs section.
 */
function RunsSection({ ledger, t }: { ledger: AutomationRecordedView; t: AutomationTranslate }): ReactNode {
  return (
    <section className={css.section} data-automation-section="runs">
      <h2 className={css.sectionTitle}>{t('runs.title')}</h2>
      {ledger.runs.length === 0
        ? <p className={css.note} data-automation-runs="empty">{t('runs.empty')}</p>
        : (
          <ul className={css.runs} data-automation-runs="listed">
            {ledger.runs.map(run => <RunCard key={run.id} run={run} t={t} />)}
          </ul>
        )}
      {ledger.runCount > ledger.runs.length
        && (
          <p className={css.note} data-automation-runs-bounded>
            {t('runs.bounded', { total: ledger.runCount, shown: ledger.runs.length })}
          </p>
        )}
    </section>
  )
}

/**
 * The recorded ledger: the workspace's state, then its runs.
 * @param props - the recorded ledger and the copy.
 * @returns the two sections.
 */
function Recorded({ ledger, t }: { ledger: AutomationRecordedView; t: AutomationTranslate }): ReactNode {
  return (
    <>
      <StateSection ledger={ledger} t={t} />
      <RunsSection ledger={ledger} t={t} />
    </>
  )
}

/**
 * The panel's body: one workspace's automation ledger, drawn whole.
 * @param props - the composed body props.
 * @returns the panel.
 */
export function AutomationBody({
  useTabInfo, sessionId, useWorkspaces, useStore, start, reload, t,
}: AutomationBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const workspace = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId)))
  const state = useStore(store => store.byTab[tab.id])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || workspace === undefined || signal.aborted) return
    start(tab.id, workspace.workspaceId, signal)
  }, [state, workspace, tab.id, signal, start])

  if (workspace === undefined) {
    return (
      <div className={css.status} data-automation-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined || state.kind === 'loading') {
    return (
      <div className={css.status} data-automation-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.status} data-automation-state="failed">
        <p className={css.statusLine}>{failureLine(t, state.failure)}</p>
      </div>
    )
  }
  const ledger: AutomationLedgerView = state.ledger
  return (
    <div className={css.root} data-automation-state={ledger.kind}>
      <div className={css.header}>
        <IconAlarmClockOutline16 />
        <span className={css.name}>{workspace.title}</span>
        <button
          type="button"
          className={css.tool}
          title={t('reload')}
          aria-label={t('reload')}
          onClick={() => { reload(tab.id, workspace.workspaceId, signal) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      <div className={css.workspacePath} data-automation-workspace-path>{workspace.path}</div>
      {ledger.kind === 'unrecorded'
        ? <p className={css.note} data-automation-unrecorded>{t('unrecorded')}</p>
        : <Recorded ledger={ledger} t={t} />}
    </div>
  )
}

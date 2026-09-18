/**
 * The panel's body: the session's workspace, observed as the git repository
 * that contains it.
 *
 * Everything the panel keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component itself only decides
 * what to draw for the settled answer: the head's facts, the branch list, the
 * bounded history with its lane gutter, and the worktree's entries with the
 * side each changed on. The header row carries the one control: reload, which
 * reads the observation again and replaces whatever the tab holds.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitChangeKind,
  GitCommit,
  GitRepositorySnapshot,
  GitWorktreeEntry,
} from '@deepseek-ai/dsh-api-workspace-git/types'
import type { GitInjected } from './face.ts'
import { commitDay, countWorktree, historyLanes, shortOid } from './history.ts'
import type {} from './locales.ts'
import type { createGitStore } from './store.ts'
import css from './GitBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type GitBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createGitStore>>
  & GitInjected
  & PropsLocale<'sidebarGit'>

/** One lane step's width in the history gutter. */
const LANE_STEP = 10

/**
 * Say why the observation could not be read.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the panel.
 */
export function failureLine(t: TranslateNS<'sidebarGit'>, failure: RemoteFailure): string {
  if (failure.code === 'workspace-git/unavailable') return t('error.unavailable', { message: failure.message })
  // Carrier and unclassified host failures reach the reader as themselves:
  // this panel knows nothing useful to add to a transport-level message.
  return t('error.failed', { message: failure.message })
}

/**
 * The repository's title: the final path segment of its root, or the root
 * itself when it is nothing but separators.
 * @param snapshot - the settled observation.
 * @returns the label for the header row.
 */
export function repositoryTitle(snapshot: GitRepositorySnapshot): string {
  const parts = snapshot.root.split(/[\\/]/).filter(part => part !== '')
  return parts.at(-1) ?? snapshot.root
}

/**
 * One change kind's word.
 * @param t - namespace-bound translate.
 * @param kind - the change kind a worktree entry carries.
 * @returns the word the entry's badge shows.
 */
function changeWord(t: TranslateNS<'sidebarGit'>, kind: GitChangeKind): string {
  switch (kind) {
    case 'added': return t('change.added')
    case 'copied': return t('change.copied')
    case 'deleted': return t('change.deleted')
    case 'modified': return t('change.modified')
    case 'renamed': return t('change.renamed')
    case 'type-changed': return t('change.type-changed')
    case 'unmerged': return t('change.unmerged')
  }
}

/** The head's facts: branch, tracking, and the commit it points at. */
function HeadFacts({ snapshot, t }: { snapshot: GitRepositorySnapshot; t: TranslateNS<'sidebarGit'> }): ReactNode {
  const { head } = snapshot
  return (
    <div className={css.facts} data-git-head>
      {head.branch !== undefined
        ? <span className={css.strong}>{head.branch}</span>
        : <span className={css.strong}>{t('head.detached')}</span>}
      {head.upstream !== undefined && <span>{t('head.upstream', { upstream: head.upstream })}</span>}
      {head.ahead !== undefined && head.behind !== undefined
        && <span>{t('head.aheadBehind', { ahead: head.ahead, behind: head.behind })}</span>}
      {head.oid !== undefined
        ? <span className={css.oid}>{t('head.oid', { oid: shortOid(head.oid) })}</span>
        : <span>{t('head.unborn')}</span>}
    </div>
  )
}

/** The branch list, the current branch reading stronger than the rest. */
function BranchList({ snapshot, t }: { snapshot: GitRepositorySnapshot; t: TranslateNS<'sidebarGit'> }): ReactNode {
  return (
    <ul className={css.list} data-git-branches>
      {snapshot.branches.length === 0 && <li className={css.note} data-git-branches-row="empty">{t('branches.empty')}</li>}
      {snapshot.branches.map(branch => (
        <li
          key={branch.name}
          className={branch.name === snapshot.head.branch ? css.current : css.branch}
          data-git-branches-row={branch.name}
          data-git-branches-current={branch.name === snapshot.head.branch ? 'true' : undefined}
        >
          {branch.name}
        </li>
      ))}
      {snapshot.branchesTruncated
        && <li className={css.note} data-git-branches-row="truncated">{t('branches.truncated')}</li>}
    </ul>
  )
}

/** One commit's row: the lane gutter, then the subject, then the meta line. */
function CommitRow({ commit, lane, width }: { commit: GitCommit; lane: number; width: number }): ReactNode {
  return (
    <li className={css.commit} data-git-commit={commit.oid} data-git-lane={lane}>
      <span className={css.lanes} style={{ width: `${width}px` }} aria-hidden="true">
        <span className={css.thread} style={{ left: `${lane * LANE_STEP + 3}px` }} />
        <span className={css.dot} style={{ left: `${lane * LANE_STEP}px` }} />
      </span>
      <span className={css.commitBody}>
        <span className={css.subject}>{commit.subject}</span>
        <span className={css.meta}>
          <span className={css.oid}>{shortOid(commit.oid)}</span>
          {` ${commit.author} · ${commitDay(commit.authoredAt)}`}
        </span>
      </span>
    </li>
  )
}

/** The bounded history with its lane gutter, newest first. */
function HistoryList({ snapshot, t }: { snapshot: GitRepositorySnapshot; t: TranslateNS<'sidebarGit'> }): ReactNode {
  const lanes = historyLanes(snapshot.history)
  const width = (Math.max(0, ...lanes) + 1) * LANE_STEP
  return (
    <ul className={css.list} data-git-history>
      {snapshot.history.length === 0 && <li className={css.note} data-git-history-row="empty">{t('history.empty')}</li>}
      {snapshot.history.map((commit, index) => {
        const lane = lanes[index]
        /* v8 ignore next -- historyLanes answers one lane per commit, so the index is always in range. */
        return <CommitRow key={commit.oid} commit={commit} lane={lane ?? 0} width={width} />
      })}
      {snapshot.historyTruncated
        && <li className={css.note} data-git-history-row="truncated">{t('history.truncated', { count: snapshot.history.length })}</li>}
    </ul>
  )
}

/** One side's badge: which side changed, and how. */
function SideBadge({ side, kind, t }: { side: 'staged' | 'unstaged'; kind: GitChangeKind; t: TranslateNS<'sidebarGit'> }): ReactNode {
  return (
    <span className={css.badge} data-git-side={side} data-git-kind={kind}>
      {side === 'staged' ? t('side.staged') : t('side.unstaged')}
      {` ${changeWord(t, kind)}`}
    </span>
  )
}

/** One worktree entry: its side badges, then the path it names. */
function WorktreeRow({ entry, t }: { entry: GitWorktreeEntry; t: TranslateNS<'sidebarGit'> }): ReactNode {
  if (entry.kind === 'untracked') {
    return (
      <li className={css.row} data-git-worktree={entry.path} data-git-worktree-kind="untracked">
        <span className={css.badges}><span className={css.badge} data-git-kind="untracked">{t('worktree.untracked')}</span></span>
        <span className={css.name}>{entry.path}</span>
      </li>
    )
  }
  return (
    <li className={css.row} data-git-worktree={entry.path} data-git-worktree-kind="changed">
      <span className={css.badges}>
        {entry.staged !== undefined && <SideBadge side="staged" kind={entry.staged} t={t} />}
        {entry.unstaged !== undefined && <SideBadge side="unstaged" kind={entry.unstaged} t={t} />}
      </span>
      <span className={css.name}>
        {entry.path}
        {entry.origPath !== undefined ? ` ${t('worktree.from', { from: entry.origPath })}` : ''}
      </span>
    </li>
  )
}

/** The worktree's entries with the status line above them. */
function WorktreeList({ snapshot, t }: { snapshot: GitRepositorySnapshot; t: TranslateNS<'sidebarGit'> }): ReactNode {
  const counts = countWorktree(snapshot.worktree)
  return (
    <>
      <div className={css.facts} data-git-counts>
        <span>{t('worktree.counts', { staged: counts.staged, unstaged: counts.unstaged, untracked: counts.untracked })}</span>
      </div>
      <ul className={css.list} data-git-worktree-list>
        {snapshot.worktree.length === 0 && <li className={css.note} data-git-worktree-row="empty">{t('worktree.empty')}</li>}
        {snapshot.worktree.map(entry => <WorktreeRow key={`${entry.kind}:${entry.path}`} entry={entry} t={t} />)}
        {snapshot.worktreeTruncated
        && <li className={css.note} data-git-worktree-row="truncated">{t('worktree.truncated')}</li>}
      </ul>
    </>
  )
}

/** The panel's body: one settled observation, drawn whole. */
export function GitBody({
  useTabInfo, sessionId, useSessions, useStore, start, reload, t,
}: GitBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-git-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined || state.kind === 'loading') {
    return (
      <div className={css.status} data-git-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.kind === 'absent') {
    return (
      <div className={css.status} data-git-state="absent">
        <p className={css.statusLine}>{t('absent')}</p>
      </div>
    )
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.status} data-git-state="failed" data-git-code={state.failure.code}>
        <p className={css.statusLine}>{failureLine(t, state.failure)}</p>
      </div>
    )
  }
  return (
    <div className={css.root} data-git-state="repository" data-git-root={state.snapshot.root}>
      <div className={css.header}>
        <IconBranchOutline16 />
        <span className={css.name}>{repositoryTitle(state.snapshot)}</span>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-git-reload
          onClick={() => { reload(tab.id, signal) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      <p className={css.sectionTitle}>{t('section.head')}</p>
      <HeadFacts snapshot={state.snapshot} t={t} />
      <p className={css.sectionTitle}>{t('section.branches')}</p>
      <BranchList snapshot={state.snapshot} t={t} />
      <p className={css.sectionTitle}>{t('section.history')}</p>
      <HistoryList snapshot={state.snapshot} t={t} />
      <p className={css.sectionTitle}>{t('section.worktree')}</p>
      <WorktreeList snapshot={state.snapshot} t={t} />
    </div>
  )
}

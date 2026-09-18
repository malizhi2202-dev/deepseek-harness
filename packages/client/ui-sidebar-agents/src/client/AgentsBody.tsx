/**
 * The derivation panel's body: the subagent forest of the session this tab
 * belongs to.
 *
 * The tree is the session list's own summaries, so it is complete and readable
 * before any child catalog arrives, and it holds finished, failed, and running
 * derivations alike. A branch opens by itself while it still has work below it;
 * every other branch opens on a gesture.
 *
 * The direct-child catalog is a second, slower fact and is drawn as such: a node
 * whose catalog has not been read says so instead of looking childless, a read
 * in progress says so, a failed read offers a retry, and the entries a catalog
 * reports without a summary of their own appear as disabled diagnostic rows.
 * Navigation is admitted only for a `child` entry of a catalog that has
 * answered, because the address needs the child's mode and the host refuses an
 * unhealthy one.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import type { SubagentCatalogSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconChevronRightOutline14, IconRefreshOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import {
  MAX_CONCURRENT_CATALOG_READS, MAX_LINEAGE_DEPTH, buildLineageForest, hasRunningDescendant, type LineageNode,
} from './lineage.ts'
import { NS, type SidebarAgentsKey } from './locales.ts'
import css from './AgentsBody.module.css'

type Catalog = SubagentCatalogSnapshot
type CatalogEntry = Catalog['entries'][number]
type ChildEntry = Extract<CatalogEntry, { kind: 'child' }>
type DiagnosticEntry = Extract<CatalogEntry, { kind: 'diagnostic' }>

/** Business actions supplied by the slot registration. */
export interface AgentsInjected {
  /** Open one catalogued child session as the addressed session. */
  openChild: (address: SubagentAddress) => void
  /** Start or stop observing one session's direct-child catalog. */
  observeCatalog: (parentSessionId: SessionId, open: boolean) => void
  /** Read one session's direct-child catalog again. */
  refreshCatalog: (parentSessionId: SessionId) => void
}

/** The body's composed props: the session's identity, live facts, actions, and copy. */
export type AgentsBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<AgentsInjected>

/** The panel's words for the three diagnostic reasons, exhaustive over the wire union. */
const DIAGNOSTIC_KEY = {
  corrupt: 'diagnostic.corrupt',
  unsupported: 'diagnostic.unsupported',
  unavailable: 'diagnostic.unavailable',
} as const satisfies Record<DiagnosticEntry['reason'], SidebarAgentsKey>

/** Stable empty values, so a session with nothing to show keeps one identity. */
const NO_OVERRIDES: ReadonlyMap<SessionId, boolean> = new Map()
const NO_READS: readonly SessionId[] = []

/** One branch as the panel draws it: its node, the catalog facts around it, and its own open children. */
interface Branch {
  readonly node: LineageNode
  /** This session's direct-child catalog as the store holds it; `undefined` means no read has started. */
  readonly catalog: Catalog | undefined
  /** The address this row opens, present only for a `child` entry of a catalog that has answered. */
  readonly address: SubagentAddress | undefined
  /** Whether this session was derived from a parent at all; the root was not. */
  readonly derived: boolean
  /** Whether the parent catalog reports the parent itself offline. */
  readonly parentUnavailable: boolean
  readonly expandable: boolean
  readonly expanded: boolean
  /** The catalog entries no session summary accounts for: this session's diagnostic children. */
  readonly diagnostics: readonly DiagnosticEntry[]
  readonly children: readonly Branch[]
}

/** The `child` entry one parent catalog holds for a session, or `undefined` while it holds none. */
function childEntryOf(catalog: Catalog | undefined, id: SessionId): ChildEntry | undefined {
  return catalog?.entries.find((entry): entry is ChildEntry => entry.kind === 'child' && entry.id === id)
}

/**
 * Why a derived row cannot be opened, read from its parent's catalog.
 * @param node - the row's session.
 * @param parent - the parent's catalog, or `undefined` when no read has started.
 * @param t - namespace-bound translate.
 * @returns the reason the row is drawn disabled with.
 */
function blockedReason(node: LineageNode, parent: Catalog | undefined, t: TranslateNS<typeof NS>): string {
  if (parent === undefined) return t('catalog.unloaded')
  if (parent.state === 'error') return t('catalog.error')
  if (parent.state === 'loading') return t('catalog.loading')
  const diagnostic = parent.entries.find(
    (entry): entry is DiagnosticEntry => entry.kind === 'diagnostic' && entry.id === node.id,
  )
  return diagnostic === undefined ? t('row.notListed') : t(DIAGNOSTIC_KEY[diagnostic.reason])
}

/**
 * Draw the branch of one session, with its children, diagnostics, and read state.
 * @param props - the branch, its parent catalog, copy, and the two actions a row takes.
 * @returns the node's row and, while it is open, its group.
 */
function BranchRows({ branch, parent, t, openChild, toggle, refreshCatalog }: {
  branch: Branch
  parent: Catalog | undefined
  t: TranslateNS<typeof NS>
  openChild: AgentsInjected['openChild']
  toggle: (branch: Branch) => void
  refreshCatalog: AgentsInjected['refreshCatalog']
}) {
  const { node, address } = branch
  const state = t(node.running ? 'state.running' : 'state.inactive')
  const reason = address === undefined && branch.derived ? blockedReason(node, parent, t) : undefined
  const handlers = address === undefined ? {} : {
    onClick: (): void => { openChild(address) },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openChild(address)
      } else if (branch.expandable
        && ((event.key === 'ArrowRight' && !branch.expanded)
          || (event.key === 'ArrowLeft' && branch.expanded))) {
        event.preventDefault()
        toggle(branch)
      }
    },
  }
  return (
    <div className={css.node}>
      <div
        role="treeitem"
        data-agents-row={node.id}
        aria-level={node.depth + 1}
        aria-current={node.depth === 0 ? 'true' : undefined}
        aria-disabled={reason === undefined ? undefined : 'true'}
        aria-label={reason === undefined
          ? t('row.aria', { label: node.label, state })
          : t('row.blocked', { label: node.label, reason })}
        className={clsx(css.row, reason !== undefined && css.blocked)}
        tabIndex={address === undefined ? undefined : 0}
        {...branch.expandable ? { 'aria-expanded': branch.expanded } : {}}
        {...handlers}
      >
        {branch.expandable
          ? (
            <button
              type="button"
              tabIndex={-1}
              className={clsx(css.disclosure, branch.expanded && css.disclosureOpen)}
              aria-label={t(branch.expanded ? 'branch.collapse' : 'branch.expand', { label: node.label })}
              onClick={(event) => { event.stopPropagation(); toggle(branch) }}
            >
              <IconChevronRightOutline14 />
            </button>
          )
          : <span className={css.disclosureSpace} />}
        <StateDot state={node.running ? 'ongoing' : 'done'} className={css.dot} />
        <span className={css.content}>
          <span className={css.label}>{node.label}</span>
          <span className={css.secondary}>{state}</span>
          {branch.parentUnavailable && <span className={css.notice}>{t('row.parentUnavailable')}</span>}
          {reason !== undefined && <span className={css.notice}>{reason}</span>}
        </span>
      </div>
      {branch.expanded && (
        <div className={css.group} role="group" aria-busy={branch.catalog?.state === 'loading' || undefined}>
          {branch.children.map(child => (
            <BranchRows
              key={child.node.id}
              branch={child}
              parent={branch.catalog}
              t={t}
              openChild={openChild}
              toggle={toggle}
              refreshCatalog={refreshCatalog}
            />
          ))}
          {branch.diagnostics.map(entry => (
            <div key={entry.id} className={css.node}>
              <div
                role="treeitem"
                data-agents-diagnostic={entry.id}
                aria-level={node.depth + 2}
                aria-disabled="true"
                aria-label={t('row.diagnostic', { id: entry.id, reason: t(DIAGNOSTIC_KEY[entry.reason]) })}
                className={clsx(css.row, css.blocked)}
              >
                <span className={css.disclosureSpace} />
                <StateDot state="error" className={css.dot} />
                <span className={css.content}>
                  <span className={css.label}>{entry.id}</span>
                  <span className={css.notice}>{t(DIAGNOSTIC_KEY[entry.reason])}</span>
                </span>
              </div>
            </div>
          ))}
          {branch.catalog?.state === 'ready'
            && node.depth === 0
            && branch.children.length === 0
            && branch.diagnostics.length === 0
            && <p className={css.empty}>{t('tree.empty')}</p>}
          {branch.catalog === undefined && <p className={css.notice}>{t('catalog.unloaded')}</p>}
          {branch.catalog?.state === 'loading' && <p className={css.notice}>{t('catalog.loading')}</p>}
          {branch.catalog?.state === 'error' && (
            <p className={css.notice}>
              {branch.catalog.error?.message ?? t('catalog.error')}
              <button type="button" className={css.retry} onClick={() => { refreshCatalog(node.id) }}>
                <IconRefreshOutline14 />
                {t('catalog.retry')}
              </button>
            </p>
          )}
        </div>
      )}
      {node.truncated && (
        <div className={css.node}>
          <div
            role="treeitem"
            data-agents-truncated={node.id}
            aria-level={node.depth + 2}
            aria-disabled="true"
            aria-label={t('row.depthLimit', { depth: MAX_LINEAGE_DEPTH })}
            className={clsx(css.row, css.blocked)}
          >
            <span className={css.disclosureSpace} />
            <span className={css.notice}>{t('row.depthLimit', { depth: MAX_LINEAGE_DEPTH })}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Draw the session's derivation panel.
 * @param props - the runtime share (session identity and live session facts), the catalog actions, and copy.
 * @returns the derivation forest, or the read state of the session it is rooted at.
 */
export function AgentsBody({ sessionId, useSessions, t, openChild, observeCatalog, refreshCatalog }: AgentsBodyProps) {
  const summaries = useSessions(state => state.byId)
  const listed = useSessions(state => state.ids)
  const catalogs = useSessions(state => state.subagentsByParent)
  const [overrides, setOverrides] = useState<ReadonlyMap<SessionId, boolean>>(NO_OVERRIDES)
  const { root, wanted } = useMemo(() => {
    const forest = buildLineageForest(sessionId, summaries, listed)
    if (forest === undefined) return { root: undefined, wanted: NO_READS }
    const placed = new Set<SessionId>()
    const index = (node: LineageNode): void => {
      placed.add(node.id)
      node.children.forEach(index)
    }
    index(forest)
    const wantedReads: SessionId[] = []
    const collect = (node: LineageNode, parentCatalog: Catalog | undefined, isRoot: boolean): Branch => {
      const catalog = catalogs[node.id]
      const entry = node.parentId === undefined ? undefined : childEntryOf(parentCatalog, node.id)
      const derived = node.parentId !== undefined
      const expandable = node.children.length > 0
        || entry?.hasChildren === true
        || (catalog?.entries.length ?? 0) > 0
      const expanded = isRoot || (expandable && (overrides.get(node.id) ?? hasRunningDescendant(node)))
      // An open branch's rows come from its own catalog, so it is read while it
      // is open. The root is read even as a leaf: the summaries alone cannot
      // rule out a child whose record does not project.
      if (isRoot || (expanded && node.depth < MAX_LINEAGE_DEPTH)) wantedReads.push(node.id)
      const children = expanded ? node.children.map(child => collect(child, catalog, false)) : []
      return {
        node,
        catalog,
        address: derived && entry !== undefined && parentCatalog?.state === 'ready'
          ? { parentSessionId: node.parentId, childSessionId: node.id, mode: entry.mode }
          : undefined,
        derived,
        parentUnavailable: parentCatalog?.parentAvailable === false,
        expandable,
        expanded,
        diagnostics: (catalog?.entries ?? []).filter(
          (child): child is DiagnosticEntry => child.kind === 'diagnostic' && !placed.has(child.id),
        ),
        children,
      }
    }
    return { root: collect(forest, undefined, true), wanted: wantedReads }
  }, [sessionId, summaries, listed, catalogs, overrides])

  const observing = useRef<readonly SessionId[]>(NO_READS)
  const latest = useRef({ observeCatalog, catalogs })
  latest.current = { observeCatalog, catalogs }
  // One unread catalog is one read in flight; a settled read releases its slot
  // for the next open branch, so a wide tree never floods the wire.
  useEffect(() => {
    const { observeCatalog: observe, catalogs: current } = latest.current
    const wantedSet = new Set(wanted)
    const kept: SessionId[] = []
    for (const id of observing.current) {
      if (wantedSet.has(id)) kept.push(id)
      else observe(id, false)
    }
    let active = kept.filter(id => current[id]?.state === 'loading').length
    for (const id of wanted) {
      if (active >= MAX_CONCURRENT_CATALOG_READS) break
      if (kept.includes(id)) continue
      observe(id, true)
      kept.push(id)
      active += 1
    }
    observing.current = kept
  })
  useEffect(() => () => {
    for (const id of observing.current) latest.current.observeCatalog(id, false)
    observing.current = NO_READS
  }, [])

  const toggle = (branch: Branch): void => {
    setOverrides((current) => {
      const next = new Map(current)
      next.set(branch.node.id, !branch.expanded)
      return next
    })
  }

  if (root === undefined) return <p className={css.empty}>{t('tree.awaiting')}</p>
  return (
    <div className={css.panel} role="tree" aria-label={t('tree.aria')}>
      <BranchRows
        branch={root}
        parent={undefined}
        t={t}
        openChild={openChild}
        toggle={toggle}
        refreshCatalog={refreshCatalog}
      />
    </div>
  )
}

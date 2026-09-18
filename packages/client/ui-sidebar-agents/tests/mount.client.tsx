/**
 * Mount the panel over scripted session facts.
 *
 * The component reads three session-list slices, its session identity, three
 * catalog actions, and copy; the rest of the standard kit is framework-injected
 * and never touched here, so one documented cast keeps the harness to what is
 * actually exercised. Facts are handed over as plain values: `useSessions` is the
 * framework's seat, and the panel only ever reads the list through it.
 */
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import type {
  SessionListState, SessionSummary, SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentsBody, type AgentsBodyProps } from '../src/client/AgentsBody.tsx'
import { zh } from '../src/client/locales.ts'

/** The session every mount is open in. */
export const ROOT = 's-root' as SessionId

/** One session summary, so each spec states only the fields it is about. */
export function summary(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

/** One durable derivation of a parent session. */
export function derived(id: string, parentId: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return summary(id, { parentId: parentId as SessionId, origin: 'subagent', ...over })
}

/** One catalog snapshot. */
export function catalog(over: Partial<SubagentCatalogSnapshot> = {}): SubagentCatalogSnapshot {
  return { entries: [], state: 'ready', error: null, ...over }
}

/** The child-entry facts a spec may vary. */
export interface ChildEntryFacts {
  activity: 'running' | 'inactive'
  hasChildren: boolean
  mode: 'one-shot' | 'continuable'
  label: string
}

/** One catalogued child entry; the two one-shot variants differ only in `label`. */
export function childEntry(id: string, over: Partial<ChildEntryFacts> = {}): SubagentListEntry {
  return {
    kind: 'child',
    id: id as SessionId,
    activity: 'inactive',
    hasChildren: false,
    mode: 'one-shot',
    ...over,
  } as SubagentListEntry
}

/** One catalogued diagnostic entry. */
export function diagnostic(id: string, reason: 'corrupt' | 'unsupported' | 'unavailable') {
  return { kind: 'diagnostic', id: id as SessionId, reason } as const
}

/** A remote failure the panel shows verbatim. */
export function failure(message: string) {
  return { code: 'gateway/internal', message } as unknown as SubagentCatalogSnapshot['error']
}

/** The session facts one mount is driven with. */
export interface Facts {
  /** Every summary the session list holds. */
  readonly summaries?: readonly SessionSummary[]
  /** The list's own id order; defaults to the summaries' order. */
  readonly listed?: readonly SessionId[]
  /** Direct-child catalogs, keyed by parent. */
  readonly catalogs?: Readonly<Record<SessionId, SubagentCatalogSnapshot>>
}

/** The three recorded business actions, each with its own call log. */
function actionSpies() {
  return {
    openChild: vi.fn<(address: SubagentAddress) => void>(),
    observeCatalog: vi.fn<(parentSessionId: SessionId, open: boolean) => void>(),
    refreshCatalog: vi.fn<(parentSessionId: SessionId) => void>(),
  }
}

/** What a spec holds after mounting. */
export interface Mounted {
  readonly view: RenderResult
  readonly actions: ReturnType<typeof actionSpies>
  /** Replace the session facts and re-render. */
  update: (next: Facts) => void
}

/**
 * Mount the panel.
 * @param facts - the session list slices to drive it with.
 * @returns the rendered view, the recorded actions, and the fact updater.
 */
export function mountBody(facts: Facts = {}): Mounted {
  const list: SessionListState = {
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const actions = actionSpies()
  const props = (): AgentsBodyProps => ({
    sessionId: ROOT,
    useSessions: <S,>(select: (state: SessionListState) => S): S => select(list),
    t: makeTranslate(zh),
    ...actions,
  }) as unknown as AgentsBodyProps
  const view = render(<AgentsBody {...props()} />)
  const update = (next: Facts): void => {
    const summaries = next.summaries ?? []
    list.ids = next.listed === undefined ? summaries.map(entry => entry.id) : [...next.listed]
    list.byId = Object.fromEntries(summaries.map(entry => [entry.id, entry]))
    list.subagentsByParent = next.catalogs ?? {}
    view.rerender(<AgentsBody {...props()} />)
  }
  update(facts)
  return { view, actions, update }
}

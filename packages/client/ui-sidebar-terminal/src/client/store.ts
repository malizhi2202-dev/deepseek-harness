/**
 * The panel's view state: the shells one tab holds, which of them is on screen,
 * and the sanitized text each has produced so far.
 *
 * The text lives here rather than in a client object layer because this panel
 * is its only consumer: a second view would be the reason to publish it, and
 * there is none. The server's frame bound keeps it in check — each frame is
 * either an append the seam sized or a whole-window replacement, never an
 * unbounded transcript.
 *
 * Per-shell writes tolerate a tab that is not serving shells. That state is
 * reachable rather than a face bug: a whole-tab failure can settle while a
 * write is still in flight, and the panel's answer to a later frame is then to
 * draw the failure, not to record text nobody will show.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { TerminalConsoleShell } from '@deepseek-ai/dsh-api-terminal-console/types'

/** One tab's state while it is serving shells. */
export interface TerminalReadyState {
  readonly kind: 'ready'
  /** Live shells in mint order, as the server reports them. */
  readonly shells: readonly TerminalConsoleShell[]
  /** The shell on screen, or undefined when this session holds none. */
  readonly active: string | undefined
  /** Sanitized text per shell id. */
  readonly output: Readonly<Record<string, string>>
  /** Shells whose output stream has ended. */
  readonly ended: Readonly<Record<string, boolean>>
  /** Why one shell's stream or write failed, per shell id. */
  readonly failures: Readonly<Record<string, RemoteFailure>>
  /** Whether a write is in flight for this tab. */
  readonly busy: boolean
}

/** What one tab's console is doing right now. */
export type TerminalTabState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'refused'; readonly failure: RemoteFailure }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }
  | TerminalReadyState

/** Every tab's state, keyed by tab id. */
export interface TerminalState {
  byTab: Record<TabId, TerminalTabState>
}

/**
 * One tab's shell-serving state.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the ready state, or undefined when the tab has no bucket or is not serving shells.
 */
function readyOf(state: TerminalState, tabId: TabId): TerminalReadyState | undefined {
  const current = state.byTab[tabId]
  return current?.kind === 'ready' ? current : undefined
}

/**
 * Build one tab's shell-serving state, carrying every per-shell record forward.
 * @param current - the tab's state before this write, if any.
 * @param shells - the shells to hold.
 * @param active - the shell to put on screen.
 * @returns the next state.
 */
function readyWith(
  current: TerminalTabState | undefined,
  shells: readonly TerminalConsoleShell[],
  active: string | undefined,
): TerminalReadyState {
  const ready = current?.kind === 'ready' ? current : undefined
  return {
    kind: 'ready',
    shells,
    active,
    output: ready?.output ?? {},
    ended: ready?.ended ?? {},
    failures: ready?.failures ?? {},
    busy: ready?.busy ?? false,
  }
}

/**
 * One record without one key.
 * @param record - the record to copy.
 * @param key - the key to drop.
 * @returns a copy without that key.
 */
function without<Value>(record: Readonly<Record<string, Value>>, key: string): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key))
}

/** The panel store's write set; every action names the tab it writes. */
type TerminalActions = {
  loading: (draft: TerminalState, tabId: TabId) => void
  refused: (draft: TerminalState, tabId: TabId, failure: RemoteFailure) => void
  failed: (draft: TerminalState, tabId: TabId, failure: RemoteFailure) => void
  listed: (draft: TerminalState, tabId: TabId, shells: readonly TerminalConsoleShell[]) => void
  minted: (draft: TerminalState, tabId: TabId, shell: TerminalConsoleShell) => void
  select: (draft: TerminalState, tabId: TabId, shellId: string) => void
  output: (draft: TerminalState, tabId: TabId, shellId: string, text: string, replace: boolean) => void
  ended: (draft: TerminalState, tabId: TabId, shellId: string) => void
  dropped: (draft: TerminalState, tabId: TabId, shellId: string) => void
  streamFailed: (draft: TerminalState, tabId: TabId, shellId: string, failure: RemoteFailure) => void
  busy: (draft: TerminalState, tabId: TabId, busy: boolean) => void
  forget: (draft: TerminalState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createTerminalStore(): EngineStoreHandle<TerminalState, TerminalActions> {
  return defineStore({
    init: (): TerminalState => ({ byTab: {} }),
    actions: {
      /**
       * Mark one tab's console as connecting.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      loading: (d, tabId: TabId) => {
        d.byTab[tabId] = { kind: 'loading' }
      },
      /**
       * Record that this install refuses the console on its surface.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      refused: (d, tabId: TabId, failure: RemoteFailure) => {
        d.byTab[tabId] = { kind: 'refused', failure }
      },
      /**
       * Record why the console could not be reached at all.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        d.byTab[tabId] = { kind: 'failed', failure }
      },
      /**
       * Replace one tab's shell list, keeping the shell on screen when it is
       * still live and falling back to the newest one when it is not.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shells - the shells the server reported.
       */
      listed: (d, tabId: TabId, shells: readonly TerminalConsoleShell[]) => {
        const current = d.byTab[tabId]
        const kept = current?.kind === 'ready' && shells.some(shell => shell.shellId === current.active)
          ? current.active
          : shells.at(-1)?.shellId
        d.byTab[tabId] = readyWith(current, shells, kept)
      },
      /**
       * Add one newly minted shell and put it on screen.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shell - the shell the server minted.
       */
      minted: (d, tabId: TabId, shell: TerminalConsoleShell) => {
        const current = d.byTab[tabId]
        const shells = [...readyOf(d, tabId)?.shells ?? [], shell]
        d.byTab[tabId] = readyWith(current, shells, shell.shellId)
      },
      /**
       * Put one shell on screen.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shellId - the shell to show.
       */
      select: (d, tabId: TabId, shellId: string) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, active: shellId }
      },
      /**
       * Extend or replace one shell's text.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shellId - the shell the frame belongs to.
       * @param text - the frame's text.
       * @param replace - whether the text replaces the view instead of extending it.
       */
      output: (d, tabId: TabId, shellId: string, text: string, replace: boolean) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = {
          ...ready,
          output: { ...ready.output, [shellId]: replace ? text : (ready.output[shellId] ?? '') + text },
        }
      },
      /**
       * Mark one shell's output stream as finished.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shellId - the shell that ended.
       */
      ended: (d, tabId: TabId, shellId: string) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, ended: { ...ready.ended, [shellId]: true } }
      },
      /**
       * Forget one shell and everything the panel kept for it.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shellId - the shell that went away.
       */
      dropped: (d, tabId: TabId, shellId: string) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        const shells = ready.shells.filter(shell => shell.shellId !== shellId)
        d.byTab[tabId] = {
          ...readyWith(ready, shells, ready.active === shellId ? shells.at(-1)?.shellId : ready.active),
          output: without(ready.output, shellId),
          ended: without(ready.ended, shellId),
          failures: without(ready.failures, shellId),
        }
      },
      /**
       * Record why one shell's stream or write failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param shellId - the shell the failure belongs to.
       * @param failure - the settled Remote failure.
       */
      streamFailed: (d, tabId: TabId, shellId: string, failure: RemoteFailure) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, failures: { ...ready.failures, [shellId]: failure } }
      },
      /**
       * Record whether a write is in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param busy - the new in-flight state.
       */
      busy: (d, tabId: TabId, busy: boolean) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, busy }
      },
      /**
       * Forget one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = without(d.byTab, tabId)
      },
    },
  })
}

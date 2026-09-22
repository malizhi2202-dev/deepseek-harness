/**
 * The panel's view state: what each tab's latest ledger read answered.
 *
 * One read per tab, replaced whole by each settlement — a ledger is not a
 * structure the panel edits, and this panel offers no write of its own, so
 * there are no per-run states to manage, only the last settled answer.
 *
 * Writers run between `start` and `forget`: the owner's `signal` is what ends a
 * bucket's life, and the face stops dispatching once it aborts.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { AutomationLedgerView } from '@deepseek-ai/dsh-api-workspace-automation/types'

/** What one tab's ledger read is doing right now. */
export type AutomationTabState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }
  /** The ledger the Host answered, `unrecorded` included: it is a reading, not a failure. */
  | { readonly kind: 'settled'; readonly ledger: AutomationLedgerView }

/** Every tab's state, keyed by tab id. */
export interface AutomationState {
  byTab: Record<TabId, AutomationTabState>
}

/**
 * Require one tab's bucket to exist: the face only dispatches while the
 * record's signal is live, and `forget` runs on its abort, so a settlement
 * reaching a missing bucket is a face bug, not a panel state.
 * @param state - the draft.
 * @param tabId - the tab being written.
 */
function requireBucket(state: AutomationState, tabId: TabId): void {
  if (state.byTab[tabId] === undefined) throw new Error(`ui-sidebar-automation: no state for tab "${tabId}"`)
}

/** The panel store's write set; every action names the tab it writes. */
type AutomationActions = {
  loading: (draft: AutomationState, tabId: TabId) => void
  settled: (draft: AutomationState, tabId: TabId, ledger: AutomationLedgerView) => void
  failed: (draft: AutomationState, tabId: TabId, failure: RemoteFailure) => void
  forget: (draft: AutomationState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createAutomationStore(): EngineStoreHandle<AutomationState, AutomationActions> {
  return defineStore({
    init: (): AutomationState => ({ byTab: {} }),
    actions: {
      /**
       * Mark one tab's read as in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      loading: (d, tabId: TabId) => {
        d.byTab[tabId] = { kind: 'loading' }
      },
      /**
       * Record one settled ledger.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ledger - the ledger the Host answered.
       */
      settled: (d, tabId: TabId, ledger: AutomationLedgerView) => {
        requireBucket(d, tabId)
        d.byTab[tabId] = { kind: 'settled', ledger }
      },
      /**
       * Record why the ledger could not be read.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        requireBucket(d, tabId)
        d.byTab[tabId] = { kind: 'failed', failure }
      },
      /**
       * Forget one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}

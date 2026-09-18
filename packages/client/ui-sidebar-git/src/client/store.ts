/**
 * The panel's view state: what each tab's latest observation read answered.
 *
 * One observation per tab, replaced whole by each read — a repository snapshot
 * is not a structure the panel edits, so there are no per-entry states to
 * manage, only the last settled answer and the read currently in flight.
 *
 * Writers run between `start` and `forget`: the owner's `signal` is what ends a
 * bucket's life, and the face stops dispatching once it aborts.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { GitObservation } from '@deepseek-ai/dsh-api-workspace-git/types'

/**
 * The repository observation a settled read keeps — the seam's repository
 * variant, discriminant included, because the observation IS the snapshot.
 */
export type GitRepositoryObservation = Extract<GitObservation, { readonly kind: 'repository' }>

/** What one tab's observation read is doing right now. */
export type GitTabState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'ready'; readonly snapshot: GitRepositoryObservation }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/** Every tab's state, keyed by tab id. */
export interface GitState {
  byTab: Record<TabId, GitTabState>
}

/**
 * Require one tab's bucket to exist: the face only dispatches while the
 * record's signal is live, and `forget` runs on its abort, so a settlement
 * reaching a missing bucket is a face bug, not a panel state.
 * @param state - the draft.
 * @param tabId - the tab being written.
 */
function requireBucket(state: GitState, tabId: TabId): void {
  if (state.byTab[tabId] === undefined) throw new Error(`ui-sidebar-git: no state for tab "${tabId}"`)
}

/** The panel store's write set; every action names the tab it writes. */
type GitActions = {
  loading: (draft: GitState, tabId: TabId) => void
  absent: (draft: GitState, tabId: TabId) => void
  ready: (draft: GitState, tabId: TabId, snapshot: GitRepositoryObservation) => void
  failed: (draft: GitState, tabId: TabId, failure: RemoteFailure) => void
  forget: (draft: GitState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createGitStore(): EngineStoreHandle<GitState, GitActions> {
  return defineStore({
    init: (): GitState => ({ byTab: {} }),
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
       * Record that the workspace is not inside a git work tree.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      absent: (d, tabId: TabId) => {
        requireBucket(d, tabId)
        d.byTab[tabId] = { kind: 'absent' }
      },
      /**
       * Record one repository observation.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param snapshot - the repository observation to draw.
       */
      ready: (d, tabId: TabId, snapshot: GitRepositoryObservation) => {
        requireBucket(d, tabId)
        d.byTab[tabId] = { kind: 'ready', snapshot }
      },
      /**
       * Record why the observation could not be read.
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

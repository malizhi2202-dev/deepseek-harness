/**
 * The panel's asynchronous half: reading one workspace's automation ledger into
 * the store.
 *
 * The component never awaits anything. It calls `start` or `reload` with the
 * workspace the tab's session belongs to, and this face performs the read and
 * writes the outcome through the store's own actions — the Slot-standard
 * `inject` shape, so the write set stays the store's.
 *
 * The read is keyed by workspace rather than by session, because that is what
 * the ledger is keyed by on the Host. The session id is part of the Slot
 * `inject` call and this panel has no session-scoped operation, so it is
 * accepted and unused; the component derives the workspace from the framework's
 * workspace hook and hands it to each call.
 *
 * A workspace the Host stores no state for answers `unrecorded`, which settles
 * like any other reading: the panel says the timer has not run there rather than
 * showing an error.
 *
 * Cleanup rides the owner's `signal`, and when the record goes away the tab's
 * bookkeeping is forgotten, so no later settlement writes to it.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Merges the generated `workspace` namespace method into the Client Remote face.
import type {} from '@deepseek-ai/dsh-api-workspace-automation/remote'
import type { createAutomationStore } from './store.ts'

/**
 * The workspace id the ledger read takes, as the generated Remote declares the
 * parameter: the same branded `WorkspaceId` the client workspace model carries.
 */
export type AutomationWorkspaceId = Parameters<ClientRemote['workspace']['automationLedger']>[0]

/** The `workspace` namespace methods this package calls, as the generated Remote declares them. */
export type AutomationNamespace = Pick<ClientRemote['workspace'], 'automationLedger'>

/** The Client Remote as this package sees it. */
export interface AutomationRemote {
  /** The `workspace` namespace, read only. */
  readonly workspace: AutomationNamespace
}

/** The panel's injected business face, as the body receives it. */
export interface AutomationInjected {
  /**
   * Read this tab's ledger for the first time.
   * @param tabId - the tab being drawn.
   * @param workspaceId - the workspace whose ledger is read.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, workspaceId: AutomationWorkspaceId, signal: AbortSignal) => void
  /**
   * Read this tab's ledger again, replacing whatever it holds.
   * @param tabId - the tab being drawn.
   * @param workspaceId - the workspace whose ledger is read.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, workspaceId: AutomationWorkspaceId, signal: AbortSignal) => void
}

/**
 * Bind the panel's face to one ledger read.
 * @param remote - the Client Remote face carrying the `workspace` namespace.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function automationFace(
  remote: AutomationRemote,
): (
  sessionId: SessionId,
  actions: BoundActions<ReturnType<typeof createAutomationStore>>,
) => AutomationInjected {
  return (
    _sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createAutomationStore>>,
  ): AutomationInjected => {
    /** Per tab: the read generation a settlement must match; the latest read wins. */
    const generations = new Map<TabId, number>()
    /**
     * Mint the next generation for one tab, retiring every read before it.
     * @param tabId - the tab being read.
     * @returns the generation the new read owns.
     */
    const nextGeneration = (tabId: TabId): number => {
      const generation = (generations.get(tabId) ?? 0) + 1
      generations.set(tabId, generation)
      return generation
    }
    const read = (tabId: TabId, workspaceId: AutomationWorkspaceId, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = nextGeneration(tabId)
      actions.loading(tabId)
      void remote.workspace.automationLedger(workspaceId).then((result) => {
        // A newer read was asked for since, or the record is gone and its
        // bookkeeping with it: nothing left for this one to write.
        if (generations.get(tabId) !== generation) return
        if (result.ok) actions.settled(tabId, result.value)
        else actions.failed(tabId, result.error)
      })
    }
    return {
      start(tabId, workspaceId, signal) {
        signal.addEventListener('abort', () => {
          // Retire the read in flight by minting past its generation, so its
          // settlement matches nothing even after a later start reopens the
          // bucket, and forget the bucket with it.
          nextGeneration(tabId)
          actions.forget(tabId)
        }, { once: true })
        read(tabId, workspaceId, signal)
      },
      reload: read,
    }
  }
}

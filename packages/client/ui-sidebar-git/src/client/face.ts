/**
 * The panel's asynchronous half: observing the workspace's repository into the
 * store.
 *
 * The component never awaits anything. It calls `start` / `reload`, and this
 * face performs the read and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * The read is bound here to the Client Remote face: the endpoint resolves the
 * workspace root from the session, so the panel never names a directory
 * itself. One tab holds one observation in force: the reload gesture retires
 * the read still in flight, whose settlement then writes nothing. Cleanup
 * rides the owner's `signal`, and when the record goes away the tab's
 * bookkeeping is forgotten, so no later settlement writes to it.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GitObservation } from '@deepseek-ai/dsh-api-workspace-git/types'
import type { createGitStore } from './store.ts'

/**
 * One workspace observation, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the
 * workspace root from it: the same panel means different repositories in
 * different sessions. A Remote call does not reject — the result carries the
 * failure. The signal is optional exactly as the generated namespace declares
 * it; the panel always passes the tab record's own.
 */
export type ObserveWorkspaceGit = (
  sessionId: SessionId,
  signal?: AbortSignal,
) => Promise<RemoteResult<GitObservation>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceGit`
 * namespace's `observe`, exactly as the Host's generated client declares it.
 */
export type WorkspaceGitObserveRemote = {
  readonly workspaceGit: Pick<ClientRemote['workspaceGit'], 'observe'>
}

/**
 * Bind the observation to one Remote face.
 * @param remote - the Client Remote face carrying the `workspaceGit` namespace.
 * @returns the observation the panel's face performs.
 */
export function createObserve(remote: WorkspaceGitObserveRemote): ObserveWorkspaceGit {
  return async (sessionId, signal) => await remote.workspaceGit.observe(sessionId, signal)
}

/** The panel's injected business face, as the body receives it. */
export interface GitInjected {
  /**
   * Read this tab's observation for the first time.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Read this tab's observation again, replacing whatever it holds.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, signal: AbortSignal) => void
}

/**
 * Bind the panel's face to one workspace observation.
 * @param observe - the bound `workspaceGit.observe` call.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function gitFace(
  observe: ObserveWorkspaceGit,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createGitStore>>) => GitInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createGitStore>>,
  ): GitInjected => {
    /** Per tab: the observation generation a settlement must match; the latest read wins. */
    const generations = new Map<TabId, number>()
    const read = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = (generations.get(tabId) ?? 0) + 1
      generations.set(tabId, generation)
      actions.loading(tabId)
      void observe(sessionId, signal).then((result) => {
        // A newer read was asked for since, or the record is gone and its
        // bookkeeping with it: nothing left for this one to write.
        if (generations.get(tabId) !== generation) return
        if (result.ok) {
          if (result.value.kind === 'absent') actions.absent(tabId)
          else actions.ready(tabId, result.value)
        } else {
          actions.failed(tabId, result.error)
        }
      })
    }
    return {
      start(tabId, signal) {
        signal.addEventListener('abort', () => {
          // Retire the read in flight by bumping past its generation, so its
          // settlement matches nothing even after a later start reopens the
          // bucket, and forget the bucket with it.
          const current = generations.get(tabId)
          /* v8 ignore next -- read() minted the tab's generation before this listener could fire, so the entry exists. */
          generations.set(tabId, (current ?? 0) + 1)
          actions.forget(tabId)
        }, { once: true })
        read(tabId, signal)
      },
      reload: read,
    }
  }
}

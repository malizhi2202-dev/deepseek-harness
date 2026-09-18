/**
 * A scripted workspace observation: the Remote call the panel's face makes,
 * settled by hand from the spec.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GitObservation } from '@deepseek-ai/dsh-api-workspace-git/types'
import type { ObserveWorkspaceGit, WorkspaceGitObserveRemote } from '../src/client/face.ts'

export const SESSION = 's-test' as SessionId
export const ROOT = '/work/repo'

/** The calls the script recorded, oldest first. */
type ObserveCall = { sessionId: SessionId; signal: AbortSignal | undefined }

/** What a spec holds from the script. */
export interface ScriptedObserve {
  /** The Remote-shaped face, ready to hand to `createObserve`. */
  readonly remote: WorkspaceGitObserveRemote
  /** The recorded calls. */
  readonly calls: readonly ObserveCall[]
  /** Resolve the oldest outstanding call with its answer. */
  settle: (result: RemoteResult<GitObservation>) => Promise<void>
  /** How many calls are still outstanding. */
  outstanding: () => number
}

/**
 * Script one observation channel.
 * @returns the script's handles.
 */
export function scriptedObserve(): ScriptedObserve {
  const calls: ObserveCall[] = []
  const outstanding: Array<(result: RemoteResult<GitObservation>) => void> = []
  const observe: ObserveWorkspaceGit = async (sessionId, signal) => {
    calls.push({ sessionId, signal })
    return await new Promise((resolve) => { outstanding.push(resolve) })
  }
  return {
    remote: { workspaceGit: { observe } },
    calls,
    settle: async (result) => {
      const resolve = outstanding.shift()
      if (resolve === undefined) throw new Error('scripted observe settled with no outstanding call')
      resolve(result)
      // Let the face's `then` run before the spec reads the store.
      await new Promise((resolveTick) => { setTimeout(resolveTick, 0) })
    },
    outstanding: () => outstanding.length,
  }
}

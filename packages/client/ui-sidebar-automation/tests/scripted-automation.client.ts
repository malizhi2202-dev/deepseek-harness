/**
 * A scripted ledger read: the one Remote call the panel's face makes, settled
 * by hand from the spec.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { AutomationLedgerView } from '@deepseek-ai/dsh-api-workspace-automation/types'
import type { AutomationRemote, AutomationWorkspaceId } from '../src/client/face.ts'

/** The calls the script recorded, oldest first. */
type LedgerCall = { workspaceId: AutomationWorkspaceId }

/** What a spec holds from the script. */
export interface ScriptedAutomation {
  /** The Remote-shaped face, ready to hand to `automationFace`. */
  readonly remote: AutomationRemote
  /** The recorded calls. */
  readonly calls: readonly LedgerCall[]
  /** Resolve the oldest outstanding call with its answer. */
  settle: (result: RemoteResult<AutomationLedgerView>) => Promise<void>
  /** How many calls are still outstanding. */
  outstanding: () => number
}

/**
 * Script one ledger channel.
 * @returns the script's handles.
 */
export function scriptedAutomation(): ScriptedAutomation {
  const calls: LedgerCall[] = []
  const outstanding: Array<(result: RemoteResult<AutomationLedgerView>) => void> = []
  const automationLedger = async (workspaceId: AutomationWorkspaceId) => {
    calls.push({ workspaceId })
    return await new Promise<RemoteResult<AutomationLedgerView>>((resolve) => { outstanding.push(resolve) })
  }
  return {
    remote: { workspace: { automationLedger } },
    calls,
    settle: async (result) => {
      const resolve = outstanding.shift()
      if (resolve === undefined) throw new Error('scripted ledger settled with no outstanding call')
      resolve(result)
      // Let the face's `then` run before the spec reads the store.
      await new Promise((resolveTick) => { setTimeout(resolveTick, 0) })
    },
    outstanding: () => outstanding.length,
  }
}

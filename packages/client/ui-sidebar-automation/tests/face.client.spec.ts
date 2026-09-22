/**
 * The panel's asynchronous half against a scripted ledger read.
 *
 * The face's contract is what reaches the store and when: the tab is `loading`
 * before the read settles, the answer after, never written once the owner's
 * signal aborted or a newer read was asked for, and a tab whose record is gone
 * leaves no bucket behind. The read is keyed by workspace, not by session, so
 * the workspace travels with every call.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { automationFace } from '../src/client/face.ts'
import { createAutomationStore } from '../src/client/store.ts'
import { SESSION, WORKSPACE_ID, recordedLedger } from './fixtures.client.ts'
import { scriptedAutomation } from './scripted-automation.client.ts'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

const LEDGER = { kind: 'recorded', ...recordedLedger([]) } as const

function mount() {
  const instance = createAutomationStore().create()
  const script = scriptedAutomation()
  const face = automationFace(script.remote)(SESSION, instance.actions)
  return { script, face, snapshot: () => instance.getSnapshot().byTab[TAB] }
}

describe('automationFace', () => {
  it('asks the workspace namespace for the workspace it was given', async () => {
    const { script, face, snapshot } = mount()
    face.start(TAB, WORKSPACE_ID, new AbortController().signal)
    expect(script.calls).toEqual([{ workspaceId: WORKSPACE_ID }])
    expect(snapshot()).toEqual({ kind: 'loading' })
    await script.settle({ ok: true, value: LEDGER })
    expect(snapshot()).toEqual({ kind: 'settled', ledger: LEDGER })
  })

  it('settles an unrecorded workspace as a reading rather than a failure', async () => {
    const { script, face, snapshot } = mount()
    face.start(TAB, WORKSPACE_ID, new AbortController().signal)
    await script.settle({ ok: true, value: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    expect(snapshot()).toEqual({ kind: 'settled', ledger: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
  })

  it('records a failed read under its tab', async () => {
    const { script, face, snapshot } = mount()
    face.start(TAB, WORKSPACE_ID, new AbortController().signal)
    const error = new RemoteError('gateway/internal', 'ledger unreadable', {})
    await script.settle({ ok: false, error })
    expect(snapshot()).toEqual({ kind: 'failed', failure: error })
  })

  it('abort forgets the bucket and a late settlement writes nothing', async () => {
    const { script, face, snapshot } = mount()
    const controller = new AbortController()
    face.start(TAB, WORKSPACE_ID, controller.signal)
    controller.abort()
    expect(snapshot()).toBeUndefined()
    await script.settle({ ok: true, value: LEDGER })
    expect(snapshot()).toBeUndefined()
  })

  it('makes no request for a record that already ended', () => {
    const { script, face } = mount()
    const controller = new AbortController()
    controller.abort()
    face.start(TAB, WORKSPACE_ID, controller.signal)
    expect(script.calls).toEqual([])
  })

  it('lets the reload gesture retire the read still in flight; only the current read writes', async () => {
    const { script, face, snapshot } = mount()
    const signal = new AbortController().signal
    face.start(TAB, WORKSPACE_ID, signal)
    // The reload gesture asks again while the first read is still out.
    face.reload(TAB, WORKSPACE_ID, signal)
    expect(script.outstanding()).toEqual(2)
    // The retired first read settles first and changes nothing.
    await script.settle({ ok: true, value: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The current read settles after and wins.
    await script.settle({ ok: true, value: LEDGER })
    expect(snapshot()).toEqual({ kind: 'settled', ledger: LEDGER })
  })

  it('a start after abort reopens the bucket, and the aborted read writes nothing into it', async () => {
    const { script, face, snapshot } = mount()
    const first = new AbortController()
    face.start(TAB, WORKSPACE_ID, first.signal)
    first.abort()
    expect(snapshot()).toBeUndefined()
    face.start(TAB, WORKSPACE_ID, new AbortController().signal)
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The aborted read settles first, with an answer that would overwrite the
    // bucket if its generation still matched; it must not.
    await script.settle({ ok: true, value: LEDGER })
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The current read settles behind it and wins.
    await script.settle({ ok: true, value: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    expect(snapshot()).toEqual({ kind: 'settled', ledger: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
  })

  it('serves two tabs independently from one face, each for its own workspace', async () => {
    const instance = createAutomationStore().create()
    const script = scriptedAutomation()
    const face = automationFace(script.remote)(SESSION, instance.actions)
    const other = 'ws-2' as typeof WORKSPACE_ID
    face.start(TAB, WORKSPACE_ID, new AbortController().signal)
    face.start(TAB2, other, new AbortController().signal)
    expect(script.calls).toEqual([{ workspaceId: WORKSPACE_ID }, { workspaceId: other }])
    await script.settle({ ok: true, value: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    await script.settle({ ok: true, value: LEDGER })
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ kind: 'settled', ledger: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    expect(instance.getSnapshot().byTab[TAB2]).toEqual({ kind: 'settled', ledger: LEDGER })
  })
})

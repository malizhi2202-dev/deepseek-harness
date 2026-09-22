/**
 * The panel's write set, one tab at a time.
 *
 * The load-bearing fact for the body: every action replaces one tab's whole
 * state, `unrecorded` settles like any other reading rather than failing, and
 * `forget` alone takes a bucket away — the face dispatches only while the
 * record's signal is live, so a settlement reaching a missing bucket is a face
 * bug, not a panel state.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createAutomationStore } from '../src/client/store.ts'
import type { AutomationTabState } from '../src/client/store.ts'
import { WORKSPACE_ID, recordedLedger } from './fixtures.client.ts'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

const LEDGER = recordedLedger([])

describe('createAutomationStore', () => {
  it('mints an independent instance per call', () => {
    const first = createAutomationStore().create()
    const second = createAutomationStore().create()
    first.actions.loading(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes one tab through loading, settled, and failed', () => {
    const store = createAutomationStore().create()
    const { actions } = store
    const at = (): AutomationTabState | undefined => store.getSnapshot().byTab[TAB]
    actions.loading(TAB)
    expect(at()).toEqual({ kind: 'loading' })
    actions.settled(TAB, { kind: 'recorded', ...LEDGER })
    expect(at()).toEqual({ kind: 'settled', ledger: { kind: 'recorded', ...LEDGER } })
    actions.settled(TAB, { kind: 'unrecorded', workspaceId: WORKSPACE_ID })
    expect(at()).toEqual({ kind: 'settled', ledger: { kind: 'unrecorded', workspaceId: WORKSPACE_ID } })
    const failure = new RemoteError('gateway/internal', 'ledger unreadable', {})
    actions.failed(TAB, failure)
    expect(at()).toEqual({ kind: 'failed', failure })
  })

  it('refuses to settle a tab whose bucket was forgotten', () => {
    const store = createAutomationStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.forget(TAB)
    expect(() => { actions.settled(TAB, { kind: 'unrecorded', workspaceId: WORKSPACE_ID }) }).toThrow(/no state for tab/)
  })

  it('forgets exactly the tab asked for', () => {
    const store = createAutomationStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.loading(TAB2)
    actions.forget(TAB)
    expect(store.getSnapshot().byTab).toEqual({ [TAB2]: { kind: 'loading' } })
  })

  it('lets a forgotten tab start over', () => {
    const store = createAutomationStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.forget(TAB)
    expect(() => { actions.loading(TAB) }).not.toThrow()
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
  })
})

/**
 * The panel's write set, one tab at a time.
 *
 * Two facts carry the body: every per-shell write tolerates a tab that is not
 * serving shells (a whole-tab failure can settle while a write is in flight),
 * and `forget` alone takes a bucket away — the face dispatches only while the
 * record's signal is live, so a settled write reaching a missing bucket is a
 * face bug rather than a panel state.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createTerminalStore } from '../src/client/store.ts'
import type { TerminalTabState } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { shell } from './scripted-console.client.ts'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

const FAILURE = new RemoteError('terminal-console/busy', 'the shell is busy', {})

/** One ready tab holding a single shell. */
function ready(): ReturnType<ReturnType<typeof createTerminalStore>['create']> {
  const store = createTerminalStore().create()
  store.actions.loading(TAB)
  store.actions.minted(TAB, shell(1, 1234))
  return store
}

describe('createTerminalStore', () => {
  it('mints an independent instance per call', () => {
    const first = createTerminalStore().create()
    const second = createTerminalStore().create()
    first.actions.loading(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes one tab through loading, refused, and failed', () => {
    const store = createTerminalStore().create()
    const { actions } = store
    const at = (): TerminalTabState | undefined => store.getSnapshot().byTab[TAB]
    actions.loading(TAB)
    expect(at()).toEqual({ kind: 'loading' })
    actions.refused(TAB, FAILURE)
    expect(at()).toEqual({ kind: 'refused', failure: FAILURE })
    actions.failed(TAB, FAILURE)
    expect(at()).toEqual({ kind: 'failed', failure: FAILURE })
  })

  it('opens a bucket ready on the first minted shell, carrying its server index', () => {
    const store = ready()
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      kind: 'ready',
      shells: [shell(1, 1234)],
      active: 'console-1',
      output: {},
      ended: {},
      failures: {},
      busy: false,
    })
  })

  it('lists shells and keeps what earlier writes recorded, selection included', () => {
    const store = ready()
    store.actions.output(TAB, 'console-1', 'kept\n', false)
    store.actions.listed(TAB, [shell(1, 1234), shell(2)])
    const state = store.getSnapshot().byTab[TAB]
    expect(state).toMatchObject({ kind: 'ready', active: 'console-1', output: { 'console-1': 'kept\n' } })
    expect(state?.kind === 'ready' ? state.shells.map(item => item.shellId) : []).toEqual(['console-1', 'console-2'])
  })

  it('keeps the shell on screen when the list still holds it', () => {
    const store = ready()
    store.actions.listed(TAB, [shell(1, 1234), shell(2)])
    store.actions.select(TAB, 'console-1')
    store.actions.listed(TAB, [shell(1, 1234), shell(2), shell(3)])
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ active: 'console-1' })
  })

  it('falls back to the newest shell when the one on screen is gone', () => {
    const store = ready()
    store.actions.listed(TAB, [shell(1, 1234), shell(2)])
    store.actions.listed(TAB, [shell(2)])
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ active: 'console-2' })
  })

  it('reports no active shell for a session that holds none', () => {
    const store = createTerminalStore().create()
    store.actions.loading(TAB)
    store.actions.listed(TAB, [])
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ kind: 'ready', shells: [], active: undefined })
  })

  it('extends one shell\'s text, and replaces it whole when a frame says so', () => {
    const store = ready()
    store.actions.output(TAB, 'console-1', 'one\n', false)
    store.actions.output(TAB, 'console-1', 'two\n', false)
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ output: { 'console-1': 'one\ntwo\n' } })
    store.actions.output(TAB, 'console-1', 'replaced\n', true)
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ output: { 'console-1': 'replaced\n' } })
  })

  it('marks one shell ended, records a failure, and tracks the in-flight write', () => {
    const store = ready()
    store.actions.ended(TAB, 'console-1')
    store.actions.streamFailed(TAB, 'console-1', FAILURE)
    store.actions.busy(TAB, true)
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({
      ended: { 'console-1': true },
      failures: { 'console-1': FAILURE },
      busy: true,
    })
    store.actions.busy(TAB, false)
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ busy: false })
  })

  it('drops one shell with its text, its failure, and the selection when it was on screen', () => {
    const store = ready()
    store.actions.listed(TAB, [shell(1, 1234), shell(2)])
    store.actions.output(TAB, 'console-2', 'gone\n', false)
    store.actions.streamFailed(TAB, 'console-2', FAILURE)
    store.actions.ended(TAB, 'console-2')
    store.actions.dropped(TAB, 'console-2')
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      kind: 'ready',
      shells: [shell(1, 1234)],
      active: 'console-1',
      output: {},
      ended: {},
      failures: {},
      busy: false,
    })
  })

  it('leaves the selection alone when a different shell is dropped', () => {
    const store = ready()
    store.actions.listed(TAB, [shell(1, 1234), shell(2)])
    store.actions.select(TAB, 'console-2')
    store.actions.dropped(TAB, 'console-1')
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ active: 'console-2' })
  })

  it('takes one tab\'s bucket away and leaves its sibling alone', () => {
    const store = ready()
    store.actions.minted(TAB2, shell(1))
    store.actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(store.getSnapshot().byTab[TAB2]).toMatchObject({ kind: 'ready' })
  })

  it('ignores every per-shell write for a tab that is not serving shells', () => {
    const store = createTerminalStore().create()
    store.actions.failed(TAB, FAILURE)
    store.actions.select(TAB, 'console-1')
    store.actions.output(TAB, 'console-1', 'x', false)
    store.actions.ended(TAB, 'console-1')
    store.actions.dropped(TAB, 'console-1')
    store.actions.streamFailed(TAB, 'console-1', FAILURE)
    store.actions.busy(TAB, true)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'failed', failure: FAILURE })
    // A tab with no bucket at all is the same case.
    store.actions.output(TAB2, 'console-1', 'x', false)
    expect(store.getSnapshot().byTab[TAB2]).toBeUndefined()
  })
})

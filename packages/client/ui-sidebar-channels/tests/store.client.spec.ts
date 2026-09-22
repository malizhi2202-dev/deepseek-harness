/**
 * The panel's write set, one tab at a time.
 *
 * The load-bearing facts for the body: a reload replaces the channel list but
 * carries each channel's own records forward, a channel the tab does not hold
 * is left alone rather than invented, and a save that did not land keeps the
 * drafts so the reader can correct them.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createChannelsStore } from '../src/client/store.ts'
import type { ChannelSettingsState, ChannelsReadyState } from '../src/client/store.ts'
import { channelView, failure, namespaceView } from './scripted-channels.client.ts'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

/** One tab's ready state, or undefined while it holds no channel list. */
function ready(store: ReturnType<ReturnType<typeof createChannelsStore>['create']>, tabId = TAB): ChannelsReadyState | undefined {
  const state = store.getSnapshot().byTab[tabId]
  return state?.kind === 'ready' ? state : undefined
}

/** One channel's form in a tab's ready state. */
function form(
  store: ReturnType<ReturnType<typeof createChannelsStore>['create']>,
  channel = 'tuitui',
  tabId = TAB,
): ChannelSettingsState {
  const entry = ready(store, tabId)?.channels.find(candidate => candidate.view.channel === channel)
  if (entry === undefined) throw new Error('no such channel in this tab')
  return entry.form
}

const DESCRIBED = {
  status: 'ready',
  writable: true,
  view: namespaceView(),
  fields: [],
} as const

describe('createChannelsStore', () => {
  it('mints an independent instance per call', () => {
    const first = createChannelsStore().create()
    const second = createChannelsStore().create()
    first.actions.loading(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes one tab through loading, failed, and listed', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.loading(TAB)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
    const broken = new RemoteError('channels/failed', 'no host', {})
    actions.failed(TAB, broken)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'failed', failure: broken })
    actions.listed(TAB, [channelView()])
    expect(ready(store)?.channels.map(entry => entry.view.channel)).toEqual(['tuitui'])
    expect(form(store)).toEqual({ status: 'loading', view: undefined, drafts: {}, saving: false, failed: false })
  })

  it('carries each channel forward across a reload and seeds the new ones', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.described(TAB, 'tuitui', DESCRIBED)
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    actions.busy(TAB, 'tuitui')
    actions.probed(TAB, 'tuitui', { ok: true })
    actions.listed(TAB, [channelView({ channel: 'other' }), channelView({ connection: 'connected' })])
    const carried = ready(store)?.channels.find(entry => entry.view.channel === 'tuitui')
    expect(carried?.view.connection).toBe('connected')
    expect(carried?.probe).toEqual({ ok: true })
    expect(carried?.form.drafts).toEqual({ host: { text: 'draft', clear: false } })
    expect(ready(store)?.busy).toBe('tuitui')
    const seeded = ready(store)?.channels.find(entry => entry.view.channel === 'other')
    expect(seeded?.form.status).toBe('loading')
    expect(seeded?.probe).toBeUndefined()
  })

  it('records one channel\'s probe, clearing the failure the last control left', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.channelFailed(TAB, 'tuitui', failure('channels/failed', 'refused'))
    expect(ready(store)?.channels[0]?.failure?.message).toBe('refused')
    actions.probed(TAB, 'tuitui', { ok: false, message: 'bad token' })
    expect(ready(store)?.channels[0]?.failure).toBeUndefined()
    expect(ready(store)?.channels[0]?.probe).toEqual({ ok: false, message: 'bad token' })
  })

  it('leaves a channel this tab does not hold alone', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.probed(TAB, 'ghost', { ok: true })
    actions.channelFailed(TAB, 'ghost', failure('channels/unknown', 'no such channel'))
    actions.described(TAB, 'ghost', DESCRIBED)
    actions.edited(TAB, 'ghost', 'host', { text: 'draft', clear: false })
    actions.saving(TAB, 'ghost', true)
    actions.saved(TAB, 'ghost', true)
    actions.discard(TAB, 'ghost')
    expect(ready(store)?.channels).toHaveLength(1)
    expect(ready(store)?.channels[0]?.probe).toBeUndefined()
    expect(ready(store)?.channels[0]?.failure).toBeUndefined()
  })

  it('tolerates a tab that holds no channel list', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.failed(TAB, failure('channels/failed', 'no host'))
    actions.busy(TAB, 'tuitui')
    actions.described(TAB, 'tuitui', DESCRIBED)
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    actions.saving(TAB, 'tuitui', true)
    actions.saved(TAB, 'tuitui', true)
    actions.discard(TAB, 'tuitui')
    expect(ready(store)).toBeUndefined()
    expect(store.getSnapshot().byTab[TAB]?.kind).toBe('failed')
  })

  it('records the descriptor each channel namespace resolved to', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.described(TAB, 'tuitui', DESCRIBED)
    const described = form(store)
    expect(described.status).toBe('ready')
    expect(described.status === 'ready' && described.writable).toBe(true)
    expect(described.status === 'ready' && described.view.ns).toBe('chat-channel-tuitui')
    actions.described(TAB, 'tuitui', { status: 'loading' })
    expect(form(store)).toEqual({ status: 'loading', view: undefined, drafts: {}, saving: false, failed: false })
    actions.described(TAB, 'tuitui', { status: 'unavailable' })
    expect(form(store)).toEqual({ status: 'unavailable', view: undefined, drafts: {}, saving: false, failed: false })
  })

  it('keeps the staged drafts and the failure flag across a descriptor refresh', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    actions.saved(TAB, 'tuitui', false)
    expect(form(store).failed).toBe(true)
    actions.described(TAB, 'tuitui', DESCRIBED)
    expect(form(store).drafts).toEqual({ host: { text: 'draft', clear: false } })
    expect(form(store).failed).toBe(true)
  })

  it('clears the drafts when a save lands and keeps them when it does not', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    actions.saving(TAB, 'tuitui', true)
    expect(form(store).saving).toBe(true)
    actions.saving(TAB, 'tuitui', false)
    actions.saved(TAB, 'tuitui', true)
    expect(form(store)).toMatchObject({ drafts: {}, failed: false, saving: false })
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    actions.saved(TAB, 'tuitui', false)
    expect(form(store)).toMatchObject({ drafts: { host: { text: 'draft', clear: false } }, failed: true })
    actions.discard(TAB, 'tuitui')
    expect(form(store)).toMatchObject({ drafts: {}, failed: false })
  })

  it('forgets one tab and leaves the others', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.listed(TAB2, [channelView()])
    actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(ready(store, TAB2)?.channels).toHaveLength(1)
  })

  it('replaces the descriptor-derived half without touching the staged drafts', () => {
    const store = createChannelsStore().create()
    const { actions } = store
    actions.listed(TAB, [channelView()])
    actions.edited(TAB, 'tuitui', 'host', { text: 'draft', clear: false })
    const narrowed: SettingsNamespaceView = namespaceView({ writable: false } as Partial<SettingsNamespaceView>)
    actions.described(TAB, 'tuitui', { status: 'ready', writable: false, view: narrowed, fields: [] })
    const described = form(store)
    expect(described.status === 'ready' && described.writable).toBe(false)
    expect(described.drafts).toEqual({ host: { text: 'draft', clear: false } })
  })
})

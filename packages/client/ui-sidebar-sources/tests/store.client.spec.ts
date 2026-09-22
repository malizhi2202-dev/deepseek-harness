/**
 * The panel's store, as its actions drive it: the source list is replaced whole
 * by each status answer while each source's own records survive a reload, the
 * form's descriptor half follows the mirror while its staged edits belong to the
 * reader, and a save that did not land keeps the drafts.
 */
import { describe, expect, it } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSourcesStore } from '../src/client/store.ts'
import type { SourceSettingsState } from '../src/client/store.ts'
import type { SourcesStoreInstance } from './mount.client.tsx'
import { NAMESPACE, SOURCE_KEY, described, failure, sourceView } from './scripted-sources.client.ts'

const TAB = 'tab-1' as TabId
const OTHER = 'tab-2' as TabId

/** A second source instance, of a different kind, as the Host reports it. */
const WIKI = sourceView({ key: 'mediawiki/wiki', kind: 'mediawiki', id: 'wiki', namespace: 'resource-mediawiki' })

/** One store instance with its actions, as the framework would mint it. */
function store() {
  const instance = createSourcesStore().create()
  return { instance, actions: instance.actions }
}

describe('createSourcesStore', () => {
  it('starts with no tab state at all', () => {
    const { instance } = store()
    expect(instance.getSnapshot()).toEqual({ byTab: {} })
  })
})

describe('the source list', () => {
  it('marks one tab loading and records why the read failed', () => {
    const { instance, actions } = store()
    actions.loading(TAB)
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
    actions.failed(TAB, failure('sources/failed', 'the carrier dropped'))
    expect(instance.getSnapshot().byTab[TAB]).toEqual({
      kind: 'failed',
      failure: { code: 'sources/failed', message: 'the carrier dropped' },
    })
  })

  it('replaces the list whole, in registration order', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView(), WIKI])
    const ready = instance.getSnapshot().byTab[TAB]
    expect(ready?.kind).toBe('ready')
    expect(ready?.kind === 'ready' ? ready.sources.map(entry => entry.view.key) : []).toEqual([SOURCE_KEY, WIKI.key])
    expect(ready?.kind === 'ready' ? ready.sources[0]?.form : undefined)
      .toEqual({ status: 'loading', view: undefined, drafts: {}, saving: false, failed: false })
    expect(ready?.kind === 'ready' ? ready.sources[0]?.probe : 'unset').toBeUndefined()
  })

  it('carries each surviving source\'s records across a reload and drops the ones that went away', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.described(TAB, SOURCE_KEY, described())
    actions.probed(TAB, SOURCE_KEY, { ok: true })
    actions.edited(TAB, SOURCE_KEY, 'host', { text: 'https://other', clear: false })
    actions.listed(TAB, [sourceView({ state: 'usable' }), WIKI])
    const ready = instance.getSnapshot().byTab[TAB]
    if (ready?.kind !== 'ready') throw new Error('the tab is not ready')
    expect(ready.sources[0]?.probe).toEqual({ ok: true })
    expect(ready.sources[0]?.form.status).toBe('ready')
    expect(ready.sources[0]?.form.drafts).toEqual({ host: { text: 'https://other', clear: false } })
    expect(ready.sources[1]?.probe).toBeUndefined()
    expect(ready.sources[1]?.form.drafts).toEqual({})
  })

  it('keeps no list on a tab that never read one', () => {
    const { instance, actions } = store()
    actions.probing(TAB, SOURCE_KEY)
    actions.probed(TAB, SOURCE_KEY, { ok: true })
    actions.sourceFailed(TAB, SOURCE_KEY, failure('sources/unknown', 'no such source'))
    actions.described(TAB, SOURCE_KEY, described())
    actions.edited(TAB, SOURCE_KEY, 'host', { text: 'x', clear: false })
    actions.saving(TAB, SOURCE_KEY, true)
    actions.saved(TAB, SOURCE_KEY, true)
    actions.discard(TAB, SOURCE_KEY)
    expect(instance.getSnapshot().byTab).toEqual({})
  })
})

describe('one source\'s probe and failures', () => {
  it('records which probe is in flight and clears the failure a probe answers', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.sourceFailed(TAB, SOURCE_KEY, failure('sources/failed', 'the carrier dropped'))
    actions.probing(TAB, SOURCE_KEY)
    const busy = instance.getSnapshot().byTab[TAB]
    expect(busy?.kind === 'ready' ? busy.probing : undefined).toBe(SOURCE_KEY)
    actions.probed(TAB, SOURCE_KEY, { ok: false, message: 'the token was refused' })
    const ready = instance.getSnapshot().byTab[TAB]
    if (ready?.kind !== 'ready') throw new Error('the tab is not ready')
    // The face clears the in-flight flag before it writes the answer; the store
    // only records what it is told.
    actions.probing(TAB, undefined)
    expect(ready.sources[0]?.probe).toEqual({ ok: false, message: 'the token was refused' })
    expect(ready.sources[0]?.failure).toBeUndefined()
    const settled = instance.getSnapshot().byTab[TAB]
    expect(settled?.kind === 'ready' ? settled.probing : 'unset').toBeUndefined()
  })

  it('records a control failure without touching the probe answer', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView(), WIKI])
    actions.probed(TAB, SOURCE_KEY, { ok: true })
    actions.sourceFailed(TAB, WIKI.key, failure('sources/unknown', 'no such source'))
    const ready = instance.getSnapshot().byTab[TAB]
    if (ready?.kind !== 'ready') throw new Error('the tab is not ready')
    // Only the source the write names changes; every other entry keeps its own
    // records.
    expect(ready.sources[0]?.failure).toBeUndefined()
    expect(ready.sources[0]?.probe).toEqual({ ok: true })
    expect(ready.sources[1]?.failure).toEqual({ code: 'sources/unknown', message: 'no such source' })
    expect(ready.sources[1]?.probe).toBeUndefined()
  })
})

describe('one source\'s settings form', () => {
  it('carries the descriptor half of the form for each mirror answer', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.described(TAB, SOURCE_KEY, { status: 'loading' })
    expect(formOf(instance, TAB, SOURCE_KEY).status).toBe('loading')
    actions.described(TAB, SOURCE_KEY, { status: 'unavailable' })
    expect(formOf(instance, TAB, SOURCE_KEY)).toMatchObject({ status: 'unavailable', view: undefined })
    actions.described(TAB, SOURCE_KEY, described({ ns: NAMESPACE }))
    const ready = formOf(instance, TAB, SOURCE_KEY)
    expect(ready.status).toBe('ready')
    expect(ready.status === 'ready' ? ready.writable : undefined).toBe(true)
    expect(ready.status === 'ready' ? ready.fields.map(field => field.name) : []).toEqual([
      'host', 'query', 'limit', 'deep', 'mode', 'tokenRef',
    ])
  })

  it('carries the staged edits across a descriptor answer', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.edited(TAB, SOURCE_KEY, 'host', { text: 'https://other', clear: false })
    actions.described(TAB, SOURCE_KEY, described())
    expect(formOf(instance, TAB, SOURCE_KEY).drafts).toEqual({ host: { text: 'https://other', clear: false } })
  })

  it('stages an edit, clears the failure flag, and drops every draft on discard', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.saved(TAB, SOURCE_KEY, false)
    expect(formOf(instance, TAB, SOURCE_KEY).failed).toBe(true)
    actions.edited(TAB, SOURCE_KEY, 'limit', { text: '5', clear: false })
    expect(formOf(instance, TAB, SOURCE_KEY)).toMatchObject({
      drafts: { limit: { text: '5', clear: false } },
      failed: false,
    })
    actions.discard(TAB, SOURCE_KEY)
    expect(formOf(instance, TAB, SOURCE_KEY)).toMatchObject({ drafts: {}, failed: false })
  })

  it('clears the drafts of a save that landed and keeps those of one that did not', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.edited(TAB, SOURCE_KEY, 'host', { text: 'https://other', clear: false })
    actions.saving(TAB, SOURCE_KEY, true)
    expect(formOf(instance, TAB, SOURCE_KEY).saving).toBe(true)
    actions.saved(TAB, SOURCE_KEY, true)
    expect(formOf(instance, TAB, SOURCE_KEY)).toMatchObject({ drafts: {}, failed: false, saving: true })
    actions.edited(TAB, SOURCE_KEY, 'host', { text: 'https://third', clear: false })
    actions.saved(TAB, SOURCE_KEY, false)
    expect(formOf(instance, TAB, SOURCE_KEY)).toMatchObject({
      drafts: { host: { text: 'https://third', clear: false } },
      failed: true,
    })
  })

  it('reports a form the mirror never answered as loading', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    expect(formOf(instance, TAB, SOURCE_KEY).view).toBeUndefined()
  })
})

describe('forget', () => {
  it('drops one tab and leaves every other tab alone', () => {
    const { instance, actions } = store()
    actions.listed(TAB, [sourceView()])
    actions.listed(OTHER, [WIKI])
    actions.forget(TAB)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([OTHER])
  })

  it('leaves a tab whose record never listed anything out of the map', () => {
    const { instance, actions } = store()
    actions.loading(TAB)
    actions.forget('tab-3' as TabId)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([TAB])
  })
})

/**
 * One source's form state, read out of a tab's bucket.
 * @param instance - the store instance.
 * @param tabId - the tab to read.
 * @param key - the source to read, as the Host identified it.
 * @returns the source's form state.
 */
function formOf(
  instance: SourcesStoreInstance,
  tabId: TabId,
  key: string,
): SourceSettingsState {
  const state = instance.getSnapshot().byTab[tabId]
  if (state?.kind !== 'ready') throw new Error('the tab is not ready')
  const entry = state.sources.find(candidate => candidate.view.key === key)
  if (entry === undefined) throw new Error(`the tab holds no ${key} source`)
  return entry.form
}

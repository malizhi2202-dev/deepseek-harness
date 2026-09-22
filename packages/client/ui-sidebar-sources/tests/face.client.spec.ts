/**
 * The panel's asynchronous half, one settlement at a time.
 *
 * Each case pins a rule the panel would otherwise get wrong quietly: a read
 * that a reload superseded writes nothing, a probe the reader never sees settled
 * leaves no in-flight mark, a save carries the revision the form was read at,
 * and a save that did not land keeps the drafts.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSourcesSettings, sourcesFace } from '../src/client/face.ts'
import type { SourcesInjected } from '../src/client/face.ts'
import { createSourcesStore } from '../src/client/store.ts'
import type { SourcesReadyState } from '../src/client/store.ts'
import {
  NAMESPACE, SESSION, SOURCE_KEY, failure, namespaceView, scriptedRemote, scriptedSettings, sourceView,
} from './scripted-sources.client.ts'

const TAB = 'tab-1' as TabId

/** One mounted face over a real store, a scripted Remote, and a scripted settings domain. */
function harness() {
  const store = createSourcesStore().create()
  const script = scriptedRemote()
  const settings = scriptedSettings()
  const face = sourcesFace(script.remote, settings.port)(SESSION, store.actions)
  const controller = new AbortController()
  const ready = (): SourcesReadyState | undefined => {
    const state = store.getSnapshot().byTab[TAB]
    return state?.kind === 'ready' ? state : undefined
  }
  const entry = () => ready()?.sources[0]
  return { store, script, settings, face, controller, ready, entry }
}

/** The mirror answer a Host that serves the scripted namespace publishes. */
const HELD = {
  status: 'ready',
  view: { namespaces: [namespaceView()], writable: true, hasDocument: true },
  error: null,
} as const

describe('createSourcesSettings', () => {
  it('reads the mirror, binds one scope per namespace, and flattens the schema into rows', () => {
    const settings = scriptedSettings()
    settings.publish(HELD)
    const binder = {
      describe: () => settings.port.describe,
      bind: (spec: { namespace: string }) => settings.port.bind(spec.namespace),
    }
    const port = createSourcesSettings(binder as unknown as SettingsScopeBinder, new SettingsSchemaService(new Context()))
    expect(port.describe.getSnapshot().status).toBe('ready')
    settings.scope(NAMESPACE).revision(3)
    expect(port.bind(NAMESPACE).getSnapshot().revision).toBe(3)
    expect(settings.binds).toEqual([NAMESPACE])
    expect(port.fields(namespaceView().schema, namespaceView()).map(field => [field.name, field.control])).toEqual([
      ['host', 'text'],
      ['query', 'text'],
      ['limit', 'number'],
      ['deep', 'boolean'],
      ['mode', 'select'],
      ['tokenRef', 'text'],
    ])
  })
})

describe('sourcesFace', () => {
  it('reads the source list, follows the descriptors, and writes each form', async () => {
    const { store, script, settings, face, controller, ready } = harness()
    face.start(TAB, controller.signal)
    expect(script.calls.map(call => call.method)).toEqual(['status'])
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
    settings.publish(HELD)
    await script.settleStatus({ sources: [sourceView()] })
    // The held answer already serves the namespace, so no repair read goes out.
    expect(script.calls.some(call => call.method === 'describe')).toBe(false)
    expect(ready()?.sources.map(candidate => candidate.view.key)).toEqual([SOURCE_KEY])
    expect(settings.subscribers()).toBe(1)
    const form = ready()?.sources[0]?.form
    expect(form?.status).toBe('ready')
    expect(form?.status === 'ready' && form.fields.map(field => field.name)).toEqual([
      'host', 'query', 'limit', 'deep', 'mode', 'tokenRef',
    ])
    settings.publish({ ...HELD, view: { ...HELD.view, namespaces: [namespaceView({ revision: 4 })] } })
    const refreshed = ready()?.sources[0]?.form
    expect(refreshed?.status === 'ready' && refreshed.view.revision).toBe(4)
    // A second read follows the descriptors again without subscribing twice.
    face.reload(TAB, controller.signal)
    await script.settleStatus({ sources: [sourceView({ state: 'usable' })] })
    expect(settings.subscribers()).toBe(1)
    expect(ready()?.sources[0]?.form.status).toBe('ready')
  })

  it('reports a source list it could not read at all', async () => {
    const { script, face, controller, store } = harness()
    face.start(TAB, controller.signal)
    await script.settle({ ok: false, error: failure('sources/failed', 'no host') })
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      kind: 'failed',
      failure: failure('sources/failed', 'no host'),
    })
  })

  it('leaves the form loading while no mirror answer is held, and unavailable once one serves no namespace', async () => {
    const { script, settings, face, controller, entry } = harness()
    face.start(TAB, controller.signal)
    await script.settleStatus({ sources: [sourceView()] })
    expect(entry()?.form).toEqual({ status: 'loading', view: undefined, drafts: {}, saving: false, failed: false })
    settings.publish({ status: 'unavailable', view: undefined, error: null })
    expect(entry()?.form.status).toBe('unavailable')
    settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    expect(entry()?.form.status).toBe('unavailable')
  })

  it('records a probe answer and a control failure against the source it names', async () => {
    const { script, face, controller, entry, ready } = harness()
    await readList(face, script, controller)
    face.probe(TAB, controller.signal, SOURCE_KEY)
    expect(script.calls.at(-1)).toEqual({ method: 'probe', key: SOURCE_KEY })
    expect(ready()?.probing).toBe(SOURCE_KEY)
    await script.settleProbe({ ok: true })
    expect(ready()?.probing).toBeUndefined()
    expect(entry()?.probe).toEqual({ ok: true })
    face.probe(TAB, controller.signal, SOURCE_KEY)
    await script.settle({ ok: false, error: failure('sources/unknown', 'no such source') })
    expect(entry()?.failure?.code).toBe('sources/unknown')
  })

  it('starts no call for a record that is already gone', async () => {
    const { store, script, face, controller } = harness()
    controller.abort()
    face.probe(TAB, controller.signal, SOURCE_KEY)
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    expect(script.calls).toEqual([])
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('drops a probe settlement the reader can no longer see', async () => {
    const { store, script, face, controller, ready } = harness()
    await readList(face, script, controller)
    face.probe(TAB, controller.signal, SOURCE_KEY)
    controller.abort()
    await script.settleProbe({ ok: true })
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(ready()).toBeUndefined()
  })

  it('starts no read for a record that is already gone', () => {
    const { store, script, face, controller } = harness()
    controller.abort()
    face.start(TAB, controller.signal)
    expect(script.calls).toEqual([])
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('drops a list the next read superseded', async () => {
    const { script, face, controller, entry } = harness()
    face.start(TAB, controller.signal)
    face.reload(TAB, controller.signal)
    expect(script.calls.map(call => call.method)).toEqual(['status', 'status'])
    await script.settleStatus({ sources: [sourceView()] })
    expect(entry()).toBeUndefined()
    await script.settleStatus({ sources: [sourceView({ state: 'usable' })] })
    expect(entry()?.view.state).toBe('usable')
  })

  it('forgets the tab when its record goes away, and drops the read it left in flight', async () => {
    const { store, script, settings, face, controller } = harness()
    await readList(face, script, controller)
    expect(settings.subscribers()).toBe(1)
    face.reload(TAB, controller.signal)
    controller.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(settings.subscribers()).toBe(0)
    await script.settleStatus({ sources: [sourceView()] })
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('aborts a tab that never followed the mirror', async () => {
    const { store, script, face, controller } = harness()
    face.start(TAB, controller.signal)
    controller.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    await script.settleStatus({ sources: [sourceView()] })
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes the staged edits under the revision the form was read at, and clears them when they land', async () => {
    const { script, settings, face, controller, entry } = harness()
    await readList(face, script, controller)
    settings.scope(NAMESPACE).revision(7)
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'new' }])
    expect(entry()?.form.saving).toBe(true)
    expect(settings.scope(NAMESPACE).mutations).toEqual([
      { ops: [{ op: 'set', path: ['host'], value: 'new' }], revision: 7 },
    ])
    settings.scope(NAMESPACE).user({ host: 'new' })
    await settings.scope(NAMESPACE).settle()
    expect(entry()?.form).toMatchObject({ saving: false, failed: false, drafts: {} })
  })

  it('keeps the staged edits when the Host did not store them', async () => {
    const { store, script, settings, face, controller, entry } = harness()
    await readList(face, script, controller)
    store.actions.edited(TAB, SOURCE_KEY, 'host', { text: 'new', clear: false })
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'new' }])
    settings.scope(NAMESPACE).user({})
    await settings.scope(NAMESPACE).settle()
    expect(entry()?.form).toMatchObject({
      saving: false,
      failed: true,
      drafts: { host: { text: 'new', clear: false } },
    })
  })

  it('reports a carrier fault like a refusal, and reads a clear back as landed', async () => {
    const { script, settings, face, controller, entry } = harness()
    await readList(face, script, controller)
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'unset', path: ['host'] }])
    settings.scope(NAMESPACE).user({})
    await settings.scope(NAMESPACE).fail(new Error('carrier down'))
    expect(entry()?.form).toMatchObject({ saving: false, failed: false, drafts: {} })
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    await settings.scope(NAMESPACE).fail(new Error('carrier down'))
    expect(entry()?.form.failed).toBe(true)
  })

  it('starts no write for an empty stage, a gone record, or a source with no namespace', async () => {
    const { script, settings, face, controller } = harness()
    face.save(TAB, controller.signal, SOURCE_KEY, [])
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    expect(settings.binds).toEqual([])
    await readList(face, script, controller)
    controller.abort()
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    expect(settings.scope(NAMESPACE).mutations).toEqual([])
  })

  it('binds one scope per namespace, and reuses it for a second save', async () => {
    const { script, settings, face, controller } = harness()
    await readList(face, script, controller)
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'y' }])
    expect(settings.binds).toEqual([NAMESPACE])
    expect(settings.scope(NAMESPACE).mutations).toHaveLength(2)
  })

  it('reads the document once to repair a descriptor the held answer predates', async () => {
    const { script, settings, face, controller, ready, entry } = harness()
    settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    face.start(TAB, controller.signal)
    await script.settleStatus({ sources: [sourceView()] })
    expect(entry()?.form.status).toBe('unavailable')
    expect(script.calls.at(-1)?.method).toBe('describe')
    await script.settleDescribe({
      ok: true,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [namespaceView({ revision: 7 }), { ...namespaceView(), ns: 'other' }],
      },
    })
    // Only the namespace the answer was missing is folded in.
    expect(settings.snapshot().view?.namespaces.map(row => row.ns)).toEqual([NAMESPACE])
    const form = ready()?.sources[0]?.form
    expect(form?.status).toBe('ready')
    expect(form?.status === 'ready' && form.view.revision).toBe(7)
  })

  it('keeps the form unavailable when the repair read was refused, and folds nothing for a gone record', async () => {
    const refused = harness()
    refused.settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    refused.face.start(TAB, refused.controller.signal)
    await refused.script.settleStatus({ sources: [sourceView()] })
    await refused.script.settleDescribe({ ok: false, error: failure('sources/failed', 'no document') })
    expect(refused.entry()?.form.status).toBe('unavailable')
    expect(refused.settings.snapshot().view?.namespaces).toEqual([])

    const gone = harness()
    gone.settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    gone.face.start(TAB, gone.controller.signal)
    await gone.script.settleStatus({ sources: [sourceView()] })
    gone.controller.abort()
    await gone.script.settleDescribe({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [namespaceView()] },
    })
    expect(gone.settings.snapshot().view?.namespaces).toEqual([])
  })

  it('reads no document while no mirror answer is held', async () => {
    const { script, settings, face, controller, entry } = harness()
    face.start(TAB, controller.signal)
    await script.settleStatus({ sources: [sourceView()] })
    expect(settings.snapshot().view).toBeUndefined()
    expect(script.calls.some(call => call.method === 'describe')).toBe(false)
    expect(entry()?.form.status).toBe('loading')
  })

  it('drops a write settlement the reader can no longer see', async () => {
    const { script, settings, face, controller, store } = harness()
    await readList(face, script, controller)
    face.save(TAB, controller.signal, SOURCE_KEY, [{ op: 'set', path: ['host'], value: 'x' }])
    controller.abort()
    settings.scope(NAMESPACE).user({ host: 'x' })
    await settings.scope(NAMESPACE).settle()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })
})

/**
 * Read the source list the way the body does on mount.
 * @param face - the mounted face.
 * @param script - the scripted Remote namespace.
 * @param controller - the tab record's lifetime.
 */
async function readList(
  face: SourcesInjected,
  script: ReturnType<typeof scriptedRemote>,
  controller: AbortController,
): Promise<void> {
  face.start(TAB, controller.signal)
  await script.settleStatus({ sources: [sourceView()] })
}

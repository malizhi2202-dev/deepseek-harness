/**
 * The panel's asynchronous half, one settlement at a time.
 *
 * Each case pins a rule the panel would otherwise get wrong quietly: a read
 * that a reload superseded writes nothing, a control call the reader never sees
 * settled leaves no in-flight mark, a save carries the revision the form was
 * read at, and a save that did not land keeps the drafts.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { channelsFace, createChannelsSettings } from '../src/client/face.ts'
import type { ChannelsInjected } from '../src/client/face.ts'
import { createChannelsStore } from '../src/client/store.ts'
import type { ChannelsReadyState } from '../src/client/store.ts'
import {
  NAMESPACE, SESSION, channelView, failure, namespaceView, scriptedRemote, scriptedSettings,
} from './scripted-channels.client.ts'

const TAB = 'tab-1' as TabId

/** One mounted face over a real store, a scripted Remote, and a scripted settings domain. */
function harness() {
  const store = createChannelsStore().create()
  const script = scriptedRemote()
  const settings = scriptedSettings()
  const face = channelsFace(script.remote, settings.port)(SESSION, store.actions)
  const controller = new AbortController()
  const ready = (): ChannelsReadyState | undefined => {
    const state = store.getSnapshot().byTab[TAB]
    return state?.kind === 'ready' ? state : undefined
  }
  const entry = () => ready()?.channels[0]
  return { store, script, settings, face, controller, ready, entry }
}

/** The mirror answer a Host that serves the scripted namespace publishes. */
const HELD = {
  status: 'ready',
  view: { namespaces: [namespaceView()], writable: true, hasDocument: true },
  error: null,
} as const

describe('createChannelsSettings', () => {
  it('reads the mirror, binds one scope per namespace, and flattens the schema', () => {
    const settings = scriptedSettings()
    settings.publish(HELD)
    const binder = {
      describe: () => settings.port.describe,
      bind: (spec: { namespace: string }) => settings.port.bind(spec.namespace),
    }
    const port = createChannelsSettings(binder as unknown as SettingsScopeBinder, new SettingsSchemaService(new Context()))
    expect(port.describe.getSnapshot().status).toBe('ready')
    settings.scope(NAMESPACE).revision(3)
    expect(port.bind(NAMESPACE).getSnapshot().revision).toBe(3)
    expect(settings.binds).toEqual([NAMESPACE])
    expect(port.fields(namespaceView().schema).map(field => [field.name, field.kind])).toEqual([
      ['enabled', 'boolean'],
      ['sessionId', 'text'],
      ['markdown', 'boolean'],
      ['host', 'text'],
      ['appSecretRef', 'text'],
    ])
  })
})

describe('channelsFace', () => {
  it('reads the channel list, follows the descriptors, and writes each form', async () => {
    const { store, script, settings, face, controller, ready } = harness()
    face.start(TAB, controller.signal)
    expect(script.calls.map(call => call.method)).toEqual(['status'])
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
    settings.publish(HELD)
    await script.settleStatus({ channels: [channelView()] })
    // The held answer already serves the namespace, so no repair read goes out.
    expect(script.calls.some(call => call.method === 'describe')).toBe(false)
    expect(ready()?.channels.map(candidate => candidate.view.channel)).toEqual(['tuitui'])
    expect(settings.subscribers()).toBe(1)
    const form = ready()?.channels[0]?.form
    expect(form?.status).toBe('ready')
    expect(form?.status === 'ready' && form.fields.map(field => field.name)).toEqual([
      'enabled', 'sessionId', 'markdown', 'host', 'appSecretRef',
    ])
    settings.publish({ ...HELD, view: { ...HELD.view, namespaces: [namespaceView({ revision: 4 })] } })
    const refreshed = ready()?.channels[0]?.form
    expect(refreshed?.status === 'ready' && refreshed.view.revision).toBe(4)
    // A second read follows the descriptors again without subscribing twice.
    face.reload(TAB, controller.signal)
    await script.settleStatus({ channels: [channelView({ connection: 'connected' })] })
    expect(settings.subscribers()).toBe(1)
    expect(ready()?.channels[0]?.form.status).toBe('ready')
  })

  it('reports a channel list it could not read at all', async () => {
    const { script, face, controller, store } = harness()
    face.start(TAB, controller.signal)
    await script.settle({ ok: false, error: failure('channels/failed', 'no host') })
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      kind: 'failed',
      failure: failure('channels/failed', 'no host'),
    })
  })

  it('leaves the form loading while no mirror answer is held, and unavailable once one serves no namespace', async () => {
    const { script, settings, face, controller, entry } = harness()
    face.start(TAB, controller.signal)
    await script.settleStatus({ channels: [channelView()] })
    expect(entry()?.form).toEqual({ status: 'loading', view: undefined, drafts: {}, saving: false, failed: false })
    settings.publish({ status: 'unavailable', view: undefined, error: null })
    expect(entry()?.form.status).toBe('unavailable')
    settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    expect(entry()?.form.status).toBe('unavailable')
  })

  it('binds a channel to this tab\'s session and applies the list the Host answers with', async () => {
    const { script, face, controller, ready, entry } = harness()
    await readList(face, script, controller)
    face.enable(TAB, controller.signal, 'tuitui')
    expect(script.calls.at(-1)).toEqual({ method: 'enable', channel: 'tuitui', sessionId: SESSION })
    expect(ready()?.busy).toBe('tuitui')
    await script.settleControl({
      channels: [channelView({ enabled: true, sessionId: SESSION, connection: 'connecting' })],
    })
    expect(ready()?.busy).toBeUndefined()
    expect(entry()?.view.enabled).toBe(true)
    expect(entry()?.view.sessionId).toBe(SESSION)
  })

  it('closes a channel and applies the list the Host answers with', async () => {
    const { script, face, controller, entry } = harness()
    await readList(face, script, controller, [channelView({ enabled: true, connection: 'connected' })])
    face.disable(TAB, controller.signal, 'tuitui')
    expect(script.calls.at(-1)).toEqual({ method: 'disable', channel: 'tuitui', sessionId: undefined })
    await script.settleControl({ channels: [channelView()] })
    expect(entry()?.view.enabled).toBe(false)
    expect(entry()?.view.connection).toBe('stopped')
  })

  it('records a probe answer and a control failure against the channel it names', async () => {
    const { script, face, controller, entry } = harness()
    await readList(face, script, controller)
    face.probe(TAB, controller.signal, 'tuitui')
    expect(script.calls.at(-1)).toEqual({ method: 'probe', channel: 'tuitui', sessionId: undefined })
    await script.settleProbe({ ok: true, accountLabel: 'ops' })
    expect(entry()?.probe).toEqual({ ok: true, accountLabel: 'ops' })
    face.enable(TAB, controller.signal, 'tuitui')
    await script.settle({ ok: false, error: failure('channels/unknown', 'no such channel') })
    expect(entry()?.failure?.code).toBe('channels/unknown')
  })

  it('starts no control call for a record that is already gone', async () => {
    const { store, script, face, controller } = harness()
    controller.abort()
    face.enable(TAB, controller.signal, 'tuitui')
    face.disable(TAB, controller.signal, 'tuitui')
    face.probe(TAB, controller.signal, 'tuitui')
    expect(script.calls).toEqual([])
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('drops a control settlement the reader can no longer see', async () => {
    const { store, script, face, controller, ready } = harness()
    await readList(face, script, controller)
    face.enable(TAB, controller.signal, 'tuitui')
    controller.abort()
    await script.settleControl({ channels: [channelView({ enabled: true })] })
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
    await script.settleStatus({ channels: [channelView()] })
    expect(entry()).toBeUndefined()
    await script.settleStatus({ channels: [channelView({ connection: 'connected' })] })
    expect(entry()?.view.connection).toBe('connected')
  })

  it('forgets the tab when its record goes away, and drops the read it left in flight', async () => {
    const { store, script, settings, face, controller } = harness()
    await readList(face, script, controller)
    expect(settings.subscribers()).toBe(1)
    face.reload(TAB, controller.signal)
    controller.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(settings.subscribers()).toBe(0)
    await script.settleStatus({ channels: [channelView()] })
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('aborts a tab that never followed the mirror', async () => {
    const { store, script, face, controller } = harness()
    face.start(TAB, controller.signal)
    controller.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    await script.settleStatus({ channels: [channelView()] })
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes the staged edits under the revision the form was read at, and clears them when they land', async () => {
    const { script, settings, face, controller, entry } = harness()
    await readList(face, script, controller)
    settings.scope(NAMESPACE).revision(7)
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'new' }])
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
    store.actions.edited(TAB, 'tuitui', 'host', { text: 'new', clear: false })
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'new' }])
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
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'unset', path: ['host'] }])
    settings.scope(NAMESPACE).user({})
    await settings.scope(NAMESPACE).fail(new Error('carrier down'))
    expect(entry()?.form).toMatchObject({ saving: false, failed: false, drafts: {} })
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'x' }])
    await settings.scope(NAMESPACE).fail(new Error('carrier down'))
    expect(entry()?.form.failed).toBe(true)
  })

  it('starts no write for an empty stage, a gone record, or a channel with no namespace', async () => {
    const { script, settings, face, controller } = harness()
    face.save(TAB, controller.signal, 'tuitui', [])
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'x' }])
    expect(settings.binds).toEqual([])
    await readList(face, script, controller)
    controller.abort()
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'x' }])
    expect(settings.scope(NAMESPACE).mutations).toEqual([])
  })

  it('binds one scope per namespace, and reuses it for a second save', async () => {
    const { script, settings, face, controller } = harness()
    await readList(face, script, controller, [channelView(), channelView({ channel: 'other' })])
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'x' }])
    face.save(TAB, controller.signal, 'other', [{ op: 'set', path: ['host'], value: 'y' }])
    expect(settings.binds).toEqual([NAMESPACE])
    expect(settings.scope(NAMESPACE).mutations).toHaveLength(2)
  })

  it('reads the document once to repair a descriptor the held answer predates', async () => {
    const { script, settings, face, controller, ready, entry } = harness()
    settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    face.start(TAB, controller.signal)
    await script.settleStatus({ channels: [channelView()] })
    // The status call is what registered the namespace on the Host, so the
    // mirror's earlier answer cannot hold it.
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
    const form = ready()?.channels[0]?.form
    expect(form?.status).toBe('ready')
    expect(form?.status === 'ready' && form.view.revision).toBe(7)
  })

  it('keeps the form unavailable when the repair read was refused, and folds nothing for a gone record', async () => {
    const refused = harness()
    refused.settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    refused.face.start(TAB, refused.controller.signal)
    await refused.script.settleStatus({ channels: [channelView()] })
    await refused.script.settleDescribe({ ok: false, error: failure('channels/failed', 'no document') })
    expect(refused.entry()?.form.status).toBe('unavailable')
    expect(refused.settings.snapshot().view?.namespaces).toEqual([])

    const gone = harness()
    gone.settings.publish({ status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null })
    gone.face.start(TAB, gone.controller.signal)
    await gone.script.settleStatus({ channels: [channelView()] })
    gone.controller.abort()
    await gone.script.settleDescribe({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [namespaceView()] },
    })
    expect(gone.settings.snapshot().view?.namespaces).toEqual([])
  })

  it('drops a write settlement the reader can no longer see', async () => {
    const { script, settings, face, controller, store } = harness()
    await readList(face, script, controller)
    face.save(TAB, controller.signal, 'tuitui', [{ op: 'set', path: ['host'], value: 'x' }])
    controller.abort()
    settings.scope(NAMESPACE).user({ host: 'x' })
    await settings.scope(NAMESPACE).settle()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })
})

/**
 * Read the channel list the way the body does on mount.
 * @param face - the mounted face.
 * @param script - the scripted Remote namespace.
 * @param controller - the tab record's lifetime.
 * @param channels - the channels the Host reports.
 */
async function readList(
  face: ChannelsInjected,
  script: ReturnType<typeof scriptedRemote>,
  controller: AbortController,
  channels = [channelView()],
): Promise<void> {
  face.start(TAB, controller.signal)
  await script.settleStatus({ channels })
}

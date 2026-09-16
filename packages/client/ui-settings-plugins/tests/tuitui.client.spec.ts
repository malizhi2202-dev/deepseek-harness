/** The tuitui card's controller: staged form, the write-only secret, and its describe-mirror signal. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { TuituiCardController, type TuituiSettings } from '../src/client/tuitui-card-controller.ts'

/** The card plugin's context, scripted down to the `settings` remote the mirror reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

/** Make the stub behave like a Host that accepts every settings write. */
function acceptWrites<T>(host: StubSettingsScope<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      }
    }
    host.publish({ value: value as T, user })
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

/** A describe mirror serving only the tuitui namespace, with a scripted secret slot. */
function tuituiApi(secretSet: () => boolean) {
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'tuitui', schema: {}, value: {}, applies: 'live' as const,
        secrets: [{ path: ['appSecret'], set: secretSet() }], revision: 0,
      }],
    },
  }))
  return { mirror: new SettingsDescribeMirror(ctxWith({ settings: { describe } })), describe }
}

describe('TuituiCardController', () => {
  it('projects the section and saves edits across every field kind', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    acceptWrites(host)
    const controller = new TuituiCardController(host.scope, tuituiApi(() => false).mirror)
    host.publish({
      status: 'ready', writable: true,
      value: { appId: 'test-app', host: 'im.test', requireMention: false, allowFrom: ['*'], treePageSize: 5 },
      base: { appId: 'test-app', host: 'im.test', requireMention: false, allowFrom: ['*'], treePageSize: 5 },
      user: {},
    })
    const face = controller.inject()
    const state = () => face.hooks.tuituiCard.getSnapshot()

    expect(state()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      appId: { text: 'test-app', overridden: false },
      host: { text: 'im.test' },
      requireMention: { text: 'false' },
      allowFrom: { text: '*' },
      treePageSize: { text: '5' },
      appSecret: { text: '' },
    })

    face.edit('appId', 'new-app')
    face.edit('requireMention', 'true')
    face.edit('allowFrom', 'u1, u2')
    face.edit('treePageSize', '8')
    expect(state().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(4) })

    expect(host.set.mock.calls).toEqual([
      ['appId', 'new-app'],
      ['requireMention', true],
      ['allowFrom', ['u1', 'u2']],
      ['treePageSize', 8],
    ])
    expect(state().dirty).toBe(false)
  })

  it('stages a reset and clears the field only on save', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    acceptWrites(host)
    const controller = new TuituiCardController(host.scope, tuituiApi(() => false).mirror)
    host.publish({
      status: 'ready', writable: true,
      value: { host: 'override.test' },
      base: { host: 'im.example.com' },
      user: { host: 'override.test' },
    })
    const face = controller.inject()

    face.resetField('host')
    expect(face.hooks.tuituiCard.getSnapshot().host).toEqual({ text: 'im.example.com', overridden: false, invalid: false })
    expect(host.unset).not.toHaveBeenCalled()

    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('host') })

    expect(face.hooks.tuituiCard.getSnapshot()).toMatchObject({ dirty: false, host: { text: 'im.example.com' } })
  })

  it('discards staged edits without writing', () => {
    const host = stubSettingsScope<TuituiSettings>()
    const controller = new TuituiCardController(host.scope, tuituiApi(() => false).mirror)
    host.publish({ status: 'ready', writable: true, value: { appId: 'test-app' }, user: {} })
    const face = controller.inject()

    face.edit('appId', 'new-app')
    face.discard()

    expect(face.hooks.tuituiCard.getSnapshot().appId.text).toBe('test-app')
    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses to save an invalid number and keeps the draft', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    const controller = new TuituiCardController(host.scope, tuituiApi(() => false).mirror)
    host.publish({ status: 'ready', writable: true, value: { treePageSize: 5 }, user: {} })
    const face = controller.inject()

    face.edit('treePageSize', 'soon')
    expect(face.hooks.tuituiCard.getSnapshot().treePageSize).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(face.hooks.tuituiCard.getSnapshot().invalid).toBe(true)

    face.save()
    await Promise.resolve()

    expect(host.set).not.toHaveBeenCalled()
    expect(face.hooks.tuituiCard.getSnapshot().treePageSize.text).toBe('soon')
  })

  it('parses every boolean and list draft branch', () => {
    const host = stubSettingsScope<TuituiSettings>()
    const controller = new TuituiCardController(host.scope, tuituiApi(() => false).mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.tuituiCard.getSnapshot()

    face.edit('requireMention', 'false')
    expect(state().requireMention).toEqual({ text: 'false', overridden: true, invalid: false })

    face.edit('requireMention', '')
    expect(state().requireMention).toEqual({ text: '', overridden: false, invalid: false })

    face.edit('requireMention', 'nope')
    expect(state().requireMention).toEqual({ text: 'nope', overridden: false, invalid: true })
    expect(state().invalid).toBe(true)

    face.edit('allowFrom', '')
    expect(state().allowFrom).toEqual({ text: '', overridden: false, invalid: false })
  })

  it('reports the secret configure state from the describe mirror', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    let secretSet = false
    const api = tuituiApi(() => secretSet)
    const controller = new TuituiCardController(host.scope, api.mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const state = () => controller.inject().hooks.tuituiCard.getSnapshot()

    expect(state().appSecretConfigured).toBe(false)
    await api.mirror.ensure()
    expect(state().appSecretConfigured).toBe(false)

    secretSet = true
    await api.mirror.load()
    await vi.waitFor(() => { expect(state().appSecretConfigured).toBe(true) })
  })

  it('writes the staged secret through a settings path-op', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    let secretSet = false
    const api = tuituiApi(() => secretSet)
    const mutate = vi.fn(async () => {
      secretSet = true
      await api.mirror.load()
    })
    const controller = new TuituiCardController({ ...host.scope, mutate }, api.mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await api.mirror.ensure()
    const face = controller.inject()
    const state = () => face.hooks.tuituiCard.getSnapshot()

    face.edit('appSecret', ' s3cret ')
    expect(state().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['appSecret'], value: 's3cret' }])
    })
    await vi.waitFor(() => { expect(state().appSecretConfigured).toBe(true) })

    expect(state()).toMatchObject({ dirty: false, failed: false })
  })

  it('never writes a blank secret, leaving the stored one in place', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    const controller = new TuituiCardController(host.scope, tuituiApi(() => true).mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('appSecret', '   ')
    expect(face.hooks.tuituiCard.getSnapshot().dirty).toBe(false)

    face.save()
    await Promise.resolve()

    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('stops following the mirror once disposed', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    let secretSet = false
    const api = tuituiApi(() => secretSet)
    const mutate = vi.fn(async () => {
      secretSet = true
      await api.mirror.load()
    })
    const controller = new TuituiCardController({ ...host.scope, mutate }, api.mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.tuituiCard.getSnapshot()

    face.edit('appSecret', 's3cret')
    face.save()
    await vi.waitFor(() => { expect(state().appSecretConfigured).toBe(true) })

    controller.dispose()
    secretSet = false
    await api.mirror.load()

    // The disposed card keeps the last read rather than following the mirror.
    expect(state().appSecretConfigured).toBe(true)
  })

  it('ignores a secret read that settles after disposal', async () => {
    const host = stubSettingsScope<TuituiSettings>()
    let secretSet = false
    const api = tuituiApi(() => secretSet)
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const mutate = vi.fn(() => gate.then(() => {
      secretSet = true
      return api.mirror.load()
    }))
    const controller = new TuituiCardController({ ...host.scope, mutate }, api.mirror)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.tuituiCard.getSnapshot()

    face.edit('appSecret', 's3cret')
    face.save()
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalled() })

    controller.dispose()
    release()
    await gate

    // The write settled after disposal; the card dropped the mirror answer.
    expect(state().appSecretConfigured).toBe(false)
  })
})

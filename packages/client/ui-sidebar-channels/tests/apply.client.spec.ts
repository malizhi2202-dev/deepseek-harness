/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, Remote, and settings faces are recorders, because what matters
 * here is what was handed to them — one body seat under the type's id with its
 * store and face — and that every registration is gone after dispose, which is
 * what makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { CHANNELS_ID, CHANNELS_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { ChannelsBody } from '../src/client/ChannelsBody.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  store: unknown
  inject: unknown
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const channels = { status: vi.fn(), probe: vi.fn(), enable: vi.fn(), disable: vi.fn() }
  const settings = { describe: vi.fn() }
  const remote = { channels, settings, $stream: vi.fn() }
  const settingsScope = {
    describe: vi.fn(() => ({ getSnapshot: () => ({ status: 'idle', view: undefined, error: null }) })),
    bind: vi.fn(() => ({ getSnapshot: () => ({ revision: undefined }), mutate: vi.fn() })),
  }
  const settingsSchema = { rehydrate: vi.fn(() => ({ type: 'object', dict: {} })) }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.channels', channels as never)
  ctx.provide('remote.settings', settings as never)
  ctx.provide('settingsScope', settingsScope as never)
  ctx.provide('settingsSchema', settingsSchema as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber }
}

describe('ui-sidebar-channels apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body seat under the type\'s id with a store and a face', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(CHANNELS_KIND)
    expect(definition?.id).toBe(CHANNELS_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('channels')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description()])).toEqual([
      [60, 'guide.title', 'guide.description'],
    ])
    expect(dictionaries.get('sidebarChannels')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', CHANNELS_ID, 'sidebarChannels', ChannelsBody],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(CHANNELS_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})

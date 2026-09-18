/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and session faces are recorders, because what matters here is
 * what was handed over — one body seat under the type's id, the two
 * dictionaries, and the three catalog actions — and that every registration is
 * gone after dispose, which is what makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { AGENTS_ID, AGENTS_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { AgentsBody, type AgentsInjected } from '../src/client/AgentsBody.tsx'

interface Recorded {
  name: string
  key: string
  locale: string
  inject: () => AgentsInjected
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
  const sessions = {
    openSubagent: vi.fn(),
    setSubagentCatalogOpen: vi.fn(),
    refreshSubagents: vi.fn(async () => {}),
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, sessions, fiber }
}

describe('ui-sidebar-agents apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the agents type, its dictionaries, and the body seat under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(AGENTS_KIND)
    expect(definition?.id).toBe(AGENTS_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.visibility).toBe('default-on')
    expect(definition?.order).toBe(20)
    expect(definition?.patterns).toBeUndefined()
    expect(definition?.icon).toBeDefined()
    expect(definition?.title('sidebar://agents')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description()]))
      .toEqual([[30, 'guide.title', 'guide.description']])
    expect(dictionaries.get('sidebarAgents')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', AGENTS_ID, 'sidebarAgents', AgentsBody],
    ])
  })

  it('routes every catalog action to the sessions service', async () => {
    const { registered, sessions } = await boot()
    const actions = registered[0]!.inject()
    actions.openChild({ parentSessionId: 'p' as SessionId, childSessionId: 'c' as SessionId, mode: 'continuable' })
    actions.observeCatalog('p' as SessionId, true)
    actions.refreshCatalog('p' as SessionId)
    expect(sessions.openSubagent).toHaveBeenCalledWith({
      parentSessionId: 'p', childSessionId: 'c', mode: 'continuable',
    })
    expect(sessions.setSubagentCatalogOpen).toHaveBeenCalledWith('p', true)
    expect(sessions.refreshSubagents).toHaveBeenCalledWith('p')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(AGENTS_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.has('sidebarAgents')).toBe(false)
  })
})

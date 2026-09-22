import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SourceRegistry from '@deepseek-ai/dsh-resource'
import type { SourceKind } from '@deepseek-ai/dsh-resource'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as plugin from '@deepseek-ai/dsh-resource-mediawiki'
import { DEFAULT_MAX_LIST_ITEMS, DEFAULT_MAX_READ_BYTES, MEDIAWIKI_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-resource-mediawiki'

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Mount the source registry on a fresh context. */
async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SourceRegistry)
  return ctx
}

describe('resource-mediawiki plugin', () => {
  it('fills every config default', () => {
    expect(plugin.Config({})).toEqual({
      maxReadBytes: DEFAULT_MAX_READ_BYTES,
      maxListItems: DEFAULT_MAX_LIST_ITEMS,
      instances: {},
    })
  })

  it('registers the kind and reads the composition entry when no settings service is mounted', async () => {
    const ctx = await mountRegistry()
    const fiber = ctx.plugin(plugin, { instances: { wiki: { baseUrl: 'https://wiki.example/w/api.php' } } })
    await fiber
    const provider = ctx.sources.get('mediawiki')
    expect(provider?.kind).toBe('mediawiki')
    await expect(provider?.instances()).resolves.toEqual([{
      ref: { kind: 'mediawiki', id: 'wiki' },
      configured: true,
      baseUrl: 'https://wiki.example/w/api.php',
    }])
    await ctx.fiber.dispose()
  })

  it('serves the stored settings section to the next operation', async () => {
    const ctx = await mountRegistry()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const fiber = ctx.plugin(plugin, { maxReadBytes: 111, instances: {} })
    await fiber
    expect(ctx.sources.get('mediawiki')?.capabilities.maxReadBytes).toBe(111)

    await ctx.settings.update(MEDIAWIKI_SETTINGS_NAMESPACE, {
      maxReadBytes: 222,
      instances: { wiki: { baseUrl: 'https://wiki.example/w/api.php' } },
    })
    const provider = ctx.sources.get('mediawiki')
    expect(provider?.capabilities.maxReadBytes).toBe(222)
    await expect(provider?.instances()).resolves.toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('announces a committed settings change so consumers re-derive their tools', async () => {
    const ctx = await mountRegistry()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const seen: SourceKind[] = []
    ctx.on('sources/changed', (kind) => { seen.push(kind) })
    const fiber = ctx.plugin(plugin, { instances: {} })
    await fiber
    seen.length = 0

    await ctx.settings.update(MEDIAWIKI_SETTINGS_NAMESPACE, { maxReadBytes: 999 })
    expect(seen).toEqual(['mediawiki'])
    await ctx.fiber.dispose()
  })

  it('resolves a bot password through the credentials service, per operation', async () => {
    const ctx = await mountRegistry()
    const asked: string[] = []
    ctx.provide('credentials', {
      resolve: (ref: string) => {
        asked.push(ref)
        return Promise.resolve({ value: 'secret', source: 'test' })
      },
    } as unknown as CredentialProvider)
    const fiber = ctx.plugin(plugin, {
      instances: { wiki: { baseUrl: 'https://wiki.example/w/api.php', username: 'Bot@reader', passwordRef: 'wiki_bot' } },
    })
    await fiber
    const instances = await ctx.sources.get('mediawiki')?.instances()
    expect(instances?.[0]?.configured).toBe(true)
    expect(asked).toEqual(['wiki_bot'])
    await ctx.fiber.dispose()
  })

  it('unregisters the kind and releases its namespace when the plugin unloads', async () => {
    const ctx = await mountRegistry()
    const settingsFiber: Fiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const fiber = ctx.plugin(plugin, { instances: {} })
    await fiber
    expect(ctx.settings.describe().map(row => String(row.ns))).toContain(MEDIAWIKI_SETTINGS_NAMESPACE)

    await fiber.dispose()

    expect(ctx.sources.get('mediawiki')).toBeUndefined()
    expect(ctx.settings.describe().map(row => String(row.ns))).not.toContain(MEDIAWIKI_SETTINGS_NAMESPACE)
    await ctx.fiber.dispose()
  })
})

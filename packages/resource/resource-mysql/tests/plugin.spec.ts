import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import SourceRegistry from '@deepseek-ai/dsh-resource'
import type { SourceKind } from '@deepseek-ai/dsh-resource'
import * as plugin from '@deepseek-ai/dsh-resource-mysql'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_ROWS,
  DEFAULT_MYSQL_HOST,
  DEFAULT_MYSQL_PORT,
  MYSQL_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-resource-mysql'

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

const INSTANCE = { user: 'reader', passwordRef: 'mysql_password', databases: ['shop'], tables: ['shop.orders'] }

describe('resource-mysql plugin', () => {
  it('fills every config default', () => {
    expect(plugin.Config({})).toEqual({
      maxReadBytes: DEFAULT_MAX_READ_BYTES,
      maxListItems: DEFAULT_MAX_LIST_ITEMS,
      instances: {},
    })
    expect(plugin.Config({ instances: { main: INSTANCE } }).instances?.['main']).toEqual({
      host: DEFAULT_MYSQL_HOST,
      port: DEFAULT_MYSQL_PORT,
      user: 'reader',
      passwordRef: 'mysql_password',
      databases: ['shop'],
      tables: ['shop.orders'],
      maxRows: DEFAULT_MAX_ROWS,
    })
  })

  it('registers the kind and reads the composition entry when no settings service is mounted', async () => {
    const ctx = await mountRegistry()
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'secret', source: 'test' }),
    } as unknown as CredentialProvider)
    const fiber = ctx.plugin(plugin, { instances: { main: INSTANCE } })
    await fiber
    const provider = ctx.sources.get('mysql')
    expect(provider?.kind).toBe('mysql')
    await expect(provider?.instances()).resolves.toEqual([{
      ref: { kind: 'mysql', id: 'main' },
      configured: true,
      host: DEFAULT_MYSQL_HOST,
      port: DEFAULT_MYSQL_PORT,
      user: 'reader',
      passwordRef: 'mysql_password',
      databases: ['shop'],
      tables: ['shop.orders'],
      maxRows: DEFAULT_MAX_ROWS,
    }])
    await ctx.fiber.dispose()
  })

  it('serves the stored settings section to the next operation and announces the change', async () => {
    const ctx = await mountRegistry()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const seen: SourceKind[] = []
    ctx.on('sources/changed', (kind) => { seen.push(kind) })
    const fiber = ctx.plugin(plugin, { maxReadBytes: 111, instances: {} })
    await fiber
    expect(ctx.sources.get('mysql')?.capabilities.maxReadBytes).toBe(111)
    seen.length = 0

    await ctx.settings.update(MYSQL_SETTINGS_NAMESPACE, { maxReadBytes: 222, instances: { main: INSTANCE } })

    expect(seen).toEqual(['mysql'])
    expect(ctx.sources.get('mysql')?.capabilities.maxReadBytes).toBe(222)
    await expect(ctx.sources.get('mysql')?.instances()).resolves.toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('reports a source whose password is not set as unconfigured', async () => {
    const ctx = await mountRegistry()
    ctx.provide('credentials', {
      resolve: () => Promise.resolve(undefined),
    } as unknown as CredentialProvider)
    const fiber = ctx.plugin(plugin, { instances: { main: INSTANCE } })
    await fiber
    expect((await ctx.sources.get('mysql')?.instances())?.[0]?.configured).toBe(false)
    await ctx.fiber.dispose()
  })

  it('unregisters the kind and releases its namespace when the plugin unloads', async () => {
    const ctx = await mountRegistry()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const fiber = ctx.plugin(plugin, { instances: {} })
    await fiber
    expect(ctx.settings.describe().map(row => String(row.ns))).toContain(MYSQL_SETTINGS_NAMESPACE)

    await fiber.dispose()

    expect(ctx.sources.get('mysql')).toBeUndefined()
    expect(ctx.settings.describe().map(row => String(row.ns))).not.toContain(MYSQL_SETTINGS_NAMESPACE)
    await ctx.fiber.dispose()
  })
})

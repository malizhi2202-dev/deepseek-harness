import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import SourceRegistry from '@deepseek-ai/dsh-resource'
import type { SourceKind } from '@deepseek-ai/dsh-resource'
import * as plugin from '@deepseek-ai/dsh-resource-github'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  GITHUB_DEFAULT_BASE_URL,
  GITHUB_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-resource-github'

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

describe('resource-github plugin', () => {
  it('fills every config default', () => {
    expect(plugin.Config({})).toEqual({
      maxReadBytes: DEFAULT_MAX_READ_BYTES,
      maxListItems: DEFAULT_MAX_LIST_ITEMS,
      instances: {},
    })
  })

  it('registers the kind and reads the composition entry when no settings service is mounted', async () => {
    const ctx = await mountRegistry()
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'token', source: 'test' }),
    } as unknown as CredentialProvider)
    const fiber = ctx.plugin(plugin, {
      instances: { work: { tokenRef: 'github_pat', repositories: ['octo/repo'] } },
    })
    await fiber
    const provider = ctx.sources.get('github')
    expect(provider?.kind).toBe('github')
    await expect(provider?.instances()).resolves.toEqual([{
      ref: { kind: 'github', id: 'work' },
      configured: true,
      tokenRef: 'github_pat',
      baseUrl: GITHUB_DEFAULT_BASE_URL,
      repositories: ['octo/repo'],
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
    expect(ctx.sources.get('github')?.capabilities.maxReadBytes).toBe(111)
    seen.length = 0

    await ctx.settings.update(GITHUB_SETTINGS_NAMESPACE, {
      maxReadBytes: 222,
      instances: { work: { repositories: ['octo/repo'] } },
    })

    expect(seen).toEqual(['github'])
    expect(ctx.sources.get('github')?.capabilities.maxReadBytes).toBe(222)
    await expect(ctx.sources.get('github')?.instances()).resolves.toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('resolves a token through the credentials service and reports an unset one as unconfigured', async () => {
    const ctx = await mountRegistry()
    ctx.provide('credentials', {
      resolve: () => Promise.resolve(undefined),
    } as unknown as CredentialProvider)
    const fiber = ctx.plugin(plugin, {
      instances: { work: { tokenRef: 'github_pat', repositories: ['octo/repo'] } },
    })
    await fiber
    const instances = await ctx.sources.get('github')?.instances()
    expect(instances?.[0]?.configured).toBe(false)
    await ctx.fiber.dispose()
  })

  it('unregisters the kind and releases its namespace when the plugin unloads', async () => {
    const ctx = await mountRegistry()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const fiber = ctx.plugin(plugin, { instances: {} })
    await fiber
    expect(ctx.settings.describe().map(row => String(row.ns))).toContain(GITHUB_SETTINGS_NAMESPACE)

    await fiber.dispose()

    expect(ctx.sources.get('github')).toBeUndefined()
    expect(ctx.settings.describe().map(row => String(row.ns))).not.toContain(GITHUB_SETTINGS_NAMESPACE)
    await ctx.fiber.dispose()
  })
})

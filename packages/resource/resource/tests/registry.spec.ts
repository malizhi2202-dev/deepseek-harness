import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SourceRegistry, {
  SOURCE_DENIED,
  SOURCE_DUPLICATE_PROVIDER,
  SOURCE_NOT_FOUND,
  SOURCE_PROVIDER_ERROR,
  SOURCE_UNCONFIGURED,
  SourceError,
} from '@deepseek-ai/dsh-resource'
import type { SourceCapabilities, SourceProvider, SourceKind } from '@deepseek-ai/dsh-resource'

const CAPABILITIES: SourceCapabilities = {
  search: true,
  browse: false,
  read: false,
  maxReadBytes: 1_000,
  maxListItems: 10,
  description: 'a test kind',
}

/** A minimal provider whose operations all answer nothing. */
function makeProvider(kind: SourceKind): SourceProvider {
  return {
    kind,
    capabilities: CAPABILITIES,
    instances: () => Promise.resolve([]),
    check: () => Promise.resolve({ label: kind }),
    search: () => Promise.resolve([]),
  }
}

/** Mount the registry on a fresh root context. */
async function mountRegistry(): Promise<{ ctx: Context; sources: SourceRegistry }> {
  const ctx = new Context()
  await ctx.plugin(SourceRegistry)
  return { ctx, sources: ctx.sources }
}

describe('SourceError', () => {
  it('carries its code and class name', () => {
    const error = new SourceError('nope', SOURCE_NOT_FOUND)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(SOURCE_NOT_FOUND)
    expect(error.name).toBe('SourceError')
    expect(error.message).toBe('nope')
    expect(SOURCE_UNCONFIGURED).toBe('SOURCE_UNCONFIGURED')
    expect(SOURCE_PROVIDER_ERROR).toBe('SOURCE_PROVIDER_ERROR')
    expect(SOURCE_DUPLICATE_PROVIDER).toBe('SOURCE_DUPLICATE_PROVIDER')
    expect(SOURCE_DENIED).toBe('SOURCE_DENIED')
  })
})

describe('SourceRegistry', () => {
  it('registers a provider, lists it, and looks it up by kind', async () => {
    const { sources } = await mountRegistry()
    const provider = makeProvider('mediawiki')
    const dispose = sources.register(provider)
    expect(sources.list()).toEqual([provider])
    expect(sources.get('mediawiki')).toBe(provider)
    expect(sources.get('github')).toBeUndefined()
    dispose()
    expect(sources.list()).toEqual([])
  })

  it('lists providers in registration order', async () => {
    const { sources } = await mountRegistry()
    const first = makeProvider('mediawiki')
    const second = makeProvider('github')
    sources.register(first)
    sources.register(second)
    expect(sources.list()).toEqual([first, second])
  })

  it('rejects a second provider for the same kind', async () => {
    const { sources } = await mountRegistry()
    sources.register(makeProvider('mysql'))
    expect(() => sources.register(makeProvider('mysql')))
      .toThrow(expect.objectContaining({ code: SOURCE_DUPLICATE_PROVIDER }))
  })

  it('rejects a kind that is not a usable tool-name and namespace segment', async () => {
    const { sources } = await mountRegistry()
    for (const kind of ['MediaWiki', '1github', 'two words', 'kebab-Case', '']) {
      expect(() => sources.register(makeProvider(kind)))
        .toThrow(expect.objectContaining({ code: SOURCE_PROVIDER_ERROR }))
    }
    expect(sources.list()).toEqual([])
    // The accepted grammar: lower-case, starting with a letter.
    expect(() => sources.register(makeProvider('kebab-case_1'))).not.toThrow()
  })

  it('emits sources/changed on registration and on disposal', async () => {
    const { ctx, sources } = await mountRegistry()
    const seen: SourceKind[] = []
    ctx.on('sources/changed', (kind) => { seen.push(kind) })
    const dispose = sources.register(makeProvider('github'))
    expect(seen).toEqual(['github'])
    dispose()
    expect(seen).toEqual(['github', 'github'])
    expect(sources.get('github')).toBeUndefined()
  })

  it('removes the provider when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, sources } = await mountRegistry()
    const provider = makeProvider('mediawiki')
    const fiber = await ctx.plugin({
      inject: ['sources'],
      apply: (inner: Context) => {
        inner.sources.register(provider)
      },
    })
    expect(sources.get('mediawiki')).toBe(provider)
    await fiber.dispose()
    expect(sources.get('mediawiki')).toBeUndefined()
    expect(sources.list()).toEqual([])
  })

  it('tolerates a second disposal of the same registration', async () => {
    const { sources } = await mountRegistry()
    const dispose = sources.register(makeProvider('mysql'))
    dispose()
    expect(() => { dispose() }).not.toThrow()
    expect(sources.list()).toEqual([])
  })
})

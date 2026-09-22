/**
 * Behavior of the model-facing source tools: argument validation, the rendered
 * bound, presentation, and the conditional registration each provider warrants.
 * Every tool call goes through the real `ctx.tools` registry.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionToken, ToolResult } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import SourceRegistry, { SOURCE_TRUNCATION_MARKER } from '@deepseek-ai/dsh-resource'
import type {
  SourceCapabilities,
  SourceConfig,
  SourceDocument,
  SourceHit,
  SourceItemRef,
  SourceProvider,
} from '@deepseek-ai/dsh-resource'
import * as plugin from '@deepseek-ai/dsh-tool-resource'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TOOL_TIMEOUT_MS,
  buildSourceTools,
  formatListOutput,
  formatReadOutput,
  formatSearchOutput,
  parseSourceListArgs,
  parseSourceRef,
  parseSourceSearchArgs,
  resolveSourceConfig,
  sourceToolName,
} from '@deepseek-ai/dsh-tool-resource'

const testToolSignal = new AbortController().signal

/** One configured instance of the `stub` kind. */
function config(id: string, configured = true): SourceConfig {
  return { ref: { kind: 'stub', id }, configured }
}

/** A hit on the `stub` kind. */
function hit(name: string, summary?: string): SourceHit {
  return {
    ref: brandString<SourceItemRef>(`stub:${name}`),
    title: name,
    ...summary === undefined ? {} : { summary },
  }
}

/** A document from the `stub` kind. */
function document(name: string, content: string, truncated = false): SourceDocument {
  return { ref: brandString<SourceItemRef>(`stub:${name}`), title: name, content, truncated }
}

/** What one stub provider answers with. An omitted method is absent from the provider. */
interface StubBehaviour {
  readonly capabilities?: Partial<SourceCapabilities>
  readonly instances?: () => Promise<readonly SourceConfig[]>
  readonly search?: (config: SourceConfig, query: string, limit: number, signal: AbortSignal) => Promise<SourceHit[]>
  readonly read?: (config: SourceConfig, ref: SourceItemRef, signal: AbortSignal) => Promise<SourceDocument>
  readonly list?: (config: SourceConfig, ref: SourceItemRef | undefined, signal: AbortSignal) => Promise<SourceHit[]>
}

/** A provider whose only real behavior is what the test gives it. */
function stubProvider(behaviour: StubBehaviour = {}, kind = 'stub'): SourceProvider {
  return {
    kind,
    capabilities: {
      search: true,
      browse: true,
      read: true,
      maxReadBytes: 4_000,
      maxListItems: 10,
      description: 'The stub kind answers a fixed set of items.',
      ...behaviour.capabilities,
    },
    instances: behaviour.instances ?? (() => Promise.resolve([config('alpha')])),
    check: () => Promise.resolve({ label: `${kind} stub` }),
    search: behaviour.search ?? (() => Promise.resolve([])),
    ...behaviour.read === undefined ? {} : { read: behaviour.read },
    ...behaviour.list === undefined ? {} : { list: behaviour.list },
  }
}

/** One mounted composition and its tool-call helper. */
interface Mount {
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly call: (name: string, args: unknown) => Promise<ToolExecutionResult>
}

/** Mount the real registries, the stub providers, and the tool suite. */
async function mount(options: { providers?: readonly SourceProvider[]; config?: plugin.Config } = {}): Promise<Mount> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SourceRegistry)
  for (const provider of options.providers ?? []) ctx.sources.register(provider)
  const fiber = await ctx.plugin(plugin, options.config ?? {})
  let counter = 0
  return {
    ctx,
    fiber,
    call: (name, args) => ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId(`call-${String(++counter)}`),
      name,
      arguments: args,
    }),
  }
}

/** The text of one result's content blocks. */
function textOf(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** A completed result, for the pure presenters. */
function toolResult(isError = false): ToolResult {
  return { content: [{ type: 'text', text: 'body' }], isError }
}

describe('sourceToolName', () => {
  it('names one tool per kind and operation', () => {
    expect(sourceToolName('mediawiki', 'search')).toBe('source_mediawiki_search')
    expect(sourceToolName('github', 'read')).toBe('source_github_read')
    expect(sourceToolName('mysql', 'list')).toBe('source_mysql_list')
  })
})

describe('parseSourceRef', () => {
  it('trims and brands a handle', () => {
    expect(parseSourceRef('  octo/repo:a.ts  ')).toBe('octo/repo:a.ts')
  })

  it('refuses a blank or multi-line handle', () => {
    for (const ref of ['', '   ', '\n', 'a\u0000b', 'a\nb', 'a\tb', 'a\u007fb']) {
      expect(() => parseSourceRef(ref), JSON.stringify(ref)).toThrow()
    }
  })
})

describe('parseSourceSearchArgs', () => {
  it('trims the source and query and defaults the limit', () => {
    expect(parseSourceSearchArgs({ source: ' alpha ', query: ' needle ' }, 20)).toEqual({ source: 'alpha', query: 'needle', limit: 20 })
    expect(parseSourceSearchArgs({ source: 'alpha', query: 'q', limit: 3 }, 20).limit).toBe(3)
  })

  it('refuses a blank source, a blank query, and an out-of-range limit', () => {
    expect(() => parseSourceSearchArgs({ source: ' ', query: 'q' }, 20)).toThrow('source must name a configured source')
    expect(() => parseSourceSearchArgs({ source: 'alpha', query: '  ' }, 20)).toThrow('query must be a non-empty string')
    for (const limit of [0, -1, 21, 1.5, Number.NaN]) {
      expect(() => parseSourceSearchArgs({ source: 'alpha', query: 'q', limit }, 20), String(limit))
        .toThrow('limit must be an integer between 1 and 20')
    }
  })
})

describe('parseSourceListArgs', () => {
  it('accepts a container handle or its absence', () => {
    expect(parseSourceListArgs({ source: ' alpha ' })).toEqual({ source: 'alpha' })
    expect(parseSourceListArgs({ source: 'alpha', ref: 'stub:x' })).toEqual({ source: 'alpha', ref: 'stub:x' })
  })

  it('refuses a blank source and a blank handle', () => {
    expect(() => parseSourceListArgs({ source: '' })).toThrow('source must name a configured source')
    expect(() => parseSourceListArgs({ source: 'alpha', ref: ' ' })).toThrow('ref must be a non-empty source handle')
  })
})

describe('output formatting', () => {
  it('renders hits with their handle and optional summary', () => {
    expect(formatSearchOutput('alpha', 'needle', [hit('one'), hit('two', 'a line')], 20)).toBe(
      'Search results from alpha for "needle":\n\n- one [stub:one]\n- two [stub:two] — a line',
    )
  })

  it('renders an empty summary as no summary at all', () => {
    expect(formatSearchOutput('alpha', 'needle', [hit('one', '')], 20)).toContain('- one [stub:one]')
    expect(formatSearchOutput('alpha', 'needle', [hit('one', '')], 20)).not.toContain('—')
  })

  it('reports no results, and notes a search that returned its whole limit', () => {
    expect(formatSearchOutput('alpha', 'needle', [], 20)).toContain('No results found.')
    expect(formatSearchOutput('alpha', 'needle', [hit('one')], 1)).toContain('Showing the first 1 results.')
    expect(formatSearchOutput('alpha', 'needle', [hit('one')], 2)).not.toContain('Showing the first')
  })

  it('names the container a listing came from, or the source when it has none', () => {
    expect(formatListOutput('alpha', undefined, [hit('one')], 10)).toBe('Entries of alpha:\n\n- one [stub:one]')
    expect(formatListOutput('alpha', brandString<SourceItemRef>('stub:dir'), [hit('one')], 10))
      .toBe('Entries of stub:dir in alpha:\n\n- one [stub:one]')
    expect(formatListOutput('alpha', undefined, [], 10)).toContain('No entries found.')
    expect(formatListOutput('alpha', undefined, [hit('one')], 1)).toContain('Showing the first 1 results.')
  })

  it('renders a document under its title and handle', () => {
    expect(formatReadOutput('alpha', document('one', 'body'))).toBe('one [stub:one] from alpha:\n\nbody')
  })
})

describe('resolveSourceConfig', () => {
  it('returns the configured instance the model named', async () => {
    const { ctx } = await mount({ providers: [stubProvider({ instances: () => Promise.resolve([config('alpha'), config('beta')]) })] })
    await expect(resolveSourceConfig(ctx, 'stub', 'beta')).resolves.toMatchObject({ ref: { id: 'beta' } })
  })

  it('refuses an unknown kind, an unknown instance, and an unconfigured one', async () => {
    const { ctx } = await mount({
      providers: [stubProvider({ instances: () => Promise.resolve([config('alpha'), config('beta', false)]) })],
    })
    await expect(resolveSourceConfig(ctx, 'nothing', 'alpha')).rejects.toThrow('no "nothing" source is registered')
    await expect(resolveSourceConfig(ctx, 'stub', 'beta'))
      .rejects.toThrow('"beta" is not a configured "stub" source; configured: alpha')
    await expect(resolveSourceConfig(ctx, 'stub', 'gamma'))
      .rejects.toThrow('"gamma" is not a configured "stub" source; configured: alpha')
  })

  it('reports that nothing is configured when no instance is', async () => {
    const { ctx } = await mount({ providers: [stubProvider({ instances: () => Promise.resolve([config('alpha', false)]) })] })
    await expect(resolveSourceConfig(ctx, 'stub', 'alpha'))
      .rejects.toThrow('"alpha" is not a configured "stub" source; configured: none')
  })
})

describe('search tool', () => {
  it('searches the named instance and renders its hits', async () => {
    const seen: unknown[] = []
    const { ctx, call, fiber } = await mount({
      providers: [stubProvider({
        search: (received, query, limit, signal) => {
          seen.push([received.ref.id, query, limit, signal === testToolSignal])
          return Promise.resolve([hit('one'), hit('two', 'a line')])
        },
      })],
    })
    const out = await call('source_stub_search', { source: 'alpha', query: 'needle', limit: 5 })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      source: 'alpha',
      entries: [
        { ref: 'stub:one', title: 'one' },
        { ref: 'stub:two', title: 'two', summary: 'a line' },
      ],
      truncated: false,
    })
    expect(seen).toEqual([['alpha', 'needle', 5, true]])
    expect(textOf(out)).toBe('Search results from alpha for "needle":\n\n- one [stub:one]\n- two [stub:two] — a line')
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('reports truncation when the search returned its whole limit', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({ search: () => Promise.resolve([hit('one'), hit('two')]) })],
    })
    const out = await call('source_stub_search', { source: 'alpha', query: 'needle', limit: 2 })
    expect(out.value).toMatchObject({ truncated: true })
    expect(textOf(out)).toContain('Showing the first 2 results.')
    await fiber.dispose()
  })

  it('fails a call the model got wrong', async () => {
    const { call, fiber } = await mount({ providers: [stubProvider()] })
    for (const args of [
      { source: '  ', query: 'needle' },
      { source: 'alpha', query: ' ' },
      { source: 'alpha', query: 'needle', limit: 0 },
      { source: 'alpha', query: 'needle', limit: 999 },
      { source: 'gamma', query: 'needle' },
      { source: 'alpha' },
    ]) {
      const out = await call('source_stub_search', args)
      expect(out.isError, JSON.stringify(args)).toBe(true)
    }
    await fiber.dispose()
  })

  it('bounds the rendered text at the kind\'s read cap', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({
        capabilities: { maxReadBytes: 200 },
        search: () => Promise.resolve(Array.from({ length: 20 }, (_, index) => hit(`item-${String(index)}`))),
      })],
    })
    const out = await call('source_stub_search', { source: 'alpha', query: 'needle', limit: 20 })
    expect(new TextEncoder().encode(textOf(out)).length).toBeLessThanOrEqual(200)
    expect(textOf(out)).toContain(SOURCE_TRUNCATION_MARKER)
    await fiber.dispose()
  })
})

describe('read tool', () => {
  it('reads the named item and renders it under its header', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({ read: () => Promise.resolve(document('one', 'the body')) })],
    })
    const out = await call('source_stub_read', { source: 'alpha', ref: 'stub:one' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({ source: 'alpha', ref: 'stub:one', title: 'one', content: 'the body', truncated: false })
    expect(textOf(out)).toBe('one [stub:one] from alpha:\n\nthe body')
    await fiber.dispose()
  })

  it('carries the provider\'s truncation through to the model', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({ read: () => Promise.resolve(document('one', 'cut', true)) })],
    })
    const out = await call('source_stub_read', { source: 'alpha', ref: 'stub:one' })
    expect(out.value).toMatchObject({ truncated: true })
    await fiber.dispose()
  })

  it('fails a blank handle, a handle with a control character, and an unknown instance', async () => {
    const { call, fiber } = await mount({ providers: [stubProvider({ read: () => Promise.resolve(document('one', 'b')) })] })
    for (const args of [
      { source: 'alpha', ref: '   ' },
      { source: 'alpha', ref: 'a\u0000b' },
      { source: 'alpha' },
      { source: ' ', ref: 'stub:one' },
      { source: 'gamma', ref: 'stub:one' },
    ]) {
      expect((await call('source_stub_read', args)).isError, JSON.stringify(args)).toBe(true)
    }
    await fiber.dispose()
  })

  it('bounds the rendered document, header included', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({
        capabilities: { maxReadBytes: 200 },
        read: () => Promise.resolve(document('one', 'x'.repeat(2_000))),
      })],
    })
    const out = await call('source_stub_read', { source: 'alpha', ref: 'stub:one' })
    expect(new TextEncoder().encode(textOf(out)).length).toBeLessThanOrEqual(200)
    expect(textOf(out)).toContain(SOURCE_TRUNCATION_MARKER)
    await fiber.dispose()
  })
})

describe('list tool', () => {
  it('lists the source roots when no container was named', async () => {
    const { call, fiber } = await mount({
      providers: [stubProvider({ list: (_config, ref) => Promise.resolve(ref === undefined ? [hit('one')] : []) })],
    })
    const out = await call('source_stub_list', { source: 'alpha' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({ source: 'alpha', entries: [{ ref: 'stub:one', title: 'one' }], truncated: false })
    expect(textOf(out)).toBe('Entries of alpha:\n\n- one [stub:one]')
    await fiber.dispose()
  })

  it('lists one container and reports the kind\'s item cap', async () => {
    const seen: (string | undefined)[] = []
    const { call, fiber } = await mount({
      providers: [stubProvider({
        capabilities: { maxListItems: 1 },
        list: (_config, ref) => {
          seen.push(ref)
          return Promise.resolve([hit('one', 'a line')])
        },
      })],
    })
    const out = await call('source_stub_list', { source: 'alpha', ref: 'stub:dir' })
    expect(seen).toEqual(['stub:dir'])
    expect(out.value).toEqual({
      source: 'alpha',
      ref: 'stub:dir',
      entries: [{ ref: 'stub:one', title: 'one', summary: 'a line' }],
      truncated: true,
    })
    expect(textOf(out)).toBe('Entries of stub:dir in alpha:\n\n- one [stub:one] — a line\n\nShowing the first 1 results.')
    await fiber.dispose()
  })

  it('fails a blank source, a blank handle, and an unknown instance', async () => {
    const { call, fiber } = await mount({ providers: [stubProvider({ list: () => Promise.resolve([]) })] })
    for (const args of [{ source: ' ' }, { source: 'alpha', ref: ' ' }, { source: 'alpha', ref: 'a\nb' }, { source: 'gamma' }]) {
      expect((await call('source_stub_list', args)).isError, JSON.stringify(args)).toBe(true)
    }
    await fiber.dispose()
  })
})

describe('tool presentation', () => {
  it('presents each call and result from the arguments alone', async () => {
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    ctx.sources.register(stubProvider({ read: () => Promise.resolve(document('one', 'b')), list: () => Promise.resolve([]) }))
    const [search, read, list] = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)
    expect(search && read && list).toBeDefined()

    expect(search?.presentCall?.({ source: 'alpha', query: 'needle' }))
      .toEqual({ card: 'generic', title: 'alpha: needle', kind: 'search', rawInput: 'needle' })
    expect(search?.presentResult?.({ source: 'alpha', query: 'needle' }, toolResult()))
      .toEqual({ card: 'generic', title: 'alpha: needle' })
    expect(search?.presentResult?.({ source: 'alpha', query: 'needle' }, toolResult(true)))
      .toEqual({ card: 'generic', title: 'alpha: needle (failed)' })

    expect(read?.presentCall?.({ source: 'alpha', ref: 'stub:one' }))
      .toEqual({ card: 'generic', title: 'stub:one', kind: 'read', rawInput: 'stub:one' })
    expect(read?.presentResult?.({ source: 'alpha', ref: 'stub:one' }, toolResult()))
      .toEqual({ card: 'generic', title: 'stub:one' })
    expect(read?.presentResult?.({ source: 'alpha', ref: 'stub:one' }, toolResult(true)))
      .toEqual({ card: 'generic', title: 'stub:one (failed)' })

    expect(list?.presentCall?.({ source: 'alpha' })).toEqual({ card: 'generic', title: 'alpha', kind: 'read' })
    expect(list?.presentCall?.({ source: 'alpha', ref: 'stub:dir' }))
      .toEqual({ card: 'generic', title: 'stub:dir', kind: 'read', rawInput: 'stub:dir' })
    expect(list?.presentResult?.({ source: 'alpha' }, toolResult())).toEqual({ card: 'generic', title: 'alpha' })
    expect(list?.presentResult?.({ source: 'alpha' }, toolResult(true))).toEqual({ card: 'generic', title: 'alpha (failed)' })
    expect(list?.presentResult?.({ source: 'alpha', ref: 'stub:dir' }, toolResult(true)))
      .toEqual({ card: 'generic', title: 'stub:dir (failed)' })
    await ctx.fiber.dispose()
  })

  it('treats a source read as safe to overlap', async () => {
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    ctx.sources.register(stubProvider({ read: () => Promise.resolve(document('one', 'b')), list: () => Promise.resolve([]) }))
    const definitions = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)
    const validArgs: Record<string, unknown> = {
      source_stub_search: { source: 'alpha', query: 'q' },
      source_stub_read: { source: 'alpha', ref: 'stub:one' },
      source_stub_list: { source: 'alpha' },
    }
    for (const definition of definitions) {
      expect(definition.isConcurrencySafe?.(validArgs[definition.name]), definition.name).toBe(true)
      expect(definition.timeoutMs).toBe(DEFAULT_TOOL_TIMEOUT_MS)
    }
    await ctx.fiber.dispose()
  })
})

describe('buildSourceTools', () => {
  /** The tool names one provider set warrants. */
  async function names(providers: readonly SourceProvider[]): Promise<string[]> {
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    for (const provider of providers) ctx.sources.register(provider)
    const definitions = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)
    await ctx.fiber.dispose()
    return definitions.map(definition => definition.name)
  }

  it('registers all three operations for a provider that implements all three', async () => {
    await expect(names([stubProvider({ read: () => Promise.resolve(document('a', 'b')), list: () => Promise.resolve([]) })]))
      .resolves.toEqual(['source_stub_search', 'source_stub_read', 'source_stub_list'])
  })

  it('registers no tool for an operation the provider does not implement', async () => {
    await expect(names([stubProvider()])).resolves.toEqual(['source_stub_search'])
    await expect(names([stubProvider({ list: () => Promise.resolve([]) })]))
      .resolves.toEqual(['source_stub_search', 'source_stub_list'])
    await expect(names([stubProvider({ read: () => Promise.resolve(document('a', 'b')) })]))
      .resolves.toEqual(['source_stub_search', 'source_stub_read'])
  })

  it('registers no tool for an operation the kind does not declare', async () => {
    const read = () => Promise.resolve(document('a', 'b'))
    const list = () => Promise.resolve([])
    await expect(names([stubProvider({ capabilities: { search: false }, read, list })]))
      .resolves.toEqual(['source_stub_read', 'source_stub_list'])
    await expect(names([stubProvider({ capabilities: { read: false }, read, list })]))
      .resolves.toEqual(['source_stub_search', 'source_stub_list'])
    await expect(names([stubProvider({ capabilities: { browse: false }, read, list })]))
      .resolves.toEqual(['source_stub_search', 'source_stub_read'])
  })

  it('registers nothing for a kind with no configured instance', async () => {
    await expect(names([stubProvider({
      instances: () => Promise.resolve([config('alpha', false)]),
      read: () => Promise.resolve(document('a', 'b')),
      list: () => Promise.resolve([]),
    })])).resolves.toEqual([])
    await expect(names([stubProvider({ instances: () => Promise.resolve([]) })])).resolves.toEqual([])
  })

  it('keeps provider registration order', async () => {
    await expect(names([
      stubProvider({}, 'second'),
      stubProvider({}, 'first'),
    ])).resolves.toEqual(['source_second_search', 'source_first_search'])
  })
})

describe('applySourceTools', () => {
  it('registers the warranted tools and re-derives them when a kind changes', async () => {
    const { ctx, call, fiber } = await mount({ providers: [stubProvider()] })
    expect((await call('source_stub_search', { source: 'alpha', query: 'q' })).isError).toBe(false)

    ctx.sources.register(stubProvider({ read: () => Promise.resolve(document('one', 'body')) }, 'other'))

    // The change lands asynchronously; the new kind's tools appear without a remount.
    await vi.waitFor(async () => {
      expect((await call('source_other_read', { source: 'alpha', ref: 'stub:one' })).isError).toBe(false)
    })
    await fiber.dispose()
  })

  it('unregisters every tool when the owning fiber is disposed', async () => {
    const { ctx, call, fiber } = await mount({ providers: [stubProvider({ read: () => Promise.resolve(document('a', 'b')) })] })
    expect((await call('source_stub_search', { source: 'alpha', query: 'q' })).isError).toBe(false)

    await fiber.dispose()

    expect((await call('source_stub_search', { source: 'alpha', query: 'q' })).isError).toBe(true)
    expect((await call('source_stub_read', { source: 'alpha', ref: 'stub:a' })).isError).toBe(true)
    await ctx.fiber.dispose()
  })

  it('lets the newest change win when two refreshes overlap', async () => {
    let releaseSecond: (() => void) | undefined
    let calls = 0
    const slow = stubProvider({
      instances: () => {
        calls += 1
        if (calls === 2) {
          return new Promise<readonly SourceConfig[]>((resolve) => {
            releaseSecond = () => { resolve([config('alpha')]) }
          })
        }
        return Promise.resolve([config(calls === 1 ? 'alpha' : 'beta')])
      },
    })
    const { ctx, fiber } = await mount({ providers: [slow] })
    await vi.waitFor(() => {
      expect(ctx.tools.schemas().some(schema => schema.name === 'source_stub_search')).toBe(true)
    })

    // Two changes overlap: the first refresh is still awaiting its instances when
    // the second starts, so the first must not overwrite the newer result.
    ctx.sources.register(stubProvider({}, 'unrelated'))
    ctx.sources.register(stubProvider({}, 'another'))
    await vi.waitFor(() => {
      expect(ctx.tools.schemas().find(schema => schema.name === 'source_stub_search')?.description).toContain('beta')
    })
    releaseSecond?.()

    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names.filter(name => name === 'source_stub_search')).toHaveLength(1)
    expect(ctx.tools.schemas().find(schema => schema.name === 'source_stub_search')?.description).toContain('beta')
    await fiber.dispose()
  })

  it('fails a tool call whose provider stopped implementing the operation', async () => {
    const provider = stubProvider({ read: () => Promise.resolve(document('one', 'body')) })
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    ctx.sources.register(provider)
    const [, read] = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)
    expect(read).toBeDefined()

    // The derivation saw a readable kind; the provider changed before the call.
    delete provider.read

    await expect(read?.execute({ source: 'alpha', ref: 'stub:one' }, {
      callId: ToolCallId('call-direct'),
      name: 'source_stub_read',
      arguments: {},
      signal: testToolSignal,
      token: Symbol('token') as ToolExecutionToken,
      deferContext: () => undefined,
      concludeTurn: () => undefined,
    } as never)).rejects.toThrow('the "stub" source cannot read items')
    await ctx.fiber.dispose()
  })

  it('fails a call whose kind was unregistered while its instances resolved', async () => {
    let calls = 0
    let unregister: () => void = () => undefined
    const provider = stubProvider({
      instances: () => {
        calls += 1
        if (calls > 1) unregister()
        return Promise.resolve([config('alpha')])
      },
    })
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    unregister = ctx.sources.register(provider)
    const [search] = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)

    await expect(search?.execute({ source: 'alpha', query: 'q' }, {
      callId: ToolCallId('call-race'),
      name: 'source_stub_search',
      arguments: {},
      signal: testToolSignal,
      token: Symbol('token') as ToolExecutionToken,
      deferContext: () => undefined,
      concludeTurn: () => undefined,
    } as never)).rejects.toThrow('no "stub" source is registered')
    await ctx.fiber.dispose()
  })

  it('fails a list call whose provider stopped implementing the operation', async () => {
    const provider = stubProvider({ list: () => Promise.resolve([]) })
    const ctx = new Context()
    await ctx.plugin(SourceRegistry)
    ctx.sources.register(provider)
    const definitions = await buildSourceTools(ctx, DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS)
    const list = definitions.find(definition => definition.name === 'source_stub_list') as ToolDefinition
    delete provider.list
    await expect(list.execute({ source: 'alpha' }, {
      callId: ToolCallId('call-direct'),
      name: 'source_stub_list',
      arguments: {},
      signal: testToolSignal,
      token: Symbol('token') as ToolExecutionToken,
      deferContext: () => undefined,
      concludeTurn: () => undefined,
    } as never)).rejects.toThrow('the "stub" source cannot list entries')
    await ctx.fiber.dispose()
  })
})

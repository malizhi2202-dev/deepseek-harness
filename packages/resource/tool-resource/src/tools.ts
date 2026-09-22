/**
 * The model-facing source tools: one `search`, one `read`, and one `list` tool
 * per registered source kind, over `ctx.sources`.
 *
 * This module owns the model-facing schemas, argument validation, the rendered
 * output bound, and presentation, never a provider's protocol. A kind's tools
 * exist only while its provider declares the capability, implements the method,
 * and has at least one configured instance; the set is re-derived whenever a
 * kind changes, so a source that stops being configured stops being addressable
 * instead of failing on every call.
 *
 * @module @deepseek-ai/dsh-tool-resource/tools
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import { boundDocumentContent } from '@deepseek-ai/dsh-resource'
import type {
  SourceCapabilities,
  SourceConfig,
  SourceDocument,
  SourceItemRef,
  SourceKind,
  SourceProvider,
} from '@deepseek-ai/dsh-resource'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Default upper bound on hits one search tool call returns. */
export const DEFAULT_MAX_RESULTS = 20

/** Default cooperative tool-call timeout budget (ms) for the source tools. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

/** The characters a source handle may not carry: a handle is one printable line. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u

/** One kind's tools, as its provider describes them. */
interface KindTools {
  /** The kind's discriminator. */
  readonly kind: SourceKind
  /** The kind's declared capabilities, including the model-facing limits statement. */
  readonly capabilities: SourceCapabilities
  /** The ids of the kind's configured instances, in settings order. */
  readonly ids: readonly string[]
}

/**
 * The tool name for one kind and operation.
 * @param kind - the source kind.
 * @param operation - the operation segment.
 * @returns the model-facing tool name.
 */
export function sourceToolName(kind: SourceKind, operation: 'search' | 'read' | 'list'): string {
  return `source_${kind}_${operation}`
}

/**
 * Validate one model-supplied handle and brand it at this wire boundary.
 * @param ref - the raw handle from the tool arguments.
 * @returns the branded handle.
 * @throws {Error} when the handle is blank or carries a control character.
 */
export function parseSourceRef(ref: string): SourceItemRef {
  const trimmed = ref.trim()
  if (trimmed.length === 0) throw new Error('ref must be a non-empty source handle')
  if (CONTROL_CHARACTER.test(trimmed)) throw new Error('ref must not contain control characters')
  return brandString<SourceItemRef>(trimmed)
}

/**
 * Validate the search arguments' value constraints.
 * @param args - the schema-validated search arguments.
 * @param maxResults - the deployment's upper bound on returned hits.
 * @returns the selected source id, the trimmed query, and the resolved limit.
 * @throws {Error} when the source id or query is blank, or the limit is out of range.
 */
export function parseSourceSearchArgs(
  args: { source: string; query: string; limit?: number },
  maxResults: number,
): { source: string; query: string; limit: number } {
  const source = args.source.trim()
  if (source.length === 0) throw new Error('source must name a configured source')
  const query = args.query.trim()
  if (query.length === 0) throw new Error('query must be a non-empty string')
  const limit = args.limit ?? maxResults
  if (!Number.isInteger(limit) || limit < 1 || limit > maxResults) {
    throw new Error(`limit must be an integer between 1 and ${String(maxResults)}`)
  }
  return { source, query, limit }
}

/**
 * Validate the list arguments' value constraints.
 * @param args - the schema-validated list arguments.
 * @returns the selected source id and the container handle, when one was given.
 * @throws {Error} when the source id is blank.
 */
export function parseSourceListArgs(args: { source: string; ref?: string }): { source: string; ref?: SourceItemRef } {
  const source = args.source.trim()
  if (source.length === 0) throw new Error('source must name a configured source')
  return {
    source,
    ...args.ref === undefined ? {} : { ref: parseSourceRef(args.ref) },
  }
}

/** One hit as the tool's own output value carries it: the handle is a plain string there. */
interface RenderedHit {
  /** The item handle the model passes back to `read`. */
  readonly ref: string
  /** The item's display title. */
  readonly title: string
  /** One line of context, when the provider supplied one. */
  readonly summary?: string
}

/** Render one hit as a line the model can act on: its title, then its handle. */
function formatHit(hit: RenderedHit): string {
  const summary = hit.summary === undefined || hit.summary.length === 0 ? '' : ` — ${hit.summary}`
  return `- ${hit.title} [${hit.ref}]${summary}`
}

/** The note a search or a listing carries when it returned as many hits as it was allowed to. */
function formatCut(returned: number, limit: number): string[] {
  return returned >= limit ? [`Showing the first ${String(returned)} results.`] : []
}

/**
 * Format one search outcome as the model-facing text block.
 * @param source - the instance id the search ran against.
 * @param query - the query the model asked for.
 * @param hits - the returned hits.
 * @param limit - the bound the search ran under.
 * @returns the rendered block.
 */
export function formatSearchOutput(source: string, query: string, hits: readonly RenderedHit[], limit: number): string {
  const parts = [`Search results from ${source} for "${query}":`]
  parts.push(hits.length === 0 ? 'No results found.' : hits.map(formatHit).join('\n'))
  parts.push(...formatCut(hits.length, limit))
  return parts.join('\n\n')
}

/**
 * Format one listing as the model-facing text block.
 * @param source - the instance id the listing ran against.
 * @param ref - the container handle, or `undefined` for the instance's roots.
 * @param hits - the returned children.
 * @param limit - the kind's declared item cap, which the provider enforced.
 * @returns the rendered block.
 */
export function formatListOutput(
  source: string,
  ref: SourceItemRef | undefined,
  hits: readonly RenderedHit[],
  limit: number,
): string {
  const parts = [ref === undefined ? `Entries of ${source}:` : `Entries of ${ref} in ${source}:`]
  parts.push(hits.length === 0 ? 'No entries found.' : hits.map(formatHit).join('\n'))
  parts.push(...formatCut(hits.length, limit))
  return parts.join('\n\n')
}

/**
 * Format one document as the model-facing text block, including its header, so a
 * caller can bound the complete rendered output rather than the body alone.
 * @param source - the instance id the read ran against.
 * @param document - the document the provider returned.
 * @returns the rendered block.
 */
export function formatReadOutput(source: string, document: SourceDocument): string {
  return `${document.title} [${document.ref}] from ${source}:\n\n${document.content}`
}

/**
 * Resolve one configured instance of a kind, as of this call. A kind that lost
 * its provider, an instance that was removed, and an instance whose credential
 * stopped resolving all fail here rather than reaching a provider with stale
 * configuration.
 * @param ctx - context whose `sources` registry holds the kind.
 * @param kind - the kind to resolve inside.
 * @param id - the instance id the model asked for.
 * @returns the instance's resolved configuration.
 * @throws {Error} when the kind or the configured instance does not exist.
 */
export async function resolveSourceConfig(ctx: Context, kind: SourceKind, id: string): Promise<SourceConfig> {
  const provider = ctx.sources.get(kind)
  if (provider === undefined) throw new Error(`no "${kind}" source is registered`)
  const instances = await provider.instances()
  const found = instances.find(instance => instance.ref.id === id && instance.configured)
  if (found === undefined) {
    const available = instances.filter(instance => instance.configured).map(instance => instance.ref.id)
    const list = available.length === 0 ? 'none' : available.join(', ')
    throw new Error(`"${id}" is not a configured "${kind}" source; configured: ${list}`)
  }
  return found
}

/** The `source` argument's description, naming every instance the model may pass. */
function sourceArgument(ids: readonly string[]): string {
  return `Required. The configured source to use; one of: ${ids.join(', ')}.`
}

/**
 * Build the `search` tool for one kind.
 * @param ctx - context whose `sources` registry resolves the instance.
 * @param tools - the kind's capabilities, ids, and the kind itself.
 * @param maxResults - the deployment's upper bound on returned hits.
 * @param timeoutMs - the cooperative tool-call budget (ms).
 * @returns the registry-ready definition.
 */
function searchTool(ctx: Context, tools: KindTools, maxResults: number, timeoutMs: number): ToolDefinition {
  const { kind, capabilities, ids } = tools
  return defineTool({
    name: sourceToolName(kind, 'search'),
    description: `Search one configured "${kind}" source. ${capabilities.description} ${sourceArgument(ids)}`,
    parameters: {
      source: { type: 'string', required: true, description: sourceArgument(ids) },
      query: { type: 'string', required: true, description: 'Required. The text to search for.' },
      limit: {
        type: 'integer',
        description: `Optional. Upper bound on returned hits; 1–${String(maxResults)}, default ${String(maxResults)}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ref: { type: 'string', required: true },
                title: { type: 'string', required: true },
                summary: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: boundDocumentContent(
          formatSearchOutput(value.source, args.query, value.entries, args.limit ?? maxResults),
          capabilities.maxReadBytes,
        ).content,
      }],
    },
    timeoutMs,
    // A source read mutates no parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parsed = parseSourceSearchArgs(args, maxResults)
      const config = await resolveSourceConfig(ctx, kind, parsed.source)
      const provider = requireProvider(ctx, kind)
      const hits = await provider.search(config, parsed.query, parsed.limit, exec.signal)
      return {
        source: parsed.source,
        entries: hits.map(hit => ({
          ref: hit.ref,
          title: hit.title,
          ...hit.summary === undefined ? {} : { summary: hit.summary },
        })),
        truncated: hits.length >= parsed.limit,
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `${args.source}: ${args.query}`,
      kind: 'search',
      rawInput: args.query,
    }),
    presentResult: (args, result): GenericResultView => ({
      card: 'generic',
      title: result.isError ? `${args.source}: ${args.query} (failed)` : `${args.source}: ${args.query}`,
    }),
  })
}

/**
 * Build the `read` tool for one kind.
 * @param ctx - context whose `sources` registry resolves the instance.
 * @param tools - the kind's capabilities, ids, and the kind itself.
 * @param timeoutMs - the cooperative tool-call budget (ms).
 * @returns the registry-ready definition.
 */
function readTool(ctx: Context, tools: KindTools, timeoutMs: number): ToolDefinition {
  const { kind, capabilities, ids } = tools
  return defineTool({
    name: sourceToolName(kind, 'read'),
    description: `Read one item from a configured "${kind}" source. ${capabilities.description} ${sourceArgument(ids)}`,
    parameters: {
      source: { type: 'string', required: true, description: sourceArgument(ids) },
      ref: {
        type: 'string',
        required: true,
        description: 'Required. The item handle, exactly as a search or a list returned it.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          ref: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: boundDocumentContent(
          formatReadOutput(value.source, {
            ref: brandString<SourceItemRef>(value.ref),
            title: value.title,
            content: value.content,
            truncated: value.truncated,
          }),
          capabilities.maxReadBytes,
        ).content,
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const source = args.source.trim()
      if (source.length === 0) throw new Error('source must name a configured source')
      const ref = parseSourceRef(args.ref)
      const config = await resolveSourceConfig(ctx, kind, source)
      const provider = requireProvider(ctx, kind)
      if (provider.read === undefined) throw new Error(`the "${kind}" source cannot read items`)
      const document = await provider.read(config, ref, exec.signal)
      return {
        source,
        ref: document.ref,
        title: document.title,
        content: document.content,
        truncated: document.truncated,
      }
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: args.ref, kind: 'read', rawInput: args.ref }),
    presentResult: (args, result): GenericResultView => ({
      card: 'generic',
      title: result.isError ? `${args.ref} (failed)` : args.ref,
    }),
  })
}

/**
 * Build the `list` tool for one kind.
 * @param ctx - context whose `sources` registry resolves the instance.
 * @param tools - the kind's capabilities, ids, and the kind itself.
 * @param timeoutMs - the cooperative tool-call budget (ms).
 * @returns the registry-ready definition.
 */
function listTool(ctx: Context, tools: KindTools, timeoutMs: number): ToolDefinition {
  const { kind, capabilities, ids } = tools
  return defineTool({
    name: sourceToolName(kind, 'list'),
    description: `List the entries of one container in a configured "${kind}" source. ${capabilities.description} ${sourceArgument(ids)} The listing is bounded by the source's own configured item limit.`,
    parameters: {
      source: { type: 'string', required: true, description: sourceArgument(ids) },
      ref: {
        type: 'string',
        description: 'Optional. The container handle; omit it to list the source\'s roots.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          ref: { type: 'string' },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ref: { type: 'string', required: true },
                title: { type: 'string', required: true },
                summary: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: boundDocumentContent(
          formatListOutput(
            value.source,
            args.ref === undefined ? undefined : parseSourceRef(args.ref),
            value.entries,
            capabilities.maxListItems,
          ),
          capabilities.maxReadBytes,
        ).content,
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parsed = parseSourceListArgs(args)
      const config = await resolveSourceConfig(ctx, kind, parsed.source)
      const provider = requireProvider(ctx, kind)
      if (provider.list === undefined) throw new Error(`the "${kind}" source cannot list entries`)
      const hits = await provider.list(config, parsed.ref, exec.signal)
      return {
        source: parsed.source,
        ...parsed.ref === undefined ? {} : { ref: parsed.ref },
        entries: hits.map(hit => ({
          ref: hit.ref,
          title: hit.title,
          ...hit.summary === undefined ? {} : { summary: hit.summary },
        })),
        truncated: hits.length >= capabilities.maxListItems,
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: args.ref === undefined ? args.source : args.ref,
      kind: 'read',
      ...args.ref === undefined ? {} : { rawInput: args.ref },
    }),
    presentResult: (args, result): GenericResultView => ({
      card: 'generic',
      title: result.isError
        ? `${args.ref ?? args.source} (failed)`
        : args.ref ?? args.source,
    }),
  })
}

/** The registered provider for a kind that {@link resolveSourceConfig} just accepted. */
function requireProvider(ctx: Context, kind: SourceKind): SourceProvider {
  const provider = ctx.sources.get(kind)
  if (provider === undefined) throw new Error(`no "${kind}" source is registered`)
  return provider
}

/**
 * Derive the tool definitions every registered kind currently warrants. A kind
 * contributes a tool only when its provider declares the capability, implements
 * the method, and has at least one configured instance.
 * @param ctx - context whose `sources` registry holds the kinds.
 * @param maxResults - the deployment's upper bound on returned hits.
 * @param timeoutMs - the cooperative tool-call budget (ms).
 * @returns the definitions, in provider registration order.
 */
export async function buildSourceTools(
  ctx: Context,
  maxResults: number,
  timeoutMs: number,
): Promise<ToolDefinition[]> {
  const definitions: ToolDefinition[] = []
  for (const provider of ctx.sources.list()) {
    const capabilities = provider.capabilities
    const instances = await provider.instances()
    const ids = instances.filter(instance => instance.configured).map(instance => instance.ref.id)
    if (ids.length === 0) continue
    const tools: KindTools = { kind: provider.kind, capabilities, ids }
    if (capabilities.search) definitions.push(searchTool(ctx, tools, maxResults, timeoutMs))
    if (capabilities.read && provider.read !== undefined) definitions.push(readTool(ctx, tools, timeoutMs))
    if (capabilities.browse && provider.list !== undefined) definitions.push(listTool(ctx, tools, timeoutMs))
  }
  return definitions
}

/**
 * Register every warranted source tool, and re-derive the set whenever a kind
 * changes. Re-derivations are serialized: a refresh that a newer one superseded
 * registers nothing, so the last change wins and no stale definition survives.
 *
 * The whole suite is one effect on the calling fiber: disposing that fiber
 * unregisters every tool and stops listening.
 * @param ctx - context whose `tools` registry receives the definitions.
 * @param maxResults - the deployment's upper bound on returned hits.
 * @param timeoutMs - the cooperative tool-call budget (ms).
 */
export function applySourceTools(ctx: Context, maxResults: number, timeoutMs: number): void {
  ctx.effect(() => {
    let registered: (() => void)[] = []
    let generation = 0
    const refresh = (): void => {
      void rebuild()
    }
    async function rebuild(): Promise<void> {
      const mine = ++generation
      const definitions = await buildSourceTools(ctx, maxResults, timeoutMs)
      // A newer refresh started while this one awaited; that one owns the result.
      if (mine !== generation) return
      for (const dispose of registered) dispose()
      registered = definitions.map(definition => ctx.tools.register(definition))
    }
    const off = ctx.on('sources/changed', refresh)
    refresh()
    return () => {
      generation += 1
      off()
      for (const dispose of registered) dispose()
      registered = []
    }
  }, 'tool-resource.register')
}

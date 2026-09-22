/**
 * Service Definition for the remote source capability seam (`ctx.sources`): the
 * registry of configured remote sources a model may consult.
 *
 * This package owns the Service Definition role of the capability seam. The
 * Service Providers are one package per kind (`@deepseek-ai/dsh-resource-mediawiki`,
 * `-github`, `-mysql`), and the Consumer is the model-facing tool suite
 * (`@deepseek-ai/dsh-tool-resource`). The seam is complete: a registry with no
 * provider answers nothing, and a provider with no consumer reaches no model.
 *
 * The registry holds at most one provider per kind. It stores the provider
 * object as registered and reads no setting itself: each provider resolves its
 * own instances from its kind's settings namespace, because only the kind knows
 * which values it requires.
 *
 * @module @deepseek-ai/dsh-resource
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SOURCE_DUPLICATE_PROVIDER, SOURCE_PROVIDER_ERROR, SourceError } from './error.ts'
import type { SourceKind, SourceProvider, Sources } from './types.ts'

export { SOURCE_DENIED, SOURCE_DUPLICATE_PROVIDER, SOURCE_NOT_FOUND, SOURCE_PROVIDER_ERROR, SOURCE_UNCONFIGURED, SourceError } from './error.ts'
export type { SourceErrorCode } from './error.ts'
export { SOURCE_TRUNCATION_MARKER, boundDocumentContent, truncateUtf8 } from './bounds.ts'
export type {
  SourceCapabilities,
  SourceConfig,
  SourceDescription,
  SourceDocument,
  SourceHit,
  SourceItemRef,
  SourceKind,
  SourceProvider,
  SourceRef,
  Sources,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sources: SourceRegistry
  }

  interface Events {
    /**
     * The sources one kind offers may have changed: its provider joined or left
     * the registry, or the provider's own configuration changed. A consumer
     * re-derives the tools it registers for that kind. Emitted after the change
     * took effect, by the registry for a join or a disposal and by the provider
     * plugin for a committed settings change.
     * @param kind - the kind whose available sources may differ.
     * @mode emit
     */
    'sources/changed'(kind: SourceKind): void
  }
}

/**
 * The kind-name grammar. A kind becomes part of a tool name and of its settings
 * namespace, so the registry admits only lower-case names that start with a
 * letter and continue with letters, digits, underscores, or hyphens.
 */
const KIND_NAME = /^[a-z][a-z0-9_-]*$/

/**
 * The source registry, registered as `ctx.sources` (one instance per context;
 * loading a second throws, which is cordis' duplicate-service behavior).
 */
export class SourceRegistry extends Service implements Sources {
  private readonly providers = new Map<SourceKind, SourceProvider>()

  /**
   * @param ctx - the context this service registers on.
   */
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  /**
   * Register one kind's provider. The registration is an effect on the calling
   * fiber: disposing that fiber removes the provider and emits `sources/changed`.
   * @param provider - the provider; its `kind` is the registry key.
   * @returns the exact disposer that unregisters the provider.
   * @throws {SourceError} `SOURCE_DUPLICATE_PROVIDER` when the kind already has a provider,
   *   or `SOURCE_PROVIDER_ERROR` when the kind is not a usable name.
   */
  register(provider: SourceProvider): () => void {
    if (!KIND_NAME.test(provider.kind)) {
      throw new SourceError(
        `"${provider.kind}" is not a usable source kind; a kind is lower-case and starts with a letter`,
        SOURCE_PROVIDER_ERROR,
      )
    }
    if (this.providers.has(provider.kind)) {
      throw new SourceError(
        `a source provider for kind "${provider.kind}" is already registered`,
        SOURCE_DUPLICATE_PROVIDER,
      )
    }
    const providers = this.providers
    const ctx = this.ctx
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.kind, provider)
      ctx.emit('sources/changed', provider.kind)
      yield () => {
        providers.delete(provider.kind)
        ctx.emit('sources/changed', provider.kind)
      }
    }, `sources.register(${provider.kind})`)
    // ctx.effect's disposer returns Promise<void>; the registry's disposer API
    // is synchronous fire-and-forget, and the effect settles synchronously.
    return () => void dispose()
  }

  /**
   * Every registered provider, in registration order.
   * @returns the registered providers.
   */
  list(): readonly SourceProvider[] {
    return [...this.providers.values()]
  }

  /**
   * Look up one kind's provider.
   * @param kind - the kind to look up.
   * @returns the provider, or `undefined` when the kind is not registered.
   */
  get(kind: SourceKind): SourceProvider | undefined {
    return this.providers.get(kind)
  }
}

export default SourceRegistry

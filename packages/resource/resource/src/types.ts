/**
 * Vocabulary for the remote source capability seam (`ctx.sources`). A source is a
 * remote collection a model may consult — a wiki, a repository, a database — and
 * every kind differs in what it can answer, so the seam normalizes only the
 * operations a caller performs and leaves addressing and limits to the provider
 * that owns the kind.
 *
 * Types only — no runtime code. The registry service, the error class, and the
 * result bounds live in `./index.ts` and `./error.ts`.
 *
 * @module @deepseek-ai/dsh-resource/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * One source kind's discriminator, such as `'mediawiki'`, `'github'`, or
 * `'mysql'`. Merge-extensible: a provider package registers under its own kind
 * string, and the open arm keeps an unknown kind assignable.
 */
export type SourceKind = 'mediawiki' | 'github' | 'mysql' | (string & {})

/**
 * Opaque handle for one item inside a source, produced by the provider that owns
 * the kind and interpreted only by that provider. A caller never parses it,
 * composes one from parts, or moves it between kinds.
 */
export type SourceItemRef = Branded<'SourceItemRef'>

/** One configured source instance, addressed by its id inside its kind's settings namespace. */
export interface SourceRef {
  /** The kind's discriminator, matching the provider's {@link SourceProvider.kind}. */
  readonly kind: SourceKind
  /** This instance's id inside its kind's settings namespace. */
  readonly id: string
}

/**
 * What one source kind can answer, declared so a consumer states the limits
 * outright instead of letting a model call a capability that does not exist.
 * The three shipped kinds genuinely differ: MediaWiki answers full-text search,
 * GitHub answers code search under a tight request quota, and MySQL answers only
 * the database structure its configuration grants.
 */
export interface SourceCapabilities {
  /** Whether the kind implements {@link SourceProvider.search}. */
  readonly search: boolean
  /** Whether the kind implements {@link SourceProvider.list}. */
  readonly browse: boolean
  /** Whether the kind implements {@link SourceProvider.read}. */
  readonly read: boolean
  /** Largest single read the source returns, in bytes; the provider enforces it. */
  readonly maxReadBytes: number
  /** Largest single listing the source returns, in items; the provider enforces it. */
  readonly maxListItems: number
  /**
   * Model-facing statement of what this kind answers and the limits it enforces,
   * including the read cap, any request quota, and any restriction on the
   * underlying view. Consumers render it into every tool description for the kind.
   */
  readonly description: string
}

/** One hit from a search or a listing, normalized across very different backends. */
export interface SourceHit {
  /** The source's own stable identity for the item: the handle every later call takes. */
  readonly ref: SourceItemRef
  /** The item's display title. */
  readonly title: string
  /** One line of context; a provider that has none omits it rather than inventing one. */
  readonly summary?: string
}

/** One item read whole, bounded by the provider's declared read cap. */
export interface SourceDocument {
  /** The handle the document was read by. */
  readonly ref: SourceItemRef
  /** The item's display title. */
  readonly title: string
  /**
   * The document text, at most {@link SourceCapabilities.maxReadBytes} bytes
   * including the truncation marker; `truncated` says whether the provider cut it.
   */
  readonly content: string
  /** True when the provider cut `content` at the read cap and appended the marker. */
  readonly truncated: boolean
}

/**
 * One configured instance of a kind, as its provider sees it: the address plus
 * the instance's own resolved settings, which only that kind's provider reads.
 * A provider returns its own extension of this interface, so the caller that
 * received the configuration passes it back without narrowing it.
 */
export interface SourceConfig {
  /** The instance this configuration belongs to. */
  readonly ref: SourceRef
  /**
   * False when the instance's settings lack a required value. An unconfigured
   * instance opens no connection, appears in no tool's instance list, and fails
   * {@link SourceProvider.check} with `SOURCE_UNCONFIGURED`.
   */
  readonly configured: boolean
}

/** What a successful credential and reachability probe found. */
export interface SourceDescription {
  /** Short label for the resolved target, such as the wiki's sitename or the repository's full name. */
  readonly label: string
  /** One line of detail the probe established; omitted when the probe established nothing beyond reachability. */
  readonly detail?: string
}

/**
 * One source kind's implementation seam. One provider package per kind,
 * registered with `ctx.sources.register`.
 *
 * The generic parameter is the provider's own configuration interface: a
 * provider returns its extension of {@link SourceConfig} from
 * {@link SourceProvider.instances} and receives that same extension back in
 * every operation, so neither side narrows a value the other produced.
 */
export interface SourceProvider<C extends SourceConfig = SourceConfig> {
  /** The kind this provider implements; the registry key. */
  readonly kind: SourceKind
  /** What this kind answers, including the model-facing limits statement. */
  readonly capabilities: SourceCapabilities
  /**
   * Every instance this kind's settings declare, in settings order. The provider
   * resolves each instance's values from its own settings namespace and reports
   * whether each is complete — including whether every credential it references
   * currently resolves. It opens no connection and makes no request here.
   * @returns the declared instances, configured or not.
   */
  instances(): Promise<readonly C[]>
  /**
   * Probe the instance's credentials and describe the target. A rejection means
   * the source is unusable and its message is the last error text a configuration
   * surface shows. An unconfigured instance rejects with `SOURCE_UNCONFIGURED`
   * before any connection is opened.
   * @param config - the instance to probe.
   * @returns the resolved target's label and optional detail.
   */
  check(config: C): Promise<SourceDescription>
  /**
   * Search the source.
   * @param config - the instance to search.
   * @param query - the caller's query text.
   * @param limit - upper bound on returned hits; the provider returns at most this many.
   * @param signal - caller cancellation.
   * @returns the hits, in the source's own relevance order.
   */
  search(config: C, query: string, limit: number, signal: AbortSignal): Promise<SourceHit[]>
  /**
   * Read one item whole, bounded by {@link SourceCapabilities.maxReadBytes}. A
   * kind without `read` omits the method, and no consumer registers a tool for it.
   * @param config - the instance to read from.
   * @param ref - the item handle, as returned by `search` or `list`.
   * @param signal - caller cancellation.
   * @returns the bounded document.
   */
  read?(config: C, ref: SourceItemRef, signal: AbortSignal): Promise<SourceDocument>
  /**
   * List a container's children, for kinds that have containers. A kind without
   * `list` omits the method, and no consumer registers a tool for it.
   * @param config - the instance to list.
   * @param ref - the container handle, or `undefined` for the instance's roots.
   * @param signal - caller cancellation.
   * @returns the children, in the source's own order.
   */
  list?(config: C, ref: SourceItemRef | undefined, signal: AbortSignal): Promise<SourceHit[]>
}

/**
 * The registry service (`ctx.sources`): the one place the model-facing tools and
 * the user-facing panel read configured sources from. One provider per kind.
 */
export interface Sources {
  /**
   * Register one kind's provider.
   * @param provider - the provider; its `kind` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  register(provider: SourceProvider): () => void
  /**
   * Every registered provider, in registration order.
   * @returns the registered providers.
   */
  list(): readonly SourceProvider[]
  /**
   * Look up one kind's provider.
   * @param kind - the kind to look up.
   * @returns the provider, or `undefined` when the kind is not registered.
   */
  get(kind: SourceKind): SourceProvider | undefined
}

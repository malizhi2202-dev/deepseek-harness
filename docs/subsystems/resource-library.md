# Resource Library

English | [中文](resource-library.zh.md)

The resource library reaches collections a deployment already owns — a wiki, a code host, a database — as sources a model may search, browse, and read. `ctx.sources` is the registry holding one provider per kind; each provider package owns its kind's protocol, addressing, and limits; and a consumer derives the model-facing tool set from what the registry holds. Five packages carry the roles: [`dsh-resource`](../../packages/resource/resource) declares the registry and the vocabulary, [`dsh-resource-mediawiki`](../../packages/resource/resource-mediawiki), [`dsh-resource-github`](../../packages/resource/resource-github), and [`dsh-resource-mysql`](../../packages/resource/resource-mysql) are the providers, and [`dsh-tool-resource`](../../packages/resource/tool-resource) is the consumer. [`dsh-api-sources`](../../packages/api/sources) serves the configuration panel through `ctx.sourcesPanel`. Every provider reads its instances from its own `resource-<kind>` settings namespace and resolves each credential reference by name on every operation, so no secret value enters configuration and no new persistence domain appears. Providers read only: none writes to its backend, and no address scheme is registered for a source, so a model reaches one only through the derived tools. Design records: [remote resource library host half](../../.agents/notes/implemented/architecture/2026-09-22-remote-resource-library-host-half.md) and [remote resource library panel half](../../.agents/notes/implemented/architecture/2026-09-22-remote-resource-library-panel-half.md).

Sources: [`packages/resource/resource/src/types.ts`](../../packages/resource/resource/src/types.ts), [`packages/resource/resource/src/error.ts`](../../packages/resource/resource/src/error.ts), [`packages/api/sources/src/types.ts`](../../packages/api/sources/src/types.ts)

## Kinds and item handles

A kind is the registry key, a segment of the settings namespace that configures it, and the first segment of every tool name derived from it. The registry admits only a lower-case name that starts with a letter and continues with letters, digits, underscores, or hyphens.

```ts type-equiv
/**
 * One source kind's discriminator, such as `'mediawiki'`, `'github'`, or
 * `'mysql'`. Merge-extensible: a provider package registers under its own kind
 * string, and the open arm keeps an unknown kind assignable.
 */
type SourceKind = 'mediawiki' | 'github' | 'mysql' | (string & {})
```

An item handle is opaque to every caller: a provider produces it, only that provider interprets it, and no caller parses one, composes one from parts, or moves one between kinds.

```ts type-equiv
/**
 * Opaque handle for one item inside a source, produced by the provider that owns
 * the kind and interpreted only by that provider. A caller never parses it,
 * composes one from parts, or moves it between kinds.
 */
type SourceItemRef = Branded<'SourceItemRef'>
```

`SourceItemRef` is a [branded id](core.md#branded-ids). One configured collection is addressed by `SourceRef` — the kind plus the instance id inside that kind's settings section — and that pair is what the model names as a tool's `source` argument.

## Declared capabilities

A model cannot discover that a kind has no search by trying one, so each provider declares what its kind answers, and the consumer registers an operation only when a declaration, an implemented method, and a configured instance all agree.

```ts type-equiv
/**
 * What one source kind can answer, declared so a consumer states the limits
 * outright instead of letting a model call a capability that does not exist.
 * The three shipped kinds genuinely differ: MediaWiki answers full-text search,
 * GitHub answers code search under a tight request quota, and MySQL answers only
 * the database structure its configuration grants.
 */
interface SourceCapabilities {
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
```

The read cap, the listing cap, and the limits statement travel with the three capability flags because the derived tool description must state the limits its provider enforces. Capabilities are fixed per kind rather than per instance, so two instances of one kind share one read cap and one listing cap. The shipped kinds differ on all three flags: MediaWiki answers search, listing, and reading; GitHub answers all three under a code-search quota; MySQL answers structure and rows without full-text search.

## Hits, documents, and the read bound

`search` and `list` answer hits; `read` answers one bounded document. Every provider cuts a read at the same declared cap and appends the same marker, so a model reads a cut result as cut whatever kind produced it.

```ts type-equiv
/** One hit from a search or a listing, normalized across very different backends. */
interface SourceHit {
  /** The source's own stable identity for the item: the handle every later call takes. */
  readonly ref: SourceItemRef
  /** The item's display title. */
  readonly title: string
  /** One line of context; a provider that has none omits it rather than inventing one. */
  readonly summary?: string
}
```

```ts type-equiv
/** One item read whole, bounded by the provider's declared read cap. */
interface SourceDocument {
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
```

The bound lives in the seam rather than in each provider. `truncateUtf8` cuts text to a byte budget on a code-point boundary, and `boundDocumentContent` applies the cap to the complete document including `SOURCE_TRUNCATION_MARKER`; the marker's own bytes count against the budget, and a budget below the marker's length still answers the marker's prefix, so a cut is never silent. A hit carries the handle that every later call takes, so a model chains a search or a listing into a read.

## Instances and providers

One provider package implements one kind. It reads that kind's instances from the kind's own settings namespace and reports each instance's completeness; it is the only code that knows the kind's protocol, addressing, and limits.

```ts type-equiv
/**
 * One configured instance of a kind, as its provider sees it: the address plus
 * the instance's own resolved settings, which only that kind's provider reads.
 * A provider returns its own extension of this interface, so the caller that
 * received the configuration passes it back without narrowing it.
 */
interface SourceConfig {
  /** The instance this configuration belongs to. */
  readonly ref: SourceRef
  /**
   * False when the instance's settings lack a required value. An unconfigured
   * instance opens no connection, appears in no tool's instance list, and fails
   * {@link SourceProvider.check} with `SOURCE_UNCONFIGURED`.
   */
  readonly configured: boolean
}
```

```ts type-equiv
/**
 * One source kind's implementation seam. One provider package per kind,
 * registered with `ctx.sources.register`.
 *
 * The generic parameter is the provider's own configuration interface: a
 * provider returns its extension of {@link SourceConfig} from
 * {@link SourceProvider.instances} and receives that same extension back in
 * every operation, so neither side narrows a value the other produced.
 */
interface SourceProvider<C extends SourceConfig = SourceConfig> {
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
```

`SourceProvider` is the Service Provider role of the capability seam; [`dsh-resource`](../../packages/resource/resource) holds the Service Definition and [`dsh-tool-resource`](../../packages/resource/tool-resource) is the Consumer. `instances()` opens no connection and makes no request, and `check()` reports what a probe found as `SourceDescription` — a short label for the resolved target plus optional detail. Credentials are resolved on every operation rather than cached, so a rotated secret reaches the next call without a remount, and a kind that omits `read` or `list` registers no tool for the omitted operation.

## The registry: `ctx.sources`

```ts type-equiv
/**
 * The registry service (`ctx.sources`): the one place the model-facing tools and
 * the user-facing panel read configured sources from. One provider per kind.
 */
interface Sources {
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
```

Registration is an effect on the calling fiber: the returned disposer removes the provider, disposing that fiber removes it too, and both emit `sources/changed` with the kind. The registry stores the provider object as registered and reads no setting itself, because only the kind knows which values it requires. Registering a kind that fails the name grammar raises `SOURCE_PROVIDER_ERROR`, and registering a second provider for one kind raises `SOURCE_DUPLICATE_PROVIDER`. The registry probes no reachability and holds no cache, so a configured but unreachable source reports its failure on the operation that used it rather than when the provider registered.

`sources/changed` is emitted after the change took effect: by the registry for a join or a disposal, and by the provider plugin for a committed settings change. A consumer re-derives the tools it registers for that kind, which is how a kind that appeared, changed, or went away becomes visible to a model without a remount.

## Failures and bounds

Providers raise `SourceError` with a code a consumer routes on, never on the message text or the class identity. The message is human-readable failure text safe to show a model or a configuration surface, and `cause` carries the backend's own error when one exists.

```ts type-equiv
/** Every failure code this seam raises. */
type SourceErrorCode =
  | typeof SOURCE_UNCONFIGURED
  | typeof SOURCE_PROVIDER_ERROR
  | typeof SOURCE_NOT_FOUND
  | typeof SOURCE_DUPLICATE_PROVIDER
  | typeof SOURCE_DENIED
```

`SOURCE_UNCONFIGURED` means the instance's settings lack a required value, so no connection was opened. `SOURCE_PROVIDER_ERROR` means the backend refused, failed, or answered something the provider could not use. `SOURCE_NOT_FOUND` means the handle names nothing the caller may see, including anything outside a granted view. `SOURCE_DUPLICATE_PROVIDER` means a kind's provider is already registered. `SOURCE_DENIED` means the operation is outside what the source permits and nothing reached the backend.

## The model-facing tools

[`dsh-tool-resource`](../../packages/resource/tool-resource) derives tools named `source_<kind>_search`, `source_<kind>_read`, and `source_<kind>_list`. A kind contributes an operation only when its provider declares the capability, implements the method, and has at least one configured instance, so a model never sees a tool that cannot work and a source that stops being configured stops being addressable. The set is re-derived on `sources/changed`, and re-derivations are serialized so a superseded refresh registers nothing. Each call resolves the instance as of that call, validates the model's arguments at that wire boundary, and bounds the rendered text at the kind's read cap. Tool registration, argument validation, rendering, and presentation belong to that package.

## The configuration endpoint: `ctx.sourcesPanel`

[`dsh-api-sources`](../../packages/api/sources) owns the `sources` Remote namespace: `status` reports every instance this Host serves, and `probe` tests one instance against the settings and credentials its provider resolved. The endpoint holds no configuration of its own — every answer is read from the registry, the settings provider, and the credential seam at call time — and it registers no tool, prompt section, or session event.

```ts type-equiv
/**
 * Where one source instance stands, as this Host last observed it.
 *
 * A source builds no connection of its own, so the state is derived rather than
 * reported by a transport: `unconfigured` when its provider reports the
 * instance's settings incomplete, `unchecked` while a configured instance has
 * not been probed at its kind's current settings revision, and `usable` or
 * `unusable` from the last probe.
 */
type SourceState = 'unconfigured' | 'unchecked' | 'usable' | 'unusable'
```

An instance's identity for the panel is the opaque `key` a `status` answer reported, unique across kinds because an instance id is unique only inside its kind. `unconfigured` is the provider's own answer; `unchecked` is a configured instance no probe has observed at the kind's current settings revision, so an edit after a probe reads as unchecked again; `usable` and `unusable` come from the last probe this process observed, and a failure is never cleared by a later success. A probe that finds the source unreachable is answered as a value rather than refused, and only an instance this Host does not serve is an error, crossing the wire as the declared `sources/unknown` code. Probe outcomes are held in memory for that process, because no durable domain exists for them.

```ts type-equiv
/** Presence of one credential reference an instance's configuration names. */
interface SourceCredentialView {
  /** The configuration field holding the reference name. */
  readonly field: string
  /** The reference name the field currently holds; empty while unset. */
  readonly ref: string
  /** Whether resolving the reference would currently return a value. */
  readonly configured: boolean
  /** The layer supplying the value; absent while unconfigured. */
  readonly source?: string
  /** Whether this Host could store a value for the reference. */
  readonly writable: boolean
}
```

A credential reference crosses as a name and its presence, never as a value: the endpoint walks the settings schema's `object`, `dict`, `array`, and `intersect` containers for fields whose node declares the credential-reference role, then reads each field's value off the instance the provider itself resolved. The settings namespace is composed from the `resource-<kind>` convention rather than declared by the seam, so a provider naming its namespace differently still reports its instances while its configuration surface reads as unavailable.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsources--sourceregistry"></a>

### `ctx.sources` — `SourceRegistry`

The source registry, registered as `ctx.sources` (one instance per context; loading a second throws, which is cordis' duplicate-service behavior).

```ts cordis-catalog
/**
 * Register one kind's provider. The registration is an effect on the calling
 * fiber: disposing that fiber removes the provider and emits `sources/changed`.
 * @param provider - the provider; its `kind` is the registry key.
 * @returns the exact disposer that unregisters the provider.
 * @throws {SourceError} `SOURCE_DUPLICATE_PROVIDER` when the kind already has a provider,
 *   or `SOURCE_PROVIDER_ERROR` when the kind is not a usable name.
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
```

Source: [`packages/resource/resource/src/index.ts`](../../packages/resource/resource/src/index.ts)

<a id="ctxsourcespanel--sourcepanel"></a>

### `ctx.sourcesPanel` — `SourcePanel`

Host Remote service reporting the remote resource sources and probing one.

```ts cordis-catalog
/**
 * Read every declared source instance's state.
 *
 * The registry is read at call time, so a provider a plugin registered a
 * moment ago is reported rather than missing, and each provider is asked for
 * its instances rather than this endpoint holding a copy of any configuration.
 * @returns one view per declared instance, providers in registration order.
 */
@Remote async status(): Promise<SourcesStatus>

/**
 * Test whether one source instance can reach its target with the configured
 * settings and credentials.
 *
 * A source that cannot is answered, not rejected: `ok: false` with the reason
 * is what the panel shows, and only an instance this Host does not serve is an
 * error.
 * @param key - the instance's identity, as `status` reported it.
 * @returns what the probe found.
 * @throws {RemoteError} with code `sources/unknown` when no such instance is declared.
 */
@Remote async probe(key: string): Promise<SourceProbe>
```

Source: [`packages/api/sources/src/index.ts`](../../packages/api/sources/src/index.ts)

<a id="sources-events"></a>

### `sources/*` events

<a id="sourceschanged--emit"></a>

#### `sources/changed` — emit

The sources one kind offers may have changed: its provider joined or left the registry, or the provider's own configuration changed. A consumer re-derives the tools it registers for that kind. Emitted after the change took effect, by the registry for a join or a disposal and by the provider plugin for a committed settings change.

```ts cordis-catalog
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
```

Source: [`packages/resource/resource/src/index.ts`](../../packages/resource/resource/src/index.ts)
<!-- END GENERATED cordis-surface -->

# 资源库

[English](resource-library.md) | 中文

资源库（resource library）把部署方已经拥有的集合——wiki、代码托管、数据库——变成模型可以检索、浏览和读取的来源（source）。`ctx.sources` 是持有每种种类（kind）一个提供方的注册表；每个提供方包负责该种类的协议、寻址和上限；消费方则依据注册表持有的内容推导出面向模型的工具集。五种角色由五个包承担：[`dsh-resource`](../../packages/resource/resource) 声明注册表与词汇，[`dsh-resource-mediawiki`](../../packages/resource/resource-mediawiki)、[`dsh-resource-github`](../../packages/resource/resource-github) 与 [`dsh-resource-mysql`](../../packages/resource/resource-mysql) 是提供方，[`dsh-tool-resource`](../../packages/resource/tool-resource) 是消费方。[`dsh-api-sources`](../../packages/api/sources) 通过 `ctx.sourcesPanel` 为配置面板提供服务。每个提供方都从自己的 `resource-<kind>` 设置命名空间读取实例，并在每次操作时按名称解析每个凭据引用，因此没有任何密钥值进入配置，也不会新增持久化领域。提供方只读：没有任何一个会写入其后端，也没有为来源注册任何地址方案，因此模型只能通过推导出的工具抵达来源。设计记录：[remote resource library host half](../../.agents/notes/implemented/architecture/2026-09-22-remote-resource-library-host-half.zh.md) 与 [remote resource library panel half](../../.agents/notes/implemented/architecture/2026-09-22-remote-resource-library-panel-half.zh.md)。

源码：[`packages/resource/resource/src/types.ts`](../../packages/resource/resource/src/types.ts)、[`packages/resource/resource/src/error.ts`](../../packages/resource/resource/src/error.ts)、[`packages/api/sources/src/types.ts`](../../packages/api/sources/src/types.ts)

## 种类与条目句柄

种类是注册表的键、配置它的设置命名空间的一个片段，也是由它推导出的每个工具名的第一段。注册表只接受小写、以字母开头、其后为字母、数字、下划线或连字符的名称。

```ts type-equiv
/**
 * One source kind's discriminator, such as `'mediawiki'`, `'github'`, or
 * `'mysql'`. Merge-extensible: a provider package registers under its own kind
 * string, and the open arm keeps an unknown kind assignable.
 */
type SourceKind = 'mediawiki' | 'github' | 'mysql' | (string & {})
```

条目句柄对每个调用方都是不透明的：提供方生成它，只有该提供方解释它，任何调用方都不解析它、不用片段拼装它，也不把它在种类之间搬移。

```ts type-equiv
/**
 * Opaque handle for one item inside a source, produced by the provider that owns
 * the kind and interpreted only by that provider. A caller never parses it,
 * composes one from parts, or moves it between kinds.
 */
type SourceItemRef = Branded<'SourceItemRef'>
```

`SourceItemRef` 是[品牌化 id](core.zh.md#branded-ids)。一个已配置的集合由 `SourceRef` 寻址——种类加上该种类设置段内的实例 id——模型正是把这个组合作为工具的 `source` 实参来命名。

## 声明式能力

模型无法靠试一次来发现某个种类没有检索，因此每个提供方都声明自己的种类能回答什么，而消费方只在声明、已实现的方法与已配置的实例三者同时成立时才注册一项操作。

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

读取上限、罗列上限与上限说明跟随这三个能力标志一起传递，因为推导出的工具描述必须陈述其提供方所执行的上限。能力按种类固定而非按实例固定，因此同一种类的两个实例共享同一个读取上限和罗列上限。已发布的三个种类在三个标志上各不相同：MediaWiki 同时回答检索、罗列与读取；GitHub 在代码检索配额下同样回答三者；MySQL 回答结构与行，但不提供全文检索。

## 命中、文档与读取上限

`search` 与 `list` 回答命中（hit），`read` 回答一个受上限约束的文档。每个提供方都在同一个声明的上限处截断读取并追加同一个标记，因此无论结果出自哪个种类，模型都把被截断的结果读作被截断。

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

上限位于 seam 之中，而不在每个提供方里。`truncateUtf8` 按码点边界把文本截到字节预算，`boundDocumentContent` 把上限施加到包含 `SOURCE_TRUNCATION_MARKER` 在内的完整文档上；标记自身的字节计入预算，而小于标记长度的预算仍然回答标记的前缀，因此截断从不静默发生。命中携带后续每次调用都要用的句柄，模型据此把一次检索或罗列串接到一次读取。

## 实例与提供方

一个提供方包实现一个种类。它从该种类自己的设置命名空间读取该种类的实例并报告每个实例的完整性；它是唯一了解该种类协议、寻址与上限的代码。

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

`SourceProvider` 是能力 seam 的 Service Provider 角色；[`dsh-resource`](../../packages/resource/resource) 持有 Service Definition，[`dsh-tool-resource`](../../packages/resource/tool-resource) 是 Consumer。`instances()` 不打开连接也不发起请求，`check()` 以 `SourceDescription` 报告探测所得——被解析目标的简短标签，外加可选的细节。凭据在每次操作时解析而不缓存，因此轮换后的密钥无需重新挂载即可抵达下一次调用；省略 `read` 或 `list` 的种类不会为被省略的操作注册任何工具。

## 注册表：`ctx.sources`

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

注册是调用方 fiber 上的 effect：返回的 disposer 会移除该提供方，释放该 fiber 同样会移除它，两者都会带种类发出 `sources/changed`。注册表按注册时的原样存储提供方对象，自身不读取任何设置，因为只有种类知道它需要哪些值。注册不通过名称语法的种类会抛出 `SOURCE_PROVIDER_ERROR`，为同一种类注册第二个提供方会抛出 `SOURCE_DUPLICATE_PROVIDER`。注册表不探测可达性也不持有缓存，因此已配置但不可达的来源会在使用它的那次操作上报错，而不是在提供方注册时报错。

`sources/changed` 在变更生效之后发出：由注册表在加入或释放时发出，由提供方插件在设置变更提交后发出。消费方据此重新推导它为那个种类注册的工具，这正是某个种类出现、改变或消失后无需重新挂载即可对模型可见的方式。

## 失败与上限

提供方以 `SourceError` 抛出失败，并携带消费方据以路由的 code，绝不依据消息文本或类身份路由。消息是可供人类阅读的失败文本，可以安全展示给模型或配置界面，`cause` 在存在时携带后端自身的错误。

```ts type-equiv
/** Every failure code this seam raises. */
type SourceErrorCode =
  | typeof SOURCE_UNCONFIGURED
  | typeof SOURCE_PROVIDER_ERROR
  | typeof SOURCE_NOT_FOUND
  | typeof SOURCE_DUPLICATE_PROVIDER
  | typeof SOURCE_DENIED
```

`SOURCE_UNCONFIGURED` 表示实例的设置缺少必需值，因此没有打开任何连接。`SOURCE_PROVIDER_ERROR` 表示后端拒绝、失败或返回了提供方无法使用的内容。`SOURCE_NOT_FOUND` 表示句柄没有指向调用方可见的任何东西，包括授权视图之外的任何东西。`SOURCE_DUPLICATE_PROVIDER` 表示某个种类的提供方已经注册。`SOURCE_DENIED` 表示该操作超出该来源允许的范围，且没有任何内容抵达后端。

## 面向模型的工具

[`dsh-tool-resource`](../../packages/resource/tool-resource) 推导名为 `source_<kind>_search`、`source_<kind>_read` 与 `source_<kind>_list` 的工具。只有当某个种类的提供方声明了该能力、实现了该方法、并且至少有一个已配置实例时，该种类才贡献一项操作，因此模型绝不会看到无法工作的工具，而不再被配置的来源也不再可寻址。工具集在 `sources/changed` 时重新推导，且重新推导被串行化，被更新的一次取代的刷新不会注册任何东西。每次调用都在该次调用时解析实例，在那个线上边界校验模型的实参，并按种类的读取上限约束渲染文本。工具注册、实参校验、渲染与呈现都归该包所有。

## 配置端点：`ctx.sourcesPanel`

[`dsh-api-sources`](../../packages/api/sources) 拥有 `sources` Remote 命名空间：`status` 报告本 Host 服务的每个实例，`probe` 针对某个实例测试其提供方所解析的设置与凭据。该端点自身不持有任何配置——每个答案都在调用时从注册表、设置提供方与凭据 seam 读取——并且不注册任何工具、提示词段或会话事件。

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

实例在面板中的身份是 `status` 答案所报告的不透明 `key`；它跨种类唯一，因为实例 id 只在种类内部唯一。`unconfigured` 来自提供方自己的答案；`unchecked` 表示某个已配置实例尚未在其种类的当前设置修订上被探测过，因此在探测之后发生的编辑会再次读作未检查；`usable` 与 `unusable` 来自本进程观察到的最近一次探测，而失败绝不会被后来的成功清除。探测发现来源不可达时以值作答而不是拒绝，只有本 Host 不服务的实例才是错误，并以已声明的 `sources/unknown` code 跨线传递。探测结果仅保存在该进程的内存中，因为不存在用于它们的持久化领域。

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

凭据引用以名称及其存在性跨线，绝不携带值：端点遍历设置 schema 的 `object`、`dict`、`array` 与 `intersect` 容器，找出其节点声明了凭据引用角色的字段，然后从提供方自己解析出的实例上读取每个字段的值。设置命名空间由 `resource-<kind>` 约定组合而来，而非由 seam 声明，因此以不同方式命名其命名空间的提供方仍会报告其实例，只是其配置界面读作不可用。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

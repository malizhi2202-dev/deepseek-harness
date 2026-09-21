# 远程资料库设计（T4）

依据：`00-request-and-rulings.md` 的 R2（只做官方 API 的源、wiki 先 MediaWiki）、`01-verified-facts.md` 的可行性表与 MCP 发现。

## 一、核心判断：这是「模型可用的源」而不只是「面板」

负责人的原话是把这些当作**资料库**加入——即模型能查阅的远端知识。因此本阶段的主面是**模型面向的读操作**，面板是配置与浏览的辅助面。这决定了接缝必须有两类消费者：

| 消费者 | 用途 |
| --- | --- |
| 工具（模型面向） | 让模型检索、读页、列结构 |
| 面板（用户面向） | 配置凭据、选库、看连接状态、手动浏览 |

只做面板会让「资料库」退化成书签；只做工具会让用户无法配置。两者同一接缝。

## 二、Service Definition（新包 `packages/resource/resource`）

```ts
/** One configured remote source instance, addressed by its settings namespace id. */
export interface SourceRef {
  /** The kind's discriminator: 'github' | 'mysql' | 'mediawiki' | … (merge-extensible). */
  readonly kind: SourceKind
  /** This instance's id inside its settings namespace. */
  readonly id: string
}

/** What a source can answer, declared so the panel and the tools can state limits honestly. */
export interface SourceCapabilities {
  readonly search: boolean
  readonly browse: boolean
  readonly read: boolean
  /** Largest single read the source will return, in bytes; the provider enforces it. */
  readonly maxReadBytes: number
}

/** One hit from a search, normalized across very different backends. */
export interface SourceHit {
  /** The source's own stable identity for the item, the handle every later call takes. */
  readonly ref: string
  readonly title: string
  /** One line of context; providers that have none leave it out rather than inventing one. */
  readonly summary?: string
}

/** One source kind's implementation seam. One provider package per kind. */
export interface SourceProvider {
  readonly kind: SourceKind
  readonly capabilities: SourceCapabilities
  /** Probe the configured credentials and describe the target; a failure means the source is unusable. */
  check(config: SourceConfig): Promise<SourceDescription>
  search(config: SourceConfig, query: string, limit: number, signal: AbortSignal): Promise<SourceHit[]>
  /** Read one item whole, bounded by the declared cap; a source without `read` omits the method. */
  read?(config: SourceConfig, ref: string, signal: AbortSignal): Promise<SourceDocument>
  /** List a container's children, for sources that have containers (a repo tree, a wiki's categories). */
  list?(config: SourceConfig, ref: string | undefined, signal: AbortSignal): Promise<SourceHit[]>
}

/** The registry service (`ctx.sources`), the one place the tools and the panel read. */
export interface Sources {
  register(provider: SourceProvider): Disposer
  list(): readonly SourceProvider[]
  get(kind: SourceKind): SourceProvider | undefined
}
```

**关键设计点**

1. **`ref` 是不透明句柄**，由各 provider 自己解释（GitHub 是 `owner/repo:path`，MediaWiki 是页面标题，MySQL 是 `库.表`）。跨边界的不透明 id 按仓库约定用 `Branded<B>`，不用裸 `string`。
2. **`capabilities` 必填**：GitHub 有代码搜索、MediaWiki 有全文检索、MySQL 只有你给它的库结构——三者的能力差异必须当面讲清，否则模型会去调不存在的能力。
3. **`read` 与 `list` 可选**，因为「只有搜索」的源是合理形态；缺方法时**不注册工具**，而不是注册一个永远失败的。
4. **`maxReadBytes` 由 provider 强制**，按仓库约定「把上限施加在完整结果上」，并在 provider 处截断+标记，不静默截断。

## 三、三个 provider（本次范围）

| 包 | 协议 | 凭据 | 要点 |
| --- | --- | --- | --- |
| `resource-github` | 官方 REST/GraphQL | PAT（`dsh-credentials` 按名引用）；设备流/环回可后补 | **代码搜索 10 请求/分钟**——必须在能力描述与错误话术里讲明，否则读起来像坏了 |
| `resource-mediawiki` | Action API + REST | bot password（认证最友好） | **先做这个**（R2 裁定）。`read` 取页面 wikitext 或渲染文本，`search` 用全文检索，`list` 列分类成员 |
| `resource-mysql` | MySQL 协议 | 连接串 + 用户名 + 密码（密码进 credentials） | 见下节的安全约束 |

## 四、MySQL 的安全约束（本设计最重要的一节）

一个让模型自由执行 SQL 的源等于把数据库交给它。因此：

1. **只读连接**：连接以只读方式建立并施加语句白名单——只允许 `SELECT`（含 `SHOW`/`DESCRIBE` 这类结构读取），其余一律拒绝。
2. **拒绝在服务端而非提示词里**：按仓库约定「在做出决定的那次操作里强制」，所以判定在 provider 的查询入口，任何直接或替代调用方都绕不过。
3. **默认不暴露整库**：配置里显式列出允许的库/表；未列出的一律不可见（默认拒绝，而非默认允许）。
4. **结果有界**：行数与字节数都有上限，超限截断并标记。
5. **不做写操作**，本阶段没有例外；将来若要做，必须单独评审。

**能力描述必须写出这些限制**，让模型知道它拿到的是只读、受限、有界的视图。

## 五、配置与凭据

- 每种源一个 `dsh-settings` 命名空间（schema 驱动），面板据此渲染表单并显示「每个字段来自哪一层」。
- 密钥一律经 `dsh-credentials` **按名引用**，永不进配置文件、永不上线（`settings-controller` 已做命名空间脱敏）。
- **不新增持久化域**，与 T2 的 R1 一致。
- 未配置的源在面板上显示「未配置」且**不建连接**；配置了但连不上要显示错误词与最后错误。

## 六、面板（新包 `packages/client/ui-sidebar-sources`）

新 tab kind **`sources`**、`order: 700`、`visibility: 'available'`、页面型（不认领地址、不声明 `patterns`）。

自上而下：源列表（按 kind）→ 每个源的连接状态与最后错误 → 凭据字段 → 保存 → 折叠说明（含该源的硬限制，如 GitHub 搜索配额、MySQL 只读与可见库表范围）。

## 七、明确不做，并记录原因

| 源 | 原因 |
| --- | --- |
| 360云盘 | **产品已停服**（2016-11-01 起停止写入，2017 数据清空） |
| 网易云盘 | **产品已关闭**（2019-11-30 关闭，2023-07-19 文件中心下线）；与网易云音乐云盘不是同一产品 |
| 夸克云盘 | **无官方 API**，只有重放的 `__pus` cookie 与硬编码 SIGN_KEY；ToS 点名第三方客户端并允许冻结账号 → 按 R2 不做 |
| 百度云 | 有官方开放平台与设备码流程，但**未审核应用被限制在 `/apps/{appname}`、10 请求/小时、10 用户**，不构成资料库。若要做，需先明确它只是「单目录小工具」 |

**替代路径**（若负责人仍想接网盘）：WebDAV / S3 兼容（`@aws-sdk/client-s3` 已在仓库内）/ 本地挂载目录（零新代码，`fs` 能力已覆盖）。

**待负责人发话**：360AI云盘是与已停服的 360云盘**不同的在用产品**，有官方 Apache-2.0 CLI/MCP，但标注「限时体验/请勿商用」。是否纳入，需要一句话。

## 八、验收面与验证边界

- 无凭据时：面板显示未配置且不建连接；工具**不注册**（而不是注册后失败）。
- 单测：只读白名单拒绝写语句、可见库表默认拒绝、结果上界、各 provider 的 ref 往返、能力缺失时不注册工具。
- **验证边界**：没有真实 GitHub PAT / MySQL / MediaWiki 实例，端到端只能到假传输层为止；最终报告必须标注哪些路径未经真机验证。

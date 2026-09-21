# 通道接缝设计（远端控制）

依据：`01-verified-facts.md` 的 P1–P8（penguin-harness 参考实现）、F7（本仓库无任何通道抽象）、F10（settings/credentials/authorization 三件现成基础设施）、R1（设置级可编辑）。

本文件是阶段二的**接口冻结稿**：先定 Service Definition，再定通用桥，再定面板。实现时以本文件为准。

## 一、为什么是"两层缝"而不是一层

penguin 的可行之处在于它把**线协议**和**生命周期+配置**分成了两层（P1）。本仓库现有的 `TuituiTransport`（F8）正好只是**线缝**——它管连接、收发、回调，但不含绑定、去重、排队、分段。若把线缝当唯一接缝，每加一个平台都要重抄一遍通用行为（推推的 1054 行里大半是这些）。

因此：

| 层 | 角色 | 归属 |
| --- | --- | --- |
| **线缝**（已有） | 一个平台怎么连、怎么收、怎么发 | 各平台自己的 client（推推已有 `TuituiTransport`） |
| **连接器缝**（新增） | 一个平台要什么配置、怎么建 client、怎么连、回复额度多少 | 每平台一个 Provider 包 |
| **通用桥**（新增） | 绑定、去重、会话锁、排队、回合、收集、分段、引用、文件投递、通知、状态、错误分类 | 一个 Consumer 包 |
| **面板** | 展示与配置 | 一个 Client 包 |

**通用桥是这次真正要写的东西**，也是唯一值得从 penguin 原样搬的部分。

## 二、Service Definition（新包 `packages/channel/channel`）

```ts
/** One normalized inbound chat message. Media is a lazy handle, not a URL or bytes. */
export interface ChatInboundMessage {
  /** Channel-scoped conversation id; the reply target for a direct chat. Opaque to the bridge. */
  readonly chatId: string
  readonly chatKind: 'direct' | 'group'
  /** The platform's message identity: the dedupe key. Empty opts out of dedupe. */
  readonly messageId: string
  /** The message text, or null when the message carries no text (a caption IS this field). */
  readonly text: string | null
  readonly images?: readonly ChatInboundImage[]
  readonly files?: readonly ChatInboundFile[]
  readonly senderName?: string
}

/** A lazily fetched attachment: bytes are never transferred until the bridge has admitted the message. */
export interface ChatInboundFile {
  readonly fileName: string
  fetch(maxBytes: number): Promise<Uint8Array>
}
export interface ChatInboundImage {
  fetch(maxBytes: number): Promise<{ readonly data: Uint8Array; readonly mime: string }>
}

/** Outbound operations one platform client offers. */
export interface ChatClient {
  /** Probe the credentials and describe the account; null when the platform offers no account fact. */
  checkCredentials(): Promise<ChatAccountInfo | null>
  sendText(chatId: string, text: string, options?: { readonly markdown?: boolean }): Promise<void>
  replyText(messageId: string, text: string, options?: { readonly markdown?: boolean }): Promise<void>
}

/** Handlers the connector reports through. `connect` resolves once the connection is CONSTRUCTED. */
export interface ChatConnectorHandlers {
  readonly onMessage: (message: ChatInboundMessage) => void
  readonly onReady?: () => void
  readonly onError?: (error: unknown) => void
}

/** One platform's lifecycle + configuration seam. One provider package per channel. */
export interface ChatChannelConnector {
  readonly channel: ChatChannelId
  /** Max outbound messages per ONE inbound message; undefined means no platform limit. */
  readonly replyBudget?: number
  /** The capabilities the panel must surface as hints (markdown subset, media, size caps). */
  readonly capabilities: ChatChannelCapabilities
  createClient(config: ChatChannelConfig): Promise<ChatClient>
  connect(config: ChatChannelConfig, handlers: ChatConnectorHandlers): Promise<{ close(): void }>
}

/** The registry service (`ctx.chatChannels`), the one place the bridge and the panel read. */
export interface ChatChannels {
  register(connector: ChatChannelConnector): Disposer
  list(): readonly ChatChannelConnector[]
  get(channel: ChatChannelId): ChatChannelConnector | undefined
}
```

**关键设计点**

1. **`mediaUrls: readonly string[]` 不要照抄**（F8 现状）。那是急切取值：中继重投的消息也会被下载，且限额无处施加。改成惰性 `fetch(maxBytes)`：字节只在桥判定"不是重投"之后才传输，上限在传输处生效。原字段可作为 `raw` 里的原始事实保留。
2. **`ChatChannelId` 用声明合并可扩展**，不写成封闭联合——否则每加一个平台都改核心包。
3. **`connect` 在"连接已构造"时就 resolve**，生命周期只经 handlers 抵达（P1：平台会自行重连，等"连上"会永久挂起）。
4. **`capabilities` 是必填的**：P8 的硬限制（QQ 回复额度、Telegram 4096、微信仅单聊、推推无引用）必须在类型上强制每个连接器声明，面板才能把"这个渠道做不到什么"当面讲清，而不是让用户从空聊天里自己发现。

## 三、通用桥（新包 `packages/channel/channel-bridge`）

职责与顺序（照 P2/P6/P7，但**入站准入改走本仓库的 agent/session 服务**）：

1. **去重**：按平台 `messageId`，每绑定一个**有界环形**（照 P3 的 64 条）+ 持久水位线；水位线**最后写**，于是中途崩溃是"至少一次"而不是静默吞掉。
2. **会话锁**：一个绑定只回答最先开口的那个会话，其余**静默忽略**（P6）。这条很小但关键，防止跨会话串上下文。
3. **准入**：文本消息变成该会话的一轮用户输入，`queueIfBusy` 语义——忙碌时排队而不是拒绝。
4. **媒体**：图片按输入框同口径内联；文件**落盘并具名**，字节不进对话。
5. **出站**：只取**已完成的助手文本**；默认"每条完成即发"；所有发送与通知串在**一条 promise 尾巴**上（P7），免得审批通知插进一条回复中间。
6. **分段**：4000 字符、格式感知（不切断代码围栏/实体）；被平台拒绝渲染时**退回纯文本重发一次**。
7. **引用**：群聊只给整轮第一条加引用。
8. **文件投递**：只发"本轮提到**且本轮真写过**"的文件（mtime ≥ 本轮开始）。**这是安全属性，不是体验细节**——没有它，可被引导的回复会变成读取原语。
9. **通知话术**：单一表，双语文案。
10. **错误分类**：按**类型**在**具名捕获点**分类，不做消息文本匹配。

**必须保留的本仓库差异**：模型**知道**消息来自哪个渠道——沿用 F8 的 `MessageSourceMap` 声明合并（`kind` + chatId/chatType/senderId/senderName）。penguin 刻意隐藏来源（P6），此处**不照抄**。

## 四、配置与凭据（按 R1：设置级可编辑）

- 每个渠道注册一个 `dsh-settings` 命名空间（schema 驱动），面板从 settings 拿到**描述符**即可渲染表单，并显示"每个字段来自哪一层"。
- 密钥**一律按名字经 `dsh-credentials` 引用**，永不进配置文件、永不上线（`settings-controller` 已做命名空间脱敏，F12）。
- 贴码/设备码类绑定（飞书与钉钉的密钥粘贴、百度云式设备码）用 `dsh-authorization` 的现成流程：`secret` prompt 收码；浏览器回调与手输码用 prompt 自带的 `signal` 互斥竞速（该字段的 JSDoc 正是为此而设）。人在面板上完成，凭据记录提交进 credentials 存储。
- **扫码类（微信登录、QQ 绑定）需要先补一个能力**：`AuthorizationPrompt` 目前只有 `text | secret | select`（`packages/credentials/authorization/src/types.ts:43-62`），**没有二维码/图片种类**。实测确认，不是猜测。两条路：
  - **（推荐）给该联合新增一个 `qr` 种类。** 授权能力已经拥有这条流程的全部事实：每凭据一条流程、忙闲状态、取消、单个 prompt 的撤回、竞速、提交、旁观事件流。二维码登录需要的正是这些**再加**一个图像与过期换码，而 `signal` 的「撤回此条 prompt、流程继续」语义恰好就是过期换码。在面板里重做一遍等于把这些事实复制到第二个归属地，违反「一个事实一个归属地」。
  - （不推荐）二维码画在面板自有面上：面板将被迫自己维护忙闲、取消、提交与错误状态，即重复授权能力的职责。
- **二维码内容可能内嵌登录令牌**，必须与 `secret` 同等对待：不进日志、不进 session log、不在错误消息里回显。
- **不新增持久化域**——这是 R1 相对 penguin 的 `messaging_bindings` 表（P4）的主要差异。代价：没有"每会话各自绑定"的能力；若日后需要，须单独立项评审存储。

## 五、面板（新包 `packages/client/ui-sidebar-channels`）

新 tab kind **`channels`**，`order: 600`，`visibility: 'available'`，页面型（不认领地址、不声明 `patterns`）。

自上而下：渠道选择 → 连接控件（启用开关 + 状态词 + 最后错误 + 上次入站时间）→ 凭据字段 → 投递偏好 → 保存 → 折叠说明。**渠道专属字段以数据声明，不在渲染器里写分支**（P6 的做法：每渠道一个子状态接口 + 一张可空的"前往控制台"链接表——没有官方控制台的渠道就该是 null，编一个 URL 是猜）。

必须显示的三种"什么都没发生"的成因：**没配**、**配了没启用**、**启用了但连不上**——外加**连上了但收不到**（用 `lastInboundAt`）。

## 六、逐平台事实（实现时逐一核对，均来自 P8）

| 渠道 | 传输 | 凭据与来源 | 公网需求 | 本次范围 |
| --- | --- | --- | --- | --- |
| 推推 | 单 WebSocket | appId + appSecret + host | 无 | **已存在，只接入，不重写** |
| 飞书 | SDK WebSocket 长连接 | appId + appSecret（开放平台自建应用） | 无 | 做 |
| 钉钉 | Stream 模式长连接 | clientId + clientSecret | 无 | 做（**全新，无任何参考实现**，见 F7/P3） |
| QQ | WebSocket 网关 | appId + appSecret，或扫码 | 无 | 做（**被动回复额度记账**单聊 4 / 群 5、窗口 5 分钟——最值得单测的策略） |
| 微信 | 长轮询 | **只能扫码，无控制台可抄** | 无 | 做（仅单聊） |
| ~~Telegram~~ | — | — | — | **不在负责人清单内，不做** |

**打包坑**：`@larksuiteoapi/node-sdk` 使用 `__dirname`，曾在同类项目的 ESM 打包里以 `__dirname is not defined` 导致连接失败（见 `01-verified-facts.md`）——引入飞书连接器前先确认打包形态。

## 七、验收面

- 无凭据时：面板显示"未配置/为何置灰"，且**不建连接**。
- 配了未启用：显示已保存 + 未启用。
- 启用后连不上：显示错误词 + `lastError` + 上次连接错误**在恢复后仍显示**（否则抖动的令牌读起来像干净）。
- 推推：把现有桥接进面板后，**面板有真数据**——这是本阶段的竖切面验收点，也是为什么把推推排在第一个接入。
- 单测：去重环与水位线顺序、会话锁、分段不切断围栏、QQ 额度记账、错误分类按类型。

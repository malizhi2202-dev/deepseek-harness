# 聊天渠道

[English](channel.md) | 中文

聊天渠道子系统让聊天平台驱动一个 Agent Session，并把该 Session 已完成的回复镜像回会话。它是一个能力缝隙，包含三个角色：[dsh-channel](../../packages/channel/channel) 是服务定义，[dsh-channel-tuitui](../../packages/channel/channel-tuitui) 是适配既有平台传输的提供方，[dsh-channel-bridge](../../packages/channel/channel-bridge) 是所有平台共用的消费方。[dsh-api-channels](../../packages/api/channels) 通过 Typert Remote 向配置面板暴露状态与启用/停用绑定。

Source: [`packages/channel/channel/src/index.ts`](../../packages/channel/channel/src/index.ts)

## 缝隙

连接器声明其平台能做什么，并交出两样东西：一条规范化入站消息（其媒体是惰性获取句柄），以及一个出站客户端。它从不接触 Session、设置文档或凭据值。

`ChatChannelIdMap` 可被合并扩展，因此提供方从自己的 `./types` 模块添加平台 id，新增平台无需改动定义。该映射以 `tuitui` 为种子值——本仓库唯一内置的平台——因此消费方单独编译时也能得到可用的 id 集合。

`ChatChannelCapabilities` 是面板对限制的陈述：`replyText` 是否引用、存在哪些附件方向、是否渲染 Markdown，以及平台的文本与字节上限。桥接层会执行出站方向与上限，而不是让用户从沉默中去发现它们。

`ChatInboundMessage` 携带文本，以及可选的图片和文件，二者都是 `fetch(maxBytes)` 句柄。在桥接层接纳该消息之前不会传输任何内容，且字节上限随传输一同传入，因此超大附件会在越过上限的那个字节处被拒绝，而不是先整份缓冲再测量。

## 桥接层拥有什么

桥接层是跨平台决策唯一的所在。其中四项属于安全属性，而非便利功能。

**会话锁定。** 第一个与被绑定渠道通话的会话被记录在已接纳的 `user/message` 事件来源上，之后每条回复都发往该会话。第二个找到机器人的会话会到达同一个 Agent，但收不到任何回复，因此被加入公开群的机器人无法把一个会话泄露到另一个会话。

**出站文件。** 被投递的文件必须同时被回复点名、且由该轮写入。归属由文件系统缝隙在 Session 工作区内判定，时效性由文件自身的修改时间与该轮开始时刻比较得出。点名一个路径本身不构成任何证明，因此被诱导点名工作区之外文件、或工作区内既有文件的回复不会投递任何东西。

**去重。** 平台在重连后会重投，而下游没有任何幂等性。两份记忆应对它：一个进程内有界环形表，以及一个从 Session 自身日志推导出的持久水位线——因为已接纳的消息本身就是一条事件，其来源携带平台消息 id。因此持久记录随认领该输入的那一轮一同提交，且发生在接纳之后，所以崩溃不会留下水位线，重投会被再次接纳而不是被吞掉。

**模型可见来源。** 每条被接纳的提示都携带 `source.kind: "channel"`，包含平台、会话、会话类型与平台消息 id，因此模型知道其输入来自何处，水位线也始终可从日志推导。

转发本身刻意收窄：只有已完成的 `assistant/message` 文本会到达聊天，按部署分块大小与平台自身上限中更严的一个切分，并在平台拒绝渲染形式时做一次纯文本重发。没有任何聊天参与者能回答的批准请求会在会话中被公告，而不是让会话保持沉默。

## 配置与凭据

一个渠道对应一个 `dsh-settings` 命名空间 `chat-channel-<channel>`，其中包含桥接层的共享字段（`enabled`、`sessionId`、`markdown`、`finalReplyOnly`），并围绕连接器自身字段组合而成。连接器的 cordis.yml `config` 是该命名空间的组合层，因此部署默认值位于配置该插件的文件中，用户编辑叠加其上。没有绑定表，也没有第二个持久化域：绑定即设置段，持久去重与会话锁定状态即 Session 日志。

密钥按名称引用，绝不存放在该段中。连接器声明 `credentialFields`，Remote 端点按名称报告每个具名 `dsh-credentials` 引用是否已配置，绝不报告其值。

至多一个已启用渠道可服务同一个 Session。为同一 Session 启用第二个渠道会被拒绝，并给出点名已绑定渠道的消息，因为两个平台回答同一会话会让每条回复都翻倍。

## 平台事实

`dsh-channel-tuitui` 适配本仓库既有的传输，自身不拥有任何协议。Tuitui 没有回复引用，因此 `capabilities.quoting` 为 false，群回复就是一条普通消息。它在两个方向上都不携带附件：传输只把媒体作为已渲染进消息文本的 URL 交出，因此模型仍能收到 URL，但永远收不到原生图片或文件块。传输的接收循环不上报握手，也会吞掉自身的重连失败，因此连接器在循环开始运行时即报告就绪，而一个始终未打开的套接字在该缝隙上与空闲状态无法区分。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxchannels--channels"></a>

### `ctx.channels` — `Channels`

Host Remote service reporting the chat channels and moving one binding.

```ts cordis-catalog
/**
 * Read every channel's status.
 *
 * The bridge binds connectors that registered after it mounted, so this call
 * settles the registry first: a channel a plugin added a moment ago is
 * reported rather than missing.
 * @returns one view per registered channel, in registration order.
 */
@Remote async status(): Promise<ChannelsStatus>

/**
 * Test whether one channel can build a client with its configured credentials.
 *
 * A channel that cannot is answered, not rejected: `ok: false` with the
 * reason is what the panel shows, and only an unregistered channel is an
 * error.
 * @param channel - the channel id to probe, as the panel knows it.
 * @returns what the probe found.
 * @throws {RemoteError} with code `channels/unknown` when no such channel is registered.
 */
@Remote async probe(channel: string): Promise<ChannelProbe>

/**
 * Point one channel at one Session and open its connection.
 * @param channel - the channel id to bind.
 * @param sessionId - the Session the channel drives.
 * @returns the status after the change.
 * @throws {RemoteError} with code `channels/unknown` or `channels/failed`, whose message names what to fix.
 */
@Remote async enable(channel: string, sessionId: string): Promise<ChannelsStatus>

/**
 * Close one channel's connection, leaving its configuration otherwise intact.
 * @param channel - the channel id to close.
 * @returns the status after the change.
 * @throws {RemoteError} with code `channels/unknown` or `channels/failed`.
 */
@Remote async disable(channel: string): Promise<ChannelsStatus>
```

Source: [`packages/api/channels/src/index.ts`](../../packages/api/channels/src/index.ts)

<a id="ctxchatbridge--chatbridge"></a>

### `ctx.chatBridge` — `ChatBridge`

The generic bridge: it binds connectors to Sessions, admits what arrives, and relays what those Sessions produce.

```ts cordis-catalog
/**
 * Bind every registered connector that is not bound yet, and drop the
 * bindings whose connector left the registry. Idempotent; the configuration
 * panel calls it before reading a status so a connector that registered after
 * this plugin mounted is not invisible.
 */
sync(): void

/**
 * Every registered channel's status, in registration order.
 * @returns one status per bound channel.
 */
statuses(): readonly ChatChannelStatus[]

/**
 * One channel's status.
 * @param channel - the channel to read.
 * @returns its status, or undefined while the channel is unregistered.
 */
status(channel: ChatChannelId): ChatChannelStatus | undefined

/**
 * Point one channel at one Session and open its connection.
 * @param channel - the channel to bind.
 * @param sessionId - the Session the channel drives.
 * @throws {Error} when the channel is unregistered, the Session does not exist,
 *   or another channel already serves that Session.
 */
async enable(channel: ChatChannelId, sessionId: string): Promise<void>

/**
 * Close one channel's connection and leave its configuration otherwise intact.
 * @param channel - the channel to close.
 * @throws {Error} when the channel is unregistered.
 */
async disable(channel: ChatChannelId): Promise<void>

/**
 * Test whether one channel can build a client with its configured credentials.
 *
 * The probe never opens a connection: it asks the platform nothing a client
 * cannot answer from its own configuration, which is what makes it safe to
 * run while the channel is live.
 * @param channel - the channel to probe.
 * @returns what the probe found; a failure is a value, not a rejection.
 * @throws {Error} when the channel is unregistered.
 */
async probe(channel: ChatChannelId): Promise<ChatProbeResult>
```

Source: [`packages/channel/channel-bridge/src/index.ts`](../../packages/channel/channel-bridge/src/index.ts)

<a id="ctxchatchannels--chatchannels"></a>

### `ctx.chatChannels` — `ChatChannels`

Registry of chat-channel connectors, keyed by platform id.

```ts cordis-catalog
/**
 * Register one platform's connector. Registration is an effect: the entry
 * disappears when the returned disposer runs or the owning fiber unloads.
 * @param connector - the platform's lifecycle and configuration seam.
 * @returns the disposer removing this entry.
 * @throws when a connector for the same platform is already registered, which
 *   is a composition mistake rather than a race: two connectors for one
 *   platform would leave the panel showing whichever registered last.
 */
register(connector: ChatChannelConnector): () => void

/**
 * Every registered connector, in registration order.
 * @returns a detached array; later registrations do not change it.
 */
list(): readonly ChatChannelConnector[]

/**
 * The connector for one platform.
 * @param channel - the platform to look up.
 * @returns the connector, or `undefined` when this build has none.
 */
get(channel: ChatChannelId): ChatChannelConnector | undefined
```

Source: [`packages/channel/channel/src/index.ts`](../../packages/channel/channel/src/index.ts)
<!-- END GENERATED cordis-surface -->

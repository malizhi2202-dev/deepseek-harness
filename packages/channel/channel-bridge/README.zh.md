---
description: "面向把渠道绑定到 Session 的运维者，以及维护其去重、会话锁定、接纳与回复文件规则的维护者的平台无关聊天渠道桥接层。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-bridge

[English](README.md) | 中文

## 概述

`dsh-channel-bridge` 是聊天渠道缝隙的消费方一半：所有关于「用聊天平台驱动 Agent Session」中与平台无关的部分。它把每个已注册连接器通过该渠道的 `dsh-settings` 命名空间绑定到一个 Session，对接收到的内容去重，将其作为一条普通用户轮次接纳，并把该 Session 已完成的回复及其各轮写入的文件转发回会话。

它的三项决策属于安全属性而非便利功能。**会话锁定**使最先开口的会话成为该渠道唯一答复的对象。**回复文件过滤**只投递既被回复点名、又由该轮写入、且位于 Session 工作区内的文件。**去重**在接纳之前执行，其持久记录就是被接纳消息自身的 session 事件，因此平台重投无法变成第二次运行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

插件自行挂载；除下列边界外不需要 cordis.yml `config`，并注入 `agents`、`attachments`、`chatChannels`、`fs`、`sandboxPolicy` 与 `settings`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `chunkChars` | `4000` | 每条出站消息的字符数；还会被平台自身的 `maxTextChars` 进一步收窄。 |
| `dedupeSize` | `64` | 单个绑定在其持久水位线之外记住的近期入站 id 数量。 |
| `maxReplyFiles` | `5` | 单条回复可投递的文件数；超出部分会在通知中计数。 |
| `mtimeGraceMs` | `2000` | 文件可在该轮开始前多久被写入、仍算作该轮产出。 |
| `maxInboundFileBytes` | `31457280` | 传入 Session 的入站附件上限。 |
| `maxOutboundFileBytes` | `31457280` | 从 Session 工作区读出的出站文件上限。 |

每个渠道自己的设置命名空间 `chat-channel-<channel>` 携带 `enabled`、`sessionId`、`markdown`、`finalReplyOnly`，并围绕连接器字段组合而成。`enable(channel, sessionId)` 与 `disable(channel)` 是移动绑定的唯一途径；[dsh-api-channels](../../api/channels/README.zh.md) 中的 Remote 端点是面板的调用方。

<a id="understand-the-implementation"></a>
## 理解实现

**去重。** 平台在重连后会重投，而下游没有任何幂等性，因此检查在接纳之前执行。`RecentInboundIds` 是一个由 Session 日志播种的有界环形表，`channelLogMemory` 从该日志中最新的渠道来源 `user/message` 事件推导持久水位线——不需要第二个持久化域，因为已接纳的消息本身就是权威记录。环形表条目在接纳开始时写入，若消息被拒绝则释放，因此已被告知聊天的消息不会在重投时被静默丢弃。

**会话锁定。** `channelLogMemory` 同时读取*最早*的渠道来源 `user/message` 事件，其来源点名了最先开口的会话。来自其他会话的消息在接纳前被丢弃：它到不了任何 Agent，也得不到任何回复。锁定存放在 Session 日志而非本包中，因此可跨重启存续。

**接纳。** 桥接层构建内容块——先是文本，然后是图片，最后是文件——在某个上限下传输每个附件，并调用 `agent.followup(createUserMessage(...))`。这正是该缝隙所需的 `queueIfBusy` 语义：一条普通后续轮次，唤醒驱动器，排在正在运行的任务之后而不是被拒绝。提示的来源是 `{ kind: 'channel', channel, chatId, chatKind, messageId, senderName? }`，因此模型知道其输入来自何处，水位线也始终可推导。

**出站转发。** 只有本桥接层所接纳轮次中已完成的 `assistant/message` 文本会到达聊天。同一 Session 的每次发送与通知都串行在单一 promise 尾部，因此批准通知不会落在回复中间。文本按 `chunkChars` 与平台 `maxTextChars` 中更严的一个切分，并按平台 `replyBudget` 通过合并尾部而非丢弃来收窄，且在平台拒绝渲染形式时以纯文本重发一次。群回复恰好引用该轮的那条入站消息一次，且仅在连接器声明 `quoting` 时进行。

**回复文件。** 被投递的文件必须同时被回复点名、且由该轮写入。`replyFileMentions` 提取路径形态的候选，`ctx.fs.resolve` 与 `ctx.fs.contains` 把每个候选限制在 Session 工作区内，宿主 `stat` 要求修改时间不早于该轮开始时刻减去 `mtimeGraceMs`。点名一个路径本身不构成任何证明，因此被诱导点名工作区之外文件的回复不会投递任何东西；被该过滤器拒绝的名称会被记录日志，因为这正是值得被看见的读取原语尝试。

<a id="model-experience"></a>
## 模型体验

### 聊天轮次

#### 模型看到什么

每条被接纳的聊天消息成为一条用户轮次。其内容是一个携带消息文本的 `text` 块，随后是每条入站图片一个 `image` 块、每个入站文件一个 `file` 块，各自持有持久附件引用。其来源是 `source.kind: "channel"`，包含 `channel`、`chatId`、`chatKind`、`messageId` 以及可选的 `senderName`——平台、会话、该会话是私聊还是群聊、平台自身的消息标识，以及平台上报时的发送者显示名。

桥接层无法传输的附件会被替换为发往聊天的双语通知，而不是提示中的占位符：模型只看到实际存在的块。

#### Token 影响

消息文本及其 `channel` 来源元数据被记入 Session，并按预设的压缩行为在之后的每次请求中重新包含。图片与文件成为提供方原生内容块，其大小由附件服务与提供方适配器决定，而非本包。此处不添加任何框架性文字、指引或系统提示文本。

#### KV Cache 影响

仅追加。来源元数据是逐消息的，本包不贡献任何自己的稳定前缀，因此前缀复用与同一预设下任何其他用户轮次完全一致。发往聊天的通知不属于请求的一部分，也不会使复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **会话锁定永不移动**——最先开口的会话在该绑定的整个生命周期内拥有该渠道；改绑到另一个会话需要清空被绑定 Session 的日志，或绑定另一个 Session。
- **无法携带文件的渠道会静默地不投递任何文件**——`capabilities.outbound.files: false` 会完全跳过回复文件投递；配置面板陈述该限制，而聊天对自己收不到的文件一无所知。
- **`mtimeGraceMs` 是唯一的时效信号**——在该宽限窗口内重写既有文件的一轮会投递被重写的文件，而未写入任何内容却点名了窗口内被其他进程触碰的文件的一轮会投递该文件。
- **修改时间经宿主文件系统读取**——归属与字节来自文件系统缝隙，但修改时间来自对已解析路径的宿主 `stat`，因此工作区不在宿主上的后端无法应用时效过滤。
- **无消息编辑或表情回应**——转发只发送新文本与文件；平台的原地编辑、表情回应与交互卡片操作在本缝隙之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：这些安全属性在作出决策的操作中执行，并由本包自身测试套件针对连接器桩件固定。

</details>

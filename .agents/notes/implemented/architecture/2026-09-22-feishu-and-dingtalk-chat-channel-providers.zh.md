# Agent Note: Feishu and DingTalk chat-channel providers

Status: implemented

[English](2026-09-22-feishu-and-dingtalk-chat-channel-providers.md) | 中文

## 问题

聊天渠道缝隙上线时只有一个提供方 `channel-tuitui`，它适配的是本仓库已经拥有的传输。运维者需要用团队已在使用的平台驱动 Session，于是还需要两个：飞书（Feishu）与钉钉（DingTalk），而本仓库两者都没有传输。两者都用应用 id 与应用密钥认证自建应用，也都在长连接上投递机器人消息，因此工作性质相同：把一个平台的入站事件规范化成缝隙的消息，并实现缝隙的出站客户端，同时不把任何跨平台决策移出[桥接层](../../../../packages/channel/channel-bridge/README.zh.md)。

两个平台的协议都不小。飞书的长连接需要端点发现、握手、心跳、重连与带类型的事件信封；钉钉的需要网关发现、按主题订阅、逐消息确认与重连。两者都手写意味着要自己拥有两套协议、它们的重试策略与线上格式。

## 决策

两个提供方包加入缝隙：`packages/channel/channel-feishu`（`@deepseek-ai/dsh-channel-feishu`）与 `packages/channel/channel-dingtalk`（`@deepseek-ai/dsh-channel-dingtalk`）。每个都是导出 `name` / `inject` / `Config` / `apply` 的函数插件，注入 `chatChannels` 与 `credentials`，声明一个设置命名空间（`chat-channel-feishu`、`chat-channel-dingtalk`），并点名其配置段持有的凭据引用字段。两者都注册进 `dsh-web-app` 组合，远端控制面板从它们的描述符绘制它们，客户端无改动。

两个包都依赖平台的官方 SDK 处理协议，不手写任何 SDK 已拥有的部分。每个 SDK 都是精确固定版本的运行时 `dependency`，因此 tsdown 将其外部化，由 Node 在运行时加载。

- **飞书：`@larksuiteoapi/node-sdk@1.74.0`。** 它既不提供 `exports` 映射也没有 `type` 字段，因此 Node 加载其 CommonJS 构建，`__dirname` 得以解析。在接受该依赖之前，已在源码启动路径（`node --import tsx/esm`）与打包后的 `lib/index.js` 上验证过。
- **钉钉：`dingtalk-stream@2.1.6-beta.1`。** 它发布的 `latest` 标签是 beta，因此按精确版本而非范围固定。它拥有网关发现、WebSocket 连接、逐消息确认与重连，并已在同样的两条启动路径上验证。

### 迫使偏离缝隙的平台事实

- **飞书只在交互卡片内渲染 Markdown**，而 `lark_md` 不渲染标题与围栏代码块。`packages/channel/channel-feishu/src/markdown.ts` 把标题变成加粗行，去掉围栏分隔行而逐字保留代码，然后把渲染结果对照平台的字符上限度量，超出即抛 `ChatFormatRejectedError`——桥接层正是以纯文本重发同一分块来回应这个错误。
- **飞书把拒绝表示为 HTTP 200 响应体中的非零 `code`。** 被拒绝的交互卡片归档为 `ChatFormatRejectedError`，被拒绝的纯文本消息或上传则归档为携带平台自身原因的普通失败。
- **飞书对畸形应用 id 只记录日志并返回**，而不报错，这会让面板报告一个永远收不到任何东西的连接。因此提供方在配置阶段校验 `cli_` 加 16 位十六进制数字的形式。
- **`im.message.receive_v1` 携带发送者 id 但不带显示名。** 规范化消息省略 `senderName`，而不是为解析它每条消息多花一次 API 调用。
- **钉钉通过回调自身携带的会话 webhook 回复**，并带过期时间戳，而不是通过经认证的 API 调用。连接器在入站消息到达时按会话记录该 URL，并通过仍然有效的那个发送；没有有效 webhook 时发送会以可读原因失败，而不会回退到未经验证的端点。
- **钉钉的上限以字节计，而桥接层以字符计。** `capabilities.maxTextChars` 取字节上限除以 UTF-8 最长编码，因此无论用什么语言书写，桥接层构建的任何分块都无法超出真实上限；渲染结果还会额外按字节度量。
- **钉钉要求 Markdown 消息带标题**并在推送通知中显示它，因此消息的第一个非空行充当标题。
- **钉钉 SDK 吞掉首次连接失败**并自行重试且不提供回调，因此 `connect` 依据套接字自身的 `connected` 状态上报失败。

### 能力按已实现范围声明

飞书声明引用回复、入站图片与文件、出站文件与 Markdown；出站图片声明为 false，因为缝隙的客户端没有图片发送接口，提供方也不实现任何图片上传路径。钉钉只声明 Markdown：会话 webhook 只接受文本或 Markdown 消息体，而钉钉把入站图片或文件作为本连接器不兑换的 `downloadCode` 投递。每个被声明为 false 的方向在提供方中都没有代码路径，而在能力为 false 之处，`replyText` 与 `sendFile` 以 `ChatUnsupportedError` 拒绝。

## 考虑过的替代方案

**两个协议都手写。** 每个 SDK 都删除了自有代码、其测试与其重试策略，这正是[依赖优先于手写策略](../process/2026-07-26-dependencies-over-hand-rolling.zh.md)所偏好的。代价被接受并记录：飞书 SDK 拉入七个传递依赖，包括 `axios` 与 `protobufjs`，钉钉的则带 beta。手写被拒绝，因为它会把另外两套协议实现塞进一个其缝隙存在的意义就是让平台协议留在桥接层之外的仓库。

**通过机器人 OpenAPI 端点发送钉钉消息。** `/v1.0/robot/oToMessages/batchSend` 与 `/v1.0/robot/groupMessages/send` 需要访问令牌与会话到地址的映射。它们的端点路径与参数名无法核实——平台参考页在客户端渲染——因此提供方使用回调已携带的会话 webhook，它不需要未经验证的端点。代价记录在「已知限制」中：会话的第一条出站消息必须跟在入站消息之后、且在 webhook 生存期内。

**为飞书声明出站图片并照样上传。** 缝隙的客户端没有图片发送接口，因此被接受的上传会是一个无从触达的能力。提供方改为声明 false。

**让平台拒绝过长消息，而不是自己去度量。** 桥接层按字符分块，而两个平台的上限都不是字符，因此符合桥接层计数的分块仍可能被拒绝。在提供方内度量把这种情况变成同一分块的纯文本重发，而不是一条丢失的消息。

## 后果

- **又有两个平台可以驱动 Session，而桥接层对二者一无所知。** 去重、会话锁定、接纳、出站转发与回复文件投递都留在一处，提供方只承载平台转换。
- **本仓库现在在运行时依赖两个第三方 SDK。** 二者都精确固定版本，都能在源码与打包启动路径上加载，也都没有被打进发布产物。
- **远端控制面板无需客户端改动即可列出三个渠道。** `apps/web/tests/snapshots/sidebar-channels/panel.expected.md` 被重新录制，因为组装后的组合现在服务三个连接器；面板自身代码未被触碰。
- **钉钉回复依赖会话 webhook 的生存期。** 最近没有收到任何消息的会话在收到之前无法被发送。这是平台的模型，而替代方案是未经验证的端点。
- **飞书消息不带发送者显示名，也不支持文本、富文本、图片与文件之外的消息类型。** 二者都记录在各包的「已知限制」中，而不是被掩盖。

## 测试

每个包的测试套件固定其配置收窄与它点名的第一个字段、对畸形名称与背后无存储值的名称的凭据引用解析、包含读取器所拒绝的每种载荷的入站规范化、处于精确上限的 Markdown 降级、出站调用及其拒绝原因、连接器的就绪/失败上报，以及 `apply` 恰好注册一个连接器。两个包都保持逐文件 100% 覆盖率。`apps/web/tests/sidebar-channels.e2e.ts` 启动出厂组合并固定这两个连接器所产生的面板。

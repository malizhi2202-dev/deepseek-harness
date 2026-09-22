---
description: "面向配置机器人的运维者，以及维护官方钉钉 Stream SDK 与渠道缝隙之间转换的维护者的钉钉聊天渠道提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-dingtalk

[English](README.md) | 中文

## 概述

`dsh-channel-dingtalk` 是钉钉（DingTalk）聊天渠道缝隙的提供方一半。它不拥有任何协议：它解析配置点名的凭据引用，构建官方 `dingtalk-stream` 客户端，并把规范化消息流交给[桥接层](../channel-bridge/README.zh.md)。它声明一个设置命名空间 `chat-channel-dingtalk`，以及平台的能力限制。

钉钉通过按会话签发、并带过期时间戳的会话 webhook 回复机器人消息，因此本提供方在入站消息到达时记录该 URL，并通过仍然有效的那个发送。该 webhook 只接受文本或 Markdown，因此每个附件方向都不受支持，且 `capabilities.quoting` 为 false。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

该插件是函数插件（`name` / `inject` / `Config` / `apply`），注入 `chatChannels` 与 `credentials`。在桥接层挂载之后把它接入 `cordis.yml`：

```yaml
- name: '@deepseek-ai/dsh-channel-dingtalk'
  config:
    clientId: 'ding…'
    clientSecretRef: DINGTALK_CLIENT_SECRET
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `clientId` | —（必填） | 来自钉钉开发者控制台的企业内部应用 Client ID，钉钉也称其为 AppKey。 |
| `clientSecretRef` | —（必填） | 持有 Client Secret 的 `dsh-credentials` 引用名称，绝不是密钥本身。 |

cordis.yml 的 `config` 是设置命名空间的组合层，因此这些值是部署默认值，且每个字段也可在 **设置 → 插件 → 插件配置** 中编辑，无需重新部署。空字段会在首次连接时以点名该字段的消息失败；不是凭据引用名称、或其背后没有存储值的引用会以同样方式失败。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client.ts` 是全部出站转换逻辑。`readDingTalkConfig` 收窄不透明的设置段并点名第一个缺失或畸形的字段。`DingTalkWebhooks` 是连接器对每个会话可经其回复的 URL 的记录：条目一旦被读到超过其过期时间戳就被丢弃，因此绝不会向失效 URL 发送。`DingTalkChatClient` 把纯文本作为 `text` 消息发送，把带格式文本作为 `markdown` 消息发送——钉钉要求该消息带标题，并在推送通知中显示它；它以 `ChatUnsupportedError` 拒绝 `replyText` 与 `sendFile`，而已声明能力已告知桥接层绝不调用它们。

`src/markdown.ts` 拥有钉钉的降级及其两个上限。钉钉渲染标题、列表与强调，但不渲染围栏代码块，因此围栏的分隔行被去掉而内容逐字保留。平台的上限以字节计而桥接层以字符计，因此 `maxTextChars` 取字节上限除以 UTF-8 最长编码——无论消息用什么语言书写，桥接层构建的任何消息都无法超出真实上限——渲染结果按字节度量，超出即拒绝。

`src/events.ts` 校验机器人回调。Stream SDK 把消息体作为未解析的 JSON 字符串交出，因此 `src/json.ts` 读取本包依赖的每个字段。文本回调读作文本；其余消息类型都读作无文本，由桥接层以其自身的不支持提示回应。会话 webhook 及其过期时间从同一回调中读出，并在消息转发之前记录。

`src/index.ts` 在 SDK 的 Stream 客户端之上构建连接器，后者拥有网关发现、WebSocket 连接、逐消息确认与重连。Client Secret 按操作解析而非加载时解析一次，这正是轮换后的密钥无需重启即可作用于下一次连接的原因。

<a id="model-experience"></a>
## 模型体验

间接地，经由 `dsh-channel-bridge`：后者接纳本提供方产出的规范化消息，因此拥有每一个模型可见字段。

#### KV Cache 影响

无直接影响；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **两个方向上都没有附件**——会话 webhook 只接受文本或 Markdown 消息体，而钉钉把入站图片或文件作为 `downloadCode` 投递，本连接器不兑换它，因此 `capabilities.inbound` 与 `capabilities.outbound` 全为 false。
- **回复依赖有效的会话 webhook**——钉钉随每条入站消息签发一个并使其过期，因此会话的第一条出站消息必须跟在入站消息之后、且在 webhook 生存期内；没有有效 webhook 时发送会以可读原因失败，而不会回退到其他端点。
- **无引用**——`replyText` 会拒绝；回答是同会话中的一条新消息。
- **连接失败依据套接字自身状态上报**——SDK 吞掉首次连接失败并自行重试且不提供回调，因此面板把该次尝试报告为失败，而之后的背景重连成功不会被上报。
- **每个进程一个连接器**——命名空间固定为 `chat-channel-dingtalk`，因此部署无法同时绑定两个钉钉应用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：该连接器是一次转换，其唯一拥有的关系是每个已声明能力都与客户端实现一致，已由其自身测试套件固定。

官方 SDK 是运行时依赖，而非手写协议代码。它被固定到精确版本，其发布的 `latest` 标签是 beta；经 tsx 的源码启动与打包后的 `lib/index.js` 都已验证能加载它。

</details>

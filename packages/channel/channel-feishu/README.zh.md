---
description: "面向配置机器人的运维者，以及维护官方飞书 SDK 与渠道缝隙之间转换的维护者的飞书聊天渠道提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-feishu

[English](README.md) | 中文

## 概述

`dsh-channel-feishu` 是飞书（Feishu）与 Lark 聊天渠道缝隙的提供方一半。它不拥有任何协议：它解析配置点名的凭据引用，构建官方 `@larksuiteoapi/node-sdk` 客户端，并把规范化消息流交给[桥接层](../channel-bridge/README.zh.md)。它声明一个设置命名空间 `chat-channel-feishu`，以及平台的能力限制。

飞书经由自身 API 而非逐消息 webhook 回复，因此本提供方可以引用某条具体消息、接收入站图片或文件、并上传出站文件。缝隙的客户端没有图片发送接口，因此 `capabilities.outbound.images` 为 false。

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
- name: '@deepseek-ai/dsh-channel-feishu'
  config:
    appId: 'cli_…'
    domain: 'feishu'
    appSecretRef: FEISHU_APP_SECRET
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `appId` | —（必填） | 来自飞书开放平台控制台的自建应用 id，形式为 `cli_` 后跟 16 位十六进制数字。 |
| `domain` | `feishu` | 应用登录的部署：`feishu` 对应 `open.feishu.cn`，`lark` 对应 `open.larksuite.com`。 |
| `appSecretRef` | —（必填） | 持有应用密钥的 `dsh-credentials` 引用名称，绝不是密钥本身。 |

cordis.yml 的 `config` 是设置命名空间的组合层，因此这些值是部署默认值，且每个字段也可在 **设置 → 插件 → 插件配置** 中编辑，无需重新部署。空字段会在首次连接时以点名该字段的消息失败；不符合飞书签发形式的 `appId` 同样失败，因为官方 SDK 对畸形 id 只记录日志并返回，而不报错。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client.ts` 是全部出站转换逻辑。`readFeishuConfig` 收窄不透明的设置段并点名第一个缺失或畸形的字段。`FeishuChatClient` 把纯文本作为 `text` 消息发送，把带格式文本作为交互卡片发送、由卡片的 `lark_md` 元素承载降级后的文本；当桥接层要求引用时，它在入站消息之下回复；并先上传文件再发送飞书返回的 key。飞书把拒绝表示为 HTTP 200 响应体中的非零 `code`，因此被拒绝的卡片会抛为 `ChatFormatRejectedError`，这正是桥接层改以纯文本重发同一分块的原因。

`src/markdown.ts` 拥有飞书的降级。`lark_md` 不渲染标题与围栏代码块，因此标题变为加粗行，围栏的分隔行被去掉而内容逐字保留。该转换可能使文本变长，因此渲染结果会对照渠道上限度量，超出即拒绝。

`src/events.ts` 校验 `im.message.receive_v1`。飞书把消息体作为 JSON 字符串放进事件里，因此事件与该字符串都会被检查。文本消息体读作文本；富文本消息体被展平为其标题、各行文本与链接，其中每张图片各自收集为一个 key；图片或文件消息体变为惰性句柄。`src/media.ts` 经由承载附件的消息下载，并在传输过程中而非传输之后执行字节上限。

`src/index.ts` 在 SDK 的 WebSocket 长连接之上构建连接器。SDK 拥有端点发现、事件解析、心跳与重连；本插件拥有缝隙。应用密钥按操作解析而非加载时解析一次，这正是轮换后的密钥无需重启即可作用于下一次连接的原因。

<a id="model-experience"></a>
## 模型体验

间接地，经由 `dsh-channel-bridge`：后者接纳本提供方产出的规范化消息，因此拥有每一个模型可见字段。

#### KV Cache 影响

无直接影响；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **无出站图片**——缝隙的客户端没有图片发送接口，因此 `capabilities.outbound.images` 为 false，本提供方也不实现任何图片上传路径。入站收到的图片仍会作为惰性句柄交给桥接层。
- **无发送者显示名**——`im.message.receive_v1` 携带发送者 id 但不带显示名，解析显示名会让每条消息多一次 API 调用，因此规范化消息省略 `senderName`。
- **消息类型仅覆盖文本、富文本、图片与文件**——音频、媒体、表情贴纸与分享会话会解析为空消息，由桥接层以其自身的不支持提示回应。
- **无卡片动作**——本提供方会发送交互卡片，但按钮点击或表单提交不会回流到会话。
- **每个进程一个连接器**——命名空间固定为 `chat-channel-feishu`，因此部署无法同时绑定两个飞书应用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：该连接器是一次转换，其唯一拥有的关系是每个已声明能力都与客户端实现一致，已由其自身测试套件固定。

官方 SDK 是运行时依赖，而非手写协议代码。它被固定到精确版本，因为它不提供 `exports` 映射，Node 因而加载其 CommonJS 构建、`__dirname` 得以解析；经 tsx 的源码启动与打包后的 `lib/index.js` 都已验证能加载它。

</details>

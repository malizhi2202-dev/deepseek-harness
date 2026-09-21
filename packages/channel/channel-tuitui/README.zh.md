---
description: "面向配置机器人的运维者，以及维护 Tuitui 传输与渠道缝隙之间转换的维护者的 Tuitui 聊天渠道提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-tuitui

[English](README.md) | 中文

## 概述

`dsh-channel-tuitui` 是 Tuitui（推推）聊天渠道缝隙的提供方一半。它不拥有任何协议：它解析配置点名的凭据引用，构建本仓库既有的 `TuituiClient` 传输，并把规范化消息流交给[桥接层](../channel-bridge/README.zh.md)。它声明一个设置命名空间 `chat-channel-tuitui`，以及平台的能力限制。

Tuitui 没有回复引用，因此 `capabilities.quoting` 为 false，群回复就是一条普通消息。它在两个方向上都不携带附件，原因在传输而非本包——见「已知限制」。

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
- name: '@deepseek-ai/dsh-channel-tuitui'
  config:
    host: 'im.example.com'
    appId: '…'
    appSecretRef: TUITUI_APP_SECRET
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `host` | —（必填） | Tuitui IM 服务器主机，不含协议与端口。 |
| `appId` | —（必填） | 来自 Tuitui 开发者控制台的机器人应用 id。 |
| `appSecretRef` | —（必填） | 持有应用密钥的 `dsh-credentials` 引用名称，绝不是密钥本身。 |

cordis.yml 的 `config` 是设置命名空间的组合层，因此这些值是部署默认值，且每个字段也可在 **设置 → 插件 → 插件配置** 中编辑，无需重新部署。空字段会在首次连接时以点名该字段的消息失败；不是凭据引用名称、或其背后没有存储值的引用会以同样方式失败。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client.ts` 是全部转换逻辑。`readTuituiConfig` 收窄不透明的设置段并点名第一个缺失字段。`toInboundMessage` 把平台的三种会话范围映射到缝隙的两种——团队帖子在引用与会话锁定上表现为群聊——并为会话 id 与消息 id 打上品牌标记，二者对下游全部不透明。`TuituiChatClient` 把文本转交传输，把已配置应用报告为探测账户，并以 `ChatUnsupportedError` 拒绝 `replyText` 与 `sendFile`，而已声明能力已告知桥接层绝不调用它们。

`src/index.ts` 构建连接器。应用密钥按操作解析而非加载时解析一次，这正是轮换后的密钥无需重启即可作用于下一次连接的原因。连接器的 `connect` 在打开传输之前注册消息处理器，并在接收循环开始运行时报告就绪；传输没有可供上报的握手信号。

Markdown 被声明为受支持，因为团队帖子渲染 `richtext/markdown`，但该选择按会话而定且位于传输中，因此连接器原样转交文本，私聊则逐字显示。

<a id="model-experience"></a>
## 模型体验

间接地，经由 `dsh-channel-bridge`：后者接纳本提供方产出的规范化消息，因此拥有每一个模型可见字段。

#### KV Cache 影响

无直接影响；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **两个方向上都没有附件**——传输只把媒体作为已渲染进消息文本的 URL 交出，因此原生图片或文件块意味着重新推导平台的消息类型并在传输之外下载字节。模型仍能从文本收到该 URL。
- **无握手或连接失败上报**——传输在其套接字打开之前就让 `connect()` 返回，并吞掉自身的重连失败，因此面板报告接收循环正在运行，而始终未打开的套接字与空闲状态无法区分。
- **无引用**——`replyText` 会拒绝；群回复就是一条普通消息。
- **无交互卡片或表情回应**——传输暴露了二者，但渠道缝隙没有对应词汇，因此 `/tree` 式卡片与表情回应无法从聊天渠道绑定触达。
- **每个进程一个连接器**——命名空间固定为 `chat-channel-tuitui`，因此部署无法同时绑定两个 Tuitui 应用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：该连接器是一次转换，其唯一拥有的关系是每个已声明能力都与客户端的拒绝行为一致，已由其自身测试套件固定。

</details>

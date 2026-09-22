---
description: "面向配置机器人应用的运维者，以及维护 QQ 机器人开放平台与渠道缝隙之间转换的维护者的 QQ 聊天渠道提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-qq

[English](README.md) | 中文

## 概述

`dsh-channel-qq` 是 QQ（QQ 机器人）聊天渠道缝隙的提供方一半。它使用官方机器人开放平台 API v2：应用凭据对被换取为短期访问令牌，入站事件经平台的 WebSocket 网关到达，出站消息发往群或单聊发送端点。它把规范化消息流交给[桥接层](../channel-bridge/README.zh.md)，声明一个设置命名空间 `chat-channel-qq`，以及平台的能力限制。

两条平台规则决定了这层转换。群或单聊消息只能作为对机器人已收到消息的**被动回复**被接受，需要携带那条消息的 id 以及一个统计该消息已回复次数的序号；而平台的 Markdown 形式需要一个由部署方在自己控制台定义模板，因此本提供方发送纯文本，并自行降级 Markdown。

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
- name: '@deepseek-ai/dsh-channel-qq'
  config:
    appId: '102000000'
    appSecretRef: QQ_BOT_APP_SECRET
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `appId` | —（必填） | QQ 机器人开发者控制台中的机器人应用 id。 |
| `appSecretRef` | —（必填） | `dsh-credentials` 中保存应用密钥的引用名，而非密钥本身。 |
| `apiBaseUrl` | `https://api.bot.qq.com` | API 主机。部署在沙箱主机上时设置它；令牌端点在两种环境下相同。 |

cordis.yml 的 `config` 是设置命名空间的合成层，因此这些值是部署方的默认值，每个字段也可在**设置 → 插件 → 插件配置**中修改而无需重新部署。必填字段为空时，首次连接即失败并点名该字段；引用名不符合凭据引用语法，或其后没有存储任何内容时，同样失败。

<a id="understand-the-implementation"></a>
## 理解实现

`src/api.ts` 是线路层。`QqApi` 在每次 OpenAPI 调用上携带访问令牌，而 `exchangeAccessToken` 是唯一使用应用密钥的地方。`src/token.ts` 拥有令牌的生命周期：平台签发的令牌最长 7200 秒，并对落在最后 60 秒内的请求轮换令牌，因此缓存正是在该边界替换令牌，且并发调用方共享一次换取。平台以 `11244` 拒绝的调用会使缓存失效并重试一次。

`src/api.ts` 同时拥有 `QqGateway`：在平台的 hello 帧上鉴权，按该帧给出的间隔发送心跳，在套接字断开后恢复会话，并在平台使会话失效时重新鉴权。`connect` 在套接字构造完成时即返回；会话本身在平台发送 `READY` 或 `RESUMED` 时经 `onReady` 上报。

`src/replies.ts` 是被动回复规则所要求的账本。它记住每条已收到的消息、该消息不再可回复的时刻，以及其回复已用掉的序号，使 `sendText` 与 `replyText` 能把平台要求的 `msg_id` 与 `msg_seq` 组合交给它。`src/client.ts` 收窄设置段，把群与单聊事件规范化为缝隙的两种会话类型，铸造携带发送端点的会话 id，并构建从事件给出的 URL 下载的惰性附件句柄。`src/markdown.ts` 去除 QQ 不渲染的标记，并按段落边界切分过长回复。

<a id="model-experience"></a>
## 模型体验

经由 `dsh-channel-bridge` 间接体现：由桥接层接纳本提供方产出的规范化消息，因此所有模型可见字段由桥接层拥有。

#### KV Cache 影响

无直接失效；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **仅限被动回复** — 群或单聊消息只能作为对机器人在平台窗口内收到的消息的回复被接受，因此超出该窗口的模型回合会明确失败，而不是被投递。不带 `msg_id` 发送属于**主动**消息，有其自身的配额与审批策略，本提供方未实现。
- **两种会话类型只上报一个回复预算** — 平台允许对单聊消息回复四次、对群消息回复五次，而缝隙只携带一个数字，因此 `replyBudget` 处处为 4，群会少用一次预算。
- **不渲染 Markdown** — 平台的 `msg_type: 2` 需要部署方在其控制台注册的模板，因此 `capabilities.markdown` 为 false，回复中的 Markdown 在此降级为纯文本。
- **无出站附件** — 富媒体上传路径未实现，因此 `capabilities.outbound` 为 false，桥接层拒绝发送文件正是正确结果。
- **不接收频道消息** — 只订阅了群与单聊事件类别。频道及其私信是独立的事件类别，具有不同的 intent 与不同的发送端点。
- **丢弃语音附件** — 语音项不携带本缝隙可用的文本；平台自带的语音转写未被读取。
- **无交互按钮与表情回应** — 渠道缝隙没有对应词汇。
- **4000 字符的分片上限是本构建自身的界限** — 平台未记载出站文本上限，因此它不是平台事实，与桥接层的默认分片大小一致。
- **每进程一个连接器** — 命名空间固定为 `chat-channel-qq`，因此一个部署无法同时绑定两个 QQ 机器人应用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

不发布运行时不变式伴随包：该连接器是一层转换，其仅有的自有关系是「每个已声明能力与客户端拒绝的行为一致」以及「被动回复账本交给平台一个它会接受的序号」，两者均由其自身测试套件钉住。

</details>

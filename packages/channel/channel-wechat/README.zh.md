---
description: "面向为机器人账号扫码登录的运维者，以及维护官方微信机器人渠道与渠道缝隙之间转换的维护者的微信聊天渠道提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-wechat

[English](README.md) | 中文

## 概述

`dsh-channel-wechat` 是微信（微信）聊天渠道缝隙的提供方一半。它使用官方机器人渠道的纯 JSON 协议：账号通过扫码建立，入站消息经长轮询到达，出站消息携带该会话最后一条入站消息所带有的 `context_token`。它把规范化消息流交给[桥接层](../channel-bridge/README.zh.md)，声明一个设置命名空间 `chat-channel-wechat`，以及平台的能力限制。

平台的机器人渠道是一对一的：本提供方接纳的每条消息都是单聊。其媒体从平台 CDN 获取，并用每个条目各自的 AES-128 密钥解密；其文本不携带 Markdown，因此回复中的 Markdown 在此降级。

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
- name: '@deepseek-ai/dsh-channel-wechat'
  config:
    tokenRef: WECHAT_BOT_TOKEN
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `tokenRef` | —（必填） | `dsh-credentials` 中保存扫码登录签发的机器人令牌的引用名，而非令牌本身。 |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | 机器人 API 主机。扫码确认会给出该账号此后必须使用的主机，因此部署方记录登录上报的结果。 |
| `botAgent` | `DeepSeekHarness` | 作为 `bot_agent` 发送的值，平台会记录它但从不据此鉴权。 |

cordis.yml 的 `config` 是设置命名空间的合成层，因此这些值是部署方的默认值，每个字段也可在**设置 → 插件 → 插件配置**中修改而无需重新部署。`tokenRef` 为空时，首次连接即失败并点名该字段；引用名不符合凭据引用语法，或其后没有存储任何内容时，同样失败。

扫码登录是获得令牌的唯一方式，且它无需令牌即可开始，因此在 `tokenRef` 解析成功之前就可用。连接器把它作为超出缝隙的额外成员暴露：

```ts
import type { ChatChannelConfig } from '@deepseek-ai/dsh-channel'
import type { WechatConnector, WechatQrChallenge } from '@deepseek-ai/dsh-channel-wechat'

declare const connector: WechatConnector
declare const section: ChatChannelConfig
declare const render: (challenge: WechatQrChallenge) => void

const signIn = connector.signIn(section)
const challenge = await signIn.start()
const outcome = await signIn.wait(challenge, { onChallenge: render })
```

`start` 返回 `{ qrcode, payload, expiresAt }`。`qrcode` 是状态轮询回传的不透明会话句柄；`payload` 是要编码为二维码图片的字符串；`expiresAt` 是本构建停止接受该挑战的时刻，即请求后五分钟。`wait` 持续轮询，直到平台确认扫码；它会替换平台已过期或被拦截的挑战（每次替换经 `onChallenge` 上报，以便调用方重新渲染），并在平台要求时经 `onVerifyCode` 索取验证码。它上报 `confirmed`（携带账号 id、机器人令牌与主机）、`expired`、`blocked`、`already-bound`、`verification-required`、`timeout` 或 `cancelled` 之一。

该 payload 等同于机密：它内嵌登录令牌，因此只应出现在显示界面上，不应出现在别处。本包从不记录它，从不把它写入会话日志，也从不把它放进错误消息，调用方也必须如此。缝隙的 `AuthorizationPrompt` 没有二维码类型，这正是该流程作为连接器成员而非授权提示的原因。

<a id="understand-the-implementation"></a>
## 理解实现

`src/wire.ts` 是协议层。每次已鉴权调用都携带 bearer 令牌与 `iLink-App-Id` / `iLink-App-ClientVersion` 头；uint64 标识符在解析时保持为缝隙所当作的字符串，因为 JavaScript 会把它舍入；媒体下载在越过上限的那个字节处即被拒绝，而不是缓冲完整个响应体之后，然后用条目的 AES-128-ECB 密钥解密。消息轮询本身就是长轮询，因此空窗返回是正常空结果，调用方再次轮询即可。

`src/client.ts` 收窄设置段并拥有 `WechatConversations`，即每个会话最后一条消息所携带令牌的有界表：令牌在连接侧到达、在客户端侧被使用，而平台要求每条出站消息都带回它。它还构建惰性附件句柄，并从字节本身读取图片的媒体类型，因为平台不提供该类型。`src/markdown.ts` 降级 Markdown，并在窗口后半段的段落边界切分过长回复。`src/signin.ts` 是扫码流程。`src/index.ts` 运行轮询循环：平台回答过一次轮询后上报就绪，从失败中恢复后再次上报；失败的轮询在两秒后重试，连续三次失败后改为三十秒。

<a id="model-experience"></a>
## 模型体验

经由 `dsh-channel-bridge` 间接体现：由桥接层接纳本提供方产出的规范化消息，因此所有模型可见字段由桥接层拥有。

#### KV Cache 影响

无直接失效；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **仅支持单聊** — 平台的机器人渠道是一对一的，因此群消息无法到达机器人，被接纳的每条消息都是单聊。
- **无引用回复** — 平台没有回复目标字段，因此 `capabilities.quoting` 为 false，`replyText` 拒绝。
- **不渲染 Markdown** — 平台只渲染纯文本，因此 `capabilities.markdown` 为 false，回复中的 Markdown 在此降级。
- **无出站附件** — 上传路径（`getuploadurl`、AES 加密、CDN POST）未实现，因此 `capabilities.outbound` 为 false，桥接层拒绝发送文件正是正确结果。
- **向从未发言的会话发送会失败** — 平台要求其最后一条入站消息所携带的 `context_token`，而保存它的表上限为 1024 个会话，因此向已被淘汰的会话回复会失败，而不是不带令牌发送。
- **令牌过期不会暂停** — 平台以 `ret: -14` 回应过期令牌，并期望渠道暂停一小时。本提供方把该拒绝作为错误上报，交由下一次轮询决定，因此它会对着需要重新签发的令牌持续重试。
- **无交互按钮与表情回应** — 渠道缝隙没有对应词汇。
- **未经核实的平台事实** — 服务端二维码有效期、服务端自身的文本上限以及平台的速率限制在此均无文档，因此五分钟的挑战有效期与 4000 字符的分片上限是本构建自身的界限；后者以官方客户端的 `textChunkLimit` 为依据。
- **每进程一个连接器** — 命名空间固定为 `chat-channel-wechat`，因此一个部署无法同时绑定两个微信机器人账号。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

不发布运行时不变式伴随包：该连接器是一层转换，其仅有的自有关系是「每个已声明能力与客户端拒绝的行为一致」，由其自身测试套件钉住。

</details>

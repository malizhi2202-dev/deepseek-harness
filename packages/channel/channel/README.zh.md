---
description: "面向组合平台、实现连接器或查阅平台承载能力的开发者与维护者的聊天渠道连接器缝隙。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel

[English](README.md) | 中文

## 概述

`dsh-channel` 拥有聊天渠道能力缝隙：`ctx.chatChannels` 连接器注册表、一条媒体为惰性 `fetch(maxBytes)` 句柄的规范化入站消息、提供方实现的出站客户端，以及连接器所作的能力与配置声明。它不持有协议、不持有 Session、不持有凭据值——提供方适配平台自身的传输，所有跨平台决策由[桥接层](../channel-bridge/README.zh.md)作出。

`ChatChannelIdMap` 可被合并扩展，因此提供方从自己的 `./types` 模块添加平台 id；该映射以 `tuitui` 为种子值——本仓库唯一内置的平台——因此消费方单独编译时也能得到可用的 id 集合。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

提供方注册一个连接器：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import type { ChatChannelConfig, ChatClient } from '@deepseek-ai/dsh-channel'

declare const ctx: Context
declare const Config: Schema<{ readonly appSecretRef: string }>
declare const MyClient: new (section: ChatChannelConfig) => ChatClient

ctx.chatChannels.register({
  channel: 'tuitui',
  capabilities: { quoting: false, inbound: { images: false, files: false }, outbound: { images: false, files: false }, markdown: true },
  settings: { namespace: 'chat-channel-tuitui', schema: Config, credentialFields: ['appSecretRef'] },
  createClient: async section => new MyClient(section),
  connect: async (section, handlers) => {
    await new MyClient(section).checkCredentials()
    handlers.onReady?.()
    return { close: () => {} }
  },
})
```

`register` 返回处置器；注册以调用插件为作用域，因此卸载该插件即注销连接器。对同一渠道的第二次注册会抛出，而不是静默替换先前的注册。

消费方通过 `list()` 或 `get(channel)` 读取，并用与桥接层相同的两个方法驱动连接器。

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 是全部词汇且不含运行时代码，因此提供方的 schema 声明与消费方的线上声明读取同一个模块，而无需加载 Host 运行时。它还向 `MessageSourceMap` 增补 `channel` 来源：被接纳的提示会点名其平台、会话、会话类型与平台消息 id，这既告诉模型其输入来自何处，也让桥接层能从 Session 日志推导出持久去重水位线。

`src/errors.ts` 是渠道失败被分类的唯一位置。连接器抛出类型化拒绝——`ChatMediaTooLargeError`、`ChatFormatRejectedError`、`ChatUnsupportedError`、`ChatPermissionError`、`ChatConfigError`——由 `chatErrorKind(error, site)` 判定这属于系统按设计运行，还是必须有人查看的问题。分类依据具名捕获点上的类，绝不匹配消息文本，因为平台的措辞会无预警变化，而它抛出的类是已声明的契约。`ChatPermissionError` 仅在会告知聊天的捕获点上是 `expected`，因为在其他地方捕获到的拒绝会让会话听不到任何回应。

`src/index.ts` 是注册表。它以 `ChatChannelId` 为键的 `Map` 而非列表实现，因此重复注册是拒绝而不是被遮蔽的条目。

媒体以句柄而非字节穿越，原因只有一个：字节上限随传输一同传入，因此超大附件会在越过上限的那个字节处被拒绝，而不是先整份缓冲再测量。`ChatChannelCapabilities` 声明平台的上限，使桥接层按其收窄；并声明附件方向，使桥接层绝不调用平台无法执行的操作。

<a id="model-experience"></a>
## 模型体验

间接地，经由 `dsh-channel-bridge`：后者负责接纳提示，因此拥有本缝隙声明的每一个模型可见字段。

#### KV Cache 影响

无直接影响；接纳消息的桥接层拥有任何请求前缀变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **无绑定持久化**——渠道配置是一个 `dsh-settings` 命名空间，其持久去重与会话锁定状态是被绑定 Session 的日志；本包两者都不存储，也没有自己的表。
- **无入站传输**——缝隙只声明惰性句柄而绝不执行传输，因此无法对一条消息的多个附件执行总字节预算。
- **无引用回退**——`capabilities.quoting` 是单个布尔值，而平台的引用能力可能按会话不同，因此能在部分会话中引用的连接器声明保守值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：注册表唯一拥有的关系是重复拒绝，已由其自身测试套件固定。

</details>

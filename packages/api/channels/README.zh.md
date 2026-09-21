---
description: "面向读取渠道状态的客户端消费方，以及维护宿主端点及其启用/停用绑定的维护者的 channels Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-channels

[English](README.md) | 中文

## 概述

`dsh-api-channels` 拥有 `channels` Remote 命名空间：`status` 读取每个已注册渠道，`probe` 通过构建客户端来测试某个渠道的凭据，`enable`/`disable` 移动一次绑定。它是面板触达[桥接层](../../channel/channel-bridge/README.zh.md)的唯一途径，自身不持有任何状态——每个答案都在调用时从桥接层与凭据缝隙读出。

凭据引用只以名称与存在性穿越。渠道配置点名一个 `dsh-credentials` 引用；本端点报告其背后是否存有值，绝不报告该值。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

客户端代码通过 [dsh-api-remotes](../remotes/README.zh.md) 客户端装配已挂载的 Remote 载体调用该命名空间；浏览器不直接加载本包。失败以两个已声明代码穿越线路：点名渠道未注册时为 `channels/unknown`，已执行的操作失败时为 `channels/failed`，其消息点名需要修复的内容。

宿主组合把本包与 `ctx.chatBridge`、`ctx.credentials`、`ctx.settings`、`ctx.typert` 一同挂载；它恰好注入这些。

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 从 [`dsh-channel`](../../channel/channel/README.zh.md) 重新导出 `ChatChannelCapabilities` 而非重述它，因此面板的声明与连接器的声明是同一个类型；并在协议详情映射中声明这两个错误代码。`ChannelView` 携带绑定、连接状态、带时间的最近错误、会话锁定、回复预算与能力集合——面板展示的一切，一次读取即可获得。

`src/index.ts` 是端点。`status` 先调用 `ctx.chatBridge.sync()` 结算注册表，因为对只询问一次的面板而言，刚刚注册的连接器否则不可见。`probe` 用已配置凭据构建客户端，并以带原因的 `ok: false` 作答而非拒绝，因为「凭据有误」正是面板存在的意义。`enable` 通过桥接层的互斥规则拒绝为一个 Session 启用第二个渠道，而不是存储第二个绑定。

该命名空间以 Remote 方法而非资源承载状态：资源是当前值流，而面板在打开时读取一次、在每条命令之后读取一次。

<a id="model-experience"></a>
## 模型体验

间接地，经由聊天平台：面板端点不注册任何工具、session 事件或请求输入，模型只把渠道看作桥接层已接纳的 `source`。

#### KV Cache 影响

无直接影响；此处不装配也不塑造任何模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **不为面板之便枚举渠道列表**——答案就是桥接层已绑定的内容；未注册渠道在被点名时以 unknown 拒绝，而不是报告为缺失。
- **探测只能证明客户端可被构建**——能解析的凭据与被主机拒绝的凭据都是 `ok: true`，因为连接器自身的探测不打开传输。
- **无配置写入路径**——该命名空间移动绑定并读取状态；编辑渠道字段属于设置命名空间自己的 Remote 端点。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：该端点是一次薄委托，其拒绝映射已由其自身测试套件针对脚本化桥接层固定。

</details>

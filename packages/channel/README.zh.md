---
description: "聊天渠道能力族的包映射：连接器缝隙、共享桥接、Tuitui 提供方与面板端点。"
kind: "package-group"
---

# channel/ — 让聊天平台驱动 Session

[English](README.md) | 中文

## 概述

`channel/` 包族让聊天平台驱动一个 Agent Session，并把该 Session 已完成的回复镜像回会话。`channel` 是服务定义：连接器注册表、一条携带惰性媒体句柄的规范化入站消息，以及提供方实现的出站客户端。`channel-bridge` 是所有平台共用的消费方，它拥有必须在各处保持一致的决策——去重、会话锁定、经 Agent 注册表接纳、出站转发，以及哪些回复文件可以离开工作区。每个提供方适配一个平台：`channel-tuitui` 基于本仓库既有传输，`channel-feishu` 基于官方飞书 SDK，`channel-dingtalk` 基于官方钉钉 Stream SDK，`channel-qq` 基于官方 QQ 机器人开放平台 API，`channel-wechat` 基于官方微信机器人通道协议。`api-channels` 通过 Typert Remote 暴露状态与启用/停用绑定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`channel/`](channel/README.zh.md) | 连接器注册表、渠道配置与能力声明，以及规范化消息/客户端契约。 | `ctx.chatChannels` |
| [`channel-bridge/`](channel-bridge/README.zh.md) | 将连接器绑定到 Session、接纳入站消息、转发已完成的回复，并投递回复文件。 | `ctx.chatBridge` |
| [`channel-tuitui/`](channel-tuitui/README.zh.md) | 基于既有传输的 Tuitui（推推）提供方。 | 消费 `ctx.chatChannels`、`ctx.credentials` |
| [`channel-feishu/`](channel-feishu/README.zh.md) | 基于官方 `@larksuiteoapi/node-sdk` 的飞书（Feishu）与 Lark 提供方。 | 消费 `ctx.chatChannels`、`ctx.credentials` |
| [`channel-dingtalk/`](channel-dingtalk/README.zh.md) | 基于官方 `dingtalk-stream` SDK 的钉钉（DingTalk）提供方。 | 消费 `ctx.chatChannels`、`ctx.credentials` |
| [`channel-qq/`](channel-qq/README.zh.md) | 基于官方 QQ 机器人开放平台 API 的 QQ 提供方。 | 消费 `ctx.chatChannels`、`ctx.credentials` |
| [`channel-wechat/`](channel-wechat/README.zh.md) | 基于官方微信机器人通道协议的微信（WeChat）提供方。 | 消费 `ctx.chatChannels`、`ctx.credentials` |
| [`api-channels/`](../api/channels/README.zh.md) | 报告渠道状态并移动一次绑定的 Remote 端点。 | `ctx.channels` / `ctx.remote.channels` |

<a id="related-documentation"></a>
## 相关文档

[聊天渠道子系统参考](../../docs/subsystems/channel.zh.md)拥有共享类型与桥接层执行的规则。若某个提供方重新实现去重、会话锁定或回复文件过滤，就会让这些规则出现第二处可能出错的地方，因此本缝隙刻意把它们排除在连接器契约之外。

<a id="dev-note"></a>
## 开发备注

无。

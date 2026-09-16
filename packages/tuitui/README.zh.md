---
description: "Tuitui（推推）IM 桥接到 DSH agent 会话的包地图。"
kind: "package-group"
---

# tuitui/ — Tuitui IM 聊天驱动 DSH agent 会话

[English](README.md) | 中文

## 概述

Tuitui 家族把一个 Tuitui（推推）机器人接入 DeepSeek Harness。聊天消息变成 agent 轮次；回复通过 Tuitui 的 HTTP 发送接口流式回传，交互式文件树卡片则暴露工作区。传输接缝把线路客户端藏在一个可注入接口之后，使测试无需真实机器人即可运行。

## 目录

- [包](#packages)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tuitui/`](tuitui/README.zh.md) | WebSocket + HTTP 传输、各会话 agent 会话以及 `/tree` 工作台 | —（函数插件，注入 `agents` / `agentPresets` / `permissionPresets`） |

<a id="dev-note"></a>
## 开发说明

无。
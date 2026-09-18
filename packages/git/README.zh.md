---
description: "面向浏览本组的用户与维护者：git 组地图——只读仓库观察服务及其本地 provider。"
kind: "package-group"
---

# git/ — 仓库观察家族

[English](README.md) | 中文

## 概述

harness 对 git 仓库的唯一只读视图：一个共享服务（`ctx.git`）回答包含某个工作目录的仓库的有界快照——HEAD 状态、分支、有界历史、工作区改动——和一个用本机 git 读取它的本地 provider。它只为 Web 客户端的右侧栏 git 面板供血；没有工具、会话事件或模型可见面提到它。整个家族是有期限的临时物，将在版本线迁移落地后被上游 git 插件替换。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`git`](git/README.zh.md) | 定义仓库观察服务及其唯一上限（`MAX_OBSERVATION_ITEMS`） | `ctx.git` |
| [`git-local`](git-local/README.zh.md) | 通过共享的无 shell 运行器用宿主机自身的 git 读取仓库 | 注册于 `ctx.git` |

面板消费的 Remote 命名空间位于 [`api/workspace-git`](../api/workspace-git/README.zh.md)；面板本体位于 [`client/ui-sidebar-git`](../client/ui-sidebar-git/README.zh.md)。

-----

<a id="related-documentation"></a>
## Related documentation

- [Web 客户端架构](../../docs/subsystems/web-client.zh.md) —— 面板遵循的 Slot 与 props 规范。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

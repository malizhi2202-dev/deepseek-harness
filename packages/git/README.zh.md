---
description: "面向浏览本组的用户与维护者：git 组地图——只读仓库观察服务、对齐 seam 及其本地 provider，以及消费它们的包。"
kind: "package-group"
---

# git/ — 仓库观察与对齐家族

[English](README.md) | 中文

## 概述

harness 的 git 表面，分为两部分。观察 seam（`ctx.git`）回答包含某个工作目录的仓库的有界只读快照——HEAD 状态、分支、有界历史、工作区改动——并为 Web 客户端的右侧栏 git 面板供血。对齐 seam（`ctx.gitAlign`）回答把分支推进到其上游需要什么，并在本地完成该动作：fetch、冲突探测、快进或合并、路径事实、忽略检查，以及一次有界提交。两个 seam 都不暴露写远端，因此推送提交始终由人决定。没有工具、会话事件或模型可见面提到其中任何一个。

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
| [`git-align`](git-align/README.zh.md) | 定义对齐服务：fetch、冲突探测、本地应用、路径事实、忽略检查，以及一次有界提交——不写远端 | `ctx.gitAlign` |
| [`git-align-local`](git-align-local/README.zh.md) | 通过共享的无 shell 运行器用宿主机自身的 git 执行这些操作 | 注册于 `ctx.gitAlign` |

对齐 seam 的唯一 consumer 是 [`workspace-automation`](../workspace/workspace-automation/README.zh.md)，它拥有逐工作区定时器与自动提交。面板消费的 Remote 命名空间位于 [`api/workspace-git`](../api/workspace-git/README.zh.md)；面板本体位于 [`client/ui-sidebar-git`](../client/ui-sidebar-git/README.zh.md)。

-----

<a id="related-documentation"></a>
## Related documentation

- [Workspace 子系统](../../docs/subsystems/workspace.zh.md) —— 对齐服务的词汇，以及消费它的逐工作区运行时。
- [Web 客户端架构](../../docs/subsystems/web-client.zh.md) —— 面板遵循的 Slot 与 props 规范。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

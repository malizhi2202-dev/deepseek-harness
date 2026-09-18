---
description: "dsh Web 客户端右侧栏的派生面板：当前会话的完整派生树，连同每条分支的子级目录读取状态与诊断。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-agents

[English](README.md) | 中文

## 概述

右侧栏的派生面板：把当前会话的派生画成一棵树，读自浏览器已经持有的会话列表，再用每条分支的直接子级目录补上摘要装不下的事实。它是一个页面类型，从引导页或会话头部的目录浮层进入，不认领任何地址 —— `ui-sidebar-right` 里没有任何代码知道这个包。

## 目录

- [它注册什么](#what-it-registers)
- [它读什么](#what-it-reads)
- [它承认什么](#what-it-admits)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 它注册什么

- **类型** —— `ctx.sidebarRightTabs.register(...)`，kind 为 `agents`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-agents`，档位 `builtin`，`default-on`，顺序 20，带字形，无 patterns，一条引导页条目（顺序 30，标题取自 `sidebarAgents` 命名空间）用来打开这个类型。
- **主体** —— 该 id 下键控的 `sidebar.right.pane.tab` 座席：树、它的行，以及各级目录的读取状态。

`src/client/` 下五个源文件：`definition.ts`（类型）、`lineage.ts`（树的折叠）、`AgentsBody.tsx`（画什么）、`locales.ts`（说什么）、`index.ts`（接线）。

<a id="what-it-reads"></a>
## 它读什么

树来自 `useSessions(state => state.byId)`，所以只要会话列表知道某个派生，它就会出现 —— 包括已经完成或已经失败的派生，且完全不依赖任何目录读取。`useSessions(state => state.ids)` 按列表自身的顺序给同级排序。`useSessions(state => state.subagentsByParent)` 是逐父级的直接子级目录，只为打开的分支读取：根，以及深度上界以内每个已展开的分支，最多三个读取同时在途，分支收起时释放，面板卸载时释放。

面板自己只保留一件事 —— 用户打开或收起了哪些分支 —— 除上述三个选择之外没有别的订阅。

<a id="what-it-admits"></a>
## 它承认什么

只有当所在分支的目录能确认某一行时，点它才会打开那个会话：父级目录必须是 `ready`，且带着该 id 的 `child` 条目，地址里的 `mode` 也取自该条目。在满足之前，这一行画成禁用，并写明打不开的原因 —— 目录还没读过、正在读取、读取失败、没有列出该 id、把它报成诊断，或父会话已离线。

目录的三种状态各自如实绘制，绝不画成「空会话」：尚未读取、正在读取、读取失败（带消息与重试）。诊断条目是独立的行，禁用，并写明原因。当目录已经应答、而会话确实没有派生时，面板用一行说明。

`lineage.ts` 持有唯一的深度上界（`MAX_LINEAGE_DEPTH`）；到达上界的分支画一行禁用的说明，而不是静默丢掉它的子级。

<a id="model-experience"></a>
## 模型体验

没有：这个包只在浏览器里绘制会话状态，不注册任何面向模型的东西。

#### KV Cache 影响

没有；面板不组装任何模型请求，也不新增会话事件。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>
- **只观测。** 面板里没有任何操作能启动、停止或继续一个派生；一行只打开会话，其余动作留在对话里。
- **单个会话。** 树以这个 tab 所属的会话为根，没有跨会话或工作区级的视图。
- **不涉及任务。** 后台任务不挂到所属节点上，那由任务面板负责。
- **深度上界。** 分支到第八层为止，并给出一行明确说明，所以更深的树只能通过打开上界以下的会话来查看。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>给维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 companion。面板没有可供比对的派生状态：树是三个会话列表选择的纯折叠，它唯一的本地事实是用户打开了哪些分支。

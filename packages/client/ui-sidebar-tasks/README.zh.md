---
description: "dsh Web 客户端右侧栏的任务观测 tab 类型：这个会话的待办清单与进度汇总，然后是它的后台任务，两者都读自浏览器已有的状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-tasks

[English](README.md) | 中文

## 概述

右侧栏的任务观测 tab 类型：这个会话的待办清单加一份进度汇总，然后是它的后台任务，两者都读自浏览器已经持有的状态。它是一个页面类型，从引导页进入，不认领任何地址 —— `ui-sidebar-right` 里没有任何代码知道这个包。

## 目录

- [它注册什么](#what-it-registers)
- [它读什么](#what-it-reads)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 它注册什么

- **类型** —— `ctx.sidebarRightTabs.register(...)`，kind 为 `tasks`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-tasks`，档位 `builtin`，无 patterns，一条引导页条目（顺序 20，标题取自 `sidebarTasks` 命名空间）用来打开这个类型。
- **主体** —— 该 id 下键控的 `sidebar.right.pane.tab` 座席：两个区块，自身没有任何控件。

`src/client/` 下四个源文件：`definition.ts`（类型）、`TasksBody.tsx`（画什么，含计数与标记助手）、`locales.ts`（说什么）、`index.ts`（接线）。

<a id="what-it-reads"></a>
## 它读什么

两个事实在浏览器里都是现成的，所以面板不发请求，也不保留 store。

| 区块 | 来源 |
|---|---|
| 待办清单 | 宿主计算出的 `todos` projection，经标准套件的 `useProjection` 读取。在模型第一次写入之前它是 `null`，且每次写入都整体替换整个列表。 |
| 后台任务 | `useSessions(state => state.jobsBySession[sessionId])`，即 Session 对象层的任务镜像。 |

清单按模型自己的写入顺序绘制，因为那个顺序就是计划；条目自身没有身份，所以一行由位置与文本共同标识。每条的状态由标记加状态词承载：`pending` / `in_progress` / `completed`。标题行承载计数，进度条汇总同一份清单；清单缺失或为空时改为显示一行说明。

后台任务显示标签、可选的详情行，以及状态。`stopping` 与 `killed` 共用提示色标记，因为两者都表示工作是按要求结束的，而不是自己结束的。

<a id="model-experience"></a>
## 模型体验

没有：这个包只在浏览器里绘制会话状态，不注册任何面向模型的东西。

#### KV Cache 影响

没有；两个事实都读自宿主已经计算好的状态，面板不组装任何模型请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>
- **只观测。** 面板里没有任何操作能改一条待办或停掉一个任务；这类动作留在对话里或各自的界面。
- **单个会话。** 面板只显示这个 tab 所属的会话，没有跨会话或工作区级的视图。
- **没有时间信息。** 不绘制任务的开始与结束时间，因此也不需要时长格式化；面板报告的是状态，不是耗时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>给维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 companion。面板不持有任何状态 —— 两个事实都是框架 hook 读取 —— 因此没有第二处观察可以比对。

---
description: "面向选型或挂载仓库观察者的部署方与实现者：ctx.git 只读观察服务契约。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git

[English](README.md) | 中文

## 概述

`dsh-git` 定义 `ctx.git` 仓库观察服务：对包含某个工作目录的仓库做一次有界的只读读取——HEAD 状态、本地分支、有界提交历史、工作区改动——或者明确回答"这里没有仓库"。这个 seam 只观察、绝不改写：词汇表里没有 checkout、commit、push、pull。组合挂载一个注册该服务的 provider（如 `dsh-git-local`）；本包是抽象契约，不是可加载插件。这里没有任何东西到达模型：词汇表由 Web 客户端的 git 面板绘制，没有会话事件、资源声明或请求输入提到它。

**状态：有期限的临时物。** 该 seam 供血的树内面板将在版本线迁移落地后被上游 git 插件替换；seam 及其消费方随之退役。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

你很少直接加载 `dsh-git`：先挂载一个注册为 `ctx.git` 的 provider，再由消费方调用 `observe`。唯一的方法接收一个工作目录和调用方的取消信号，回答一个可判别的值：`absent`（没有仓库把该目录包含为工作树，含裸仓库、或损坏到说不出工作树的仓库），或 `repository`（携带快照）。失败词汇是 `GitError` 上两个稳定代码——git 本身无法运行时 `GIT_UNAVAILABLE`，命令运行了却在此之外失败时 `GIT_COMMAND_FAILED`——判定依据是 `code` 字段，绝不依赖类身份。

### 唯一的上限

`MAX_OBSERVATION_ITEMS`（200）同时封顶快照的历史深度、分支列表和工作区条目列表——一个安全常量，先例是 `ui-sidebar-agents` 的 `MAX_LINEAGE_DEPTH`——所以超大仓库绝不会被无界拉取。每个列表带自己的 `*Truncated` 标志，截断以截断的样子可见。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 持有全部词汇表（`GitError` 类沿用 `FsError` 先例）；`src/index.ts` 声明抽象 `GitObserver` 服务与上限。观察是一次当前值读取，不是订阅：调用方发起并获得一个答案，新鲜度靠调用方的重读手势。这也是该 seam 不做资源的原因：资源是当前值流，而本面板展示的有界历史不是可寻址状态。

<a id="model-experience"></a>
## Model Experience

无。该 seam 不注册工具、会话事件、资源或请求输入；唯一消费方是面向用户的 Web 面板。

#### KV Cache effect

无；本包不组装、不塑形任何模型请求。

## Known Limitations and Deferred Work

- **设计即只读。** 该 seam 不会加入任何写操作；仓库改写属于替换它的上游 git 插件。
- **一次有界读取，非订阅。** 面板靠重读手势再取；没有文件监听或推送通知。
- **仅本地工作树。** 远端跟踪事实只到 `git status` 本地可见的程度；没有网络 fetch。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：任何地方都不比对同一仓库的独立观察，`./invariant` 的归属规则不适用。

</details>

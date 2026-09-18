---
description: "面向读取会话工作区所属仓库的客户端消费者与维护者：workspaceGit Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-git

[English](README.md) | 中文

## 概述

`dsh-api-workspace-git` 拥有 `workspaceGit` Remote 命名空间：唯一的方法 `observe` 读取包含调用会话工作区根的 git 仓库，回答 seam 的有界快照。宿主端点通过沙箱策略从会话解析工作区根，因此客户端从不指名目录；seam 的失败以两个已声明代码跨线——宿主上无法运行 git 时 `workspace-git/unavailable`，观察运行了却失败时 `workspace-git/failed`——"不是仓库"不是错误而是 `absent` 回答。把本包生成的客户端 remote（`workspaceGitRemote`）载入 `ctx.remote.$mount` 后，浏览器即可调用 `ctx.remote.workspaceGit.observe`。

**状态：有期限的临时物。** 该命名空间只服务树内 git 面板，将在版本线迁移落地后被上游 git 插件替换。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

客户端代码通过 `dsh-api-remotes` 客户端装配已经挂载的 Remote 载体调用该命名空间；浏览器中没有插件直接加载本包。一次调用传入会话 id 和可选的取消信号，以 Remote 结果收到观察——失败的调用以携带两个已声明代码之一的 `RemoteError` 拒绝。

希望提供端点的宿主组合把本包与某个 `ctx.git` provider（如 `dsh-git-local`）一同挂载；端点同时注入 `git` 与 `sandboxPolicy`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 从 [`dsh-git`](../../git/git/README.zh.md) 再导出 seam 的词汇表而非重述，因此线上类型与宿主的回答是同一份声明；它还在协议的 details map 里声明两个错误代码。`src/index.ts` 是端点：一个 `TypertRemoteService`，其唯一的 `@Remote observe` 解析工作区根并委托 `ctx.git`，按稳定的 `code` 字段把 seam 失败映射到已声明代码——绝不按类身份，因为 `GitError` 类属于 provider 加载的那个 `dsh-git` 实例。该命名空间以直接 Remote 方法携带观察而非资源：资源是当前值流，而本面板绘制的有界历史不是可寻址状态。

<a id="model-experience"></a>
## Model Experience

无。该命名空间是面向客户端的读取；不注册工具、会话事件或请求输入。

#### KV Cache effect

无；本包不组装、不塑形任何模型请求。

## Known Limitations and Deferred Work

- **只读。** 命名空间只暴露 `observe`；仓库改写属于替换它的上游 git 插件。
- **一个会话一个仓库。** 端点观察调用会话的工作区根；没有跨会话或全工作区视图。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：端点是一层薄委托，其映射在自身测试套件里对照脚本化 seam 固定。

</details>

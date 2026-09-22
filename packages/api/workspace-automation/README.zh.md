---
description: "面向客户端消费方的 workspace 命名空间的自动化台账读取，以及维护投影自动化运行时台账的宿主端点的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-automation

[English](README.md) | 中文

## 概述

`dsh-api-workspace-automation` 拥有 `workspace` Remote 命名空间中的一个方法：`automationLedger(workspaceId)` 投影某个工作区的自动化运行时运行台账。该命名空间与 [`dsh-api-workspace-controller`](../workspace-controller/README.zh.md) 共用，因为两者都以同一个不透明 `WorkspaceId` 为键；方法名是本包对它唯一的占用。把生成的客户端载入 `ctx.remote.$mount` 后，浏览器即可调用 `ctx.remote.workspace.automationLedger`。

台账是权威的，本包不持有任何自己的事实：它返回的每个值都抄自已存的运行记录、已存的工作区状态，或某次运行记录的提交。它只读、从不写——运行时仍是唯一的写方，建立在此读取之上的面板不提供任何能改变运行、排期或挂起的控件。

两个界限都是经校验的配置：一次读取返回多少条运行，以及一个路径列表携带多少条路径。两者都会报告被裁剪前的计数，读者因此知道界限藏起了什么。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

客户端代码通过 [dsh-api-remotes](../remotes/README.zh.md) 客户端装配已经挂载的 Remote 载体调用该方法；浏览器中没有插件直接加载本包。一次调用传入 `WorkspaceId`，返回已记录的台账或 `unrecorded`——对从未跑过定时器的工作区而言后者是正常回答，而非失败。

宿主组合把本包与自动化运行时、Gateway 一同挂载；它注入 `workspaceAutomation` 与 `typert`。哪些工作区有状态、台账保留多久、某工作区是否被挂起，都由运行时自身的配置决定；本包无法改变其中任何一项。

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 只是线上词汇表，因为生成的 Remote 客户端消费它：它镜像运行时的封闭结果联合，把每个路径列表替换为有界列表加其计数，并携带工作区状态、每条记录对应的运行，以及某次运行创建的提交。`src/projection.ts` 是全部变换，且是纯函数：抄写已存的值、把每个列表裁到界限、把保留的运行按最新在前排序，并从设计的结果表读出下一步。`src/index.ts` 是端点——一个 `TypertRemoteService`，其唯一的 `@Remote automationLedger` 从 `ctx.workspaceAutomation` 取该工作区的报告并投影它。

结果联合按其判别式穷尽 switch，运行时新增一个原因会在这里编译失败，而不会作为一张没有解释的卡片到达面板。下一步标签在同一文件里由同一结果推导，面板因此从不推断设计未指派过的后果。

<a id="model-experience"></a>
## Model Experience

### 自动化台账读取

#### What the model sees

没有直接影响。端点不注册工具、提示词段落或会话事件，它返回的任何答案都不进入模型请求：设计让运行完全不进入模型请求，而绘制该台账的面板只在浏览器里。运行确实会经由它写入仓库的提交消息触达模型，但那是仓库内容而非请求输入，该文本由提交任务自己的提供方负责。

#### Token effect

本身没有。一次读取不给任何请求增加 token，它携带的工作区状态与运行记录只在浏览器里绘制。运行的提交消息在写入前由运行时自己的 `maxMessageBytes` 定尺，那是仓库事实而非请求输入。

#### KV Cache effect

无直接失效；本包不组装、不塑形任何模型请求。

## Known Limitations and Deferred Work

- **台账记录的 observed upstream id 是本地 head。** `RunRecord.observedUpstreamOid` 由对齐任务在 fetch 之后写入，值是它观察到的本地 `HEAD` oid，与本次运行存下的基线是同一个值；git 缝隙的 `observe` 不报告任何上游提交 id，`gitAlign.fetch` 也只回答发生过一次 fetch。因此本投影按该字段自己的名字携带台账自己的值，不对上游尖端作任何断言。要指名上游尖端，需要 git 缝隙提供上游 oid，而缝隙并未发布它。
- **被取代（superseded）的运行无法指名是什么动了。** 该结果只记录运行期望的 head，读者由此知道 `.git` 在运行期间被改动，但不知道是哪个提交。
- **只有冲突的路径列表带有真实总数。** 拒绝与归属不明的列表在到达本端点之前已被运行时的 `maxPathsPerCommit` 裁过，因此旁边报告的计数是台账持有的长度。请读作"至少这么多"，绝不要读成涉及路径的数量。
- **两个路径列表到达时无界。** 上次提交任务报告的未提交余量与归属不明的路径不受运行时约束，本投影正是给它们加界的一方；旁边报告的计数是它收到的长度。
- **运行界限的默认值是产品选择。** `maxRuns` 默认为 20，而设计自己的保留数字是 200 条环形缓冲；台账自身的计数与返回的运行并列报告，想要整份保留台账的部署在 `cordis.yml` 里调高该界限。
- **一次调用一个工作区。** 没有跨工作区视图：想要每个工作区定时器的调用方要按工作区各调用一次，这里不做任何聚合。
- **台账不携带工作区路径或标题。** 两者都在工作区注册表里，面板通过客户端工作区模型拼接，而不是通过这次读取。
- **命名空间是共用的，因此激活是耦合的。** 因为方法住在 `workspace` 上，浏览器消费方注入 `remote.workspace`，而 Workspace Controller 的客户端半边也挂载它；面板的读取因此依赖那一贡献被载入，而不只依赖本包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：端点不持有任何两个独立观察可能分歧的关系，它的全部行为就是一次纯投影，其映射在自身测试套件里对照脚本化运行时固定，覆盖极小与恰好相等的界限，以及运行时能记录的每一种结果。

</details>

---
description: "每个工作区一个定时器：让检出与上游对齐，并提交单个轮次可归属的工作，全程不存在写远端的路径。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-automation

[English](README.md) | 中文

## 概述

`dsh-workspace-automation` 为每个工作区拥有一个定时器，并在其上运行两个作业。对齐作业执行 fetch、询问上游能否在无冲突的情况下被接受，然后要么报告发现、要么推进分支。提交作业在闭合的轮次边界运行：推导出该轮次自身的工具调用已证明写过的路径，对它们做筛查、做总结，并创建一次提交。

两个作业共享三条性质。每次运行都被记为一条带闭合结果的台账记录，因此读者能区分拒绝、无操作与失败。任何东西都不做就地重试：失败会累加退避，最终导致挂起；冲突的工作区会被冷置一段时间。而且**该运行时不存在任何写远端的操作**——push 始终由人决定。

## 目录

- [如何使用本包](#use-this-package)
- [「绝不 push」如何被强制](#never-push)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

在 `dsh-storage-domain`、`dsh-git`、`dsh-git-align`、`dsh-work-summary` 与 `dsh-fs` 可用的地方挂载该运行时，并声明每个工作区可以做什么。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 是否有任何定时器运行。 |
| `intervalSeconds` | `3600` | 标称间隔；下限为 300。 |
| `jitterRatio` | `0.5` | 施加在间隔上的对称抖动。 |
| `mode` | `observe` | `observe` 只探测并报告；`align` 可以写入。 |
| `worktreeRoot` | 无 | `align` 模式下必填：探测工作树的创建位置。 |
| `alignStrategy` | `ff-only` | `ff-only` 或 `merge`；rebase 无法表达。 |
| `dirtyPolicy` | `refuse` | `refuse`，或用 `commit-attributable` 让提交作业先运行。 |
| `downstreamVerification` | `none` | `external` 把一次干净推进让给已覆盖它的校验方。 |
| `commit.enabled` | `false` | 轮次边界是否可创建提交。 |
| `commit.secretPatterns` | 五个内置形态 | 凭据模式；命中即拒绝。 |
| `commit.maxPathsPerCommit` | `200` | 一次提交可包含的路径数。 |
| `workspaces` | `{}` | 以工作区 id 为键的逐工作区覆盖。 |

`workspaces` 条目可设置 `enabled`、`intervalSeconds`、`mode`、`alignStrategy`、`dirtyPolicy` 或 `commitEnabled`。指名未注册工作区的覆盖，或在部署没有 `worktreeRoot` 时打开 `align` 模式的覆盖，都会在加载时失败。

三个公开方法用于读取或干预该运行时：`report(workspaceId)` 返回已存储状态，`resume(workspaceId)` 清除挂起，`runAlign` / `runCommit` 按需运行单个作业。对齐作业还会随定时器运行；提交作业还会在会话闭合一个轮次时运行。

-----

<a id="never-push"></a>
## 「绝不 push」如何被强制

三层，每一层都可独立核查：

1. **能力 seam 没有写远端。** `ctx.gitAlign`——本包唯一可经其写入的 git 表面——声明了 `resolve`、`fetch`、`probe`、`apply`、`changeFacts`、`ignoredPaths`、`commit` 与 `pushedToRemote`。其中没有 `push`，也没有任何方法接收远端目的地。`pushedToRemote` 是一次读取：它询问是否已有某个 `refs/remotes/` 引用包含某个提交 id。
2. **provider 的 argv 无法携带 push。** `dsh-git-align-local` 自行构造每个参数向量，其真实仓库测试记录一次完整对齐与提交运行所发出每条命令的 argv，断言其中没有任何一条包含 `push` 或 `rebase`，并断言裸 origin 的分支顶端事后未移动。
3. **运行时只调用该 seam。** `workspace-automation` 写入走 `ctx.gitAlign`、读取走 `ctx.git.observe`；它从不派生进程。它的两个写操作是 `apply` 与 `commit`，都是本地的；它创建的提交带有 `Dsh-Unit: <sessionId>/<turn>` trailer，因此日后由人推送时，可以把该提交归属到产生它的工作单元。

撤销路径被刻意设计为非破坏性的。已创建的提交会连同 `git reset --soft <parent>` 与 `git reset --mixed <parent>` 一起被报告；不产出任何 `--hard` 形式，因此撤销一次提交不会丢弃工作树。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 持有词汇表：两个作业名、闭合的 `AutomationOutcome` 联合，以及存储与上报记录。`src/spec.ts` 把存储记录投射为 `workspace_automation` 存储域。`src/config.ts` 持有 `Config` 模式，以及把声明变成单个工作区策略的三个解析步骤。`src/decision.ts` 是纯函数：对齐判定、退避与冷置算术、租约检查、凭据筛查、暂存上限、歧义检查、撤销报告，以及两个描述结果的闭合分支。`src/attribution.ts` 从轮次自身的 `tool/call` 与 `tool/result` 事件推导该轮次的可归属路径。`src/index.ts` 持有 `WorkspaceAutomationRuntime`。

每次运行是一个事务：获取租约、执行动作、记录一条台账、释放租约、重新装填定时器。租约是存储的而非仅存内存，因此读取同一域的第二个进程也能看到它。发现租约被持有的运行记录 `skipped-locked` 并直接返回，不触碰仓库。

定时器把下一次运行存为绝对的 `nextEarliestRunAt` 时间戳，而不是一个间隔起点，因为存储状态是重启后的进程唯一能读到的东西。退避、冷置与正常间隔都写这同一个字段，因此装填定时器从不依赖上一次运行发生在何时。

归属被刻意收窄。只有当轮次中存在一次写工具的 `tool/call`、其参数指名该路径，**并且**存在一条报告无错误的对应 `tool/result` 时，该路径才算作本轮的成果。结果始终未到的调用、失败的结果，以及属于其他轮次的调用都被排除，因此 shell 命令写出的文件永远不会被归属。

## Model Experience

### No model-visible surface

#### What the model sees

无。该运行时不贡献任何工具、提示段落或会话事件，设计 §7.5 也固定了这一点：台账是存储记录而非会话事件，因此这里没有任何内容到达模型请求。运行时引发的唯一面向模型的动作是一次摘要询问，而该请求属于 `ctx.workSummary` 的 provider，由它仅凭路径事实构造。

#### Token effect

无。存储状态、台账与提交消息都没有任何部分被渲染进模型请求。

#### KV Cache effect

无。这里没有可缓存或可失效的请求前缀、消息或工具定义。

## Known Limitations and Deferred Work

- **拉取请求对齐不在范围内。** 仓库没有 forge 能力，因此这里无法对齐拉取请求；只有本地分支与其上游会被考虑。
- **台账经一个有界投射读取。** `packages/api/workspace-automation` 提供最新的 `maxRuns` 次运行，每次运行 `maxPaths` 条路径，因此读者看到的是近期台账而非其全部保留范围；存储的台账仍是权威。
- **shell 写出的文件永不被归属。** 由子进程改动的路径不产生第一方 `tool/call`，因此它只出现在上报的 `uncommittedPaths` 余量中，且永不被提交。
- **宿主归属解析器可能漂移。** `src/attribution.ts` 重述了客户端 turn-deliverables 视图同样编码的写工具参数词汇；两者是同一事实的两份独立实现，且没有共享的纯模块强制二者一致。
- **凭据筛查只读有界前缀。** 每条路径只检查前 `commit.maxScanBytes` 字节，因此超出该界限的凭据不会被看到。
- **没有跨工作区视图。** 台账按工作区设界，并且一次只读一个工作区。
- **没有写入时间宽限窗口。** 设计中的 `mtimeGraceMs` 在此不可配置，因为 `ctx.fs` 报告的是不透明的 freshness token 而非修改时间，因此无法把候选路径的写入时间与某个界限比较；资格仅来自轮次边界。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：本包拥有的每个关系都已由其自身在真实存储域与脚本化 git provider 上的测试固定；唯一可能产生分歧的关系——真实仓库——改由 `dsh-git-align-local` 的真实仓库测试覆盖。

</details>

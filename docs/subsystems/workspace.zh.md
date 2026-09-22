# 工作区

[English](workspace.md) | 中文

工作区（workspace）是用户工作目录的持久记录：一个建立在规范路径之上的稳定 id、一个显示标题，以及归属于它的会话的有序账本。该子系统位于宿主侧，不属于 agent loop（智能体循环）主干，并且对模型不可见（没有工具、没有提示词文本、没有会话事件）。它的注册表包是 [`dsh-workspace`](../../packages/workspace/workspace)（`ctx.workspaceRegistry`），该包通过[存储领域数据形式](storage.zh.md)存储自己的记录，并对照 [`SessionHeader.cwd`](persistence.zh.md#sessionheader--metadata-beside-the-log) 校验会话成员资格，因此 `storageDomain` 与 `sessionPersistence` 是必需的启动依赖：持久化这一依赖不可用时，插件保持 pending，而不是把这种不可用误当作空历史。另有三个包作用于工作区的检出：[`dsh-git-align`](../../packages/git/git-align) 声明对齐服务 `ctx.gitAlign`，[`dsh-git-align-local`](../../packages/git/git-align-local) 用本机自带的 git 提供该服务，[`dsh-workspace-automation`](../../packages/workspace/workspace-automation) 为每个工作区运行一个定时器，对齐分支并提交一个回合中可归属的工作，其读取经 `ctx.git`、摘要经 `ctx.workSummary`。这两个服务都没有写入远端的操作，因此推送提交始终是人的决定。设计记录：[领域 KV 存储 Agent Note（agent 决策记录）](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)；引导与 GUI 顺序：[Workspace UI 产品流程 Agent Note](../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md)；对齐与自动提交：[per-workspace git alignment and automatic commit](../../.agents/notes/implemented/architecture/2026-09-22-workspace-git-alignment-and-automatic-commit.zh.md)。

源码：[`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)、[`packages/git/git-align/src/types.ts`](../../packages/git/git-align/src/types.ts)、[`packages/workspace/workspace-automation/src/types.ts`](../../packages/workspace/workspace-automation/src/types.ts)、[`packages/api/workspace-automation/src/types.ts`](../../packages/api/workspace-automation/src/types.ts)

## 标识

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` 是[品牌化 id](core.zh.md#branded-ids)。路径标识与之分离：`realpathNormalize`（`fs.realpath`；尾部斜杠、`..` 与符号链接全部解析）是唯一的一套唯一性规范——工作区路径以规范化形式存储，唯一性即规范路径的字符串相等（指向已被拥有目录的符号链接会与之冲突），attach 时的会话 cwd 检查也走同一套规范。

## 工作区实体

消费方只看到 `Workspace` 接口；实现保持包内私有。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有权的真源是记录中有序的 `sessionIds`，绝不从会话 cwd 派生——但成员资格要求两者同时成立：账本上有其 id，且 header 的规范 cwd 等于工作区路径，因此一个会话在结构上至多属于一个工作区。失败的写入会拒绝（`insertSessionBefore` 的账本错误以 `WorkspaceMoveInvalidError` 拒绝，存储失败以普通错误拒绝）；每次被接受的变更都盖上 `updatedAt` 时间戳，并持久修剪不再通过成员资格检查的候选项。

## 注册表：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[签名](#ctxworkspaceregistry--workspaceregistry)）拥有注册与解析。`create(path, title?)` 要求完全限定路径并将其规范化，拒绝不存在的路径（原样传出原始 `ENOENT`）或非目录；当规范路径已被拥有时原样返回既有实体；否则创建一条标题为 `title ?? defaultWorkspaceTitle(path)` 的记录并前插到持久的注册表顺序中（不同规范路径可以共享同一显示标题，没有最终路径段时使用根路径拼写）。`get(id)` 与有序的 `list()` 是同步缓存读取；`resolveByPath(path)` 应用同一套完全限定 realpath 规范但不创建。`delete(id)` 只移除注册记录、顺序条目和会话账本——目录、用户文件、实时会话和已持久化日志一概不动，因此这些会话变为 Ungrouped（[决策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)）；未知 id 返回 `false`。create 与 delete 会在其两次写入（记录 + 顺序）可能分叉之前先持久写入一个待定变更标记；启动时恰好解决被标记的那次变更——通过删除被标记的表行：这会补完被中断的 delete，并回滚被中断的 create（注册可以重建，因此回滚是安全方向）——而没有标记的顺序/表不一致则作为损坏大声失败。

会话的 cwd 在创建时由创建者赋予，而不是由本注册表赋予——API 网关从所选工作区的 `path` 解析新会话的 cwd（回退到显式或默认 cwd），先创建会话使 cwd 落入其不可变的 [`SessionHeader`](persistence.zh.md#sessionheader--metadata-beside-the-log)，再调用 `attachSession`，后者会把已存储的 header cwd 与工作区路径重新校验一遍。首次成功启动时，注册表仅凭已持久化的 header（`id`、`cwd`、`createdAt`——绝不读事件正文）引导历史：把规范 cwd 有效的会话按目录分组为工作区，最新的排在最前；「已初始化」标记最后写入，因此被中断的引导可以安全续跑。引导只发生这一次：没有 cwd 的历史遗留会话保持 Ungrouped，此后创建的会话只能通过 `attachSession` 加入工作区。

## 仓库对齐：`ctx.gitAlign`

`ctx.gitAlign` 是作用于仓库工作树的可写入服务，与只读的 `ctx.git` 观测服务并立，后者由下方的 [Cordis API](#ctxgit--gitobserver-abstract-seam) 一节承载。[`dsh-git-align`](../../packages/git/git-align) 声明一次定时对齐运行所需的操作，[`dsh-git-align-local`](../../packages/git/git-align-local) 通过共享的无 shell 运行器用本机自带的 git 实现它们。有三个操作在构造上就不存在：没有 push、没有 rebase、没有历史改写，也没有任何操作接受远端目的地。`resolve` 把观测到的坐标转换成 `AlignSpec`，只拆分一次被跟踪分支的短拼写，使后续操作不再重新推导。

```ts type-equiv
/**
 * Raw coordinates of one alignment target, as the consumer observed them.
 *
 * `upstream` is git's short spelling of the tracked branch (`origin/main`); the
 * provider splits it into a remote and a ref name in {@link AlignSpec}.
 */
interface AlignRequest {
  /** Absolute directory of the repository work tree; travels as git's own `-C` argument. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling, such as `origin/main`. */
  readonly upstream: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}
```

```ts type-equiv
/**
 * One resolved alignment target: the request plus the remote and ref name a
 * fetch names, derived once by the provider so no operation re-derives them.
 */
interface AlignSpec {
  /** Absolute directory of the repository work tree. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling. */
  readonly upstream: string
  /** Remote the upstream ref lives on. */
  readonly remote: string
  /** Ref name the fetch asks that remote for. */
  readonly refspec: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}
```

其余每个操作都以可判别值作答，而不是对一次预期内的 git 失败抛出异常，因为消费方会把答案记录进持久账本，且不会就地重试。`fetch` 回答 `fetched` 或一次失败；`probe` 回答 `clean`、一份有界冲突报告或一次失败，并且不得修改目标工作树、其索引或其 ref；`changeFacts` 与 `ignoredPaths` 回答事实或一次失败；`pushedToRemote` 回答是否已有任何远端跟踪 ref 包含某个提交。调用方的取消不是 git 结果：它以调用方自己的中止原因拒绝。

```ts type-equiv
/** One bounded git failure: a code, plus a diagnostic that carries no repository content. */
interface GitAlignFailure {
  /** Which bound or boundary produced the failure. */
  readonly code: GitAlignFailureCode
  /** Short diagnostic naming the git command and its own exit status. */
  readonly detail: string
}
```

失败按 `code` 判别，绝不按类身份判别。`timeout` 表示提供方自身的时限结束了命令，`git-unavailable` 表示进程从未运行，`command-failed` 表示命令运行过并以非零状态退出。

```ts type-equiv
/**
 * The answer to one alignment write.
 *
 * The aligned case carries no object id: the consumer re-observes HEAD through
 * `ctx.git` after every write, and that observation is the single authority for
 * what HEAD became.
 */
type ApplyResult =
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'merge-failed'; readonly failure: GitAlignFailure }
  | { readonly kind: 'merge-failed-dirty'; readonly failure: GitAlignFailure }
```

`merge-failed-dirty` 表示该次尝试自身的合并无法回滚，因此工作树留给人工处理，而不是报告为一次干净的拒绝。对齐只按请求的策略以快进或合并抵达上游。

```ts type-equiv
/**
 * The answer to one commit attempt. The created commit's identity is read from
 * the post-write HEAD observation the consumer performs regardless, so this
 * answer states only that a commit landed.
 */
type CommitResult =
  | { readonly kind: 'committed' }
  | {
    readonly kind: 'failed'
    readonly failure: GitAlignFailure
    /** Whether the index mutation this attempt made was rolled back. */
    readonly indexRestored: boolean
  }
```

`commit` 恰好包含交给它的路径，空路径集会被拒绝而不是被解释，因为不带路径的 git 提交会提交整个索引。新路径会在提交前记入索引以便 git 接受，而失败的提交会报告该索引条目是否已回滚。

## 定时自动化：`ctx.workspaceAutomation`

[`dsh-workspace-automation`](../../packages/workspace/workspace-automation) 为每个工作区拥有一个定时器和其上的两个作业。对齐作业先观测、决策、fetch、再观测、探测，然后要么报告所发现的情况，要么推进分支。提交作业在闭合的回合边界运行：它推导该回合自身的工具调用已证明写入的路径，对其有界前缀做凭据筛查，经 `ctx.workSummary` 生成摘要，然后创建一个提交。两个作业都通过 `ctx.gitAlign` 写入、通过 `ctx.git` 读取，都不派生子进程。

每次运行是一个事务：获取已存储的租约、执行动作、恰好记录一条带闭合结果的账本条目、释放租约、重新装填定时器。租约是存储的而非仅存于内存，因此读取同一领域的第二个进程也能看到它；发现租约已被持有的运行记录 `skipped-locked`，并且不触碰任何东西。定时器把下一次运行存为绝对时刻而不是区间起点，因为已存储状态是重启后的进程唯一能读到的东西；退避、冲突冷却与常规区间都只写这一个字段。工作区在连续失败达到配置值后被挂起，任何非失败结果都会清除退避与冷却。

归属是被证明的而非被推断的：只有当某个回合持有一次写入工具的 `tool/call`、其实参命名了该路径，并且存在一次报告无错误的匹配 `tool/result` 时，该路径才算作本回合的工作。缺失结果、失败结果与来自其他回合的调用全部被排除，因此 shell 命令写入的文件绝不会被归属；而更早的未提交回合也写过的路径会作为歧义被拒绝，而不是被提交两次。

```ts type-equiv
/**
 * The closed outcome of one run. `no-op` and `refused` are correct answers, not
 * failures; only `failed` and `suspended` advance the failure backoff.
 */
type AutomationOutcome =
  | { readonly kind: 'no-op'; readonly reason: NoOpReason }
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'committed'; readonly sessionId: string; readonly turn: number }
  | { readonly kind: 'conflicted'; readonly paths: readonly string[]; readonly total: number }
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly paths: readonly string[] }
  | { readonly kind: 'ambiguous-attribution'; readonly paths: readonly string[] }
  | { readonly kind: 'skipped-locked' }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly reason: FailureReason; readonly detail: string }
  | { readonly kind: 'suspended'; readonly reason: string }
```

`no-op` 指明该次运行为何正确地什么都没做——分支已是最新、未找到仓库或上游、模式只做观测、下游验证方已覆盖这次推进、没有可归属路径，或工作已经提交过。`refused` 指明该次运行为何拒绝行动：分离的 HEAD、在已配置策略下脏的工作树、命中凭据形态的候选、并存的版本控制工作区、超过一个提交可承载的路径数、无法归属的剩余部分，或不可读的路径。`superseded` 表示运行在自身两次读取之间观测到 HEAD 移动，因而什么都没写。

```ts type-equiv
/** What one created commit was, and how a human withdraws it. */
interface CommitReport {
  /** Created commit id. */
  readonly oid: string
  /** Parent commit id. */
  readonly parentOid: string
  /** Paths the commit contains, and no others. */
  readonly paths: readonly string[]
  /** Accepted subject line. */
  readonly subject: string
  /** Accepted body lines, empty when the message has none. */
  readonly body: readonly string[]
  /** Whether a provider or the mechanical fallback supplied the message. */
  readonly summarySource: string
  /** Every summary consultation note. */
  readonly summaryNotes: readonly string[]
  /** Bytes the credential screen read. */
  readonly scanBytes: number
  /** Whether no remote-tracking ref contains the commit yet. */
  readonly withdrawable: boolean
  /** Withdrawal command that keeps the changes staged. */
  readonly softReset: string
  /** Withdrawal command that keeps the changes in the work tree only. */
  readonly mixedReset: string
}
```

撤回是非破坏性的：记录下来的两条 reset 命令都会保留提交的内容，所报告的命令中不存在 `--hard` 形式。提交携带 `ctx.workSummary` 保留的 `Dsh-Unit: <sessionId>/<turn>` trailer，因此后来推送它的人可以把该提交归属到产生它的工作单元。

```ts type-equiv
/** One retained run record; the ledger is the authoritative record. */
interface RunRecord {
  /** Stable record id. */
  readonly id: string
  /** Job this run belonged to. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** Closed outcome. */
  readonly outcome: AutomationOutcome
  /** HEAD recorded before the first write of the run, when observed. */
  readonly expectedHeadOid: string | null
  /** Upstream commit id the run observed. */
  readonly observedUpstreamOid: string | null
  /** Baseline before the run. */
  readonly baselineBefore: string | null
  /** Baseline after the run. */
  readonly baselineAfter: string | null
  /** The commit this run created, when it created one. */
  readonly commit: CommitReport | null
}
```

运行时的持久状态是每个工作区一条 `workspace_automation` 存储领域记录（`AutomationStateRecord`）：已对齐基线的上游与本地提交 id 及其分支、最近一次运行的结束时刻与结果、连续失败计数、下一次运行最早可行动的时刻、挂起原因、租约的持有者与到期时刻、每个会话最近提交的回合、上一次提交作业留下的未提交路径，以及保留的运行记录。该记录才是真源；账本是它的有界视图。

## 自动化账本：`ctx.workspaceAutomationLedger`

[`dsh-api-workspace-automation`](../../packages/api/workspace-automation) 通过 `workspace` Remote 命名空间的 `automationLedger` 把某个工作区已存储的账本投影给客户端；其 README 拥有该投影的上限与已知限制。它不拥有自己的任何事实：每个值都从一条已存储的运行记录、已存储状态或某次运行的提交记录复制而来。运行时没有为其存储任何内容的工作区是正常答案而非错误，因为定时器可能从未在那里运行过。运行条数上限与路径上限都是经校验的配置，账本自身的计数随每个有界列表一起传递，因此被截断的列表绝不会被误当作全部。

```ts type-equiv
/** One retained run, answering the four questions the design requires of every run. */
interface AutomationRunView {
  /** The ledger record's id. */
  readonly id: string
  /** Which job ran. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** What the run compared. */
  readonly comparison: AutomationComparison
  /** What the run did, or why it did not act. */
  readonly outcome: AutomationRunOutcome
  /** What happens next. */
  readonly nextStep: AutomationNextStep
  /** The commit the run created; present only when it created one. */
  readonly commit?: AutomationCommitView
}
```

一次运行视图回答读者关于它的四个问题：比对了什么、做了什么或为什么没做、冲突在哪、下一步是什么。`nextStep` 是每个结果一个标签，因此无需了解运行内部即可读懂下一步动作。

```ts type-equiv
/**
 * One ledger read. A workspace the runtime stores nothing for is a normal
 * answer rather than an error: the timer may never have run there.
 */
type AutomationLedgerView =
  | { readonly kind: 'unrecorded'; readonly workspaceId: WorkspaceId }
  | ({ readonly kind: 'recorded' } & AutomationRecordedView)
```

## 消费方

[`dsh-api-workspace-controller`](../../packages/api/workspace-controller) 经 `ctx.workspaceRegistry` 向 GUI 客户端提供工作区 CRUD，[`dsh-api-workspace-git`](../../packages/api/workspace-git) 提供 `ctx.workspaceGit` 的有界仓库读取，[`dsh-api-session-controller`](../../packages/api/session-controller) 执行上文「先建会话再 attach」的流程。[dsh-agent-instructions](../../packages/context/agent-instructions) 尽管名字如此，却**不是**消费方：它在 agent 自己的 cwd 下发现 AGENTS.md 风格的指令文件，从不触碰 `ctx.workspaceRegistry`——两者共用的这个词指的是用户的工作目录，而非本注册表的实体。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxgit--gitobserver-abstract-seam"></a>

### `ctx.git` — `GitObserver` (abstract seam)

Abstract git observation service. Subclass, implement observe, and load the subclass as a plugin — it registers as `ctx.git` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- observe resolves `absent` for a directory outside any git work tree; that is an answer, not a failure.
- Every list in the snapshot is cut to MAX_OBSERVATION_ITEMS with its truncated flag set when the bound dropped entries.
- `signal` aborts the read; an aborted read rejects with the abort reason.
- Nothing in the implementation writes to the repository.

```ts cordis-catalog
/**
 * Observe the git repository that contains one working directory.
 * @param cwd - the directory to observe from; the repository's work-tree root
 *   is whatever git reports for it, not necessarily the directory itself.
 * @param signal - caller cancellation.
 * @returns the repository's bounded snapshot, or `absent` outside any work tree.
 */
abstract observe(cwd: string, signal: AbortSignal): Promise<GitObservation>
```

Source: [`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)

<a id="ctxgitalign--gitaligner-abstract-seam"></a>

### `ctx.gitAlign` — `GitAligner` (abstract seam)

Abstract git alignment service. Subclass it, implement every operation, and load the subclass as a plugin — it registers as `ctx.gitAlign` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Every operation resolves a classified value for an expected git failure; only a caller cancellation rejects, with the abort reason.
- A cancelled call must not leave a merge in progress in the work tree.
- probe never modifies the target work tree, its index, or its refs.
- commit contains exactly the supplied paths and no others.
- Nothing in the implementation pushes, rebases, or rewrites history.

```ts cordis-catalog
/**
 * Resolve one raw request into the target every operation uses.
 *
 * The split of `upstream` into a remote and a ref name happens once, here, so
 * no operation re-derives it and a request that cannot be split fails before
 * any command runs.
 * @param request - the coordinates observed by the consumer.
 * @returns the resolved target.
 * @throws {GitAlignRequestError} when the tracked branch has no `remote/ref` spelling.
 */
abstract resolve(request: AlignRequest): AlignSpec

/**
 * Fetch the target's upstream ref from its remote — the seam's only network operation.
 * @param spec - the resolved target.
 * @param signal - caller cancellation, which must bound the fetch.
 * @returns the classified fetch answer.
 */
abstract fetch(spec: AlignSpec, signal: AbortSignal): Promise<FetchResult>

/**
 * Report whether the upstream merges into HEAD cleanly, without touching the
 * target work tree, its index, or its refs.
 * @param spec - the resolved target.
 * @param request - scratch-tree location and the conflict-list bound.
 * @param signal - caller cancellation.
 * @returns the classified probe answer.
 */
abstract probe(spec: AlignSpec, request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult>

/**
 * Align HEAD to the upstream using the requested strategy, or roll the
 * attempt back and report it.
 * @param spec - the resolved target.
 * @param strategy - how the attempt reaches the upstream revision.
 * @param signal - caller cancellation.
 * @returns the classified write answer.
 */
abstract apply(spec: AlignSpec, strategy: AlignStrategy, signal: AbortSignal): Promise<ApplyResult>

/**
 * Read diff facts for exactly one path set, relative to HEAD.
 * @param spec - the resolved target.
 * @param paths - repository-relative paths, already bounded by the consumer.
 * @param signal - caller cancellation.
 * @returns the classified facts answer.
 */
abstract changeFacts( spec: AlignSpec, paths: readonly string[], signal: AbortSignal, ): Promise<ChangeFactsResult>

/**
 * Report which of the given paths git's own ignore rules match.
 * @param spec - the resolved target.
 * @param paths - repository-relative paths, already bounded by the consumer.
 * @param signal - caller cancellation.
 * @returns the classified ignore answer.
 */
abstract ignoredPaths( spec: AlignSpec, paths: readonly string[], signal: AbortSignal, ): Promise<IgnoreResult>

/**
 * Create one commit containing exactly the supplied paths.
 * @param spec - the resolved target.
 * @param request - the path set, the message, and whether repository hooks run.
 * @param signal - caller cancellation.
 * @returns the classified commit answer.
 */
abstract commit(spec: AlignSpec, request: CommitRequest, signal: AbortSignal): Promise<CommitResult>

/**
 * Report whether any remote-tracking ref already contains one commit — the
 * fact that decides whether a created commit can still be withdrawn.
 * @param spec - the resolved target.
 * @param oid - full object id of the commit to test.
 * @param signal - caller cancellation.
 * @returns the classified answer.
 */
abstract pushedToRemote(spec: AlignSpec, oid: string, signal: AbortSignal): Promise<PushedResult>
```

Source: [`packages/git/git-align/src/index.ts`](../../packages/git/git-align/src/index.ts)

<a id="ctxworkspaceautomation--workspaceautomationruntime"></a>

### `ctx.workspaceAutomation` — `WorkspaceAutomationRuntime`

The workspace automation runtime. One instance owns every workspace's timer, its durable state, and the two jobs.

```ts cordis-catalog
/**
 * The read-only projection of one workspace's automation state.
 * @param workspaceId - workspace to report.
 * @returns the report, or `undefined` when no state is stored yet.
 */
report(workspaceId: string): WorkspaceAutomationReport | undefined

/**
 * Clear a workspace's suspension and re-arm its timer.
 * @param workspaceId - workspace to resume.
 * @returns `true` when the workspace was suspended.
 */
async resume(workspaceId: string): Promise<boolean>

/**
 * Run the alignment job once for one workspace.
 * @param workspaceId - workspace to align.
 * @param trigger - what asked for the run.
 * @returns the recorded run.
 */
async runAlign(workspaceId: string, trigger: RunTrigger = 'due'): Promise<RunRecord>

/**
 * Run the commit job once for one work unit.
 * @param workspaceId - workspace the session belongs to.
 * @param session - the session whose work unit ended.
 * @param turn - the turn number that closed the work unit.
 * @returns the recorded run.
 */
async runCommit(workspaceId: string, session: Session, turn: number): Promise<RunRecord>
```

Types: [Session](session.zh.md)

Source: [`packages/workspace/workspace-automation/src/index.ts`](../../packages/workspace/workspace-automation/src/index.ts)

<a id="ctxworkspaceautomationledger--workspaceautomationledger"></a>

### `ctx.workspaceAutomationLedger` — `WorkspaceAutomationLedger`

Host Remote service projecting one workspace's automation ledger.

```ts cordis-catalog
/**
 * Read one workspace's automation ledger.
 *
 * A workspace the runtime holds no state for answers `unrecorded` rather than
 * failing: a workspace whose timer has never run is a normal reading, and the
 * panel says so instead of showing an empty ledger.
 * @param workspaceId - the workspace whose ledger is read.
 * @returns the recorded state with its bounded runs, or `unrecorded`.
 */
@Remote automationLedger(workspaceId: WorkspaceId): AutomationLedgerView
```

Source: [`packages/api/workspace-automation/src/index.ts`](../../packages/api/workspace-automation/src/index.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspacefiles--workspacefiles"></a>

### `ctx.workspaceFiles` — `WorkspaceFiles`

Host Remote service over the composed filesystem, confined to one workspace.

```ts cordis-catalog
/**
 * Read one page of lines from a UTF-8 text file inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the line window; omitted fields take the page defaults.
 * @param signal - caller cancellation.
 * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
 */
@Remote async read(agent: Agent, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>

/**
 * Read one byte window of a regular file inside the Agent's workspace: raw
 * bytes, no text decoding and no binary rejection.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the byte window; omitted fields take the window defaults.
 * @param signal - caller cancellation.
 * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
 */
@Remote async readBytes(agent: Agent, path: string, range: WorkspaceByteRange, signal: AbortSignal): Promise<WorkspaceFileBytes>

/**
 * Report one regular file's identity, version, and size without its content.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the file's absolute path, current version, and byte size.
 */
@Remote async stat(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>

/**
 * Replace one regular file's complete text inside the Agent's workspace.
 *
 * The write is guarded by the version the caller read: a file that no longer
 * carries it fails with `workspace-file/stale-version` and keeps its content.
 * The guard is applied twice on purpose — once against the stat this method
 * takes, so the common conflict is decided before any content is written, and
 * once by the backend's atomic write at that same version, so a change
 * landing in between is refused rather than clobbered.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param content - the complete new file text.
 * @param expectedVersion - the `version` the caller's read reported.
 * @param signal - caller cancellation.
 * @returns the written file's absolute path, new version, and byte size.
 */
@Remote async write( agent: Agent, path: string, content: string, expectedVersion: string, signal: AbortSignal, ): Promise<WorkspaceFileStat>

/**
 * List the direct children of one directory inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the directory's children in the backend's stable name order, bounded by the entry cap.
 */
@Remote async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

/**
 * Stream every `fs/observed` observation of a file inside the Agent's
 * workspace. Only Agent filesystem operations report here; the OS is not
 * watched.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - generation cancellation.
 * @returns `ready` once the Host observation queue is active and the workspace
 *   root is resolved, then queued and live observations in emission order.
 */
@Remote({ mode: 'stream' }) changes(agent: Agent, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
```

Types: [Agent](core.zh.md)

Source: [`packages/api/workspace-files/src/index.ts`](../../packages/api/workspace-files/src/index.ts)

<a id="ctxworkspacegit--workspacegit"></a>

### `ctx.workspaceGit` — `WorkspaceGit`

Host Remote service reading one workspace's repository state through `ctx.git`.

```ts cordis-catalog
/**
 * Observe the repository that contains the Agent's workspace root.
 *
 * The observation is one bounded read, not a subscription: a consumer asks
 * again when it wants a fresher answer, and aborting the call abandons the
 * read without leaving any state behind.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - caller cancellation.
 * @returns the repository's bounded snapshot, or `absent` when the workspace
 *   root is not inside a git work tree.
 */
@Remote async observe(agent: Agent, signal: AbortSignal): Promise<GitObservation>
```

Types: [Agent](core.zh.md)

Source: [`packages/api/workspace-git/src/index.ts`](../../packages/api/workspace-git/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The fully qualified
 * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
 * non-directory path rejects. Repeated calls for the same canonical path
 * return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in a fully qualified path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in a fully qualified spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.zh.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->

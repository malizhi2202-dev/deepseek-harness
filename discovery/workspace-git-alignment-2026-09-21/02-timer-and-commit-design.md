# 每工作区定时器 与 自动总结+自动提交：设计

议题 slug：`workspace-git-alignment-2026-09-21`
本文位置：`discovery/workspace-git-alignment-2026-09-21/02-timer-and-commit-design.md`
输入：`00-request-and-facts.md`（需求与已核实事实）、`01-competitive-landscape.md`（同类产品调研，本文的全部外部证据来源）

本文是**设计**，不是调研。所有外部证据以 `01-competitive-landscape.md` 的节号（如 §28.2）与证据分级引用，不重新取证，也不把该文的【推断】升级为事实。所有仓库事实在本文写作时实查过，引用仓库内路径而非行号。本文不修改任何代码、包或配置，不做任何 git 写操作。

正文中每条决定带一个标签：**【证据强制】** 表示该决定由调研稿的一手证据或仓库内契约直接推出，换成别的做法就与证据冲突；**【判断】** 表示证据没有强制，是本文选定的取舍，理由随附。

---

## 一、动机：证据已经定了什么

负责人的三条原话（`00-request-and-facts.md` 开头）：

> 1 给每个工作区维度添加一个定时器模块
> 2 这个模块的作用就是定时 对齐git 以及git内的文档、pr、提交、代码 定时合并对齐
> 3 在添加 在每个工作内部自动总结 自动提交commit 但是push 由人决定

### 1.1 八条证据强制的决定

| # | 决定 | 依据 |
| --- | --- | --- |
| 1 | **两段式：定时器只触发一次「运行」，陈旧度决定「要不要动」** | 【证据强制】§28.2 明确点出这是两个独立一手先例的共同形状：Renovate 由外部调度器按 `schedule` 触发、运行内部由 `rebaseWhen` 决定动作，判据 `behind-base-branch` = 落后 ≥1 个 commit（§5，【实抓】）；etckeeper 由 cron/systemd timer 每日触发、脚本先跑 `etckeeper unclean` 判脏再提交（§24.1，【子代理实抓】）。Kodiak 把「落后多少」完全委托给平台二值状态、Mergify 让用户写 `#commits-behind > 5`（§7.2，【事实】），说明「落后 N」是配置或委托，不是内置常量 |
| 2 | **workspace 记录上存「最后对齐到的 revision」，不存「上次对齐的时间」** | 【证据强制】§28.2 的推论段直接给出这条：jj 的 `.jj/working_copy/` 记录工作副本最后被更新到哪个操作，因此陈旧可检测（§10、§22，【实抓】，附录复核过 `working-copy` 文档逐字）；§30.1 把它列为跨重启的答案 4 |
| 3 | **对齐强度是下游验证能力的补集** | 【证据强制】§28.3 引 Renovate `rebaseWhen=auto` 逐字：GitHub base 分支有 merge queue、或 GitLab 项目启用 merge trains 时，退化成 `conflicted`，理由是「merge queue 已经在拿 head 测 PR」（§5，【实抓】）；另一半来自 GitLab 官方：automatic rebase before merge 明确不重跑 CI（逐字 "Does not re-run CI/CD pipelines on the rebased result."，§2，【子代理实抓】）。因此「rebase 后要不要重验」必须显式回答，不能默认 |
| 4 | **默认保守，甚至默认关闭** | 【证据强制】§28.4 一张表：VS Code `git.autofetch` 默认 `false`（§14.1，【实抓】）、obsidian-git 的 auto commit-and-sync interval 默认 `0`（§24.3）、Sapling `amend.autorestack` 默认 `only-trivial`（§11）、`git rerere` 默认关（§16.1，【实抓】）、GitLab merge train enforcement 默认 `Allow bypass`（§2）、Zuul `disable-after-consecutive-failures` 默认关（§7.5）。§28.4 的结论是「能做」与「默认做」普遍分开 |
| 5 | **不能论证「同类产品都定时做对齐」；要论证「为什么这件事必须由时间驱动」** | 【证据强制】§28.1：调研覆盖的全部产品里 automatic 一律挂在动作上，唯一出现在时间上的都是外部调度器（OS 调度器 / CI cron / 平台托管），工具自己只提供「一条可以安全地在无人值守下运行的命令」；`gh stack sync` 是唯一明确声明适合被调度的一个（逐字 "`sync` is safe to run in automation"，§8，【实抓】），但它自己不带定时器。§32.1 明确限定了这类否定性结论的强度：只覆盖到实际枚举过的页面集合。**可引用的正面立项理由是 GitLab 自己的话**（§17.2，【实抓】）：纯 push 事件驱动不会维护「完全没有 push 的仓库」，因此 dormant 或只读仓库享受不到改进，必须补一条定时路径 |
| 6 | **commit 期的 git hook 拦不住密钥，可靠的闸门在 push** | 【证据强制，但注意这是调研稿自己标明的推导，不是任何产品的表述】§26.1 的三个一手事实：`pre-commit` 与 `commit-msg` 都能被 `--no-verify` 绕过（`githooks.adoc` 逐字），唯一不被 `--no-verify` 抑制的 `prepare-commit-msg` 只拿到提交消息文件、拿不到被提交的文件内容（官方自己写 "It should not be used as a replacement for the pre-commit hook."），而 `git-commit.adoc` 对 `--no-verify` 的定义是 "Bypass the `pre-commit` and `commit-msg` hooks."（均【实抓】）；再加上 Aider 的 `--git-commit-verify` 默认 `False`，即默认给 `git commit` 加 `--no-verify`（§18，【实抓】）。§26.4 第 5 条据此得出「最强的一道闸门在 push 侧」，而这条正好与负责人「push 由人决定」合拍 |
| 7 | **暂存范围是安全属性；绝不 `git add -A` / `git add .`** | 【证据强制】§31.2 第 2、3 条：Aider 的自动提交用 path-limited commit（`git commit -m <msg> -- <fnames>`），这是「只提交本工作单元产生的改动」的 git 原生实现（§18，【实抓】）；`git commit -- <paths>` 默认等于 `--only`，逐字 "disregarding any contents that have been staged for other paths"（附录复核过 `git-commit.adoc`）。§31.2 同时点明 Aider 在 `--dirty-commits`（默认 `True`）与 `/commit` 两条路径上主动放弃了这条不变量，所以「自动提交」这个词必须逐路径写明范围 |
| 8 | **绝不 push：模块不提供任何自动 push 路径** | 【证据强制】§31.2 第 1 条与 §27.3：Aider 是唯一成熟先例，`args.py` 与官方选项页里 `push` 零匹配（§18，【实抓】）；§27.3 第 1 条同时给出反面教训——Cline 官方文档把 "Commit and push changes to version control" 列为 YOLO 模式的风险项，**只要 agent 有 shell 就能 push**，所以「不自动 push」必须在 harness 层强制，不能靠「没写这个功能」；§27.3 第 2 条给出正面理由：Aider 的 `/undo` 在提交推出 origin 之后永久拒绝（逐字 "The last commit has already been pushed to the origin. Undoing is not possible."），即 committed-but-not-pushed 正是「还能撤销」的必要条件 |

### 1.2 一条本设计**不**采纳调研稿建议的地方

§29.2 与 §16.1 建议「一个每周期重试对齐的模块应当默认开启 `rerere`」。**本设计不开启，也不调用 `rerere`。**【判断】理由：那条建议的前提是对齐器会在用户的工作副本里解冲突、留下可复用的解决记录；而本设计在冲突时**从不进入工作副本的合并态**（见 4.3），工作副本里不会出现需要复用的冲突前置文本，`rerere` 没有可复用的对象。若将来加入「在工作副本内解冲突」的形态，这条建议才重新适用。

---

## 二、底座缺口与要建的东西

### 2.1 实查确认的缺口

| 事项 | 实查结果 |
| --- | --- |
| git 能力 | `packages/git/git/src/index.ts` 只有一个抽象方法 `observe(cwd, signal): Promise<GitObservation>`；模块头逐字写着 "What the seam will never do is mutate: no checkout, commit, push, or pull crosses this contract."。全树无 `fetch` / `merge` / `rebase` / `commit` / `checkout` 的写路径。该包 README 第 53 行逐字："**Read-only by design.** No write operation will be added on this seam; repository mutation belongs to the upstream git plugin that replaces it."，且整个 `git/` family 被标记为 **bounded-lifetime temporary artifact**（`packages/git/README.md`、`.agents/notes/implemented/feature/2026-09-18-sidebar-git-observation-panel.md`） |
| 调度底座 | `packages/schedule/schedule` 是**会话内**持久提醒（README 逐字："durable reminders … the reminder comes back as an ordinary follow-up message in the same conversation"），`packages/jobs/jobs` 是**会话归属**的后台作业（README 逐字："Jobs belong to the agent session that started them"）。两者归属维度都不是 workspace |
| 宿主级调度 | 全树没有任何 workspace 级或宿主级周期作业底座。`ctx.timeout` / `ctx.interval` 存在（`vendor/timer/src/index.ts`），但它们是 **effect 作用域的进程内定时器**：无持久化、无相位恢复、随 fiber 释放而消失，不能直接当「每工作区定时器」 |
| forge 能力 | 全树没有任何 GitHub/GitLab **写**能力包。`packages/webhook/webhook-github` 只依赖 `@octokit/webhooks`（入站投递的签名校验），没有 `@octokit/rest`，没有任何「列 PR / 读 PR 状态 / 改 PR base / 更新分支 / 入队合并」的代码 |
| 密钥扫描 | 全树无 `gitleaks` / `detect-secrets` / `trufflehog` 或任何等价能力 |
| 存储域 | 全树只有两个 `defineDomain` 声明：`packages/workspace/workspace/src/spec.ts` 的 `workspace`（version 2）与 `packages/session/session-projection-cache/src/spec.ts` 的投影缓存 |

### 2.2 为什么不拓宽只读 git 接缝

**采用：新立对齐接缝 `ctx.gitAlign`，provider 经既有 no-shell runner 执行 git 命令。**【证据强制】理由三条，均可复核：`packages/git/git/README.md` 逐字声明「本接缝不会加写操作」；该 family 是**有期限的临时配套**，在其上加写操作会把这个期限绑到本特性上；`GitObserver` 的契约自述是「有界只读观察」，把它改成可写会让**每一个既有消费者**（`packages/api/workspace-git` 的 Web 侧边栏面板）在类型上获得它不需要的变更权限。

**但要正面考虑反面方案，并且部分采纳它。** 反面方案是「复用 `ctx.git` 做读、只把写放进新接缝」。实查 `packages/git/git/src/types.ts` 的 `GitHeadState` 之后，这条不只是可行而是**应该做**：它已经带 `oid`、`branch`（HEAD detached 时缺失）、`upstream`（无上游时缺失）、`ahead`、`behind`，正是陈旧判据与拒绝路径需要的全部输入；`GitRepositorySnapshot` 还带 `worktree` 与 `worktreeTruncated`，正是脏树判定需要的输入。因此：

- **读**：对齐运行的第一步用 `ctx.git.observe(workspace.path)` 取快照，不重复实现读取。这不需要改 `packages/git/git` 一个字节。
- **写与只读接缝不覆盖的命令**：放进 `ctx.gitAlign`。`observe` 不提供 fetch、试合并探测、diff 事实、commit，也不提供「远端引用刚被 fetch 更新之后」的重新观察——fetch 之后的观察仍走 `ctx.git.observe`。

【判断】把两个作业（对齐与提交）放在**同一个** `ctx.gitAlign` 接缝里，而不是拆成 `ctx.gitAlign` 与 `ctx.gitCommit`：两者共用同一个 provider 的 git 命令知识、同一套拒绝分类、同一把每工作区锁、以及同一个「写之前先记下预期 HEAD」的前置步骤；拆开会让这些知识在两处 provider 里各写一遍。仓库约定要求「provider 专属行为留在 provider 或消费者，不让一个消费者决定服务契约」，一条接缝两个消费者（对齐作业、提交作业）符合这条。

### 2.3 要建的包与存储域

| 包 | 角色 | 关键面 |
| --- | --- | --- |
| `packages/git/git-align`（`@deepseek-ai/dsh-git-align`） | Service Definition | `ctx.gitAlign`，抽象类 `GitAligner`；导出 `AlignRequest` / `AlignSpec` / `FetchResult` / `ProbeResult` / `ApplyResult` / `ChangeFacts` / `CommitResult` |
| `packages/git/git-align-local`（`@deepseek-ai/dsh-git-align-local`） | Provider | `LocalGitAligner`，经 `@deepseek-ai/dsh-native-command` 的 `runNativeCommand` 执行 git，与 `packages/git/git-local` 用同一条 no-shell 边界 |
| `packages/workspace/workspace-automation`（`@deepseek-ai/dsh-workspace-automation`） | Consumer + 定时器 + 运行台账 | `ctx.workspaceAutomation`，类 `WorkspaceAutomationRuntime`；拥有 `workspaceAutomation` 存储域 |
| `packages/session/work-summary`（`@deepseek-ai/dsh-work-summary`） | Definition + Service + Provider 契约 + 机械兜底 | `ctx.workSummary`，抽象类 `WorkSummaryService`，`WorkSummaryProvider { generate(request) }` |
| `packages/session/work-summary-llm`（`@deepseek-ai/dsh-work-summary-llm`） | Provider | 用 LLM 生成变更摘要 |
| `packages/api/workspace-automation` | Remote 命名空间 | 按 `WorkspaceId` 键的只读台账投影，形态照 `packages/api/workspace-controller`（它已经是按 workspace 键、namespace 为 `workspace` 的 Remote 所有者） |

接缝完整性：`git-align`（Definition）/ `git-align-local`（Provider）/ `workspace-automation`（Consumer）三角齐全；`work-summary`（Definition + Provider 契约）/ `work-summary-llm`（Provider）/ `workspace-automation`（Consumer）三角齐全。**【判断】** `work-summary` 单独成包而不是折进 `workspace-automation`：它的形状在仓库里已有先例——`packages/session/session-title` 一个包同时装了接缝、服务、provider 契约与确定性兜底，另有 `session-title-llm` 等 provider 包（§31.3 的 DSH 落点表列了这一行）。可替换的 provider 本身构成这条能力，所以值得一个包；而 provider 契约里**不带** cadence 字段（对照 `SessionTitleProvider.automatic` 的 `'first-prompt' | 'all-prompts'`），因为这里的触发节奏是工作区级策略、由 `workspace-automation` 拥有，不属于 provider——这处不对称是有意的。

存储域 `workspaceAutomation`（`defineDomain({ name: 'workspaceAutomation', version: 1 })`），按 `WorkspaceId` 键，两张表：

```
state (key: WorkspaceId):
  baselineUpstreamOid: string | null      # 最后对齐到的远端引用 oid
  baselineLocalOid: string | null         # 对齐完成时本地 HEAD 的 oid
  baselineBranch: string | null
  baselineAt: string                      # ISO-8601，只用于报告，不用于判据
  lastRunAt: string
  lastOutcome: string                     # 见 7.1 的分类
  consecutiveFailures: number
  nextEarliestRunAt: string | null        # 退避与冲突冷却
  suspended: boolean
  suspendedReason: string | null
  runLeaseUntil: string | null            # 每工作区运行租约
  runLeaseOwner: string | null
  commitWatermarks: Record<SessionId, number>   # 每会话最后已提交的 turn 号
  ledger: RunRecord[]                     # 有界环形，长度由 Config.ledgerEntries 决定
```

**【判断】** 单独开一个域而不扩 `workspace` 域（后者是 version 2，`WorkspaceRecord` 由 zod 在耐久边界校验，扩它要动已有 schema 与版本兼容）。代价是 workspace 记录与它的对齐状态之间没有单条原子写；本设计不需要那个原子性——运行状态是**可重建的投影**（见 7.2），workspace 记录是权威身份。

### 2.4 「本工作单元写过哪些路径」在宿主面能拿到什么

这是作业 (b) 的核心输入，必须逐条说清可达性。

- **`produced-files` 记录本身在宿主面不可达。** 实查：`produced-files` 只出现在 `packages/client/ui-deliverables/src/client/index.ts` 与其同目录的 `turn-deliverables.ts`；它声明的是客户端 `ConversationTurnDataMap` 上的 `deliverables` 成员，路径来自对 `write` / `edit` / `str_replace_editor` 调用参数的解析（`mutationPath`、`validEditArgs`、`editorMutationPath`），并且依赖客户端的 Conversation Location 索引来划定 turn 归属。宿主面导入不了这个 Definition。
- **但它的输入在宿主面可达。** `packages/core/session/src/types.ts` 的 `SessionEventMap` 里，`'tool/call'` 的载荷是 `{ turn, step, callId, name, arguments }`，其中 `arguments` 是模型产出的原始 JSON 字符串；`'tool/result'` 带 `{ turn, step, message, error? }`，**没有 `error` 即成功**。这些都是耐久日志里的事件。所以宿主面可以**重新推导**同一组路径：按 `turn` 过滤 `tool/call`，取 name 属于第一方变更工具、其 `tool/result` 无 `error` 的调用，从 `arguments` 里抽出路径。
- **mtime 判据在宿主面可达，但它是过滤器不是发现器。** `packages/channel/channel-bridge/src/index.ts` 的 `writtenFile` 已经实现同一条判据：`stat(...).mtimeMs < runStartedAt - mtimeGraceMs` 即判为该轮没写过，`mtimeGraceMs` 是 Config 字段、默认 2000。但它的调用者 `deliverFiles` 是在**回复文本已经点名的路径**上逐个过滤（`replyFileMentions(text)`），它回答的是「这个被点名的路径本轮写过吗」，不回答「本轮写了哪些路径」。
- **结论（作业 (b) 的暂存集定义）**：暂存集 = 从该工作单元的 `tool/call` 参数抽出的路径 ∩ 经 `ctx.fs.resolve` + `ctx.fs.contains(workspaceRoot, target)` 确认在工作区内 ∩ 经 `ctx.fs.stat` 确认是文件且 `mtimeMs >= 该 turn 的 turn/start 时刻 - mtimeGraceMs` ∩ 未被 `.gitignore` 忽略。前三项覆盖「发现」，第三项同时覆盖「验证」。
- **由此产生的两个已知缺口，必须写进实现而不是靠文档约定**：① **经 shell 写出的路径不在暂存集里**——`bash` 跑的 `sed -i`、构建产物、`git` 自身的写操作都不会产生第一方变更工具的 `tool/call` 参数，因此它们永远进不了自动提交，只能作为「未提交余量」被报告。这是【判断】选定的收窄：宁可漏提交也不能误提交，与 §31.2 第 2 条「必须逐路径写明提交范围」一致。② **宿主面的抽取规则与客户端 `turn-deliverables.ts` 的规则会漂移**——两处都要判 `edit` 的 `old_string`/`new_string` 合法性与 `str_replace_editor` 的变更型 command。**建议**（本文只提出，不实现）把这段纯解析抽到一个双方都能导入的非客户端模块，让客户端 Definition 与宿主面抽取共用一份规则；在此之前，两处的规则必须由测试钉住。**【判断】**

---

## 三、定时器与陈旧度模型

### 3.1 两段式

一次「运行」分两段，两段的判据完全不同：

- **第一段：到期**。定时器到点即跑，跑的成本是只读观察（可能含一次 fetch）。这一段的产物是「一个结论」。
- **第二段：是否动手**。由陈旧度决定，判据是「相对记录下来的基线是否真的落后」，不是「距离上次多久」。**【证据强制：§28.2】**

这条分工带来一个直接后果，也是本设计能不做相位持久化的原因：**错过一次运行不需要补跑，因为下一次运行的动作取决于落后与否，不取决于「欠了几次」。** `packages/schedule/schedule/src/domain.ts` 已经用同一思路处理错过的固定间隔（`EveryOccurrence` 的注释逐字："One latest-only fixed-rate decision derived without enumerating a backlog"，README 也写「A repeating reminder that missed intervals … presents only its latest due occurrence, not a backlog」）。本设计复用它的**到期计算模型**（只算最近一次到期、不枚举积压），但不复用它的归属——它属于 session，本模块属于 workspace。

### 3.2 存「最后对齐到的 revision」，不存时间

`state.baselineUpstreamOid` 与 `state.baselineLocalOid` 是判据的唯一来源。**【证据强制：§28.2 推论、§30.1 答案 4】** `state.baselineAt` 存在但只用于人读的报告，任何判定都不读它。这条决定了三件事：

- 一次「什么都没做」的成功运行**也要推进基线**：把当前观察到的 upstream oid 与 local oid 写进 `baselineUpstreamOid` / `baselineLocalOid`。否则每次运行都会把同一批落后提交重新算一遍。这是 §30.2 GitLab 水位线列（`last_repository_check_at`）的同构做法。
- 陈旧度不是「基线时间有多老」，所以一个长期安静的仓库不会因为时间流逝而变成「陈旧」——它只有在远端真的前进了之后才需要动。这与 §28.1 的立项理由（安静的仓库需要一条定时路径）不矛盾：定时路径保证的是**被发现**，不是**被判定为陈旧**。
- 崩溃后无需恢复相位：进程重启时从 `state` 重建「谁该跑」，不从内存重建。

### 3.3 触发器的形态

每个启用的工作区一个自续的 `ctx.timeout`，**不用 `ctx.interval`**。**【证据强制：§14.1】** VS Code `autofetch.ts` 的 `run()` 是 `while (this.enabled)` 循环加 `Promise.race([timeout, whenDisabled])`，下一次的计时从「上一次 fetch 完成之后」才开始，主 agent 全文复核过（§14.1，【实抓】）；本设计照此，避免上一次运行还没结束、下一次已经到点。

- 延迟 = `max(0, 上次完成时刻 + intervalSeconds - 现在)`，再乘一个抖动因子。**【证据强制：§28.5】** 三个独立产品用三种方式解决同一个问题：bors-ng 首次轮询乘 `rand.uniform(2) * 0.5`（【实抓】）、Dependabot 给每个配置随机分配固定执行时刻（逐字 "By default, Dependabot randomly assigns a time"，§6）、Gitaly scheduled housekeeping 每轮随机洗牌遍历顺序（§17.2，【实抓】）。本设计用每轮抖动（bors 形态），因为工作区的数量与创建时刻都由人决定，分配固定时刻会引入「新建工作区恰好撞上已有的」这类新问题。
- 下限：`intervalSeconds` 不接受低于 300 的值。**【判断】** 300 来自 `packages/schedule/schedule/src/domain.ts` 的 `MIN_EVERY_INTERVAL_SECONDS = 300`，复用仓库里已经定过的固定速率下限，而不是新造一个数字。
- 相位不持久化。**【证据强制：§14.1】** VS Code 的 `_enabled` 是内存字段，启动时由配置重新推导，唯一被持久化的运行时状态是 `autofetch.didInformUser`——「跨重启存活的只是开关配置，不是调度相位」。本设计的相位由 `state.lastRunAt` 在启动时重算。
- 工作区的启用与停用：插件启动时遍历 `ctx.workspaceRegistry.list()` 逐个装载；运行期新增或删除工作区靠 `ctx.on('domain/changed', ...)` 过滤 `domain === 'workspace'` 来装载或卸载（`packages/api/workspace-controller/src/feed.ts` 已经用这条事件重建它的基线，是既有扩展点）。`WorkspaceRegistry` 自身只提供 `get(id)` / `list()` / `create()` / `resolveByPath()`，不发变更事件。
- 工作区记录被删除后，`state` 里对应的键成为孤儿。**【判断】** 每轮装载时按 `ctx.workspaceRegistry.list()` 的 id 集合裁剪孤儿记录，裁剪是有界的（只删不在注册表里的键）。

### 3.4 陈旧判据

判据是「落后 ≥ `behindThreshold` 个提交」，默认 1。**【证据强制】** Renovate 的 `behind-base-branch` 就是「落后 1 个或更多提交」（§5，【实抓】）；Kodiak 完全委托平台二值状态、Mergify 让用户写整数（§7.2，【事实】），说明阈值应当可配而不是内置。**【判断】** 默认取 1：取 1 与 Renovate 的默认判据一致；取更大值会让「落后一点」长期不被处理，而定时运行本身不产生写操作，所以取 1 不会带来额外的写入风险。

判据的输入来自 `ctx.git.observe` 的 `GitHeadState.behind`，但**必须在 fetch 之后取**：`behind` 是相对本地 remote-tracking 引用的，fetch 之前它反映的是上一次 fetch 的状态。

**「落后」与「分歧」必须分开。**【证据强制：§29.2 规则 4 的配套细节】** bors-ng 把 `pr.head_sha != patch.commit`（分支被人动过）判成 `:race` 而不是 `:conflict`，Mergify 区分「与队内前序 PR 冲突」与「与 base 冲突」（§3.1、§7.3）。本设计用 `GitHeadState` 的 `ahead` / `behind` 两个数把三种情况分开：

| ahead | behind | 结论 | 动作 |
| --- | --- | --- | --- |
| 0 | 0 | `up-to-date` | 无 |
| 0 | ≥ 阈值 | 纯落后 | 可快进 |
| > 0 | ≥ 阈值 | 分歧 | 只能 merge-forward，不能快进 |
| > 0 | 0 | 本地领先 | 无 |

### 3.5 并发写者：检出即拒绝

这是负责人已经作出的保留决定，本文记录并落实，不重新讨论。调研稿 §22 的警示框给出事实：**在 colocated 工作区（`.git` 与 `.jj` 并存）下，jj 的每条命令都会自动 import/export，并通过 `try_reset_git_head` → `jj_lib::git::reset_head` 把本地 Git HEAD 置为 detached 状态**（【子代理实抓】，附 `docs/git-compatibility.md` 与 `cli/src/cli_util.rs` 行号）；并且调研稿自己写明「这类『两个写者都认为自己在管 git』的场景，本文调研的产品里没有一个处理过」。

**本设计的立场：检出并拒绝，绝不与另一个写者争 `.git`。** 三层落实，每一层都在做出决定的那次操作里强制：

1. **前置拒绝（在运行开始前）**：工作区根下存在 `.jj` 目录 → 本次运行以 `refused-colocated-vcs` 结束，不执行任何 git 写命令。**【判断】** 这条做成固定拒绝、不做成 Config 开关：一旦可配就等于承认「与另一个 `.git` 写者共存」是支持的部署形态，而调研稿明确说没有任何产品处理过这件事，本设计不声称能处理。代价是 jj colocated 工作区完全用不了本特性，这是这条决定接受的成本。
2. **HEAD 附着检查**：`ctx.git.observe` 返回的 `GitHeadState.branch` 缺失即 HEAD detached → `refused-detached-head`，不提交、不对齐。这条同时覆盖「另一个工具把 HEAD 置成 detached 但我们没检出 `.jj`」的情形。
3. **预期 HEAD 比对 + 每工作区锁**：运行开始时记下 `expectedHeadOid`；在执行任何写命令之前与之后各读一次 HEAD，任一次与预期不符 → 本次运行以 `superseded` 结束，**中止且不重试**。锁方面：进程内用按 `WorkspaceId` 键的互斥（同一工作区同一时刻只有一个运行）；跨进程用 `state.runLeaseOwner` / `state.runLeaseUntil` 做租约（**【判断】** 租约时长取 `runTimeoutMs` 加宽限，参考 §30.3 第 1 条 GitLab 的 `STUCK_AFTER = LEASE_TIMEOUT + 5.minutes` 的宽限做法）。

**这条决定接受的三项残余风险，明写在此：**

- **外部写者在我们「观察之后、写之前」移动 `.git`，本次运行白跑。** 我们检出并中止，但不阻止它发生。这是「拒绝而非竞争」的必然代价。
- **外部写者把 HEAD 移到同一个 oid（例如 detached 到同一个提交），我们的比对看不出差别，会继续执行。** 【判断】可观测的比对量只有 revision 身份，而 `.git` 的内部状态（index、`ORIG_HEAD`、`logs/HEAD`）不构成可稳定比较的量；本设计选择只比对 revision 身份，接受这个盲区。
- **跨进程互斥依赖存储后端。** `packages/storage/storage/src/backend.ts` 的契约逐字写着「The unit does NOT serialize concurrent writes — write ordering is the caller's responsibility (the domain layer runs one write chain per unit)」，即单进程内串行、跨进程不保证。因此两个 DSH 进程共享同一个存储文件时，租约只能做到尽力而为。**【判断】** 本设计按单进程部署假设设计，并把这条列为开放问题（见九）。

---

## 四、作业 (a)：定时 git 对齐

### 4.1 对齐对象：仓库内的一切是一件事

负责人的第 2 条原话把「git 本体」与「其内的文档、PR、提交、代码」并列。本文明确一个事实：**在一个仓库内，文档、提交、代码都是路径与对象，对齐它们就是一次 git 操作。** 没有独立的「对齐文档」作业。**【证据强制：§15】** 调研稿 §15 的结论很集中：真实 setup 里的「文档对齐」几乎都不是 git 合并，而是「重新生成 + 比对」，冲突被转化成构建失败（`kubernetes/kubernetes` 的 `hack/verify-generated-docs.sh`、Terraform provider 的 `make generate` + `git diff --exit-code`、`rust-lang/rust` tidy 的集合比对，均【子代理实抓】）。§15.1 另有一条对无人值守最有用的做法：`kube::verify::generated` 用 `git worktree add -f -q "$_tmpdir" HEAD` 在临时工作树里跑生成，因此中断也不会把开发者的工作副本留在半途。

因此：文档与代码的对齐由 4.2 的同一个操作完成；**生成物漂移检查不在本模块内**（本模块不知道仓库的生成器是什么），列为「明确不自动化」并作为开放问题。

「PR」不在这里，见 4.5。

### 4.2 操作序列

每个运行按下面的顺序执行，每一步都有明确的拒绝路径与结果分类。全部 git 命令经 `ctx.gitAlign` 的 provider 执行，读快照经 `ctx.git.observe`。

**步骤 0：装载与前置。**

1. `ctx.workspaceRegistry.get(id)` 取 `Workspace`，`path` 缺失（目录已消失，`Workspace.path` 的契约是「即使目录消失也不改写」）→ `no-op` 理由 `workspace-path-missing`。
2. 工作区根下存在 `.jj` → `refused-colocated-vcs`（3.5 第 1 层）。
3. 取运行锁；拿不到 → `skipped-locked`（不是失败，见 7.1）。
4. `ctx.git.observe(path)`：`absent` → `no-op` 理由 `no-repository`。**【证据强制】** 接缝契约逐字写着「resolves `absent` for a directory outside any git work tree; that is an answer, not a failure」。
5. `head.branch` 缺失 → `refused-detached-head`（3.5 第 2 层）。`head.upstream` 缺失 → `no-op` 理由 `no-upstream`。
6. 记下 `expectedHeadOid = head.oid`、`expectedBranch`、`expectedUpstreamRef`。

**步骤 1：fetch（唯一一次网络操作）。**

- `git fetch --no-tags <remote> <refspec>`，经 `runNativeCommand`，AbortSignal 由 `runTimeoutMs` 驱动。**【判断】** 不带 `--prune`：剪除远端跟踪引用是写操作，而它对本特性的收益为零，默认不做。
- 失败（网络、凭据、超时）→ `failed-fetch`，记入台账并退避。**与 `no-op` 严格区分**（见 7.1）。
- `runNativeCommand` 本身**没有超时也没有 `maxBuffer`**（实查 `packages/util/native-command/src/runner.ts`：`execFile(command, args, { encoding: 'utf8', signal, windowsHide: true }, ...)`），所以超时必须由 provider 用 `ctx.timeout` + `AbortController` 组合，输出必须由命令形态本身限界（只取 `--numstat` / `--name-only` / `-z` 这类紧凑形式，不取完整 patch 文本；Node 的 `execFile` 默认 `maxBuffer` 是 1 MiB，大 diff 会在这里失败）。

**步骤 2：重新观察并判定陈旧度。**

- 再调一次 `ctx.git.observe(path)`（fetch 之后），用 `head.behind` / `head.ahead` 按 3.4 的表判定。
- `behind < behindThreshold` → `no-op` 理由 `up-to-date`；**推进基线**（3.2）。
- `downstreamVerification === 'external'` 且为纯落后 → `no-op` 理由 `deferred-to-downstream-verification`。**【判断】** 这里对 §28.3 的映射是：Renovate 的 `conflicted` 档是「只在分支真冲突时才 rebase」，而本设计**没有任何解冲突能力**（4.3），所以外部已有验证者时，唯一剩下的动作（对齐一条无冲突的分支）恰好是下游验证者已经覆盖的动作，于是退化成只观察。这比 Renovate 的档位更保守，是有意的。

**步骤 3：脏树判定。**

- 用步骤 2 快照的 `worktree` 与 `worktreeTruncated` 判脏（`worktree` 非空即脏；`worktreeTruncated` 为真只影响报告里的条数，不影响「脏」这个结论）。
- 脏且 `dirtyPolicy === 'refuse'` → `refused-dirty`，报告脏路径条数与有界列表。**【证据强制】** §26.4 第 7 条：etckeeper 的 `pre-install` 在安装前检查 `/etc` 有没有未提交改动，有就取消安装让人手工提交——「把工作区干净作为执行前置条件，而不是先合并再说」。
- 脏且 `dirtyPolicy === 'commit-attributable'` → 先跑作业 (b) 的提交流程（第五节），再回到这里重新判定；仍脏 → `refused-dirty`。**【判断】** 默认是 `refuse`：一个脏工作区里可能有**没有任何工作单元记录能归属**的人手改动，而作业 (a) 的合并会作用于整棵工作树、无法像作业 (b) 那样按路径限界（见 5.3），所以它的前置条件必须比作业 (b) 更严。

**步骤 4：试合并探测（不碰工作副本）。**

- 首选 `git merge-tree --write-tree --name-only <upstream> <HEAD>`（在对象库里构造合并结果，不检出、不动工作副本、不动引用；它会往对象库写入未引用的对象，这些对象不影响 HEAD 身份比对）。冲突时该命令以非零退出并把冲突路径列在 stdout，探测结果直接取那份列表，不需要再读工作副本。**【判断】** provider 通过一次能力探测决定用哪条路径（运行该命令并归类它的失败），**不按 git 版本号假设**：版本号到能力的映射需要另一份外部事实，而这里可以就地判定。
- 能力探测失败时退回隔离工作树：`git worktree add --detach <worktreeRoot>/<workspaceId> HEAD`，在其中 `git merge --no-commit --no-ff <upstream>`，冲突路径取 `git diff --name-only --diff-filter=U`，随后 `git worktree remove --force` 与 `git worktree prune`。`worktreeRoot` 是必填 Config（`mode === 'align'` 时在装载期校验，缺失即响亮失败），且**不放在工作区目录内**——放进去会以未跟踪文件的形式污染工作区，也会被 `dirtyPolicy` 自己判成脏。**【判断】** 放在工作区外而非系统临时目录：系统临时目录可能在另一个文件系统上，而 `git worktree` 与主仓库共享对象库时跨文件系统会带来额外约束。
- 探测结果冲突 → `conflicted`，报告冲突路径（有界，超出部分只报条数），**工作副本零改动**。**【证据强制】** §7.3：Zuul 在冲突时不跑任何 job，因为合并结果根本构造不出来——「验证这一步在冲突面前是无需尝试的」；§29.2 规则 2：预检 + 拒绝优于执行 + 回滚，Gerrit 在冲突时直接禁用 Submit 按钮、GitHub 的 Update branch 只在无冲突时可用、Kodiak 完全委托平台判定。§15.1 的 `git worktree` 隔离是同一族做法。
- 探测干净 → 进入步骤 5。

**步骤 5：写（仅当 `mode === 'align'`）。**

- 纯落后（ahead == 0）且 `alignStrategy === 'ff-only'` → `git merge --ff-only <upstream>`。
- 分歧（ahead > 0）且 `alignStrategy === 'merge'` → `git merge --no-ff <upstream>`。**【证据强制】** 仓库已有一份落地的取舍记录在 `.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md`（§31.3 引用）：merge-forward 仍然可用，并且它能保留已完成的冲突解决 checkpoint，代价是额外的 merge commit。本设计复用这个已落地的取舍，不重新发明。
- **rebase 不是 `alignStrategy` 的取值，即它在配置层面不可表达。** 理由见 4.4。
- 绝不传 `-X ours` / `-X theirs` / `--strategy` 覆盖：**【证据强制：§29.1】** 调研覆盖的全部产品里没有任何一家自动解冲突（Kodiak 摘 label、Zuul 出队且不跑 job、Mergify 区分两类冲突但都交给人、GitHub Update branch 冲突态不可用、Gerrit 禁用 Submit、gh-stack 建议用交互式 `gh stack rebase`）。
- 合并失败（含探测之后 `.git` 被改动导致的失败）→ 执行 `git merge --abort` 回滚**我们自己发起的那次合并**，然后 `failed-merge`。**【判断】** `--abort` 只回滚本次合并尝试，不丢弃任何用户内容，且它是「绝不留下半途合并态」的唯一手段；它不在禁止清单里（禁止的是 `reset --hard`、`clean -fd`、force-push、改写历史）。若 `--abort` 本身失败，结果升级为 `failed-merge-dirty`，**停止该工作区的后续运行并报告**，不再尝试任何写操作。
- 写之后重读 HEAD：既不是 ff 到 `<upstream>` oid、也不是一个以 `<upstream>` 为第二父的新 merge commit → `superseded`，中止不重试（3.5 第 3 层）。

**步骤 6：记台账。**

- 推进基线（`baselineUpstreamOid` = 对齐到的 upstream oid，`baselineLocalOid` = 新的 HEAD oid）。
- 写 `lastRunAt` / `lastOutcome`；`no-op` 与成功写都把 `consecutiveFailures` 归零；失败按 7.2 递增。
- 追加一条有界的 `RunRecord`。

### 4.3 冲突

冲突映射到一个**终止状态**，不是「下次再试」。**【证据强制：§29.2 规则 1】** bors-ng 的 issue #61 标题「Merge conflicts do not mark the batch as "canceled"」正文全文只有一句（逐字）："This puts bors in an infinite loop. Fix it!"；`lib/database/batch_state.ex` 因此把 `:conflict` 显式折叠成 `:error` 而不是 `:canceled` 或独立态。调研稿称之为「本调研里最有价值的失败教训」：一个周期性对齐器如果对冲突没有终止语义，它每周期都会重试、每周期都失败。

具体落实：

- `conflicted` 是终态；它设置 `nextEarliestRunAt = now + conflictCooldownSeconds`（Config），冷却期内定时器到期也不重新探测冲突。**【判断】** 冷却的时长与是否冷却都没有直接证据（调研稿只说「必须定义冲突之后下一周期做什么」），本设计选择「冷却 + 报告冲突路径 + 等人处理」。
- 冲突路径的**发现**来自步骤 4 的探测本身（`merge-tree` 的 stdout，或隔离工作树里的 `git diff --name-only --diff-filter=U`），不来自工作副本的冲突态，因为本设计不产生工作副本的冲突态；报告不依赖 `git rerere remaining`（本设计不启用 `rerere`，见 1.2）。报告的形态照 §2 的 GitLab 范本：**机器可读的原因 + 人可读的说明 + 明确的下一步**，冲突文件最多列 10 个并给出剩余数量（GitLab 的系统备注就是这么做的，§2，【子代理实抓】）。
- 冲突**短路掉后续的提交与验证**，不浪费一轮预算去尝试。**【证据强制：§7.3】** Zuul 冲突时不跑任何 job。

### 4.4 「rebase 后要不要重验」的显式回答

**回答：本设计不实现 rebase，因此这个问题在本设计里没有触发点；一旦将来加入任何改写本地历史的对齐方式，它必须同时带来一次重验，而 DSH 当前没有任何重验机制，所以现在就不加入。**【证据强制 + 判断】

- 【证据强制】§28.3：GitLab 官方对 automatic rebase before merge 明确写「Does not re-run CI/CD pipelines on the rebased result.」，并因此推荐改用 merge trains；§2 一般化为「凡是基于某个合成结果跑出来的验证，一旦合成输入变了，该验证就必须作废而不能重试」（逐字："the merged result is out of date and the pipeline can't be retried."）；§3.2 的 homu 用 `merge_sha` 而不是时间戳作为陈旧结果失效键。§28.3 的结论是「rebase 完要不要重验」必须显式回答，不能默认。
- 【判断】DSH 里没有 CI、没有测试门、也没有「合成结果」这一层，所以「重验」在这里无处落地。因此选择：不实现 rebase。这不是「把 rebase 的默认值设为 off」，而是**让它不可表达**——`alignStrategy` 的取值里没有 `'rebase'`。仓库约定要求「在做出决定的那次操作里强制」，让一个被拒绝的取值在配置层面无法出现，比写一个默认值是更硬的强制。

### 4.5 PR 那一半：本仓库没有 forge 能力

**结论：PR 对齐不在本设计的范围内，明确不做。** 实查：全树没有任何 GitHub/GitLab 写能力包；`packages/webhook/webhook-github` 的 `package.json` 只依赖 `@octokit/webhooks`，用途是入站投递的签名校验（`packages/webhook/webhook/src/index.ts` 的 `webhookRuntime.register(rule)` / `dispatch(delivery)`），它无法列 PR、读 PR 状态、改 PR base、触发更新分支或入队合并。

因此本文不为一个不存在的能力做设计。**但两条事实必须写清楚：**

- **入站事件路径存在，且与定时路径互补。**【证据强制：§31.3】DSH 已有 `ctx.webhookRuntime`（fire-and-forget、返回 202 不等结果），与 §30.3 第 1 条 GitLab 的「主线事件驱动 + cron 兜底」同构。所以本特性不必只做定时器：如果将来接入 forge 能力，入站事件可以成为主路径，定时运行退化为兜底。
- **「自动改 PR」的风险等级远高于本地合并。** 它是对外可见的写操作，需要凭据（走既有 `packages/credentials`），并且会触发 §1.2 那条被低估的代价：GitHub 官方逐字写着点一次 Update branch 会作废既有审批（"the approving review is dismissed as stale"，§1.2，【实抓】）。一个无人看管的定时对齐如果自动更新 PR 分支，就会持续销毁人工审批。这条在将来接入 forge 时必须正面回答。

---

## 五、作业 (b)：自动总结 + 自动提交（push 由人决定）

### 5.1 粒度：「每个工作内部」读作每个工作单元

**【判断，但边界由证据支持】** 本文设计到「**每个工作单元 = 一个 turn**」。理由：`packages/core/session/src/types.ts` 里 `'turn/start'` / `'turn/end'` 是已有的边界事件，`turn/end` 带 `TurnEndReason`，是一个真正的**结算点**；更重要的是，只有按 turn 才能拿到一个**精确可归属的路径集**——`tool/call` 事件带 `turn`，`turn/end` 之后该 turn 的调用集就封闭了。`packages/session/session-turn-outline` 也用 `turn/start` 作为锚点（§31.3 把它列为「工作单元最自然的既有边界」，但那行是【推断】并注明「是否采用需要另外论证」——本文的论证就是上面这条可归属路径集）。**注意：`session-turn-outline` 是轮次导航数据（seq + 有界预览），不是工作总结，不作为摘要使用**（`00-request-and-facts.md` §8.1 已核实）。

另外两种读法只改触发条件，其余设计不变：

- **读作「每个工作区」**：触发条件改为「定时运行发现自上次提交以来积累了可归属路径」，触发面从 turn 边界换成定时器。其余（暂存集定义、密钥筛查、消息生成、撤销、绝不 push）逐条不变。
- **读作「每个会话」**：触发条件改为会话进入 idle 或关闭（`ctx.sessions` 的 idle 边界），其余不变。

### 5.2 两个触发面：turn 边界为主，定时器为安全网

负责人的第 3 条把作业 (b) 归在「定时器模块」下。本文按证据修正触发面，并说明模块仍然拥有这个作业：

- **主路径是事件驱动：`turn/end`。** 【证据强制：§28.7】调研覆盖的产品里，「自动」的含义一律是挂在某个动作上（§28.1）；gh-stack / git-town / jj / Sapling 的「自动」都是「人做一次，工具替他把后续一串做完」（§28.7），而 §28.7 明确说这不是定时器的对立面而是它的必要组成部分：「定时器负责没人时也别落后，而人一旦在场，对齐应当是一次操作把整条链处理干净」。一个 turn 结束正是「一段工作做完了」这个动作。
- **安全网是定时器：** 补上主路径没跑成的情形（进程崩溃、会话在 turn 结束时没有 live root agent、当时被禁用）。这正是 §30.3 第 1 条的形状：GitLab 的主线是事件驱动，cron 只负责把卡死超过租约期的记录捞回来重试；也是 §17.2 那条立项理由的正面应用——纯事件驱动会漏掉「安静的」目标。
- **安全网的具体做法**：定时运行在作业 (a) 之前先扫一遍「未提交的工作单元」。输入是 `state.commitWatermarks`（每会话最后已提交的 turn 号）与 `Workspace.sessionIds`（工作区记录已有的会话归属账），逐个会话读日志里 `turn/end` 序号大于水位的 turn，按 5.3 推导暂存集。
- **安全网必须处理归属歧义。**【判断】如果同一个路径出现在**多个**未提交 turn 的暂存集里，说明这些 turn 之后工作副本又变了，此时无法把「哪个版本属于哪个 turn」分清楚。规则：按 turn 号从旧到新处理，遇到出现在多个未提交 turn 里的路径 → 该路径本次**拒绝提交**并报告（结果分类 `ambiguous-attribution`），只提交无歧义的路径。宁可少提交也不把两个工作单元的内容混进一条提交。

### 5.3 提交范围（核心安全属性）

**【证据强制】** §31.2 第 2、3 条与 §18：这是本作业的核心安全属性，不是体验细节。

规则，逐条落到命令上：

1. **绝不 `git add -A`、绝不 `git add .`、绝不 `git commit -a`。** 不用「先暂存再提交」两步，而是直接用 `git commit -m <msg> -- <paths>`。理由：`git commit -- <paths>` 默认等于 `--only`，取这些路径的**工作树内容**、无视其他路径已暂存的内容（`git-commit.adoc` 逐字 "disregarding any contents that have been staged for other paths"，附录复核过）。这带来两个好处：不需要改 index 就能构造 diff 事实（用 `git diff HEAD --numstat -- <paths>`），而且**任何拒绝路径都不留下 index 改动**。
2. **暂存集的定义**见 2.4。四道过滤（工具归属、工作区包含、mtime 验证、忽略文件）缺一不可。
3. **不采用 `git add --update` 作为发现机制。**【判断，对 §25.4 的精确化】§25.4 记下 `aicommits` 用 `git add --update` 并称其「默认安全」。这条对**只生成消息、不提交**的工具成立（`--update` 不会把未跟踪的新文件带进来），但对**自动提交器不成立**：`--update` 会暂存**全部已跟踪文件的修改与删除**，其中就包括用户自己的半成品改动——这正是 §31.2 第 2 条点名要避免的失败形态。所以本设计只把它当作一条已知的反面参考，不采用。
4. **读忽略文件。**【证据强制：§31.2 第 3 条】etckeeper 的 "interesting" 定义就是「`.gitignore` 没忽略的文件」（§24.1），jj 逐字 "Files with paths matching ignore files are never tracked automatically"（§22，【实抓】）；反面证据是 VS Code Local History 的源码里 `gitignore` 零命中，因此 `.env`、凭据文件只要被保存过就会被完整抄进它自己的存储（§23.1，【推断】由源码直接推出）。本设计用 `git check-ignore --stdin` 让 **git 自己**判定忽略，而不是重新实现一套匹配规则。
5. **`.jj` 与 detached HEAD 的拒绝同样适用于提交**（3.5）：detached HEAD 上提交会让提交不属于任何分支，且正是 jj colocated 场景的产物。
6. **路径数上限**：`maxPathsPerCommit`（Config）。超出即拒绝本次提交并报告，不截断——截断会提交一个语义不完整的变更集。**【判断】**
7. **空暂存集 = `no-op`，不是失败。**【证据强制：§12.1 的硬要求框】Copybara 的 `EmptyChangeException` 只 warn 并继续（§12.1，【子代理实抓】）；issue #236 的用户原话逐字 "'440d40ec...' has been already migrated. Use --force..."，随后 "this returns an non-zero exit code, causing CI pipelines to be unhappy"；调研稿据此立了一条硬要求：「这一轮没有需要对齐的东西」必须与「这一轮失败了」用不同的退出码/状态区分。etckeeper 也是先跑 `etckeeper unclean` 判脏再提交（§24.1）。

### 5.4 密钥筛查

**【证据强制：§26.1 的推导 + §26.4 第 5 条 + `00-request-and-facts.md` §8.3 第 2 条】** 筛查发生在**本模块自己的提交流程里**，不依赖 git hook；命中即拒绝提交并**只报路径、不回显内容**。

- 为什么不在 git hook 里：commit 期不存在一个「既扛得住 `--no-verify`、又能看到文件内容」的位置（`pre-commit` 与 `commit-msg` 可被 `--no-verify` 绕过，`prepare-commit-msg` 看不到内容且官方自己说不能替代 `pre-commit`）。
- 为什么可靠的闸门在 push：§26.4 第 5 条。而本模块**不提供任何 push 路径**（5.8），所以它在这一层的职责是「命中就拒绝、并且让拒绝可见」，不是「保证仓库里没有密钥」。
- **筛查面**：暂存集里每个路径的**当前完整内容**，逐路径经 `ctx.fs.readBytes` 读取并按 `maxScanBytes` 限界。**【判断】** 选完整内容而不是 diff hunk：完整内容是 diff 的超集，误报的代价只是一次人可以解除的拒绝，而漏报的代价是把密钥固化进历史（`00-request-and-facts.md` §8.3 明确「一次自动提交会把它们固化，而 push 是人来决定的——人可能不看内容就推」）。对照方案是 §26.2 记下的 `detect-secrets` 的「增量 diff + baseline」形态，它更贴合「每个工作单元只提交增量」，但它的已知边界是「无法发现 baseline 生成之前就已存在的 secret」，本文不采用。
- **豁免**：本设计**不提供**任何「忽略密钥命中」的开关。**【判断】** 豁免机制是安全边界：§26.4 第 3 条列出 gitleaks 的 baseline / `.gitleaksignore`、trufflehog 的行内注释、detect-secrets 的 baseline、pre-commit 的 `SKIP=`——「每一个都是『永久放行』的入口」，而「一个生成不当的 baseline 等于把 secret 永久放行」。命中就拒绝、报路径、由人处理。
- **`secretPatterns` 是 Config 字段。** 依据仓库约定「deployment-varying choices are validated `Config` fields」：部署方可能要加自己的凭据格式。**「命中即拒绝」本身是安全不变量，不可配。**
- **诚实边界**：模式匹配不能证明「没有密钥」。调研稿 §26.4 第 1 条明确「『装了扫描器』≠『拦得住』」——四个工具里只有 gitleaks 默认阻断，trufflehog 默认永不阻断，detect-secrets 的退出码连官方文档都没有。并且调研稿在引用节里自陈了一条方法学限制：「未安装、未运行任何扫描工具，所有退出码结论都是静态阅读（源码级或文档级）的产物，没有一条是实测退出码。若正式设计要依赖这些退出码，应当补一次实测。」**因此本设计不依赖任何外部扫描器的退出码**，筛查在模块内实现；如果将来改用外部扫描器，必须先实测它的退出码语义。

### 5.5 提交信息从 diff 来

- **接缝**：`ctx.workSummary`（`packages/session/work-summary`），provider 契约 `WorkSummaryProvider { generate(request): Promise<WorkSummaryProviderResult> }`，形状照 `packages/session/session-title` 的 `SessionTitleProvider { generate(request) }`（§31.3 的 DSH 落点表把 session-title 列为可直接复用的机制：异步模型生成且不阻塞主响应、被接受的版本是 log-only 事件、更新的版本取代旧的）。**【判断】** 生成在旁路进行、不阻塞 turn 的结束，与 §31.3 那条一致。
- **请求的输入面写清楚**：`{ workspaceId, sessionId, turn, endReason, paths, numstat（每路径的增删行数）, stat, signal }`。**【证据强制：§25.5 第 3 条】** 「输入面要写清楚：diff？暂存区？对话历史？三者的安全属性不同」，而「以暂存区为输入（Copilot、aicommits）是最安全的，因为暂存动作本身是可控的」。本设计不用暂存区（5.3 第 1 条不用两步提交），等价的安全属性来自**路径集本身已经是可控的**：它由 5.3 的四道过滤得出，diff 事实由 `git diff HEAD --numstat -- <paths>` 在同一个路径集上读取，两者同源。
- **消息形态**：单行 subject + 机械 body。subject 形如 `<type>(<scope>): <provider 摘要>`；body 是逐文件的增删行数。**【证据强制：§25.1】** Conventional Commits 1.0.0 规范逐字规定 "Commits **MUST** be prefixed with a type"，但 "Additional types are not mandated by the Conventional Commits specification"，所以**类型词表必须由本设计决定**（`commit.types`，Config，默认 `feat` / `fix` / `docs` / `refactor` / `test` / `chore`）。
- **`!` 与 `BREAKING CHANGE` 不产生。**【证据强制：§25.1、§31.2 第 6 条】规范里只有 `fix`→PATCH、`feat`→MINOR、BREAKING→MAJOR 有真实语义，而「一个自动生成的 `!` 会触发下游的 MAJOR 版本语义——这个产生权必须显式决定」。**【判断】** 本设计的决定是：**不产生**。provider 的产出若含 `!` 或 `BREAKING CHANGE` trailer，服务判定该提案不合法，退回机械摘要并在台账里记 `message-proposal-rejected`。`commit.allowBreaking` 默认 `false`；即便置为 `true`，服务也不自行推断 breaking，它只是允许 provider 的显式声明通过。**这是本设计里唯一一处允许把下游语义交给模型的开关，默认关闭。**
- **生成失败 → 机械摘要，绝不编，也不用占位消息。**【证据强制：§25.5 第 2 条、§31.2 第 5 条】Aider 的选择是用占位消息 `(no commit message provided)` **仍然提交**，调研稿的评价是「这会让一次消息生成失败静默地留下一条垃圾历史」。机械摘要 = `commit.fallbackType`（默认 `chore`）+ 共同路径前缀作为 scope + 文件数与增删行数，全部事实来自 `--numstat`，不声称没发生的事（`00-request-and-facts.md` §8.3 第 3 条）。
- **summary 事件不新增 `SessionEventMap` 成员。**【判断】v1 把摘要写进 `workspaceAutomation` 台账（按 workspace 键），不写进会话日志。理由：会话日志的成员是「required-on-read by default」，新增成员会牵动已发布会话格式的读取规则；而摘要在本设计里**不进入模型请求**（7.5），所以不需要会话事件。替代方案（照 `session/title` 做成 log-only 会话事件）保留为开放问题。

### 5.6 安全信封落到操作上

| 信封规则 | 落在哪次操作 | 拒绝结果 | 可观测 |
| --- | --- | --- | --- |
| 绝不静默解冲突 | 作业 (a) 步骤 4/5；作业 (b) 从不进入合并 | `conflicted` / `failed-merge`（`--abort` 后） | 冲突路径（有界）+ 剩余条数 + 下一步 |
| 脏树拒绝 | 作业 (a) 步骤 3 | `refused-dirty` | 脏路径条数 + 有界列表 |
| 只提交可归属路径 | 作业 (b) 5.3 的四道过滤 | 被过滤的路径逐条带原因 | 每条路径的过滤原因 |
| 不做破坏性操作 | 全部写操作：无 `reset --hard`、无 `clean -fd`、无 force-push、无 `--amend`、无历史改写 | 不可表达（不在代码路径里） | 代码路径不存在，测试覆盖「未出现」 |
| 超时有界 | provider 的每次 `runNativeCommand` | `failed-timeout` | 超时值与已执行到的步骤 |
| 每工作区互斥 | 步骤 0 的锁 + 租约 | `skipped-locked` | 持有者与租约到期时刻 |
| 退避 | 7.2 | 不重试，`nextEarliestRunAt` 推后 | 退避曲线与下次可跑时刻 |
| 可观测 | 每次运行都写 `RunRecord` | — | 见 7.4 |
| 默认观察并报告 | `mode` 默认 `'observe'`；`commit.enabled` 默认 `false` | 写操作不可达 | 两个开关各自的状态 |
| 提交前密钥筛查 | 作业 (b) 5.4 | `refused-secrets` | **只报路径，不回显内容** |
| 消息从 diff 来 | 作业 (b) 5.5 | 提案不合法 → 机械摘要 | 摘要来源（provider / fallback） |
| 绝不 amend / 改写已推送历史 | 提交操作不实现 `--amend` | 不可表达 | 测试覆盖「未出现」 |
| 报告撤销方式 | 作业 (b) 5.7 | — | 见 5.7 |

### 5.7 撤销

提交是本地对象，人未 push 前可以撤回，所以报告里必须给出撤回方式（`00-request-and-facts.md` §8.3 第 6 条）。

- **先判定是否还可撤回**：检查刚创建的提交是否被任何 `refs/remotes/*` 包含（`git merge-base --is-ancestor <commit> <ref>` 逐个远端引用）。包含即已被推出去 → 报告「不再可撤回」。**【证据强制：§18/§31.2 第 1 条】** Aider 的 `/undo` 在提交推出 origin 之后永久拒绝，逐字 "The last commit has already been pushed to the origin. Undoing is not possible."；§27.3 第 2 条的结论是「`不 push` 不是一个保守的默认值，它是『可回滚』这个能力的必要条件」。
- **报告的内容**：新建提交的 oid、它的父提交 oid、涉及路径、以及**两条**可执行的命令——`git reset --soft <parent>`（保留改动在 index）与 `git reset --mixed <parent>`（保留改动在工作树、不留在 index），并说明两者区别。**【证据强制：附录复核记录】** Aider 的 `/undo` 真实动作是逐文件 `git checkout HEAD~1 <file>` 加 `git reset("--soft", "HEAD~1")`，**不是 `reset --hard`**；`reset --hard` 只是它给用户看的建议文案。所以本设计**不推荐** `reset --hard`。
- **本模块不自动执行撤销。**【判断】负责人只要求「自动总结 + 自动提交」，撤销是人的动作；模块的职责是把撤回方式和撤回边界摆出来（`00-request-and-facts.md` §8.3 第 6 条只要求「给出撤回方式」）。

### 5.8 「绝不 push」怎么被强制

**【证据强制：§27.3 第 1 条、§31.2 第 9 条】** 调研稿把这条列为第二部分最重要的安全结论：**「不自动 push」不能靠「不实现 push 功能」来实现**，因为任何给 agent 提供 shell 的工具，只要 agent 有 shell 就能 push（Cline 官方文档把 "Commit and push changes to version control" 直接列为 YOLO 模式的风险项，§20.3）。所以强制分三层：

1. **本模块的代码路径里不存在 push。** `ctx.gitAlign` 的操作集合里没有 push，`LocalGitAligner` 不构造任何 `git push` 参数。测试覆盖「未出现」——这一层与 Aider 相同（它的 `args.py` 与官方选项页里 `push` 零匹配，§18，【实抓】）。
2. **部署侧可用的原生硬闸门：`push.default=nothing`。**【证据强制：§27.1】`Documentation/config/push.adoc` 逐字："`nothing`;; do not push anything (error out) unless a refspec is given. This is primarily meant for people who want to avoid mistakes by always being explicit."；§27.1 的结论是它「比在应用层写 `if (approved)` 更硬，因为它对任何调用方（脚本、agent、逃逸舱命令）一视同仁」。本设计**建议**但不强制设置它（改部署的 git 配置超出本模块的职责），在 README 里作为部署建议写明。
3. **把「未确认的提交」表达成可继承的谓词，而不是一次布尔判断。**【证据强制：§27.3 第 4 条】jj 的 `git.private-commits` 是一个 revset，匹配它的提交被拒绝推送，**并且连带阻止其所有后代被推送**；调研稿称之为「本文见到的唯一一个把『push 由人决定』做成可组合、可继承策略的机制」。本设计采纳这条思路的**形态**：给本模块创建的每个提交打一个 trailer（例如 `Dsh-Unit: <sessionId>/<turn>`），于是「本模块产出的提交」成为一条可计算的谓词，部署侧可以用它写 `pre-push` 检查或 `git.private-commits` 风格的规则。**注意这不是在 DSH 里实现 push 拦截**——DSH 没有 push 路径可拦；它是让部署侧能用 git 自己的机制表达这条边界。**【判断】** trailer 的具体名字与是否需要它是本文的判断，调研稿只给了形态上的先例。

---

## 六、配置

### 6.1 Config 字段

按仓库约定「No hardcoded tunables in plugins：deployment-varying choices are validated `Config` fields changeable from cordis.yml」，全部可变量都在 `Config` 里，装载期校验、误配响亮失败。

| 字段 | 类型 | 默认 | 依据 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 【证据强制：§28.4】默认关闭是同类产品的普遍姿态（VS Code `git.autofetch` `false`、obsidian-git interval `0`） |
| `intervalSeconds` | number（≥300） | `3600` | 【判断】默认值无一手证据强制（同类产品要么默认关、要么只做只读 fetch）；取下限之上的保守值，下限 300 复用 `schedule` 的 `MIN_EVERY_INTERVAL_SECONDS` |
| `jitterRatio` | number（0–1） | `0.5` | 【证据强制：§28.5】bors-ng 用 `rand.uniform(2) * 0.5`（0–1 倍随机） |
| `mode` | `'observe' \| 'align'` | `'observe'` | 【证据强制】§28.4 与 `00-request-and-facts.md` §五.2：「默认是观察并报告而不是自动改，写操作需要显式启用」 |
| `alignStrategy` | `'ff-only' \| 'merge'` | `'ff-only'` | 【判断】快进不产生新提交、不改写历史，是最小的写；merge-forward 是仓库已落地的取舍（§31.3）。**没有 `'rebase'` 取值**（4.4） |
| `downstreamVerification` | `'none' \| 'external'` | `'none'` | 【证据强制：§28.3】对齐强度是下游验证能力的补集；`'external'` 时退化为只观察（4.2 步骤 2） |
| `dirtyPolicy` | `'refuse' \| 'commit-attributable'` | `'refuse'` | 【证据强制：§26.4 第 7 条】etckeeper 的干净前置检查；`00-request-and-facts.md` §五.3 也要求有前置判定与拒绝路径 |
| `behindThreshold` | number（≥1） | `1` | 【证据强制：§5/§7.2】Renovate `behind-base-branch` = 落后 ≥1；Mergify 让用户写整数，说明阈值应可配 |
| `runTimeoutMs` | number | `120000` | 【判断】数值无证据；机制有证据（§30.3 第 3 条 GitLab 的 `RUN_TIME = 3600` 硬时间预算、§17.2 Gitaly 超时优雅取消） |
| `conflictCooldownSeconds` | number | `3600` | 【判断】§29.2 规则 1 只要求「冲突必须有终止语义」，冷却时长无证据 |
| `backoff` | `{ baseSeconds, maxSeconds, suspendAfter }` | `{ 300, 21600, 5 }` | 【判断】数值无证据；机制有证据（§17.1 失败只记录不重试、§30.5 平台级错误停止并变得可见） |
| `ledgerEntries` | number | `20` | 【判断】有界是仓库约定「Apply bounds to the complete result」，条数无证据 |
| `mtimeGraceMs` | number | `2000` | 【证据强制：仓库内】`packages/channel/channel-bridge/src/index.ts` 的 `mtimeGraceMs` 默认 2000，复用同一个时钟宽限语义 |
| `worktreeRoot` | string | 无（`mode === 'align'` 时必填） | 【判断】机制有证据（§15.1 的 `git worktree` 隔离），位置选择无证据 |
| `commit.enabled` | boolean | `false` | 【证据强制：§28.4】与 `mode` 分开的第二个开关，见 6.3 |
| `commit.trigger` | `'turn-end' \| 'timer-only'` | `'turn-end'` | 【判断】5.2 的读法；两种读法都保留，因为负责人只说了「每个工作内部」 |
| `commit.types` | string[] | `['feat','fix','docs','refactor','test','chore']` | 【证据强制：§25.1】规范不强制类型词表，必须自己决定 |
| `commit.allowBreaking` | boolean | `false` | 【证据强制：§25.1/§31.2 第 6 条】`!`/`BREAKING CHANGE` 的产生权必须显式决定 |
| `commit.runHooks` | boolean | `true` | 【判断】见下 |
| `commit.secretPatterns` | string[] | 一组常见凭据形态 | 【判断】部署方可能加自己的格式；「命中即拒绝」不可配（5.4） |
| `commit.maxScanBytes` | number | `1048576` | 【判断】有界；数值无证据 |
| `commit.maxPathsPerCommit` | number | `200` | 【判断】有界；与 `MAX_OBSERVATION_ITEMS` 取同一个数量级便于对照 |
| `commit.maxMessageBytes` | number | `1024` | 【判断】有界 |
| `commit.fallbackType` | string | `'chore'` | 【判断】机械摘要需要一个类型词；取最中性的一个 |
| `workspaces` | `Record<WorkspaceId, {...}>` | 无 | 见 6.2 |

**`commit.runHooks` 默认 `true` 的理由。**【判断】默认**不**传 `--no-verify`，即让仓库自己的 hook 跑。三条理由：① 本模块的密钥筛查不依赖 hook（5.4），所以让 hook 跑不会制造「已经装了扫描器所以安全」的假象；② 提交是本地对象，hook 失败是拒绝而不是数据丢失；③ 仓库自身的 AGENTS.md 依赖 pre-commit 门（`git diff --cached --check` 管文件末尾换行）。反面先例是 Aider 的 `--git-commit-verify` 默认 `False`（§18，【实抓】），本设计明确不照抄这一条。**已知风险**：hook 可能是交互式的，需要终端。调研稿 §12.1/§34 记下 Copybara 的 `promptConfirmation` 与 `ask_for_confirmation` 都需要终端而「无人值守行为未文档化」——所以这里必须用 `runTimeoutMs` 把 hook 一并限界，**超时按拒绝处理而不是按失败重试**。

### 6.2 每工作区覆盖

`workspaces` 是一个以 `WorkspaceId` 为键的映射，每项可以覆盖 `enabled` / `intervalSeconds` / `jobs`（`{ align: boolean; commit: boolean }`）。**【判断】** 为什么放在 Config 而不放 `ctx.settings`：实查 `packages/settings/settings/src/index.ts`，settings 的命名空间是**全局字符串**（`parseSettingsNamespace` 校验的是名字形态），不是按工作区键的；要用 settings 表达「每工作区」只能在一个命名空间里塞一个以 workspace id 为键的映射，那既不比 Config 清楚，又引入「用户可改」这个本设计没有消费者证据的面向。所以 v1 用 Config，用户可编辑的每工作区开关列为开放问题。

校验规则：**装载期检查 `workspaces` 的每个键都在 `ctx.workspaceRegistry.list()` 里**，不在即响亮失败（`00-request-and-facts.md` 的仓库约定「Misconfiguration fails loud at load when self-contained」）。运行期新建的工作区不在映射里，回落到全局默认——这条必须写清，否则「未知 id 响亮失败」会与「工作区可以随时新建」冲突。

### 6.3 固定不变、不做成可配项的部分

| 项 | 为什么不可配 |
| --- | --- |
| 不实现 rebase | 4.4：`alignStrategy` 里没有这个取值 |
| 不实现 push | 5.8：操作集合里没有它 |
| 不实现 `--amend` / 历史改写 | §31.2 第 4 条、§31.1 的 jj `immutable_heads()` |
| 不用 `git add -A` / `.` / `commit -a` | 5.3 第 1 条 |
| 不静默解冲突（`-X ours` 等） | §29.1：没有一家自动解冲突 |
| 密钥命中不可豁免 | 5.4 |
| `.jj` 存在即拒绝 | 3.5 |
| detached HEAD 即拒绝 | 3.5 |
| `mode` 与 `commit.enabled` 是两个开关 | 两者的风险面不同：作业 (a) 的合并作用于整棵工作树，作业 (b) 的提交按路径限界；§31.2 第 2 条要求逐路径写明提交范围，同一个开关会掩盖这个差别 |

---

## 七、失败与可观测

### 7.1 结果分类：「什么都不做」不等于「失败」

**【证据强制：§30.3 第 6 条】** 调研稿的硬要求：**绝不能用一个「退出码 0」同时表示「对齐成功」和「发现冲突所以什么都没做」。** 证据是两处把这两件事混起来的产品：`gh stack sync` 在非交互终端遇到栈分叉时**中止但 "exiting successfully"（退出码 0）**（逐字，§8，【实抓】），无人值守时这就是「看起来成功、其实什么都没做」；Copybara 的 issue #236 把「已经迁移过」当成非 0 退出，用户原话抱怨 "causing CI pipelines to be unhappy"（§12.1）。`gh stack` 另有一张完整的退出码表（1–10）并为并发专门定义 exit 8（排他锁 5 秒超时）；`git-sync` 用 exit 1 / exit 2 区分「本次 rebase 失败留在冲突态」与「上次没收拾干净」（§13.1）。本设计照此，但用持久的结果枚举而不是退出码：

| 结果 | 含义 | 计失败？ | 下一步 |
| --- | --- | --- | --- |
| `no-op` | 有理由地什么都没做，理由逐条记（`up-to-date` / `no-repository` / `no-upstream` / `no-attributable-paths` / `deferred-to-downstream-verification` / `workspace-path-missing`） | 否 | 无 |
| `aligned` | 写操作落地 | 否 | 无 |
| `committed` | 提交落地 | 否 | 报告撤销方式 |
| `conflicted` | 预检发现冲突，工作副本零改动 | 否 | 冷却 + 人处理冲突路径 |
| `refused-*` | 前置条件不满足（`dirty` / `secrets` / `detached-head` / `colocated-vcs` / `hook` / `too-many-paths`） | 否 | 报告原因与解除条件 |
| `ambiguous-attribution` | 安全网无法归属某些路径 | 否 | 报告路径 |
| `skipped-locked` | 另一运行持有锁 | 否 | 无（下一轮） |
| `superseded` | `.git` 在我们脚下被改动 | 否 | 不重试，报告 |
| `failed-*` | 真的失败（`fetch` / `merge` / `merge-dirty` / `timeout` / `git-unavailable` / `flush`） | **是** | 退避；连续达阈值则挂起 |
| `suspended` | 连续失败达阈值，自动停手 | **是** | 报告并要求人清除 |

`no-op` 与 `refused-*` 不递增 `consecutiveFailures`。**【判断】** 把 `refused-*` 也排除在失败之外：它表示「系统按设计正确拒绝」，把它算成失败会让一个长期有脏工作区的部署误触发挂起，这正好是 §30.3 第 6 条要避免的「运维上会直接淹没真正的失败」。

### 7.2 失败被记录，不被重试

**【证据强制：§30.2】** GitLab 的仓库检查是范本：`update_repository_check_status` 失败时打日志、把记录标成 `failed`、**照常推进水位线**；调研稿的评价是「失败 → 打日志 + 标 `failed` + 照常推进水位线。没有无限重试，也不会卡住队列。这是『无人值守』的正确姿态。」

- 失败 → 写 `lastOutcome`、递增 `consecutiveFailures`、把 `nextEarliestRunAt` 推后（指数退避，上限 `backoff.maxSeconds`），**不重试本次**。
- 连续失败达 `backoff.suspendAfter` → `suspended = true`，停止该工作区的自动运行，直到人清除。**【证据强制：§30.5】** Kodiak 遇到 GitHub 500 时给自己贴 `kodiak:disabled` 然后停手等人（issue #397 的教训：单纯重试 500 会导致同一个 PR 被重复合并）；调研稿的结论是「对『外部系统故障』这类错误，正确的动作是『停止并变得可见』，而不是『重试』」，并指出这与 DSH 的 `packages/session/session-checkpoint-policy` 的既有处理一致（§31.3：已持久化但无结果的调用记录为「结果未知」，而不是自动重试）。
- 冲突不进退避曲线，进冷却（4.3）：它是终态而不是失败。

### 7.3 有界

| 界 | 值 | 依据 |
| --- | --- | --- |
| 单次运行时间 | `runTimeoutMs` | §30.3 第 3 条：GitLab `RUN_TIME = 3600`，到点就走，剩下的下轮继续；§17.2 Gitaly 超时优雅取消 |
| 每工作区互斥 | 锁 + 租约 | §30.3 第 2 条：GitLab 双层锁 + 租约；§16 `git maintenance` 的对象库锁 |
| 锁竞争的代价 | 少跑一轮 | 【证据强制：§30.3 第 4 条】`git maintenance` 官方 TROUBLESHOOTING 自陈 "Users may find some cases where scheduled maintenance tasks do not run as frequently as intended."——少跑是正常代价，不是故障 |
| 命令输出 | 只用紧凑命令形态 | 4.2 步骤 1：`runNativeCommand` 无 `maxBuffer`，Node `execFile` 默认 1 MiB |
| 冲突路径列表 | 10 条 + 剩余条数 | §2：GitLab 的系统备注最多列 10 个冲突文件并给出剩余数量 |
| 台账 | `ledgerEntries` 条环形 | 仓库约定 |
| 暂存集 | `maxPathsPerCommit`，超出即拒绝 | 5.3 第 6 条 |
| 筛查字节 | `maxScanBytes` | 5.4 |
| 消息字节 | `maxMessageBytes` | 5.5 |
| 工作区路径数 | `ctx.workspaceRegistry.list()` 的长度 | 由注册表本身决定，不额外设界 |

### 7.4 可观测面

- **权威记录是 `workspaceAutomation` 域的 `RunRecord` 台账**：每次运行一条，含 `startedAt` / `finishedAt` / `outcome` / `reason` / `expectedHeadOid` / `observedUpstreamOid` / `baselineBefore` / `baselineAfter` / 冲突路径（有界）/ 提交 oid 与父 oid / 摘要来源 / 拒绝的路径与原因。台账是权威，其余都是它的投影（仓库约定「Publish state only at its commit point」「derive caches, prompts, UI echoes, replay, and query views from one authoritative source」）。
- **人可见的投影**：`packages/api/workspace-automation` 提供一个按 `WorkspaceId` 键的只读 Remote 命名空间，形态照 `packages/api/workspace-controller`（按 workspace 键、`namespace: 'workspace'`）。**【判断】** 选 Remote 而不是工具（tool）的理由：台账是工作区级的、与任何会话无关，而工具是会话内的模型面；负责人的要求是「人能看到」，不是「模型能看到」。工具形态保留为替代方案。
- **每次运行必须能回答四个问题**：比对了什么（基线 oid → 观察到的 oid）、做了什么或为什么没做、冲突在哪（路径 + 剩余条数）、下一步是什么。**【证据强制：§29.2 规则 3】** GitLab 是全篇最好的范本：5 类系统备注，每一类都配 "What to do"，并且官方单独说明「真正原因在 `Explanation:` 之后」；反面证据是 bors-ng 的 issue #378「bors use of "Merge conflict" message is misleading」被单独立为 issue，以及 Gerrit 官方承认关闭 content merge 会让失败路径不可解释并以此为主要理由反对它。**「失败路径的可解释性」是设计指标，不是文案问题。**
- **注册与装载的接线面**：新包要进 `tsconfig.host.json`（`packages/api/workspace-automation` 的 Remote 面若含客户端投影还要进 `tsconfig.client.json`）、进一个 `cordis.yml` overlay（形态照 `apps/cli/config/examples/schedule/cordis.yml`），若被 Raw/Web 的 `cordis.yml` 直接引用还要进对应 resolver manifest 的 `dependencies`（`verify-cordis-config` 会强制）。`00-request-and-facts.md` §七 已记录：这些接线文件与另外四项在飞工作共享，**本议题必须串行，不能与正在跑的工作流同时改接线面**。

### 7.5 模型可见性

- **运行本身不进入模型请求。** 它写台账、写 Remote 投影、不写会话日志。因此本设计**不需要新增 `SessionEventMap` 成员**，也就不触发已发布会话格式的读取规则。
- **提交的效果对模型是普通 git 状态**，不需要额外事件。
- **摘要不进模型。** 它是台账里的一条记录（5.5）。如果将来要把它呈现给模型，仓库约定「Model-visible ⟺ logged」要求它同时成为一条会话事件；届时照 `session/title` 做成 log-only 事件（§31.3 那一行：被接受的版本是 log-only 的 `session/title` 事件，更新的版本取代旧的）。

---

## 八、明确不自动化的部分

| 不自动化的事 | 依据 |
| --- | --- |
| **解冲突** | §29.1：调研覆盖的全部产品里没有任何一家自动解冲突；§31.1 第一行 |
| **rebase / 改写本地历史** | 4.4；§31.1「改写已进入主线的历史」行（jj `immutable_heads()`） |
| **push** | 5.8；§31.2 第 1 条、§27.3 第 1 条 |
| **force-push / 覆盖远端移动** | §31.2 第 8 条；仓库已有决定「用精确 lease 或 lease 保护的 push 路径，远端移动即中止，禁止裸 `--force`」（§31.3） |
| **`reset --hard` / `clean -fd`** | §31.1 引 Codex CLI 系统提示词逐字 "**NEVER** use destructive commands like `git reset --hard` or `git checkout --`" |
| **`--amend`** | §31.2 第 4 条；Codex CLI 逐字 "Do not amend a commit unless explicitly requested" |
| **暂存整棵树** | 5.3；§31.2 第 2、3 条 |
| **自动创建 PR / 自动合并** | §31.1 最后两行：gh-stack 逐字 "Sync never opens pull requests."、Copilot 逐字 "Sessions do not create pull requests automatically."、"Requires human review before merging" |
| **对齐 PR（改 base / 更新分支 / 入队）** | 4.5：本仓库没有 forge 写能力 |
| **生成物 / 文档漂移的自动修复** | §15：真实 setup 里文档对齐是「重新生成 + 比对」，冲突被转化成构建失败，且生成器由仓库自己拥有；本模块不知道生成器是什么。§15.1 另给出可迁移的形态（`git worktree` 隔离、按场景分级门控：rust tidy 在 PR 阶段 `continue_on_error: true`、Auto 阶段硬失败），列为开放问题 |
| **提交经 shell 写出的路径** | 2.4 的已知缺口：`bash` 的写不产生第一方变更工具的 `tool/call`，无法归属；只作为「未提交余量」报告 |
| **豁免密钥命中** | 5.4 |
| **自动撤销提交** | 5.7：只报告撤回方式与边界 |
| **在 `.jj` colocated 工作区里工作** | 3.5 |
| **与另一个 `.git` 写者竞争** | 3.5（负责人的保留决定） |
| **对冲突按周期重试** | 4.3；§29.2 规则 1 |
| **重试平台级故障** | 7.2；§30.5 |
| **子模块内部的对齐** | 工作区观察的是超级项目的 `status`；子模块的提交属于另一个仓库。**【判断】** 本设计不递归进子模块，也不把子模块的脏状态与超级项目分开报告 |

---

## 九、开放问题与负责人保留的决定

### 9.1 已保留的决定（记录，不重开）

**并发写者：检出并拒绝，绝不与另一个 `.git` 写者竞争。** 负责人已裁定。落实为 3.5 的三层（`.jj` 存在即拒绝、detached HEAD 即拒绝、预期 HEAD 比对不符即 `superseded` 中止不重试），理由是 §22 的事实：jj 在 colocated 工作区下每条命令都改写 `.git` 并把 HEAD 置成 detached，而调研稿明确说这类场景「本文调研的产品里没有一个处理过」。**接受的三项残余风险已在 3.5 逐条写明**（外部写者导致白跑、HEAD 移到同一 oid 时的盲区、跨进程租约依赖存储后端）。

### 9.2 本文回答了的开放问题

| 问题 | 回答 |
| --- | --- |
| 「每个工作内部」的粒度 | 设计到**每个工作单元（一个 turn）**，理由与另两种读法的影响见 5.1 |
| 「对齐 PR」需要什么 | 需要 forge 能力，本仓库没有；明确不做，见 4.5 |
| 怎么配置 | 全部走 `Config`（6.1），每工作区覆盖走 `workspaces` 映射（6.2），固定项见 6.3 |
| 失败时怎么办 | 「什么都不做」与「失败」分成两组互斥的结果枚举（7.1），失败被记录不被重试（7.2） |
| 「rebase 后要不要重验」 | 本设计不实现 rebase，问题无触发点；一旦加入必须同时带来重验机制，而现在没有（4.4） |

### 9.3 仍未决的开放问题

| 问题 | 现状 |
| --- | --- |
| **「人是否已介入」在本仓库里没有可观察量** | 【判断，标记为未决】§31.2 第 4 条把 Dependabot 的「PR 上出现额外提交即停止自动改写 + 显式逃生字符串」列为「本设计最该抄的一条」。但 DSH 的工作区里没有等价信号：没有 PR、没有第二作者、`mtime` 只能证明「写过」不能证明「谁写的」。候选信号（路径是否被非第一方变更工具写过、内容哈希在单元结束后是否变化、显式抑制标记）都不够可靠。**本设计不猜，也不发明机制**；v1 靠 5.3 的四道过滤与 5.2 的归属歧义拒绝来兜住风险，把「人已介入」列为未决 |
| **用户可编辑的每工作区开关** | 需要给 `ctx.settings` 加一个以 workspace id 为键的命名空间；本设计没有找到消费者证据，v1 用 Config（6.2） |
| **摘要是否应成为 log-only 会话事件** | v1 放台账（5.5）。改成 `session/title` 那样的 log-only 事件需要新增 `SessionEventMap` 成员并处理已发布会话格式的读取规则 |
| **生成物漂移检查** | §15.1 的形态（`git worktree` 隔离 + 按场景分级门控）有证据，但「跑哪个命令」由仓库自己拥有；若要接入，命令必须来自 Config，且「漂移」应只报告不自动修 |
| **外部密钥扫描器** | 本设计不依赖任何外部扫描器的退出码（5.4 的诚实边界）。若将来要改用，必须先实测退出码语义——调研稿自陈「未安装、未运行任何扫描工具，所有退出码结论都是静态阅读的产物，没有一条是实测退出码」 |
| **跨进程互斥** | 单进程部署假设下租约足够；多进程共享同一存储后端时需要另想办法（3.5 第三项残余风险） |
| **宿主面路径抽取规则与客户端 `turn-deliverables.ts` 的漂移** | 建议抽出一份双方共用的纯解析模块（2.4），本文只提出，未实现 |
| **提交 trailer 的名字与是否采用** | 5.8 第 3 层采纳了「可继承谓词」的形态（§27.3 第 4 条），但 trailer 的具体名字是本文的判断 |
| **`no-op` 与 `refused-*` 是否都不计失败** | 本文按 7.1 的决定处理；「系统按设计正确拒绝」算不算运维意义上的失败，属于部署方的判断 |
| **子模块** | 明确不递归（第八节）；若要支持，需要另一套「每个子模块是一个对齐目标」的模型 |

---

## 十、本设计中的判断（非证据强制）

下列决定**不由证据强制**，是本文选定的取舍。其余决定都由调研稿的一手证据或仓库内契约强制，逐条已在上文标注。

1. **不采纳「默认开启 `rerere`」的建议**（1.2）：该建议的前提是本设计明确拒绝的形态（在工作副本里解冲突）。
2. **一个 `ctx.gitAlign` 接缝同时承载对齐与提交**，而不是拆成两个接缝（2.2）。
3. **`work-summary` 单独成包**，且 provider 契约不带 cadence 字段（2.3）。
4. **`workspaceAutomation` 单独开一个存储域**，不扩 `workspace` 域（2.3）。
5. **安全网对归属歧义的路径拒绝提交而不是猜测**（5.2）。
6. **`.jj` 存在即拒绝做成固定规则、不做成 Config 开关**（3.5）：可配就等于声称支持「与另一个 `.git` 写者共存」。
7. **HEAD 比对只比对 revision 身份**，接受「移到同一 oid 时看不出差别」的盲区（3.5）。
8. **租约时长 = `runTimeoutMs` + 宽限**（3.5）。
9. **`intervalSeconds` 默认 3600、下限 300**（6.1）：下限复用 `schedule` 的既有常量，默认值本身无证据。
10. **`behindThreshold` 默认 1**（3.4）。
11. **`dirtyPolicy` 默认 `refuse`**，而作业 (b) 不受脏树影响（4.2 步骤 3、5.3 第 1 条）：两者的差别来自「作业 (a) 作用于整棵工作树、作业 (b) 按路径限界」。
12. **`downstreamVerification === 'external'` 时作业 (a) 退化为只观察**（4.2 步骤 2）：这是对 §28.3 的保守映射，不是 Renovate 档位的逐字翻译。
13. **不实现 rebase，并让它在配置层面不可表达**（4.4）。
14. **`commit.runHooks` 默认 `true`，不照抄 Aider 的 `--no-verify` 默认**（6.1）。
15. **密钥筛查面取路径的完整内容而不是 diff hunk**（5.4）。
16. **「命中即拒绝」不可配，`secretPatterns` 可配**（5.4）。
17. **不采用 `git add --update` 作为发现机制**（5.3 第 3 条）：这是对 §25.4 的精确化，`--update` 能挡住未跟踪文件但挡不住用户自己的已跟踪半成品改动。
18. **`!` / `BREAKING CHANGE` 不产生**，提案含它即退回机械摘要（5.5）。
19. **机械摘要不用占位消息**，用 `fallbackType` + 文件数与增删行数（5.5）。
20. **摘要 v1 只进台账，不新增 `SessionEventMap` 成员**（5.5、7.5）。
21. **可观测面用按 `WorkspaceId` 键的 Remote 命名空间而不是工具**（7.4）。
22. **撤销只报告不执行**（5.7）。
23. **提交 trailer 用于让部署侧表达「未确认的提交」谓词**（5.8）。
24. **`refused-*` 与 `no-op` 都不计入 `consecutiveFailures`**（7.1）。
25. **工作区记录的孤儿对齐状态按注册表裁剪**（3.3）。
26. **不递归进子模块**（第八节）。
27. **建议但不强制部署侧设置 `push.default=nothing`**（5.8）：改部署的 git 配置超出本模块职责。

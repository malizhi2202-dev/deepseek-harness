# Agent Note: 逐工作区 git 对齐与自动提交

Status: implemented

[English](2026-09-22-workspace-git-alignment-and-automatic-commit.md) | 中文

## 问题

工作区是 harness 在其中运行会话的一个目录，而会话的工作落在一个人人都不去与上游对齐、也没有人去提交的 git 检出里，直到某个人类注意到为止。所有者提出两件事：在每个工作区维度上装一个定时器，周期性地让 git——以及其中的文档、提交、代码——与远端对齐；并在每个工作单元结束时自动总结并提交，而 push 留给人。

后半部分才是更硬的约束。一个能 push 的 agent 可以发布无人评审的工作、重写同事正在其上开发的分支，或者把凭据泄漏到一个永久保留历史的远端。只有当 harness 根本不能 push——而不只是选择不 push——该特性才可接受。

## 决定

五个包，按两个 seam 所需的角色划分。`dsh-git-align` 定义 `ctx.gitAlign`：`resolve`、`fetch`、`probe`、`apply`、`changeFacts`、`ignoredPaths`、`commit` 与 `pushedToRemote`。`dsh-git-align-local` 是宿主 provider，通过共享的无 shell 运行器运行本机 git。`dsh-work-summary` 定义 `ctx.workSummary`：一个 provider 注册表，外加一个有界的机械回退，把单个工作单元改动的路径变成 Conventional Commits 消息。`dsh-work-summary-llm` 是它的一个 provider。`dsh-workspace-automation` 拥有定时器以及消费上述一切的两个作业。

读取仍留在既有的 `ctx.git.observe` 上；`ctx.gitAlign` 是一条新 seam，而不是给只读 seam 加方法，因为观察 seam 是有期限的临时物，而把具备写入能力的方法挂在它上面，等于把一条会触碰远端的表面藏在一个 Web 客户端只读面板已经注入的名字后面。

**「绝不 push」由三层强制。** seam 不声明任何 push 操作，也没有任何方法接收远端目的地，因此 consumer 无法表达 push。provider 自行构造每个 argv，其真实仓库测试记录一次完整对齐与提交运行的全部 argv，断言其中没有一条包含 `push` 或 `rebase`，并断言裸 origin 的分支顶端事后未移动。运行时写入只经 `ctx.gitAlign`、读取只经 `ctx.git.observe`，且从不派生进程。`pushedToRemote` 是一次读取——对 `refs/remotes/` 执行 `for-each-ref --contains`——其答案只决定一个已创建的提交是否仍可撤销。

**两个作业，各自一个事务。** 对齐作业观察、判定、fetch、重新观察、探测，然后要么报告、要么推进。提交作业在闭合的轮次边界运行：推导该轮次的可归属路径、为凭据筛查读取它们的有界前缀、总结，并创建一次提交。每次运行获取一个存储的租约、恰好记录一条带闭合结果的台账记录、释放租约，并重新装填定时器。发现租约被持有的运行记录 `skipped-locked`，什么都不触碰。

**定时器存储绝对的 `nextEarliestRunAt`。** 而不是间隔起点：存储状态是重启后的进程唯一能读到的东西，且退避、冲突冷置与正常间隔都写这同一个字段。因此装填从不依赖上一次运行发生在何时。失败会把延迟从 `backoffBaseSeconds` 翻倍至 `backoffMaxSeconds`，并在连续失败达到 `backoffSuspendAfter` 次后挂起该工作区；冲突施加一次冷置；一次成功把两者都清除。

**归属是被证明的，不是被推断的。** 只有当轮次中存在一次写工具的 `tool/call`、其参数指名该路径，**并且**存在一条报告无错误的对应 `tool/result` 时，该路径才算作本轮的成果。结果缺失、结果失败，以及属于其他轮次的调用都被排除；而一个更早的未提交轮次也写过的路径会被作为歧义拒绝，而不是被提交两次。

**撤销永不具破坏性。** 已创建的提交会连同 `git reset --soft <parent>` 与 `git reset --mixed <parent>` 一起被报告；词汇表中不存在任何 `--hard` 形式，因此撤销不可能丢弃工作树。

## 考虑过的替代方案

**用一个插件做完所有事。** 单个包可以同时持有 seam、provider、总结器与定时器。它落败，因为四个角色有不同的所有者与不同的测试表面：provider 需要一个真实仓库，总结器完全不需要 git，而定时器两者都不需要。拆分还让对齐 seam 可被日后任何想要一次本地快进而不要定时器的东西复用。

**给 `ctx.git` 添加写方法。** 更少的包、一次注入。它落败，因为 `ctx.git` 是 Web 客户端 git 面板所注入的只读观察 seam，而且在一个只读 seam 上留出一个 push 形状的洞，恰恰是本特性绝不能制造的诱因。

**用下一次运行的间隔取代绝对时间戳。** 算术更简单。它落败，因为重启会从一个它并未观察到的时刻重新推导计划，而且三条不同策略（间隔、退避、冷置）各自都需要自己的字段才能让读者对账。

**`git rerere`，让重复的冲突自行解决。** 它落败，因为它在仓库自身的配置里记录解决方案，那是 harness 随后会默默拥有的状态，而人类在调试冲突时无法在台账中看到它。

**用 `git reset --hard` 撤销。** 显而易见的撤销方式。它落败，因为它丢弃工作树，而那正是由 agent 工作单元创建的提交绝不能付出的代价。

**不加 `git add --intent-to-add` 直接 `git commit -- <paths>`。** 一条命令而不是两条。它落败，因为 git 会拒绝它尚不认识的路径，而替代方案 `git add -A` 会暂存可归属集合之外的路径。

**为这次询问新增一个 `SessionEventMap` 成员。** 它会把总结请求放进会话日志，而模型可见输入正属于那里。它落败，因为该请求不是*本*会话的模型可见输入：新增该成员需要重新生成 `known-event-types.ts`、会话格式目录与持久化目录，而设计转而把台账固定为记录载体。

**强制要求 `git merge-tree --write-tree`。** 一条代码路径而不是两条。它落败，因为该标志集并非宿主可能携带的每个 git 都支持——本机的 2.25.1 以退出码 129 拒绝它——因此 provider 运行它、并仅在该状态上回退到隔离的临时工作树，而不是从版本号推断能力。

## 后果

仓库新增了五个包与两条 seam，而 `dsh-workspace-automation` 是两者的第一个 consumer。以 `enabled: true` 与 `mode: align` 挂载运行时的部署会得到一个自行推进的检出；默认是 `enabled: false` 与 `mode: observe`，因此在操作者表态之前什么都不会移动。

它买到了：一条无法从此代码路径发生的 push、一份能区分拒绝与无操作与失败的台账，以及一次在 `Dsh-Unit: <sessionId>/<turn>` trailer 中指名产生它的工作单元的提交。

它的代价，以及已交付代码偏离设计之处：

- 运行预算由 `AbortSignal.timeout` 组合，而不是设计中的 `ctx.timeout` 与 `AbortController` 组合。
- `changeFacts` 之前会执行 `git add --intent-to-add`，且 `commit` 在提交失败时用 `reset -q -- <paths>` 回滚该索引条目并报告 `indexRestored`。设计完全没有提到索引。
- numstat 读取会传 `--no-renames`，因此一次重命名被报告为一次删除加一次新增，而不是一条记录。
- `ignoredPaths` 使用带 `core.quotePath=false` 的换行分隔输出，并与请求集合求交，因为 `check-ignore -z` 只有配合 `--stdin` 才有意义，而无 shell 运行器无法提供。
- `maxConflictPaths` 是设计表之外的 Config 字段，因为探测返回的冲突列表像其他每个列表一样需要一个上限。
- fetch 无法通过该运行器关闭凭据助手，因此交互式 fetch 被 `commandTimeoutMs` 有界化并被记录为失败的 fetch，而不是被回答。
- 消息塑形配置（类型词表、`allowBreaking`、回退类型、trailer）位于 `dsh-work-summary` 而不是自动化 Config 上，因为校验提案的 seam 就是拥有它所校验策略的那个 seam。
- `dsh-work-summary-llm` 既不向 `ctx.llm.stream` 传会话 id 也不传 purpose，且询问记录在调用方台账而非会话日志中，原因见上。
- 存储域名为 `workspace_automation` 而非 `workspace-automation`，因为域名规则是 `/^[a-z][a-z0-9_]*$/`。
- 设计中的 `mtimeGraceMs` 根本不是 Config 字段：`ctx.fs` 报告的是不透明的 freshness token 而非修改时间，因此无法把候选路径的写入时间与某个界限比较。资格仅来自轮次边界。
- `packages/api/workspace-automation` 经 Typert Remote 以 `workspace/automationLedger` 投射台账，每次读取以最新的 `maxRuns` 次运行、每次运行 `maxPaths` 条路径为界；`automation` 右边栏页签类型渲染它。存储的台账仍是权威，投射由它派生。

## 测试

`pnpm run test:coverage` 覆盖全部五个包，逐文件达到语句、分支、函数与行 100%。除单元覆盖之外，三个测试套件承载验收论证。

绝不 push 的证明是 `packages/git/git-align-local/tests/live.spec.ts`：它构建一个真实仓库与一个真实裸 origin，在其上运行一次完整对齐与一次提交，同时记录 provider 发出的每个参数向量，断言没有任何被记录的向量包含 `push` 或 `rebase`，并断言 origin 的分支顶端事后未移动。

HEAD 被移动的竞态测试是 `packages/workspace/workspace-automation/tests/runtime.spec.ts`。脚本化观察器为 fetch 之后的那次重新观察返回不同的 head 对象 id，运行随即记录 `superseded`，既不探测也不写入——与第二个写入者产生的结果相同。第二个用例让重新观察直接失败，第三个让工作树稳定下来却没有到达上游。

检测并拒绝覆盖词汇表的其余部分：分离的 HEAD、在 `dirtyPolicy: refuse` 下脏的工作树、一个带同址 `.jj` 工作区的仓库、一个命中已声明凭据形态的候选、一个无法读取的候选、超出 `maxPathsPerCommit` 的暂存集合，以及一个更早的未提交轮次也写过的路径。每一项都被断言为一个结果，并且在后续本会有写入的地方，断言相应 provider 调用不存在。

## 暂缓

没有任何测试套件通过 Loader 引导该运行时。它的组合以真实存储域、真实 `WorkSummaryService`，以及脚本化的 git 与文件系统 provider 被演练；真实 git provider 由 `dsh-git-align-local` 的真实仓库测试端到端演练；但两者从未一起从 `cordis.yml` 加载。可照搬的模式是 `packages/session/session-title-first-prompt-llm/tests/loader-composition.spec.ts`；Loader 组合还需要把插件名登记进解析器清单，而该清单位于包 bundle 之下。

拉取请求对齐需要仓库所没有的 forge 能力。台账的 Remote 投射属于 `packages/api/` 中的其他 Remote 命名空间。宿主侧归属解析器重述了客户端 turn-deliverables 视图同样编码的写工具参数词汇；设计建议用一个共享纯模块，而本轮留下两份实现。

## 相关

- `discovery/workspace-git-alignment-2026-09-21/02-timer-and-commit-design.md`——本实现所依据的冻结设计，以及上述每一项偏离的来源。
- `.agents/notes/implemented/architecture/2026-06-13-capability-seams.md`——为什么两条 seam 都承载全部三个角色。
- `.agents/notes/implemented/architecture/2026-07-24-domain-kv-storage-and-workspace.md`——台账所在的存储域。
- `.agents/notes/implemented/feature/2026-09-18-sidebar-git-observation-panel.md`——本 note 所并置的只读观察 seam。该 note 的决定原样成立：`ctx.git` 保留其唯一的 `observe` 方法，而本包经由它读取而非加宽它。这一关系是局部的，不是取代，因此两份 note 都保持有效并互相链接。

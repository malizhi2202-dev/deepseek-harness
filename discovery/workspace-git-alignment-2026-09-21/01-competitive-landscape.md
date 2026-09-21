# 工作区定时 git 对齐 与 自动提交：同类产品的落地方案与代码调研

议题 slug：`workspace-git-alignment-2026-09-21`
本文位置：`discovery/workspace-git-alignment-2026-09-21/01-competitive-landscape.md`

## 〇、本文回答什么问题、怎么调研的

被设计的功能是**每工作区定时器模块**（per-workspace timer module）：每个 workspace 是一条持久记录、持有规范目录路径，模块按定时器周期性地**对齐 git**——仓库本身，以及仓库内的文档、PR、commit、代码，形式是**定时的合并对齐（scheduled merge alignment）**。

负责人在调研过程中追加了第三批需求（原话）：

> 「在每个工作内部自动总结 自动提交commit 但是push 由人决定」

因此本文覆盖两组问题：

- **第一部分：定时合并对齐。** 对齐的双方是谁、什么触发、真实算法是什么、**冲突时具体发生什么**、自动还是门控、周期性工作怎么调度、已知失败模式。
- **第二部分：自动总结 + 自动提交 + push 由人决定。** 尤其是两件事：**（A）到底把什么放进 commit**（这是安全属性），**（B）人怎么被保护**。

### 调研方法与证据分级

- **只取一手来源**：项目自己的仓库源码、README、官方文档、设计文档、官方 changelog、issue tracker。**本环境 `web_search` 不可用**（端点未配置，报 `DeepSeek returned no web_search_tool_result blocks`），所以全程**零搜索**，只用 `curl` 直取已知 URL 与仓库文件。这提高了单条证据的强度，但降低了"穷尽性"——**否定性结论只覆盖到实际枚举过的页面集合**。
- 本文的证据分级（每条结论后标注）：

  | 标记 | 含义 |
  | --- | --- |
  | 【实抓】 | 主 agent 本会话**亲自** `curl` 抓取并阅读，引文可复核 |
  | 【子代理实抓】 | 子代理 `curl` 抓取并留档在 `/tmp/dsh-align-research/`，主 agent **抽查复核过其方法**（见文末"复核记录"） |
  | 【子代理实抓·未复核】 | 同上，但主 agent 未抽查该条 |
  | 【推断】 | 由源码/文档事实推出的结论，**无直接一手表述** |
  | 【未能核实】 | 尝试过但没拿到一手证据，**本文不当事实使用** |

- **抓不到的就说抓不到**，绝不凭记忆重建机制。文末"未能核实"汇总。
- 有若干条结论**推翻了任务书本身的前提**（例如 Gerrit 的 `rebaseOnSubmit` 查无此配置、`gh stack` 不在 `cli/cli` 里、jj 的 `design/conflicts` 等文件不存在）。这些都按实际情况写，不迁就任务书的措辞。

---

# 第一部分：定时合并对齐（scheduled merge alignment）

## 1. GitHub

GitHub 侧有三个语义差别很大的机制，混在一起讲会误导，因此分开。

### 1.1 Auto-merge（`gh pr merge --auto`）

**对齐双方。** PR 的 head 分支 vs base 分支，但 **auto-merge 本身不做任何对齐**：它只是"等必需条件满足后，按选定的合并方式把 PR 合掉"。它不会把 base 拉进 head，也不会 rebase head。【实抓】

**触发。** 事件驱动，无周期成分。官方原文（`automatically-merging-a-pull-request`）：

> Auto-merge merges a pull request automatically after all required reviews and status checks pass.

**算法。** 用户选定的 merge method（merge / rebase / squash）在条件满足时执行一次合并。

**冲突路径。** Auto-merge **不解决冲突**。官方文档写明了两条会**关掉** auto-merge 的条件（原文）：

> Auto-merge is disabled if someone without write permissions pushes new changes to the head branch or switches the base branch.

即：分支被外人推进、或 base 被换掉，就自动失效。如果 base 前进导致分支落后且分支保护要求"up to date"，PR 会卡住——**需要另一条机制（Update branch 或 merge queue）来收拾**。

**自动 vs 门控。** 需要仓库级开启该功能；再由**有 write 权限的人**在 PR 上点 Enable auto-merge。合并本身要满足必需评审与状态检查。

**调度实现。** **服务端**，实现未公开。`gh pr merge --auto` 的真实实现不是本地轮询循环，而是发一个 GraphQL mutation（`enablePullRequestAutoMerge`）——【子代理实抓】依据 `cli/cli` 的 `pkg/cmd/pr/merge/merge.go` 与 `http.go`。

**已知失败模式。** 上引两条自动失效条件；以及"能否点 auto-merge"只在**当前不能立即合并**的 PR 上出现（官方注记）。

**引用**
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request 【实抓，`Accept: text/markdown`】
- https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/pr/merge/merge.go 【子代理实抓】

### 1.2 "Update branch" 按钮

**对齐双方。** PR head ← base 最新。

**触发。** **纯手动**——有 write 权限的人在 PR 页面点。GitHub **不会**自动帮你更新分支。

**为什么会被逼着点。** 因为"必需状态检查"的 **Strict** 模式是默认行为。官方原文（`about-protected-branches`）：

> | **Strict** | The **Require branches to be up to date before merging** checkbox is checked. | The branch **must** be up to date with the base branch before merging. | This is the default behavior for required status checks. More builds may be required, as you'll need to bring the head branch up to date after other collaborators update the target branch. |

这段是理解整个问题的关键：**默认配置就会让"base 每前进一次 → 所有在飞 PR 都要重新对齐并重跑 CI"，这个负担被官方明确承认为成本**。merge queue 的存在理由正是把它从人身上拿走（下节引文）。

**算法。** 把 base 合进 head（页面也提供 "Update with rebase"，仓库可配置允许）；随后需要重跑 CI。

**冲突路径。** 无冲突时才可一键更新；有冲突时按钮不可用，GitHub 引导到冲突解决流程（web 编辑器或本地）。**【推断】** 未取到"按钮在有冲突时具体如何禁用"的一手表述，只取到"有冲突时需先解决"的引导。

**一个被低估的代价（官方原文，`about-protected-branches`）：**

> If the diff changes from this state (for example, because a contributor pushes new changes to the pull request branch or clicks **Update branch**, or because a related pull request is merged into the target branch), the approving review is dismissed as stale, and the pull request cannot be merged until someone approves the work again.

**点一次 Update branch 会作废既有审批。** 对一个"无人看管、定时对齐"的模块，这条意味着：**自动对齐会持续销毁人工审批**。这是本特性最需要正面回答的冲突之一。

**自动 vs 门控。** 手动 + write 权限。

**调度实现。** 无（不是周期性机制）；服务端。

**引用**
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches 【实抓】

### 1.3 Merge queue（合并队列）

**对齐双方。** **PR 的变更 vs 「base 最新 + 队列中排在它前面的 PR」的合并结果**。GitHub 服务端为每个 merge_group 造一条临时分支来跑必需检查。

**触发。** **队列位置（FIFO）**，不是时间。官方原文：

> As pull requests are added to the merge queue, the merge queue ensures that they are merged in a first-in-first-out order where the required checks are always satisfied.

**算法（服务端构造合并结果 → 跑检查 → 落地）。** 官方逐步场景（`managing-a-merge-queue`，原文编号）：

1. User adds pull request #1 to the merge queue.
2. The merge queue creates a temporary branch with the prefix of `main/pr-1` that contains code changes from the target branch and pull request #1. A `merge_group` webhook event of type `checks_requested` is dispatched…
3. User adds pull request #2 to the merge queue.
4. The merge queue creates a temporary branch with the prefix of `main/pr-2` that contains code changes from the target branch, pull request #1, and pull request #2, and dispatches webhooks.
5. When the GitHub API receives successful CI responses for `merge_group` branches `main/pr-1` and `main/pr-2`, the temporary branch `main/pr-2` will be merged in to the target branch.

注意第 5 步的巧妙之处：**`pr-2` 的临时分支已经包含了 `pr-1`，所以只要它绿了，两个一起落地**——一次合并覆盖队列前段。

**冲突 / 失败路径（这是本节最重要的部分）。** 官方原文：

> After grouping a pull request with the latest version of the target branch and changes ahead of it in the queue, if there are failed required status checks or conflicts with the base branch, the pull request will be removed from the queue. The pull request timeline will display the reason why the pull request was removed from the queue.

并且**后续 PR 的临时分支会被重建、把失败者摘掉**（原文第 5–7 步）：

> 5. When the GitHub API receives a failing status for `main/pr-1`, the merge queue automatically removes pull request #1 from the merge queue.
> 6. The merge queue recreates the temporary branch with the prefix of `main/pr-2` to only contain changes from the target branch and pull request #2.
> 7. When the GitHub API receives successful CI responses for `merge_group` branch `main/pr-2`, the temporary branch `main/pr-2` will be merged in to the target branch **without pull request #1 included**.

**"被摘掉"的完整原因清单（官方枚举，原文）：**

> * Configured CI service is reporting test failures for a merge group
> * Timed out awaiting a successful CI result based off the configured timeout setting
> * User requesting a removal via the API or merge queue interface
> * Branch protection failure that could not automatically be resolved

注意：**冲突（conflicts with the base branch）与 CI 失败走同一条路——移出队列 + 时间线给出原因**。没有"自动解冲突"，也没有重试循环。

**队列分组（batch）是怎么形成的。** 由 `Only merge non-failing pull requests` 决定（官方表格原文要点）：开启时"所有 PR 都必须满足必需检查"；关闭时"失败必需检查的 PR 也能进组，只要组里最后一个 PR 通过了必需检查"——官方给的理由是"当你有时断时续的测试失败、但不想让假阴性卡住队列时有用"。另有两个数字旋钮：

- **Build concurrency**：同时派发的 `merge_group` webhook 数，**1–100**。
- **Merge limits**：同时合入 base 的 PR 数**最小/最大值，各 1–100**，外加"等凑够最小值的超时"。

官方特别澄清（原文）："Merge limits do not combine `merge_group` **builds**. Merge limits only affect merges to the base branch once one or more `merge_group` has satisfied build checks."

**跳队（jump to the top）的代价（官方原文）：**

> Be aware that jumping to the top of a merge queue will cause a full rebuild of all in-progress pull requests, as the reordering of the queue introduces a break in the commit graph. Heavily utilizing this feature can slow down the velocity of merges for your target branch.

**自动 vs 门控。** 仓库管理员开启 "Require merge queue"；**有 write 权限的人**把 PR 加进队列。合并方式（merge/rebase/squash）是**队列级配置**。

**调度实现。** **纯服务端、事件驱动**（`merge_group` webhook + CI 回报）。**官方不暴露任何轮询间隔**——暴露的三个旋钮都是行为级的（Status check timeout、Build concurrency、Merge limits 的 Wait time）。服务端的持久化实现未公开。【子代理实抓，并明确标注"未公开"】

**已知失败模式（官方文档化的）：**
1. CI 必须显式加 `merge_group` 触发条件，否则合并会失败（原文："The merge will fail as the required status check will not be reported."）。
2. 不能在分支名 pattern 里用通配符 `*` 时启用 merge queue。
3. **官方文档自相矛盾**：一处说第三方 CI 要监听前缀 `gh-readonly-queue/{base_branch}` 的临时分支，正文场景却写 `main/pr-N`。本文两处都照录，不替官方裁决。【子代理实抓 + 主 agent 同页复核】【推断：正文示例是简化示意】

**对本特性的直接启示。** merge queue 是"**把对齐负担从人身上拿走**"的成熟答案——它不需要作者更新分支，而是**在服务端为每个候选结果造一条一次性分支去验证**。但它的关键前提是：**有一个能跑 CI、能持有队列状态的服务端**。本特性没有这个前提（见末节"可迁移的模式"）。

**引用**
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue 【实抓】
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue 【实抓】

---

## 2. GitLab

**对齐双方（三种机制要分开）。**
1. **Merge train（合并列车）**：MR 的 source branch **+ 列车中排在它前面的所有 MR 的变更** + target branch，**物化成一条真实的 git ref（train ref）**，并用这条 ref 跑 CI。【子代理实抓】——这是本文见到的**唯一**把"对齐后的合并结果"物化成 ref 的同类物（GitHub merge queue 也物化，但它的实现不公开）。
2. **Automatic rebase before merge**：**只动 source branch**，把 source rebase 到 target 上。
3. **Fast-forward merge**：只有在 target 没有从 source 的 base commit 分叉出去时才可能。官方逐字（`doc/user/project/merge_requests/methods/_index.md`）：

> A fast-forward merge is only possible when the target branch (such as `main`) has not diverged from the source branch's base commit. **If the target branch has new commits that aren't in the source branch, you must first rebase the source branch.**

**触发。** **事件驱动，无内部通用定时器。** 人把 MR 加入列车（点按钮，或调 API 时带 `auto_merge=true`）；之后由 push 事件驱动重算（`CheckStatusService` → `outdate_pipeline` → `refresh_async`）。周期性只来自 **Sidekiq cron**（见下）。

**算法。** 逐级三方合并构造出 train ref，跑 CI，最后对 target 做 `ff_merge`。

**冲突路径（本文认为这是所有产品里写得最具体、最可直接照抄的一份）。** 失败分两层：

**(a) 列车中的 MR 会被"自动丢弃"**，官方逐字（`doc/ci/pipelines/merge_trains.md`，Troubleshooting）：

> A merge request is dropped from the merge train automatically if it can no longer be merged while the pipeline is running. Common causes include:
> * The merge train pipeline did not succeed.
> * The merge request was marked as a [draft].
> * The merge request was closed.
> * The source branch was updated.
> * The merge request did not pass all merge checks, such as a merge conflict.
> * The changes in the merge request could not be combined with changes in earlier merge requests on the train.
> * The merge did not complete in time.
> * An unexpected error occurred.

**(b) 失败原因被写成"机器可读 + 人可读"的系统备注，并且每一类都配了明确的下一步动作。** 这是本文找到的最佳范本（官方表格，逐字）：

| 系统备注（逐字） | 含义 | What to do（逐字） |
| --- | --- | --- |
| `the merge could not be completed. Merge request is not mergeable. Explanation: The pipeline must succeed.` | 某个 merge check 失败；**真正原因在 "Explanation:" 之后** | Fix the cause, then add the merge request to the merge train again. |
| `the merge train pipeline could not be prepared: Failed to create merge commit for source_sha ... and target_sha ...` | 与前列车中的 MR 无法合并，**通常是冲突** | Rebase the source branch on the target branch, resolve the conflicts, then add the merge request to the merge train again. |
| `the merge train pipeline could not be prepared: merging commits: merge: there are conflicting files. Conflicts in: ...` | 与前列车中的 MR 冲突；**系统备注最多列出 10 个冲突文件并给出剩余数量** | 同上 |
| `an unexpected error occurred. Correlation ID: <id>` | 意外错误 | Give the correlation ID to your administrator or GitLab Support, then add the merge request again. |
| `the merge did not complete in time.` | 合并开始后卡住，通常是后台故障；**卡住被检测到后 MR 被丢弃** | Add the merge request to the merge train again. |

> 定位方式（逐字）："To find out why the merge request was dropped, check the **Activity** section in the **Overview** tab for a message similar to: `User removed this merge request from the merge train because ...`"

**(c) 一个失败会重排后面所有人，旧 pipeline 全部作废。** 官方逐字：

> If the pipeline for `B` fails: The first pipeline (`A`) continues to run. `B` is removed from the train. The pipeline for `C` [is canceled], and a new pipeline starts for the changes from `A` and `C` combined with the target branch (without the `B` changes).

> …the old pipelines were comparing against the previous combined changes in the merge train, which are no longer valid, so these old pipelines are canceled.

**(d) 失败的列车 pipeline 不能重试**（逐字）：

> When a merge train pipeline fails, the merge request is dropped from the train and **the pipeline can't be retried after it fails. Merge train pipelines run on the merged result** of the changes in the merge request and changes from other merge requests already on the train. **If the merge request is dropped from the train, the merged result is out of date and the pipeline can't be retried.**

**注意这条的一般化含义：凡是基于"某个合成结果"跑出来的验证，一旦合成输入变了，该验证就必须作废而不能重试。** 对定时对齐模块同样成立。

**(e) "rebase 后要不要重验"——GitLab 官方给了明确答案，而且这个答案对设计极其重要。** **automatic rebase before merge 明确不重跑 CI**（官方逐字："Does not re-run CI/CD pipelines on the rebased result."），**官方因此推荐改用 merge trains 来验证 rebase 后的结果**。【子代理实抓】**这是"rebase 后是否重验"的一手决策依据。**

**自动 vs 门控。** 入列后由服务端自动执行；门槛是 **merge checks 全集**（审批、流水线、未解决线程、非草案、外部状态检查、安全策略、标题正则、merge-after 日期等）。另有三级强制（官方逐字）：`Allow bypass`（默认）/ `Enforce for all users` / `Enforce with Owner override`。

**一个对自动化工具的直接约束（官方逐字，很重要）：**

> If merge train enforcement is enabled, any tool that calls the merge requests API without `auto_merge=true` receives a `405 Method Not Allowed` response. **This includes scripts, CI/CD jobs, and bots.**

**调度实现（跨重启的答案：数据库行 + Sidekiq + 租约 + cron 兜底）。**

- **持久状态在 `merge_trains` 表**（模型注释逐字说明历史原因）：
  ```ruby
  # For legacy reasons, each row is a merge train in the database
  self.table_name = 'merge_trains'
  ACTIVE_STATUSES = %w[idle stale fresh].freeze
  COMPLETE_STATUSES = %w[merged merging skip_merged].freeze
  REFRESHABLE_STATUSES = (ACTIVE_STATUSES + %w[merging]).freeze
  STUCK_AFTER = RefreshService::LEASE_TIMEOUT + 5.minutes
  ```
- **6 状态机**（`state_machine :status, initial: :idle`）：`idle(0) / merged(1) / stale(2) / fresh(3) / merging(4) / skip_merged(5)`，与 API 返回值一一对应。
- **并发保护是双层的**（源码注释逐字）：
  ```ruby
  # NOTE: To prevent concurrent refreshes, two locking mechanisms are in place:
  # 1. `MergeTrains::RefreshWorker` deduplicates via `deduplicate :until_executed, if_deduplicated: :reschedule_once`
  # 2. This service holds an `ExclusiveLeaseGuard` (scoped to project + branch) and renews it per car,
  #    guarding against cases where a refresh outlives the worker's 10-minute deduplication TTL.
  ```
  租约 key `"merge_trains:refresh:#{project_id}:#{target_branch}"`，`LEASE_TIMEOUT = 10.minutes`；worker 侧 `sidekiq_options retry: 3`。
- **cron 兜底 worker（这是"定时器作为安全网"的最佳范例）**：`MergeTrains::UnstickStuckMergesCronWorker` 的 `perform` 用一把 30 分钟的租约（`LEASE_TTL = 30.minutes`）包住 `MergeTrains::Car.stuck_cars.each_batch`，对每辆卡住的车**重新 enqueue 一个 `RefreshWorker`**，并用 `Set` 去重 `[target_project_id, target_branch]`。**即：主线是事件驱动，定时器只负责把"卡死超过租约期"的记录捞回来重试。**

**已知失败模式（官方文档化）。** 上引"失败 pipeline 不能重试"、"redundant pipelines 自动取消"、"API 不带 `auto_merge=true` 会 405"；以及顶层 race：**"The source branch was updated." 也会让 MR 被丢弃**——即**外部改分支 = 丢队列**，这对"别的东西也在动这个分支"的场景是直接冲突。

**引用**
- https://docs.gitlab.com/ci/pipelines/merge_trains/ 【子代理实抓，官方 Markdown 源】
- https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/user/project/merge_requests/methods/_index.md 【子代理实抓；主 agent 复核 HTTP 200】
- https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/user/project/merge_requests/conflicts.md 【子代理实抓；主 agent 复核 HTTP 200】
- https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/merge_trains.md 【子代理实抓；主 agent 复核 HTTP 200】
- https://docs.gitlab.com/user/project/merge_requests/conflicts/ 【主 agent 复核 HTTP 200，渲染版】
- **URL 形式更正**：GitLab 文档的 **`https://docs.gitlab.com/<path>.md` 形式返回 403**（不是公开的 Markdown 源入口）；**真正的 Markdown 源在 `gitlab.com/gitlab-org/gitlab/-/raw/master/doc/…`**，渲染版在 `docs.gitlab.com/<path>/`。本文已按此更正。
- `gitlab-org/gitlab` 源码：`ee/app/models/merge_trains/car.rb`、`ee/app/workers/merge_trains/refresh_worker.rb`、`ee/app/workers/merge_trains/unstick_stuck_merges_cron_worker.rb`、`ee/app/services/merge_trains/refresh_service.rb`、`ee/app/services/merge_trains/refresh_merge_request_service.rb` 【子代理实抓】
- **未能访问**：`https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/merge_trains/` → **404**，GitLab handbook 仓库同路径亦 404，search API 需认证。**未获得 merge trains 的官方架构设计文档。**

---

## 3. Bors-ng 与 homu："先测合并结果"

这两个是"**先构造合并结果、测试它、再落地**"范式的原始实现。它们的价值在于**实现完全公开**，因此"状态机怎么设计、崩溃后怎么恢复"都能读到源码。

### 3.1 bors-ng

**对齐双方。** 一条 **staging 分支** vs **base + 一批（batch）PR 的合并结果**。人用 `bors r+` 把 PR 放进去，bors 把 PR 逐个合进 staging，CI 绿了再 fast-forward 到 master。

**触发——这里有一个真实的、可配置的周期。** 主 agent **亲自复核**了 `bors-ng/bors-ng` 的 `config/config.exs`：

```elixir
poll_period: {:system, :integer, "BORS_POLL_PERIOD", 1_800_000}
```

**即默认 1 800 000 ms = 30 分钟的全局轮询兜底**（可用环境变量 `BORS_POLL_PERIOD` 覆盖）。`lib/worker/batcher.ex` 里的用法：

```elixir
trunc(Confex.fetch_env!(:bors, :poll_period) * :rand.uniform(2) * 0.5)   # 首次：把轮询时间随机打散（抖动防惊群）
Process.send_after(self(), {:poll, repetition}, Confex.fetch_env!(:bors, :poll_period))
```

**注意第 84 行的随机化**：首次轮询时间被乘上 `rand.uniform(2) * 0.5`（即 0–1 倍随机），**这是为了避免所有 project 的 batcher 在同一刻同时打 GitHub**。对"每个工作区一个定时器"的场景，**这是必须抄的一条**：N 个工作区的定时器必须抖动，否则会形成周期性尖峰。

另外 `@prerun_poll_period 1 * 60 * 1000`（60 秒，用于"运行前的自旋等待"），以及 `poll_at = (project.batch_delay_sec + 1) * 1000`。

其余时间参数（`batch_delay_sec` 凑批等待 10 秒、`batch_poll_period_sec` 运行态轮询 1800 秒、`batch_timeout_sec` 超时 7200 秒）为**每 project 的数据库字段**，【子代理实抓】自 `bors.toml`/文档与源码引用点（`lib/database/batch.ex:163,165` 读用它们）。**主 agent 未逐条复核这三个默认值**，仅复核了全局 `poll_period`。【实抓：`poll_period`】

**算法。** 把每个 PR 依次合入 staging（`GitHub.merge_branch!`），逐级构造合并结果，然后 fast-forward 落地。官方 README 解释了为什么要 batch：

> The one-at-a-time strategy is O(N), where N is the total number of pull requests. **The batching strategy is O(E log N)**, where N is again the total number of pull requests and **E is the number of pull requests that fail**.

**即：批量的收益正比于"失败率低"。** 对定时对齐模块的含义：**批量只有在大多数情况下能成功时才划算**；一个高冲突率的仓库里批量反而更糟。

**冲突路径——本文认为最该抄的一条在这里。**

**(a) 冲突在 `do_merge_patch` 里被检测，并且与"竞态"明确区分：**

```elixir
do_merge_patch = fn %{patch: patch}, branch ->
  pr = GitHub.get_pr!(repo_conn, patch.pr_xref)
  case branch do
    :conflict -> :conflict
    :canceled -> :canceled
    :race -> :race
    _ when pr.head_sha != patch.commit -> :race     # 头动了 = 竞态，不是冲突
    ...
```

**【事实】把"分支被人动过"判成 `:race` 而不是 `:conflict`，是一个值得照搬的分类**：两种情况的正确响应完全不同。

**(b) `:conflict` 被显式折叠成 `:error`，即冲突必须映射到终止状态**（`lib/database/batch_state.ex` 逐字）：

```elixir
def cast(state) when is_atom(state) do
  case state do
    :waiting -> {:ok, :waiting}
    :running -> {:ok, :running}
    :ok -> {:ok, :ok}
    :error -> {:ok, :error}
    :conflict -> {:ok, :error}      # ← 冲突不单独成一态
    :canceled -> {:ok, :canceled}
    _ -> :error
  end
end
```

**为什么必须这样——源码之外的证据是一条 issue。** bors-ng issue **#61**「Merge conflicts do not mark the batch as "canceled"」的正文**逐字全文只有一句**：

> This puts bors in an infinite loop. Fix it!

**【事实】冲突若不被映射到终止状态，就会导致无限循环。** 这是本调研里**最有价值的一条失败教训**：一个周期性对齐器如果对"冲突"没有终止语义，它每周期都会重试、每周期都失败、永远不停。

**(c) 冲突时把批次拆开重试，并给人发消息**（`lib/worker/batcher.ex` 逐字）：

```elixir
defp start_waiting_merged_batch(batch, patch_links, _base, :conflict) do
  project = batch.project
  repo_conn = get_repo_conn(project)
  patches = Enum.map(patch_links, & &1.patch)
  state = Divider.split_batch_with_conflicts(patch_links, batch)
  poll_after_delay(project)
  send_message(repo_conn, patches, {:conflict, state})
```

**即：冲突 → 拆批（`Divider.split_batch_with_conflicts`）→ 通知 → 重新排队**，而不是整体失败。

**自动 vs 门控。** 合并本身**全自动**（无人）；门槛是 `bors.toml` 的 `required_approvals`、`block_labels`、`use_codeowners`、`up_to_date_approvals`，以及 CI 门槛 `status` / `pr_status`（逐字："List of commit statuses that must pass on the merge commit before it is pushed to master."）。人工重试入口是 `bors retry`（"Run the previous command a second time."）。

**调度实现（跨重启的答案）。**
- 每个 project 一个 `Batcher` GenServer，由 `Batcher.Supervisor`（`DynamicSupervisor`）托管；一个全局 `Batcher.Registry` GenServer 负责启动/重启/记录崩溃。
- **调度状态全部在 PostgreSQL（Ecto）**；`Batcher.Registry.init/1` **在启动时为所有 active project 重新拉起 batcher**（逐字）：
  ```elixir
  def init(:ok) do
    Project.active() |> Repo.all() |> Enum.map(fn %{id: id} -> id end)
    |> Enum.uniq() |> Enum.map(&{&1, do_start(&1)})
    {:ok, {Map.new(), Map.new()}}
  end
  ```
  **即：进程内的 GenServer 只是无状态工作循环，重启后从数据库重建。**
- 数据库表（从 `lib/database/` 文件名可读）：`batch`、`attempt`、`status`、`patch`、`project`、`crash`、`log`、`installation`、`link_patch_batch`、`user_patch_delegation`、`project_permission`。

**已知失败模式（issue tracker 一手实抓）。** open issue 总数 **168**。与"卡死/冲突"直接相关的：

| Issue | 标题 | 状态 |
| --- | --- | --- |
| [#61](https://github.com/bors-ng/bors-ng/issues/61) | Merge conflicts do not mark the batch as "canceled" | closed |
| [#48](https://github.com/bors-ng/bors-ng/issues/48) | Instance stuck on running after crash | closed |
| [#220](https://github.com/bors-ng/bors-ng/issues/220) | PR is stuck in running state | closed |
| [#1239](https://github.com/bors-ng/bors-ng/issues/1239) | bors gets stuck after a db crash | **open** |
| [#882](https://github.com/bors-ng/bors-ng/issues/882) | No comments for batches with merge conflicts | — |
| [#378](https://github.com/bors-ng/bors-ng/issues/378) | bors use of "Merge conflict" message is misleading | — |

**#48 正文逐字**（崩溃后卡死）：

> After the previous crash, one PR is stuck on 'running' even though it has already successfully completed. Is there a way to trigger bors-ng to look at this again?

**#1239 正文逐字**（**至今 open**，数据库抖动 → worker 崩溃）：

> After `bors merge`ing on a PR, occasionally, I run into the following error: `%DBConnection.ConnectionError{message: "ssl recv: closed"}, ... {BorsNG.Worker.Batcher, :do_handle_cast, 2, ...}`

**#378 这条尤其值得记：连"Merge conflict 这条消息具有误导性"都被单独立了 issue。** 再次印证 Gerrit 那条结论：**失败路径的可解释性是设计指标。**

**引用**
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/config/config.exs 【实抓，`poll_period` 默认值】
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/lib/worker/batcher.ex 【实抓，轮询与冲突分支】
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/lib/database/batch_state.ex 【子代理实抓】
- https://github.com/bors-ng/bors-ng/issues/61、`/48`、`/1239`、`/378` 【子代理实抓，正文逐字】
- **未能访问**：`bors.tech` 的 TMIB 76 与 RFCs 页面均 **404**。

### 3.2 homu（bors 的前身，Mozilla 系）

**对齐双方。** PR head vs base（在本地 `homu-tmp` 目录里构造合并结果）。

**触发。** **没有周期性定时器——这是本节最值得注意的一点。** homu 刻意采用 **webhook 优先**（为规避 GitHub 的 API 限流），**完全不做定时轮询**。

**算法。** 两种：**rebase（线性历史）** 或 **merge `--no-ff`**，可选 autosquash。

**冲突路径。** `status=error` + 发一条 `:lock: Merge conflict` 评论 + 打 `conflict` 标签——**"放弃 + 通知人 + 交还给人"，无自动解冲突**。冲突的 4 步动作精确到源码行。

**状态与跨重启。** SQLite（`main.db`），12 个 `LabelEvent` 组成的标签状态机。**重启时从数据库重建**，但**有一处会把 `pending` 重置为 `''`，且源码里留着一条 `FIXME`**——即**崩溃重启会丢失"正在处理的 commit"这一信息**。【子代理实抓】

**一个可照搬的机制：用"结果标识"而不是"时间戳"来作废陈旧结果。** homu 用 **`merge_sha`** 作为 key 判断一个 CI 结果是否还属于当前候选。**任何"先构造结果、再去验证"的系统都必须这样做**——否则一个旧结果的回报会被误当成新结果的验证。

**引用**
- `mozilla/homu`：`main.py`（1590 行）与 7 个源文件、README、`cfg.sample.toml` 【子代理实抓】

---

## 4. Gerrit：submit 时 rebase

**对齐双方。** 一条 change 的**当前 patch set** vs **目标分支的当前 head**。

**触发。** **人按 Submit**。没有周期成分。

**算法——真实配置名是 `submit.action`，不是 `rebaseOnSubmit`。**

> **任务书里要求查的 `gerrit.rebaseOnSubmit` 查无此配置。** 子代理抓取 Gerrit 文档索引 `index.html`、枚举出全部 57 个文档页面并逐个下载后 `grep -i rebaseOnSubmit`，**零命中**；`config-gerrit.html` 里 "rebase" 只出现 3 处且都与提交对齐无关。主 agent 另行抓取 `config-project-config.html` 复核，`rebaseOnSubmit` **0 命中**【实抓】。**请勿在正式设计里引用这个配置名。**

`submit.action` 的取值（官方逐字定义，【实抓】）：

| 取值 | 语义（官方原文要点） |
| --- | --- |
| `'merge if necessary'`（**默认**） | 能 fast-forward 就 ff，否则**自动建 merge commit**；等同 `git merge --ff` |
| `'merge always'` | 总是建 merge commit，即使能 ff；等同 `git merge --no-ff` |
| `'rebase if necessary'` | 能 ff 就 ff，否则**自动 rebase** 到目标分支 head 上再 ff；被评审过的原 commit 不进入目标分支历史（线性历史） |
| `'rebase always'` | 总是 rebase，即使能 ff |
| `'fast forward only'`（官方**generally not recommended**） | 只有能 ff 才可提交 |
| `'cherry pick'`（官方**not recommended，use rebase always instead**） | 总是 cherry-pick，**忽略 change 依赖** |
| `Inherit` | 继承父项目配置；新项目默认 `Inherit`，而 `All-Projects` 根项目上的 `Inherit` 等价于 `merge if necessary` |

官方原文（`submit.action`）："If `submit.action` is not set, the default is `'merge if necessary'`."

**冲突路径——这是 Gerrit 最有借鉴价值的一点：它在动作发生前就拒绝。** 官方原文（【实抓】）：

> If content merges are disabled, the submit button in the Gerrit web UI is disabled, if any path conflict would occur on submitting the change. Users then need to rebase the change manually to resolve the path conflict.

> If Gerrit performs a merge, rebase or cherry-pick as part of the change submission (true for all submit actions, except for `fast forward only`), it can be that trying to submit a change would fail due to Git conflicts (if the same lines were modified concurrently, or if `mergeContent` is disabled also if the same files were modified concurrently). In this case the submit button in the Gerrit web UI is disabled…

**即：Gerrit 不"先做，坏了再说"，而是把 Submit 按钮直接禁用，让人去 rebase。** 相关旋钮还有 `submit.rejectEmptyCommit`：rebase/cherry-pick 后变空的提交会让合入失败。

**一条被官方自己承认的反面教训（【实抓】）**：Gerrit 官方**强烈不建议**关闭 content merge，理由是**失败路径会让人困惑**——提交被拒，但手动 rebase 却看不到冲突。**"失败路径的可解释性"是设计指标，不只是正确性问题。**

**自动 vs 门控。** `Submit` 权限 + `Rebase` 权限（`access-control.html`，【子代理实抓】）。合并动作由人触发，但**变基是服务端自动做的**。

**调度实现。** 无周期性。服务端在 submit 时同步集成。持久化机制（NoteDb 等）**未核实**。

**已知失败模式（官方文档化）。** `fast forward only` 被官方标注"usage generally not recommended"，理由是会让已通过评审/验证的 patch set 频繁失效，造成"an unreasonable amount of overhead"；关闭 content merge 会让失败路径不可解释（上引）。

**引用**
- https://gerrit-review.googlesource.com/Documentation/config-project-config.html 【实抓，主 agent 复核 `rebaseOnSubmit` 零命中 + 全部 submit action 定义】
- https://gerrit-review.googlesource.com/Documentation/access-control.html 【子代理实抓】
- https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html 【子代理实抓，`/rebase`、`/rebase:chain`】
- 说明：任务书推荐的 `.../Documentation/config-repo.html` 本次 **404**（页面已改名为 `config-project-config.html`）【实抓】

---

## 5. Renovate：`rebaseWhen`——本功能最直接的同类物

**为什么单列。** Renovate 是"**周期性运行 + 判断是否落后 + 决定要不要 rebase 已有 PR**"的工业化实现，与本特性的形状几乎同构。它的配置项答案在官方配置参考里是逐字可查的。【实抓】

**对齐双方。** Renovate 自己开的 PR 分支 vs 它的 base 分支（默认 `behind-base-branch` 的判定就是"落后 ≥1 个 commit"）。

**触发。** **两段式，这是关键设计：定时器只负责"跑一次"，"要不要动"由陈旧条件决定。** Renovate 按 `schedule`（cron 语法）周期性运行；在一次运行里，是否 rebase 由 `rebaseWhen` 决定。

`rebaseWhen` 官方原文（逐字，【实抓】）：

> Controls when Renovate rebases an existing branch.
> - **type** `string`
> - **allowedValues** `[ "auto" , "never" , "conflicted" , "behind-base-branch" , "automerging" ]`
> - **default** `"auto"`
> - **cli** `--rebase-when`
> - **env** `RENOVATE_REBASE_WHEN`

> Possible values and meanings:
> - **auto**: Renovate will autodetect the best setting. It will use `behind-base-branch` if configured to automerge or repository has been set to require PRs to be up to date. Otherwise, `conflicted` will be used instead. **On GitHub, if the base branch has a merge queue, `conflicted` is used because the merge queue already tests PRs against the head of the base branch. The same applies on GitLab if merge trains are enabled on the project**
> - **automerging**: Renovate will use `behind-base-branch` if configured to automerge, Otherwise, `never` will be used instead
> - **never**: Renovate will never rebase the branch or update it unless manually requested
> - **conflicted**: Renovate will rebase only if the branch is conflicted
> - **behind-base-branch**: Renovate will rebase whenever the branch falls **1 or more commit** behind its base branch

**这段是本文最有价值的单条证据**：一个成熟产品明确把"**有没有别的东西在替你测合并结果**"作为**是否自动对齐**的判据——有 merge queue / merge trains 时就退化成 `conflicted`，因为"别人已经在测 head 了"。**自动对齐不是越勤越好，而是与下游验证机制互补。**

**算法。** rebase（内部走分支重建/force-push 路径；官方另有 `recreateWhen` 控制"重建 PR"而非 rebase）。**默认值 `auto` 的自动判定**会把"锁文件维护 / package groups / pinning"这类强制 `recreateWhen=always`。

**冲突路径（官方自己写明的权衡，逐字，【实抓】）：**

> `rebaseWhen=conflicted` is not recommended if you have enabled Renovate automerge, because:
> - It could result in a broken base branch if two updates are merged one after another without testing the new versions together
> - If you have enforced that PRs must be up-to-date before merging (e.g. using branch protection on GitHub), then automerge won't be possible as soon as a PR gets out-of-date but remains non-conflicted
>
> It is also recommended to avoid `rebaseWhen=never` as it can result in conflicted branches with outdated PR descriptions and/or status checks.

**Renovate 不自己解冲突**——`conflicted` 分支会被 rebase 掉冲突，但 rebase 失败时它不会替你写代码；`never` 会把冲突留给下一次重建。

**人工介入的第三个档位（逐字，【实抓】）——`rebaseLabel` 与 `keepUpdatedLabel`：**

> `rebaseLabel`：Label to request a rebase from Renovate. … default `"rebase"`

> `keepUpdatedLabel`：If set, users can add this label to PRs to request they be kept updated with the base branch. … On supported platforms you may add a label to a PR so that Renovate recreates/rebases the PR when the branch falls behind the base branch. **Adding the `keepUpdatedLabel` label to a PR makes Renovate behave as if `rebaseWhen` were set to `behind-base-branch`, but only for the given PR. Renovate does not remove the label from the PR after it finishes rebasing. This is different from the `rebaseLabel` option, where Renovate removes the label from the PR after rebasing.**

**即：全局保守（`never`/`conflicted`）+ 逐 PR 的"请持续跟进"开关。** 这个组合对我们非常可迁移（见末节）。

**自动 vs 门控。** rebase 是自动的；**automerging 才是门控点**。`automergeSchedule`（默认 `["at any time"]`）限制可自动合并的时间窗；官方警告（逐字）："When `platformAutomerge` is enabled, Renovate enqueues the platform PR automerge at time of creation, so the schedule specified in `automergeSchedule` cannot be followed."

**调度实现。** 外部调度器（CI cron / Mend 托管）触发一次 Renovate 运行；`schedule` / `timezone` 决定"何时允许跑"；`automergeSchedule` 决定"何时允许自动合并"。

**已知失败模式（官方文档化）。** 上引 `conflicted` + automerge 的两条；`never` 导致的陈旧描述/状态检查；`platformAutomerge` 让 `automergeSchedule` 失效；另有官方警告 "Avoid setting `rebaseWhen=never` and then also setting `prCreation=not-pending` as this can prevent creation of PRs."

**对本特性的直接启示（本文认为最值得抄的一条）。** 本功能应当采用**"定时器触发评估、陈旧度决定动作、按下游验证能力自适应"**的三段式，而不是"到点就 rebase"。见末节 (a)。

**引用**
- https://docs.renovatebot.com/configuration-options/#rebasewhen 【实抓】
- https://docs.renovatebot.com/configuration-options/#rebaselabel 【实抓】
- https://docs.renovatebot.com/configuration-options/#recreatewhen 【实抓】
- https://docs.renovatebot.com/configuration-options/#automergeschedule 【实抓】

---

## 6. Dependabot

**先更正一条任务书的前提。** 任务书假设"Dependabot 不会自动 rebase 有冲突的 PR"。**这与官方文档不符。** 官方逐字（`manage-dependabot-prs.md`）：

> By default, Dependabot automatically rebases pull requests to resolve any conflicts.

以及（`dependabot-options-reference.md`）：

> Dependabot checks for changes when: … A Dependabot pull request is in conflict after a recent push to the target branch.

**【子代理实抓】请以官方文档为准。**

**对齐双方。** 它自己开的 PR 分支 vs target branch。**只动 source branch**，不产生"合并结果引用"。

**触发。** `dependabot.yml` 的 `schedule.interval`（官方允许值逐字：`daily` / `weekly` / `monthly` / `quarterly` / `semiannually` / `yearly` / `cron`，其中 `cron` 支持 "Valid cron expression in cron syntax or natural expression"，例 `0 9 * * *`、`every day at 5pm`），外加 `time` / `timezone`（默认 UTC）。

**一个值得照搬的细节（逐字）：**

> By default, Dependabot **randomly assigns a time** to apply all the updates in the configuration file.

**即"给每个配置随机分配一个执行时刻"来天然打散负载**——与 §3.1 里 bors 的 `rand.uniform(2)` 抖动是同一目的，但这里是**分配固定时刻**而非每轮抖动。

**安全更新绕过 schedule**（逐字）：

> Dependabot security updates are **always triggered by a security advisory**, rather than running according to the `schedule` you have set in the `dependabot.yml` for version updates.

**首次启用与配置变更都会立即触发一次**（逐字）：

> Dependabot checks for outdated dependencies **as soon as it's enabled**. … Dependabot will also run an update on **subsequent changes to the configuration file**.

**算法。** **未公开**（闭源服务）。文档可确证的只有：rebase 是默认行为；**用的是 "rebase and force push"**。**具体是 `--force` 还是 `--force-with-lease`，官方未说明**【推断：不可知】。**注意 Renovate 侧有明确的一手依据说它用 `--force-with-lease`（见 §5），Dependabot 侧没有。**

**冲突路径——"自动 rebase → 超过阈值就停 → 交给人"。三条会**停止** rebase 的条件（全部官方逐字）：**

1. **PR 上被推了额外提交**：
   > By default, Dependabot **will stop rebasing a pull request once extra commits have been pushed to it.** To allow Dependabot to force push over commits added to its branches, include any of the following strings: `[dependabot skip]`, `[skip dependabot]`, `[dependabot-skip]`, or `[skip-dependabot]`, in either lower or uppercase, to the commit message.
2. **满 30 天**：
   > If a pull request has not been merged for 30 days, Dependabot **will stop rebasing** the pull request. You can still manually rebase and merge the pull request.
3. **`rebase-strategy: disabled`**：
   > When `rebase-strategy` is set to `disabled`, Dependabot stops rebasing pull requests.
   > Pull requests that were open **before** you disable rebasing will continue to be rebased until 30 days after they were opened.

**第 1 条是本文认为最精妙的一条设计**：**"一旦有人在这个分支上加了东西，就不再覆盖它"**——用一个**可被人类写入的信号（额外提交）**作为"停止自动改写"的开关，并且提供一个**显式的逃生字符串**让人能重新授权覆盖。**对"自动提交但 push 由人决定"的功能，这是极好的先例：把"人是否已介入"编码成机器可判定的证据。**

**还有一条仓库级熔断**：【子代理实抓】**仓库 90 天不活跃则整体自动暂停。**

**自动 vs 门控。** **Dependabot 本身不自动合并**——平台侧分支保护 + 人工点合并。人对 PR 的控制靠评论命令（官方表格逐字）：

| Command | Description |
| --- | --- |
| `@dependabot rebase` | "Rebases the pull request." |
| `@dependabot recreate` | "Recreates the pull request, overwriting any edits that have been made to the pull request." |

**调度实现。** **GitHub 服务端托管。仓库侧只有 `dependabot.yml` 声明，没有任何状态机。** 官方文档**完全没有描述**其表名/队列/worker/重试语义。【子代理实抓，明确标注"未公开"】

**引用**
- https://docs.github.com/en/code-security/dependabot/working-with-dependabot/managing-pull-requests-for-dependency-updates 【子代理实抓】
- https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file 【子代理实抓（301 → `reference/supply-chain-security/dependabot-options-reference`）】
- https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands 【主 agent 复核 HTTP 200（原 `working-with-dependabot/dependabot-pull-request-comment-commands` 已 **404**）】
- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-pull-requests 【主 agent 复核 HTTP 200，`dependabot-pull-requests.md` 的现址】
- **URL 迁移记录**：`.../working-with-dependabot/dependabot-pull-requests`、`.../troubleshooting-dependabot`、`.../about-dependabot-on-github-actions`、`.../dependabot-pull-request-comment-commands` 本次**均 404**，已迁移到 `concepts/supply-chain-security/` 与 `reference/supply-chain-security/` 下。
- **未能核实**：Dependabot 的历史事故/incident report；其调度实现细节；其 git 层实现；`rebase-strategy` 的显式允许值字面量列表（文档只给了 `disabled` 的语义）。

---

## 7. 其他合并队列 / 自动对齐产品：Kodiak、Mergify、Graphite、Zuul

这一组是"平台原生 merge queue 之外的第三方 merge queue"。**四家在"冲突怎么处理"上是同构的，在"状态怎么存活"上差异最大。**

**先更正四条被证伪的任务书前提（提请注意，勿在正式设计里引用）：**

| 任务书里的说法 | 事实 | 否证方式 |
| --- | --- | --- |
| Kodiak 有 `update_branch: off\|merge\|rebase\|worth` | **不存在**。真实键是 `update.always` / `update.require_automerge_label` / `update.autoupdate_label` / `merge.optimistic_updates`，以及已废弃的 `update_branch_immediately`(bool) | 当前 master 的 `bot/kodiak/config.py`、工作树 grep、**629 个可达提交逐 blob + `git cat-file --batch-all-objects` 全对象扫描（`worth` 0 命中）**、线上 config-reference |
| Kodiak 有 `reconcile` / schedule 机制 | **没有**，全仓库 0 命中。纯 webhook 驱动 | 同上 |
| Kodiak 有 `merge_title_format` | 实为 `merge.message.title`（`github_default` / `pull_request_title`） | 同上 |
| Zuul 有 `doMerge` / `doRebase` 选项；有 `zuul.sql`；"gate reset" 是官方术语 | 都没有。真实是**项目级** `merge-mode`，权威表是 `model.py` 的 `MERGER_MAP`；schema 由 SQLAlchemy 自动建表（`find -name "*.sql"` 0 命中）；"gate reset" 只出现在两处源码注释里 | 浅克隆 `opendev.org/zuul/zuul` 后全仓检索 |

同理：**Mergify 的 `strict` 已于 2022-01-12 移除**，`require_conditions` 全文档 0 命中；**Graphite 的 `gt repo sync` 命令不存在**。【子代理实抓】

### 7.1 对齐双方

| 产品 | 对齐双方 | 是否物化"合并结果" |
| --- | --- | --- |
| **Kodiak** | PR head vs base；更新动作 = GitHub REST `PUT /repos/{o}/{r}/pulls/{n}/update-branch`（**等于 UI 的 Update branch，merge base into head，从不 rebase、从不 force-push**） | 否（交给平台原生 merge queue） |
| **Mergify** | PR vs base + **队列中前序 PR**；有 batch 概念 | 是（服务端有 queue branch） |
| **Graphite** | stack 内每层 vs 其父 + trunk；CLI 靠 git 自己的 rebase 状态目录 | 否（CLI 侧） |
| **Zuul** | change vs 其依赖链 + 同队列其他 change，在 merger 里构造合并结果 | 是（merger 真正构造并在其上跑 job） |

### 7.2 关键：**"落后 N 个 commit"这个 N 在不同产品里根本不是同一回事**

| 产品 | N 从哪来 |
| --- | --- |
| Kodiak | **N 不存在**——完全委托 GitHub 的 `mergeStateStatus == BEHIND`（二值） |
| Mergify | N 是**用户写在条件里的任意整数**，官方示例 `#commits-behind > 5`——**无硬编码阈值** |

**【事实】即：成熟产品把"落后多少算需要对齐"做成了配置/委托，而不是内置常量。** 这与 DSH 的「No hardcoded tunables in plugins」约定一致。

### 7.3 冲突路径——**四家同构：放弃 + 通知 + 交还给人，没有一家自动解冲突**

| 产品 | 冲突时具体动作 |
| --- | --- |
| **Kodiak** | 摘掉**全部** automerge label + 发一条逐字评论模板；不做任何自动解决 |
| **Zuul** | 回 "Merge failed." 并出队，走 `merge-conflict` reporter；**冲突时不跑任何 job** |
| **Mergify** | **区分两种冲突**（见下） |
| **Aviator** | 转入 Blocked 状态并写进 sticky comment |
| **Trunk** | **Pending Failure**：等前序结果出来以定位真凶，只踢最前面那一个 |

**Mergify 的两分法值得单独记（本文认为是对"冲突"建模最细的一条）：**
- **与队内前序 PR 冲突** → **保持排队位、defer、不摘 `queued_label`**，等前序结果出来再说。
- **与 base 冲突** → **立即出队**。
- 并且**把出队原因（dequeue reason）暴露出来**。

**这与 bors-ng 把 `:race` 与 `:conflict` 分开是同一种洞察：不是所有"合不进去"都是同一件事，混为一谈会导致错误的响应。**

**Zuul 的冲突语义还有一条硬事实**：**冲突时不跑任何 job**（因为合并结果根本构造不出来）——即**"验证"这一步在冲突面前是无需尝试的，直接判定为不可验证**。对定时对齐模块：**冲突应当短路掉后续的验证与提交，而不是浪费一轮预算去尝试。**

### 7.4 一个"无人值守下批处理失败定位"的完整算法

**Mergify 的 batch 二分法**（`batches.md` 逐字，含 6-PR 的具体例子）与 **Trunk 的 Pending Failure** 是两套很完整的"批量失败后怎么找出是谁的错"的算法，**值得在设计"一次对齐多个目标、部分失败"时直接参考**。【子代理实抓】

### 7.5 调度实现与跨重启——四家差异最大的一维

| 产品 | 调度状态存哪 | 跨重启 |
| --- | --- | --- |
| **Zuul** | **`ChangeQueue` 是 `ZKObject`，`serialize()` 把当前 `window` 值写进 ZooKeeper** | **显式持久化且文档化**（本文所见唯一一家把"自适应限流的当前窗口值"当状态存下来的） |
| **Kodiak** | Redis 有序集合 + `kodiak_merge_queue_names:v2` 集合（**队列名里编码 installation/repo/target**），启动时据此重建 worker | 队列可重建，但**进程内轮询状态会丢** |
| **Graphite** | 只靠 git 自己的 rebase 状态目录 | 随 git |
| **Mergify** | 服务端，**未公开** | 未公开 |

**Zuul 的 merger `working_root` 反而是可重建缓存**：scheme 不匹配就 `shutil.rmtree` 重 clone。**【事实】即"工作目录是缓存，状态在 ZooKeeper"——这是把可重建的东西与权威状态分开的清晰分界。** 对照 DSH 的 `dsh-schedule`（"Session log owns the state；timers 是可丢弃的投影"）是同一原则。

**Zuul 的自适应限流（值得抄的具体数字）。** 文档权威默认值（**注意别与源码构造器默认混用**）：`window`=**20**、`window-floor`=**3**、`window-ceiling`=无上限、`window-increase-type`=**linear**、`window-increase-factor`=**1**、`window-decrease-type`=**exponential**、`window-decrease-factor`=**2**；而 `model.py` 的 `ChangeQueue.__init__` 构造默认是 `window=0, window_floor=1`（=不限流），文档默认由 configloader 灌入。**即"成功就线性加一，失败就指数减半"**。

**Zuul 的连续失败熔断**：`disable-after-consecutive-failures`（**默认关闭**）——**唯一一家把它做成一等配置的产品。**

**Kodiak 的一条失败模式值得记**：遇到 GitHub 500 时它**给自己贴 `kodiak:disabled` 标签然后停手等人**（issue #397 的教训：单纯重试 500 会导致同一个 PR 被重复合并）。**即"遇到平台级错误时，正确的动作是把整个自动化关掉，而不是重试"**——对无人值守的定时器，这条尤其重要。

### 7.6 引用

- `chdsbd/kodiak` 源码（HEAD `2c23f609`，629 提交）：`bot/kodiak/config.py`、`evaluation.py`、`queue.py`、`pull_request.py`、`queries/__init__.py`、`refresh_pull_requests.py`、`entrypoints/*`；线上 `kodiakhq.com/docs/config-reference`；`docs/docs/troubleshooting.md`；issue #150/#361/#397/#586 【子代理实抓】
- Mergify 官方文档 25 页（`lifecycle` / `batches` / `rules` / `merge-strategies` / `priority` / `file-format` / `conditions` / `data-types` / `actions` + 3 条 changelog），文档站支持 URL 追加 `.md` 取 Markdown 源 【子代理实抓】
- Graphite 官方文档 14 页（`graphite.dev/docs` 301 → `graphite.com/docs`，Mintlify，同样支持 `.md`），含 `command-reference` 【子代理实抓】
- `opendev.org/zuul/zuul`（HEAD `609043ea`）：`zuul/model.py`、`merger/merger.py`、`merger/server.py`、`executor/server.py`、`manager/__init__.py`、`doc/source/config/pipeline.rst`、`config/project.rst`、`gating.rst`、`components.rst`、`configuration.rst` 【子代理实抓】
- Aviator / Trunk 官方 docs 的 `.md` 源 【子代理实抓】
- **未能核实**：Mergify / Graphite / Aviator / Trunk 的**服务端状态存储实现**（schema、跨重启恢复）官方均未公开——只能证实"有服务端状态 + REST API"；Mergify 清理孤儿 queue branch 的**具体周期**未给数值；Zuul 因仓库过大无法 `--unshallow`，**只有 HEAD 浅克隆**，故"历史版本是否有过 `zuul.sql`"无法确认；Graphite"CLI 无后台自动 sync"属**"未找到反例"式结论**，非官方明确声明。

---

## 8. `gh stack sync`

**对齐双方。** 整条 stack 的**每个分支 vs 各自的父分支**，以及 **trunk vs remote trunk**。【实抓】

**触发。** **人手一条命令。** 官方文档没有定时器。（但官方明确讨论了"在自动化里跑"的语义，见下。）

**算法——官方文档化的 8 步编号序列（逐字，【实抓】）。** 注意这是**官方编号列表**，可直接引用：

> 1. **Fetch.** Fetches the latest changes from `origin`.
> 2. **Reconcile the remote stack.** Mirrors the stack on GitHub locally. When pull requests have been added to the stack on GitHub, so that the remote is ahead of your local stack, their branches are pulled down and appended to your local stack automatically. When the local and remote stacks have genuinely diverged, for example because you added a branch locally while different pull requests were added to the stack on GitHub, you are prompted to resolve the difference. See [Diverged stacks](#diverged-stacks). In a non-interactive terminal, a divergence aborts the sync, and nothing is pushed or updated.
> 3. **Fast-forward trunk.** Fast-forwards the trunk branch to match the remote. This step is skipped if the branches have diverged.
> 4. **Cascade rebase.** Rebases all stack branches onto their updated parents, but only if trunk moved. If a conflict is detected, all branches are restored to their original state, and you are advised to run `gh stack rebase` to resolve conflicts interactively.
> 5. **Push.** Pushes all branches, using `--force-with-lease` if a rebase occurred.
> 6. **Sync pull requests.** Syncs pull request state from GitHub and reports the status of each pull request.
> 7. **Sync the stack.** Links the stack's open pull requests into a stack on GitHub… Sync never opens pull requests. Use `gh stack submit` for that.
> 8. **Prune.** In interactive terminals, prompts you to delete local branches for merged pull requests. Use `--prune` to prune automatically.

**子分支（child branches）被做了什么。** 第 4 步：**整栈 cascade rebase 到更新后的父分支上（只在 trunk 移动时才做）**，逐层向上。

**冲突路径——"绝不停在半途"哲学的代表（逐字，【实抓】）：**

> If a conflict is detected, all branches are restored to their original state, and you are advised to run `gh stack rebase` to resolve conflicts interactively.

即：`sync` **原子回滚整条栈**，把解冲突这件事交给一个**独立的、交互式的**命令 `gh stack rebase`。`gh stack rebase` 则是"停下来等人"：官方原文——"If a rebase conflict occurs, the operation pauses and prints the conflicted files with line numbers. Resolve the conflicts, stage them with `git add`, then continue with `--continue`. To undo the entire rebase, use `--abort`…"

**这是本文认为最重要的一个设计对照：同一个工具，把"无人值守的 sync"和"有人值守的 rebase"做成了两个命令，失败语义完全不同。**

**自动 vs 门控。** 推送在 sync 里是**自动的**（第 5 步），但用 `--force-with-lease` 保护；【子代理实抓】进一步读到源码里的构造是 `--force-with-lease=<ref>:<sha>` **加 `--atomic`**。

**调度实现——官方对"自动化"的明确表态（逐字，【实抓】）：**

> A clean remote-ahead update, where pull requests are added on top of your local stack, is pulled down automatically without prompting, so **`sync` is safe to run in automation**. Sync only prompts when the stacks have truly diverged.

**这条是本功能可以直接引用的一手依据：`gh stack sync` 自己声明它适合被外部调度器调用。** 但它**自己不提供定时器**。

**已知失败模式（官方文档化 + 子代理读源码）。**
1. **退出码 0 ≠ 成功。** 非交互式终端遇到栈分叉时：官方原文"In a non-interactive terminal, a divergence aborts the sync, **exiting successfully**, without pushing branches or updating pull requests."【实抓】——**"退出成功"但什么也没做**，无人值守时必须额外判断"到底动没动"。这是本特性最该抄的失败模式。
2. 官方 troubleshooting 另列了 11 条失败模式与一张**完整退出码表（1–10）**——【子代理实抓】依据 `github/gh-stack` 源码与官方 troubleshooting 文档。**为"无人值守也要能判断发生了什么"专门设计退出码**，这个做法值得直接借鉴。
3. 并发：排他文件锁（5s 超时 → exit 8）+ checksum 检测并发写。【子代理实抓】

**持久状态。** `.git/gh-stack`、`.git/gh-stack.lock`、`.git/gh-stack-rebase-state`——**状态在仓库内、`.git` 下**。【子代理实抓】

**对本特性的启示。** （1）"无人值守的 sync 必须原子、可判定"；（2）把"解冲突"拆成一个独立的、需要人的命令，而不要让定时器去做；（3）**不要用退出码 0 表示成功**。

**引用**
- https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands 【实抓，8 步序列原文】
- https://docs.github.com/en/pull-requests/get-started/about-stacked-prs 【实抓】
- `github/gh-stack` 源码（`cmd/sync.go` 等）与官方 troubleshooting 文档 【子代理实抓】
- **重要更正**：`gh stack` **不在 `cli/cli` 里**，它是独立扩展 `github/gh-stack`。任务书给的 `https://cli.github.com/manual/gh_stack_sync`、`.../gh_stack`、`.../pkg/cmd/stack/sync/sync.go` **全部 404**（子代理下载了 `cli/cli` trunk 全量 tarball 确认其 `pkg/cmd/` 下无 `stack` 目录）。**请勿引用 CLI manual URL。**

---

## 9. git-town（`git town sync`）

**对齐双方。** **当前分支 vs 其父分支 + 其 tracking 分支**，并且**递归处理祖先链**。

**触发。** **人手一条命令。** 官方的 `auto-sync` 语义是"跑别的命令时顺带同步"，**不是定时器**。【子代理实抓】

**算法（默认 merge 策略）。** 官方旧版 manual 的"逐条编号步骤"页面已迁站（`git-town.com/manual/commands/sync.html` 现 **404**，且调研期间 Internet Archive 整体离线，取不到旧版），所以这里的一手依据是**源码 opcode 顺序**，比旧文档更精确。主 agent **亲自复核**了默认策略的实现：

`internal/vm/opcodes/sync_feature_branch_merge.go`（本会话实读）的逻辑是：沿 lineage 逐级上溯，对每个**非本地**的父分支先与其 tracking 分支对齐，直到找到**本地父分支**为止；每到一级若不同步就插入一个 `MergeParentResolvePhantomConflicts`（合并父分支 + **自动解决 phantom conflict**）；最后若当前分支与其 tracking 不同步，再插入 `MergeIntoCurrentBranch{BranchToMerge: trackingBranch}`。

**即：默认策略是 merge（不是 rebase），并且递归到最低的本地祖先。**【实抓源码】

**冲突路径——"停下来等人"哲学的代表。** 冲突时**停在半途**，把待办状态**持久化**，等人跑 `git town continue` / `skip` / `undo`。子代理读到 `runstate.json` 的完整结构（含 `RunProgram` / `AbortProgram` / `FinalUndoProgram` / `UndoAPIProgram`）。

**状态存在哪——这是本节最值得注意的一点（主 agent 亲自复核）。** runstate **不在仓库里**，而在**用户配置目录**下、以**被 sanitize 过的仓库路径**为键：

- `internal/config/configdomain/user_config_dir.go`：
  ```go
  // RepoConfigDir provides the file path where Git Town stores data for the given Git repo inside this UserConfigDir.
  func (self UserConfigDir) RepoConfigDir(repoDir gitdomain.RepoRootDir) RepoConfigDir {
      return RepoConfigDir(filepath.Join(self.String(), "git-town", SanitizePath(repoDir.String())))
  }
  ```
- `internal/config/configdomain/repo_config_dir.go` 的注释逐字：`// Example: ~/.config/git-town/home-user-my-repo.`
- `internal/cli/env.go`：`SystemUserConfigDir` 取 `filepath.Join(home, ".config")` 或 `os.UserConfigDir()`。
- `internal/cmd/continue.go`：`runstatePath := runstate.NewRunstatePath(repo.ConfigDir)`

**【实抓源码，逐字复核】即 runstate 落在 `~/.config/git-town/<sanitized-repo-path>/runstate.json`。** 对"每工作区"的启发：**把周期性/可恢复状态放在"以工作区路径为键的外部状态目录"里，是已有产品采用的方案**；代价是【推断】仓库被移动/重命名后旧状态找不到（子代理亦标注为推断，未找到官方说明）。

**force-push 安全。** rebase 策略用 `--force-with-lease` **+ `--force-if-includes`**。【子代理实抓】

**已知失败模式（官方文档化）。** 包含一条**官方承认的无限循环**。【子代理实抓】

**引用**
- `git-town/git-town` 源码：`internal/vm/opcodes/sync_feature_branch_merge.go`（主 agent 实读）、`internal/config/configdomain/user_config_dir.go`（主 agent 实读）、`internal/cmd/continue.go`
- 官方 docs 源（`website/src/`）【子代理实抓】
- **注意**：`https://www.git-town.com/manual/commands/sync.html`、`.../continue.html`、`https://www.git-town.com/manual` **均 404**（文档站已迁到 mdBook 结构）。引用 git-town 请用源码或新文档站。

---

## 10. Jujutsu（jj）：自动 rebase 后代

**对齐双方。** 两个不同的问题要分开：

1. **后代自动 rebase**：被改写 commit 的**后代** vs **新的父 commit**。这是 jj 的自动行为。
2. **对齐到远端 base**：**不是自动的**——需要人手 `jj git fetch`，再 `jj rebase -o main`。【子代理实抓】官方文档把"对齐到上游"描述成 **two step process**。

**触发。** **"人改写了某个 commit"这个事件**，不是定时器。任何导致 commit 被重写的操作（`jj rebase`、`jj abandon`、`jj squash` 等）都会把其后代自动 rebase 到新版本上。

**算法。** 把后代重新 parent 到新 commit；**冲突不阻止操作**——见下。

**冲突路径——"把冲突变成数据"哲学的代表（本文认为这是最优雅的一条）。** 冲突是 **first-class object，存在 commit 内部**；操作**照常成功**，不会把工作副本停在半途的 `rebase in progress` 状态。工作副本里会写入 conflict markers，而 jj **记住参与冲突的（通常 3）个部分**，之后每次扫描工作副本时**解析 markers 重建冲突状态**。【实抓，官方 `working-copy` 文档】

> Jujutsu's solution is to add conflict markers to conflicted files when it writes them to the working copy. It also keeps track of the (typically 3) different parts involved in the conflict. Whenever it scans the working copy thereafter, it parses the conflict markers and recreates the conflict state from them. You can resolve conflicts by replacing the conflict markers by the resolved text. **You don't need to resolve all conflicts at once. You can even resolve part of a conflict by updating the different parts of the conflict marker.**

**没有人被卡住，也没有"进行中"状态需要清理。**

**硬边界（值得抄）。** `immutable_heads()`：默认**拒绝改写**从 `trunk()` 可达的一切。【子代理实抓】

**人的保护 / 回滚。** `.jj/` 内的 **operation log**：每一步操作都是一次可回滚的条目，支持 `jj op log` / `jj undo` / `jj op revert` / `jj op restore`，**可回到任意历史操作点**。并发是 **lock-free** 的：并发命令各自基于自己看到的 operation，不阻塞、不损坏，分叉由后续 `jj st` / `jj log` 暴露。【子代理实抓】

**已知失败模式（官方文档化，【实抓】）——"stale working copy"：**

> Almost all commands go through three main steps: 1. Snapshot the working copy (which gets recorded as an operation) 2. Create new commits etc. "in memory" and record that as a new operation 3. Update the working copy to match the new operation… If step 3 doesn't happen for some reason, the working copy is considered "stale". **We can detect that because the working copy (`.jj/working_copy/`) keeps track of which operation it was last updated to.** When the working copy is stale, use `jj workspace update-stale` to update the files in the working copy.

> A working copy can also become stale because some error, such as `^C` prevented step 3 from completing. It's also possible that it was successfully updated in step 3 but the operation has then been lost… **If the operation has been lost, then `jj workspace update-stale` will create a recovery commit with the contents of the working copy but parented to the current operation's working-copy commit.**

**这条对本特性极其有用：工作副本自己记录"最后同步到哪个操作"，因此陈旧是可检测、可恢复的。** 这正是"每工作区定时对齐"最需要的：**在 workspace 记录上存一个"最后对齐到的 rev / 操作"，而不是靠时间戳猜。**

**引用**
- https://jj-vcs.github.io/jj/latest/working-copy/ 【实抓】
- https://jj-vcs.github.io/jj/latest/conflicts/ 【实抓】
- https://raw.githubusercontent.com/jj-vcs/jj/main/docs/technical/conflicts.md、`docs/operation-log.md`、`docs/git-compatibility.md`、`docs/config.md` 【子代理实抓】
- **更正**：任务书提到的 `docs/design/working-copy.md`、`docs/design/conflicts.md`、`docs/design/operation-log.md` **在 jj 仓库中不存在（均 404）**；`docs/design/` 下只有 9 个文件（`copy-tracking`、`git-submodule-storage`、`git-submodules`、`jj-converge-command`、`managed-config`、`run`、`secure-config`、`sparse-v2`、`tracking-branches`）。相关机制的一手依据在 Concepts 文档与 `docs/technical/` 下。【子代理实抓】

---

## 11. Meta Sapling：auto-restack

**对齐双方。** stack 内的**孤儿 commit vs 各自父提交的最新 successor**。【子代理实抓】

**触发。** **有两条完全不同的路径，且都不是定时器：**
1. **自动**：`sl amend`（及 `absorb`）时，由 `amend.autorestack` 控制——**触发点是"人改了一个有后代的 commit"**。
2. **手动**：`sl restack`（= `sl rebase --restack`）。

**`amend.autorestack` 的四个取值（源码逐字，默认 `only-trivial`）：**

| 取值 | 语义（源码注释/逻辑） |
| --- | --- |
| `never` | `# Never restack commits on amend.` |
| `only-trivial`（**默认**） | 实际判定是 `old.manifestnode() == newcommit.manifestnode() and not repo[None].dirty()`——**manifest 未变且工作副本干净**才 restack。提示语逐字：`descendants have been auto-rebased because no merge conflict could have happened` |
| `no-conflict` | 只在**不会产生合并冲突**时 restack；**要求 IMM（in-memory merge）**，否则回落到默认值 |
| `always` | `# Always attempt to restack commits on amend, even if doing so will leave the user in a conflicted state.` |

**注意两处值得记下的细节（子代理实抓）：**
- `only-trivial` 的**源码注释与实现不一致**（注释写 "only if they change manifest, and don't change the commit manifest" 自相矛盾，实现是 `==`）。**以代码为准。**
- **CLI 默认 `only-trivial`，ISL GUI 默认 `always`**，两个产品面默认值不一致，官方无解释。

**冲突路径——第三条哲学："主操作照常成功，只留一条 hint 记债"。** 当决定**不**自动 restack 时，**不是失败**，而是打一条 hint（逐字）：

> `descendants of %s are left behind - use '@prog@ restack' to rebase them`

**算法（`sl restack`，源码 55 行）。** 取 `repo.wlock(), repo.lock()`；若未指定 rev：用 `(draft() & ::.)::` 取"当前 commit 及其祖先中的 draft commit 加上它们的全部后代"；为空则退回 `draft() & children(.)`，仍为空则输出 `nothing to restack` 并 **return 1**；再经 obsolete graph 的 `successors/predecessors` 连接一次，最后再经 changelog 连接一次补齐。【子代理实抓】

**自动 vs 门控。** 默认档位是**最保守的**：只在"能证明不会冲突"（manifest 未变 + 工作副本干净）时才自动做，其余全部留 hint。**这是"无人看管时只做可证明安全的事"的最佳范例。**

**引用**
- `facebook/sapling` 源码：`eden/scm/sapling/ext/amend/__init__.py`、`eden/scm/sapling/ext/amend/restack.py`、`addons/isl/src/RestackBehavior.tsx` 【子代理实抓】
- **未能核实**：任务书提到的"`sl smartlog` 里的 restack 提示"**未能证实**——`smartlog.py` 搜 `restack` 零命中；实际 restack hint 来自 `sl amend`。可能指 ISL GUI 的 `SuggestedRebase.tsx`（文件存在，内容未读）。【子代理实抓 + 明确标注未证实】

---

## 12. 跨仓库自动搬运：Copybara、fbshipit、Piper / Mondrian / ROSIE

**这一节的第一条结论是本节最重要的内容，也是对整个第一部分的一个总结：**

> **【事实】在"两个仓库 / 两棵树之间自动搬运改动"这一类工具里，没有任何一个是"自己带定时器、自己跨重启"的。** 它们的调度全部落在以下四种之一：①**CLI 一次性执行**，由外部调度器（cron / CI schedule / systemd timer）决定周期——Copybara、fbshipit；②**push 事件驱动**（拦截 git push / HTTP 请求），无定时——josh-proxy；③**本地文件系统事件 + 超时兜底**（inotify/fswatch + 超时触发一次）——git-sync 的 contrib 脚本；④**CLI 一次性执行**，由人手动或外部 cron 驱动——git-subtree、git-subrepo。

**唯一在进程内跑定时循环的是 josh-proxy**：一个硬编码 **10 秒**的上游 fetch 轮询（`run_polling`）和一个 **60 秒**的 housekeeping 循环——但它们**不是合并对齐定时器**，语义完全不同。

> **第二条结论同样重要：跨重启的"上次同步到哪"，全部落在 git 本身，没有一个放在进程内存或本地数据库里。** 形式是 destination 的 commit message label（Copybara）、commit message trailer（fbshipit 的 `fbshipit-source-id`、git-subtree 的 `git-subtree-split`）、仓库内的一个文件（git-subrepo 的 `.gitrepo`）、或纯粹由"上游 ref 现在指向哪"隐式决定（josh、git-sync）。**这是它们天然跨重启、天然支持多实例的原因。**

### 12.1 Copybara

**对齐双方。** 两个仓库（origin → destination），glob 限定文件范围。**必须显式指定 authoritative repo**（哪边是真相源）。

**触发。** **CLI 一次性执行，无内置调度。**【子代理实抓】全仓库 grep `cron/continuous/polling/periodic` **无官方命中**，**文档未给外部调度建议**。（`core.feedback` 只处理 PR 事件元数据，不是同步触发。）

**算法。** 三种模式：`SQUASH`（一个 commit）、`ITERATIVE`（逐 commit）、`CHANGE_REQUEST`（**rebase 到目标 HEAD**）；`merge_import` 走 diff3 三方合并。

**冲突路径（本节最重要）。**

**(a) ITERATIVE：单个 change 失败 → 整轮中止，但前面的已落地**（`WorkflowMode.java` 逐字）：

```java
} catch (EmptyChangeException e) {
  runHelper.getConsole().warnFmt("Migration of origin revision '%s' resulted in an empty"
      + " change in the destination: %s", change.getRevision().asString(), e.getMessage());
} catch (ValidationException | RepoException e) {
  runHelper.getConsole().errorFmt("Migration of origin revision '%s' failed with error: %s",
      change.getRevision().asString(), e.getMessage());
  throw e;                      // ← 直接抛出，整轮结束
}
```

**逐条读出：**
1. `EmptyChangeException`（该 change 在 destination 变成空）**只 warn 并继续下一个**——**"空变更"被显式容忍**。
2. 其它 `ValidationException | RepoException` **直接 throw**，整轮中止。**但循环里已经成功并 push 出去的 change 不会回滚。Copybara 没有事务、没有 rollback。部分落地 = 目标分支上留下前 N-1 个 commit，第 N 个失败，剩下的等下次运行**（下次从新的 `GitOrigin-RevId` label 继续）。
3. 有 error 且后面还有 change 时会**交互式询问** `"Continue importing next change?"`。**这在无人值守下是致命的**：`promptConfirmation` 需要终端，而**官方文档没有说明其无人值守行为**。**【推断】未在源码中找到明确的非交互默认值，本文不做断言。**

**(b) CHANGE_REQUEST：rebase 冲突 → 中止，目标仓库零改动，人去改 origin 再重跑**（`GitRepository.java` 逐字）：

```java
if (FAILED_REBASE.matcher(output.getStderr()).find()) {
  throw new RebaseConflictException(
      String.format("Conflict detected while rebasing %s to %s. Please sync or update the change in the"
              + " origin and retry. Git output was:\n%s%s", workTree, branch, output.getStdout(),
          errorAdvice != null ? ". " + errorAdvice : ""));
}
```

`errorAdvice` 逐字：`Please consider to use flag --nogit-destination-rebase to workaround`。

**"谁收拾"**：**目标仓库没有任何改动被写入**（rebase 在本地 scratch clone 里失败，push 还没发生），**没有任何状态被记录**；修法是**人去改 origin 上那个 change，然后重跑**。真实用户复现见 issue [google/copybara#104](https://github.com/google/copybara/issues/104)（*Unexpected merge importing a pull request*，open，2019-11-09）。

**(c) `merge_import` 是唯一的例外：冲突标记直接落地，且"没人收拾"**——**带冲突标记写入 destination 并只 warn**（一个 `merge_error` DestinationEffect）。**这是本文见到的唯一一个"故意把冲突标记提交进目标分支"的机制**，也是 S4 明确标出的缺陷。

**自动 vs 门控。** **默认自动 push**；门控手段有 `ask_for_confirmation`（**需终端**）、`dry_run`、`check_last_rev_state`，或换成 PR/CL destination。

**调度与状态持久化（关键）。**

| 项 | 值 |
| --- | --- |
| 内置调度 | **无**，CLI 一次性 |
| 上次同步 rev 存哪 | **destination 的 commit message label `GitOrigin-RevId: <rev>`** |
| 覆盖 | `--last-rev`（注意：**存的是 commit message 的 label，但 `--last-rev` 是命令行 flag，不是 `--label`**） |
| 找不到时 | 报错，除非 `--force` / `--last-rev` / `--init-history` |
| 跨重启 | **天然**——状态在 git 里，进程无状态（README 明确声明 stateless） |
| 可观测 | `copybara info` 打印 `last_migrated_ref`，样例逐字：`INFO: Workflow 'default': last_migrated_ref 4dd20b2...` |

**唯一的"人工介入修数据"原语是 `--squash`**（`docs/reference.md` 逐字）：

> Override workflow's mode with 'SQUASH'. This is useful mainly for workflows that use 'ITERATIVE' mode, when we want to run a single export with 'SQUASH', maybe to fix an issue. **Always use --dry-run before**, to test your changes locally.

**即：ITERATIVE 卡住时，人用 `--squash --dry-run` 验证后把区间压成一个 commit 强行推进。**

**change 级去重——跨重启幂等的最强模型（源码级证据）。** Copybara 的 `change_identity` = **MD5(workflowName + ref + config 路径 + user)**，消费方是 Gerrit 侧的 `hashtag:"copybara_id_<identity>_<email>"` 查询——**用它复用已存在的 active change，而不是再发一个**。**但注意：`git.destination`（直接 push 分支）不用 identity**——这解释了为什么直接 push 模式下重复运行只会撞到 empty change。

**【事实】即：真正的幂等键是"这个工作单元的这次对齐"（workflow + ref + config + 人）的一个稳定哈希，而不是时间戳或运行次数。** 对本设计的直接含义：**定时器每周期跑一次时，"这个工作单元这一轮该产出的东西"必须有一个稳定身份，才能做到"跑第二遍不产生第二个 commit"。** 否则每周期都会造出一个语义重复的提交。

**已知失败模式。** ITERATIVE 中途失败留下部分落地（**已 push 的 commit 不回滚**）；`merge_import` 冲突标记进 destination；rebase 冲突需人改 origin（源码 + issue #104）；**会主动删除上次失败的 rebase 锁（丢弃半成品，重来一遍）**。

**空操作被当成错误会污染退出码——issue #236 用户原话（逐字）：**
> `'440d40ec...' has been already migrated. Use --force...`

之后：*"**this returns an non-zero exit code, causing CI pipelines to be unhappy**"*。

> ### ⚠️ 对定时器模块的硬要求
>
> **"这一轮没有需要对齐的东西"必须与"这一轮失败了"用不同的退出码/状态区分。** 否则一个每 30 分钟跑一次的定时器，会在"无事可做"的绝大多数轮次里持续上报失败——**运维上会直接淹没真正的失败**（这正是 §30.3 第 6 条与 `gh stack sync` "aborts the sync, exiting successfully" 的同一个教训）。

### 12.2 fbshipit

**对齐双方。** 两个仓库（source → destination），roots + filter 限定范围。**不显式声明**权威方，由 phase 配置决定方向。

**触发。** **CLI 一次性，无调度。**

**算法。** **cherry-pick（底层用 `git am`）**。

**冲突路径。** `git am --abort` **只回滚当前 patch**，然后整轮中止（**后续 phase 不执行**）。本地 clone 里有部分落地，但**未 push**。这个区分很重要：**"本地有、远端没有"是一种比 Copybara 更干净的部分失败形态。**

**人的处置路径（文档化得相当完整）：** `--save-patches-to` 复现问题 → 按 `DEBUGGING.md` 的三种处置 → `--create-fixup-patch` 生成补丁让人手动推。跳过单个 source commit 靠 `--skip-source-commits=<sha>`，**但它不持久**；另一种跳过是靠 commit message 里的 `@already-on-github`。

**状态。** destination 的 commit message trailer **`fbshipit-source-id: <src-sha>`**（用 `git log -1 --grep` 找回）→ **天然跨重启**。

**已知失败模式（文档化）。** **不理解 merge commit（假设线性历史）**；`git-am: patch does not apply` / `already exists in index`；**"有人用了 GitHub 的 Merge pull request 按钮"是文档点名的常见根因**；`--skip-source-commits` 不持久；`flock` 卡死（Mercurial）。**并且 README 明确说明该项目已停止维护（archived）。**

**对本特性的启示：fbshipit 的核心脆弱点是"线性历史假设"。** 任何"把变更搬进另一条历史"的自动机制，都必须先明确**它能不能处理 merge commit**——否则 merge commit 会变成静默的失败源。

### 12.3 Google 的 Piper / Mondrian / ROSIE——**有一手来源，但必须纠正三个常见误解**

**取证转机（重要）。** 这三个系统本身闭源，但 **Google 在自己的域名上免费全文托管了《Software Engineering at Google》（O'Reilly 2020，作者全为 Google 员工）**：`https://abseil.io/resources/swe-book/`。**主 agent 亲自复核了 `html/ch16.html`（HTTP 200，88 KB）与 `html/ch22.html`（HTTP 200，70 KB）**，并对正文做了文本提取与关键词计数。这使本节从"无材料"变成**逐字可引**。

同时必须说明：**经典出处 CACM 2016《Why Google Stores Billions of Lines of Code in a Single Repository》的正文本次仍取不到**——主 agent 复验：`research.google/pubs/pub45424/` **HTTP 200 但为纯 JS 渲染，正文与摘要均无法提取**；`cacm.acm.org/...` 与 `dl.acm.org/doi/10.1145/2854146` **均 403（Cloudflare）**。S4 另穷尽了 Internet Archive、归档 PDF 与多个代理，**全部失败**。

#### Piper（ch16，主 agent 复核）

逐字：

> We rely on an in-house-developed centralized VCS called Piper, built to run as a distributed microservice in our production environment. This has allowed us to use Google-standard storage, communication, and Compute as a Service technology to provide a globally available VCS **storing more than 80 TB of content and metadata**. The Piper monorepo is then **simultaneously edited and committed to by many thousands of engineers every day**.

**关键点：Piper 是 trunk-based 的单一集中式仓库。** 因此**在 Piper 内部根本不存在"需要周期性对齐的两棵树"**——没有长期分支，就没有分支与 base 的漂移。

#### ROSIE（ch22，主 agent 复核；`Rosie` 在该章出现 **11 次**）

**它做什么（逐字）：**

> At Google, this tool is called **Rosie**… It provides the ability to **split the large sets of comprehensive changes produced by tooling into smaller shards**, which can be tested, reviewed, and submitted independently.

**分片依据与提交粒度（逐字，这是最该抄的一段）：**

> **Rosie takes a large change and shards it based upon project boundaries and ownership rules into changes that can be submitted atomically.** It then puts each individually sharded change through an **independent test-mail-submit pipeline**.

**它对共享资源的自我限流（逐字）：**

> Rosie can be a heavy user of other pieces of Google's developer infrastructure, so it **caps the number of outstanding shards** for any given LSC, **runs at lower priority**, and communicates with the rest of the infrastructure about **how much load it is acceptable to generate** on our shared testing infrastructure.

**它的一条硬要求（逐字）：**

> For any LSC process, **individual shards should be committable independently.** This means that they don't have any interdependence or that the sharding mechanism can group dependent changes (such as to a header file and its implementation) together.

**它先测后送审（逐字）：**

> After Rosie has **validated that a change is safe through testing**, it mails the change to an appropriate reviewer. … Rosie uses an **owners detection service** that understands these OWNERS files and weights each owner based upon…

#### ⚠️ 必须纠正的三个误解

1. **ROSIE 没有"全局原子提交"。** 逐字（同章）：
   > Usually, the size of the change is **too large to fit in a single global change, due to technical limitations of the underlying version control system.**

   **能原子提交的是"单个 shard"，不是全局。** 请勿写成"全局原子提交 + 冲突回滚"。
2. **"Piper 的客户端 commit queue" 没有一手材料。** S4 对全部 26 章 *以及* `research.google/sitemap_main.xml`（20,508 条 URL）做了全量扫描，**`submit queue` / `commit queue` 均 0 命中**。**本文不写这个机制。**
3. **`--import-labels`（Copybara）在当前版本不存在**（全仓库 grep 无命中）。

#### Google 给出的答案不是"更好的定时器"，而是"让定时器不必要"——**这是本文最强的反面参照**

**失败处理的设计前提完全不同（逐字，`cattle and pets` 一段）：**

> In this environment, we've found it useful to **treat specific changes as cattle: nameless and faceless commits that might be rolled back or otherwise rejected at any given time with little cost** unless the entire herd is affected. **Often this happens because of an unforeseen problem not caught by tests, or even something as simple as a merge conflict.**

> With a "pet" commit, it can be difficult to not take rejection personally…

**【事实】Google 明确把"因为一个 merge conflict 而被回滚"列为正常、被设计接受的结果**，并把它与"人手工写的 commit（pet）会难以接受被拒"对照。**这是一种与前面所有产品都不同的失败哲学：不追求"对齐成功"，而追求"单个改动随时可弃、代价极小"。**

配套的两条（S4 取证，本文未逐字复核）：**TAP 已升级为自动回滚 culprit**；**Critique 记录一个 change 是否已被回滚**；以及 Google **官方承认大规模下 flaky 测试必然出现并吃掉 LSC 吞吐**，其选择是**放行 + 事后回滚**而非阻塞。

> **对本特性的直接含义（本文判断）**：如果本设计要"定时自动对齐"，那么它应当同时接受 Google 这条前提——**单个工作单元的自动提交/自动对齐产物必须是"可随时丢弃、代价极小"的**。否则一个无人看管的定时器每周期都在制造"pet"（人已经投入心血的产物），而冲突会让它们反复被拒——**这正是 §29 里 bors-ng 无限循环那条教训的组织层版本。**

### 12.4 引用

- `google/copybara` 源码：`WorkflowMode.java`、`GitRepository.java`、`GitDestination.java`、`WorkflowRunHelper.java`、`Main.java`、`CommandLineDiffUtil.java`、`MergeImportTool.java`；`README.md`、`docs/reference.md`、`docs/examples.md`；issue #104、#236 【子代理实抓】
- `facebook/fbshipit`：README、`DEBUGGING.md`、`ShipItSync.php`、`ShipItRepoGIT.php`、`ShipItVerifyRepoPhase.php` 【子代理实抓】
- **Google 一手材料（§12.3）**：https://abseil.io/resources/swe-book/ 的 `html/ch16.html`（Piper）、`html/ch22.html`（Rosie / cattle-vs-pets）【**主 agent 亲自复核 HTTP 200 与逐字引文**】；`html/ch19.html`（Critique）、`html/ch23.html`（TAP）、`developers.googleblog.com` 的两篇 2008 博文（Mondrian，含 Guido van Rossum 原话）、`research.google` 托管的 2 篇 ICSE PDF 【子代理实抓】
- **仍未能核实**：**CACM 2016《Why Google Stores Billions of Lines of Code in a Single Repository》正文**——`research.google/pubs/pub45424/` 200 但纯 JS 无正文（主 agent 复核）、`cacm.acm.org` 与 `dl.acm.org` **均 403**（主 agent 复核），S4 穷尽 Internet Archive / 归档 PDF / 多个代理后仍全部失败；**Piper 的"客户端 commit queue"机制**（26 章 + `research.google` sitemap 的 20,508 条 URL 全量扫描，`submit queue` / `commit queue` **0 命中**）；**Mondrian 是否开源、其内部实现**（仅 2008 博文的公开描述）；**`--iterative` 的性能问题**（仓库全量 grep + GitHub Search API 均无官方命中）；**rename detection 问题**（Search API `repo:google/copybara rename detection` 返回 0 条）；`bbshipit` 的改名时间；**`--nopush`（josh）与 `--import-labels`（Copybara）在当前版本不存在**；`git-subtree.txt` / git-subrepo `README.md` / Copybara `docs/faq.md` 与 `docs/best_practices.md` **均 404**。
- **引文规范化披露（S4 已声明，避免逐字比对时误判）**：弯引号→直引号；省略书/论文的脚注上标数字；PDF 的连字符断行与合字（`ﬁ`）已还原。**这三处是有意为之，不是转录错误。**
- **S4 的机械校验**：脚本把全部 **146 条 ≥70 字符的英文引文**与本地留存的全部源文件（37 个逐文件复抓件 + Google 一手件 + tarball 解包树）做去标记/去空白/去大小写全量比对，**除 4 条 GitHub issue 正文、6 条中文注释、1 条网络抖动后重试确认的博文外全部命中，无一处转录错误。**

---

## 13. 单体仓库 / 多仓库同步工具：josh、git-subtree、git-subrepo、git-sync

这一组是"一个 monorepo ↔ 多个子项目视图"或"一个仓库 ↔ 它的镜像"的对齐。**它们回答的是本特性的另一个维度：如果 workspace 里的目录本身要与外部保持同步，怎么做。**

### 13.1 对照表

| 工具 | 对齐双方 | 算法 | 不干净时 | "上次同步到哪"存哪 |
| --- | --- | --- | --- | --- |
| **josh** | **一个 monorepo ↔ N 个投影仓库**（filter / workspace 定义）；真相源是 **monorepo** | **filter / unapply（历史重写）**，无 merge | 默认 `OrphansMode::Fail` **拒绝 push**；往返不一致报 `REWRITE(a -> b)` | **不显式存**；由上游 ref + 确定性 filter 推导 |
| **git-subtree** | 上游仓库整棵历史 ↔ 本地某子目录 `<prefix>` | pull = `git merge --no-ff -Xsubtree`；push = `split` + push | merge 冲突 → 标准 git 冲突态；push 非快进 → **git 拒绝（`+` 被忽略）** | 主仓库 commit message trailer **`git-subtree-dir:` / `git-subtree-split:` / `git-subtree-mainline:`** |
| **git-subrepo** | 上游仓库整棵历史 ↔ 本地某子目录 `<subdir>` | pull = fetch+branch+merge/rebase+commit（**压成一个 commit**）；push = **祖先检查**后 push | 停手交给人（**"finish this by hand"**）；push 未含上游 HEAD → `error` | **`<subdir>/.gitrepo` 文件**（`subrepo.remote/branch/commit/parent/method/cmdver`） |
| **git-sync** | 本地分支 ↔ 其配置的远端同名分支（**同一仓库的两份 clone**） | ahead=push / behind=`merge --ff-only` / diverged=**rebase 后 push** | rebase 失败 → **exit 1，留在冲突态**，下次 exit 2 | **不存**；由远端 ref 隐式决定 |

**四条值得单独记的事实：**

1. **josh 的失败默认是"拒绝"，不是"尝试"**：`OrphansMode::Fail` 让不可逆的 filter 直接拒绝 push；需要人显式加 `-o merge` / `-o allow_orphans` / `-o edit` / `-o force` 才放开——**四个选项默认全关**。**并且 josh 官方强烈推荐外挂 code review。**
2. **josh 的 cache 被官方明确声明为"仅性能用途、不需要备份"**（`--local` 目录 / docker volume）——**权威状态与可重建缓存分离**，与 Zuul 的 `working_root`、DSH 的 `dsh-schedule`（timers 是可丢弃投影）是同一原则。
3. **git-subtree 的 `+` 被忽略**：即使你在 refspec 里写了 `+`（强制），**非快进推送仍然推不上去**——**用 git 自身的非快进拒绝作为最后一道防线**，而不是靠工具自觉。**这是"拒绝自动化"的一个干净例子。**
4. **git-sync 的失败码是有含义的**：rebase 失败 exit 1 并**留在冲突态**，下一次运行 exit 2——**"上次没收拾干净"是可通过退出码观察的状态**。

### 13.2 与本特性的关系

**这一组里最可迁移的不是算法，是两条架构决策：**

- **"同步游标存在被同步的产物自身里"**（commit message trailer / label / `.gitrepo` 文件）。它带来三个性质：天然跨重启、天然多实例安全、**跟着仓库一起被复制/备份**。对照 Copybara 的 `GitOrigin-RevId`、fbshipit 的 `fbshipit-source-id`、git-subtree 的 `git-subtree-split`——**四个独立项目选了同一个答案，这不是巧合。**
- **"可重建的缓存"与"权威状态"必须分开**（josh cache、Zuul `working_root`）。

**同时注意这一组普遍缺乏的东西：没有一家提供"定时"本身。** 也就是说，**"定时"这件事在生态里一贯由外部调度器承担**——这正是本特性要新写的部分，也是它必须自己解决"跨重启"的原因（见末节）。

### 13.3 引用

- `josh-project/josh`：源码、`docs/` 的 `workspace.md`、`migration.md` 【子代理实抓】
- `git.git` 的 `contrib/subtree/`（源码 + man page）【子代理实抓】
- `ingydotnet/git-subrepo`：`ReadMe.pod` + 源码 【子代理实抓】
- `simonthum/git-sync`：README + 源码 + contrib 脚本 【子代理实抓】
- **未能核实**：`--nopush` 参数（**当前 master 不存在**，`josh-proxy/src/cli.rs` 的 `struct Args` 是完整参数集——可能是历史版本或记忆偏差）；git-sync 的 `GIT_SYNC_INTERVAL` 在不同发行版中的默认值。

---

## 14. IDE 的后台对齐：VS Code 与 JetBrains

**这一组的价值在于它是一个"有人在场"的对照组**：它明确把"定时"和"合并"拆开，并回答"无人场景怎么办"。

### 14.1 VS Code 内置 Git 扩展

**对齐双方。** 本地仓库 vs 其远端（`origin`）。**定时那一半只更新远端引用，不动本地分支，也不动工作副本。**

**触发与默认间隔（三个默认值必须按源码写，容易记错）。** 主 agent **亲自复核**了 `extensions/git/package.json`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `git.autofetch` | **`false`** | 周期 fetch 默认**关闭** |
| `git.autofetchPeriod` | **`180`** | 单位是**秒**（= 3 分钟），不是分钟 |
| `git.confirmSync` | **`true`** | 同步前弹**模态**确认框 |

`package.nls.json` 对 `autofetchPeriod` 的文案逐字：`Duration in seconds between each automatic git fetch`。【实抓】

**算法——只 fetch，永不 merge/rebase。** 主 agent **亲自复核** `extensions/git/src/autofetch.ts`（全文 143 行）：该文件里**只有** `fetchAll({ silent: true })` 与 `fetchDefault({ silent: true })` 两个 git 调用，**没有任何** merge / rebase / pull。**【实抓】**

**冲突路径。** 定时那一半**根本不产生冲突**——冲突风险被彻底移出定时路径。真正的合并路径是状态栏的 Sync 按钮，**手动**，并且默认带 `modal: true` 的确认框（`commands.ts`，【子代理实抓并给出逐字源码】）。有人在场时的 rebase 冲突由 UI 交给冲突解决工具，**工作副本会停在冲突状态**。

**门控。** 定时 fetch：全自动（只有一次性的"要不要开启"引导，用 `globalState` 的 `autofetch.didInformUser` 记住）。合并/同步：`git.confirmSync` 默认 `true` + **模态**。

**调度实现（这段最值得抄）。** `autofetch.ts` 的 `run()` 是一个 `while (this.enabled)` 循环 + `Promise.race([timeout, whenDisabled])`，**不是 `setInterval`**：下一次的计时从"上一次 fetch 完成之后"才开始（避免叠加）。开启后立即先 fetch 一次。**定时器本身不持久化**——`_enabled` 是内存字段，启动时由配置 `git.autofetch` 重新推导；唯一被持久化的运行时状态是 `autofetch.didInformUser`。**"跨重启存活"的只是开关配置，不是调度相位。**（远端引用时间由 git 自己写在 `.git/FETCH_HEAD` / ref 里，VS Code 不读不存。）

**两个阻止调度的前置条件（逐字，【子代理实抓】）：** `await this.repository.whenIdleAndFocused();`，而 `whenIdleAndFocused()` 要求**仓库空闲**且 **`window.state.focused`**。**窗口失焦就完全不 fetch，一直等到窗口被聚焦。**

**"无人看管"场景官方怎么处理：用配置作用域，不是改算法。** 官方为 Agents window 单独覆盖默认值：`git.autofetch` → `true`，`git.confirmSync` → `false` + `readOnly`（`configurationRegistry.ts` 的 `agentsWindow`）。**【推断】但 `whenIdleAndFocused()` 的 `window.state.focused` 条件仍然生效，而无人看管的窗口通常失焦——所以这个覆盖可能并不真正生效。**（子代理已标注为推断，未见官方确认。）

**已知失败模式（源码级，【子代理实抓】）：**
1. **认证失败 → 永久关闭 autofetch**（只改内存 `_enabled`，不改配置，**无提示**）：
   ```ts
   if (err.gitErrorCode === GitErrorCodes.AuthenticationFailed) { this.disable(); }
   ```
2. **其他 fetch 错误被静默吞掉**（`catch` 里只判 `AuthenticationFailed` 一个分支），循环继续等下一周期。
3. **计量连接（metered connection）自动禁用**：`if (env.isMeteredConnection) { this.disable(); return; }`
4. **"后台定时"其实是"前台空闲定时"**——对"人在旁边"的强假设。
5. `git.pullBeforeCheckout` 是**失败即静默**路径（`catch` 里 `// noop`），但它是 fast-forward 不是 rebase，所以不会留半途状态。

### 14.2 JetBrains IntelliJ 系列

**触发与默认间隔。** 后台检查的**出厂默认是 `LS_REMOTE`——只做 `git ls-remote`**,不 fetch。开启"自动 fetch 远端变更"后才只 fetch。间隔默认 **20 分钟**（由 registry key `git.update.incoming.info.time` 控制）。官方文档在 `sync-with-a-remote-repository` 与 `settings-version-control-git` 两处都写 "every 20 minutes by default"。【子代理实抓】
**注意更正**：**不存在** `git.auto.fetch.enabled` 这个键（那是对 UI 资源键 `settings.git.auto.fetch.text` 的误记）；当前 UI 文案是 "Fetch remote changes automatically" / "Check remote for incoming changes"，不是 "Fetch periodically"。**【子代理实抓】**

**算法 / 门控。** **Update Project** 由人触发，默认弹策略对话框；官方设置页只列 **Merge / Rebase** 两种策略，但**源码枚举有 4 个值**（含 `BRANCH_DEFAULT` "Use default specified in the config file for the branch" 与 `RESET`）——**文档与实现不一致，以源码为准**。【子代理实抓】

**调度与持久状态。** `GitVcsSettings` 是 **project 级** service——**定时/检查设置天然按项目（≈工作区）作用域**，并把 `Last fetch: {0}` 作为**可见的持久状态**展示（`branches.tooltip.last.fetch`）。**【子代理实抓】这是本文找到的、与"每工作区"形态最接近的现成先例。**

**已知失败模式。** 官方文档化的失败模式**未取得**（GitHub API 限流使 issue tracker 抓取失败）。

**引用**
- https://raw.githubusercontent.com/microsoft/vscode/main/extensions/git/src/autofetch.ts 【实抓，全文复核】
- https://raw.githubusercontent.com/microsoft/vscode/main/extensions/git/package.json 【实抓，默认值复核】
- https://raw.githubusercontent.com/microsoft/vscode/main/extensions/git/src/repository.ts、`git.ts`、`commands.ts`、`package.nls.json` 【子代理实抓】
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/configuration/common/configurationRegistry.ts 【子代理实抓，`agentsWindow`】
- https://raw.githubusercontent.com/microsoft/vscode-docs/main/docs/sourcecontrol/repos-remotes.md、`overview.md`、`faq.md` 【子代理实抓】
- `JetBrains/intellij-community`：`plugins/git4idea/shared/src/git4idea/config/GitVcsSettings.java`、`GitVcsOptions.kt`、`UpdateMethod.java`、`GitIncomingRemoteCheckStrategy.kt` 【子代理实抓】
- https://www.jetbrains.com/help/idea/sync-with-a-remote-repository.html、`settings-version-control-git.html` 【子代理实抓】
- 说明：`https://code.visualstudio.com/docs/sourcecontrol/overview` 的 HTML 是 JS 渲染的，抓下来搜不到 `autofetch`；官方文案改用 `package.nls.json` 与 `microsoft/vscode-docs` 的 Markdown 源。【子代理实抓，主 agent 复核默认值】

---

## 15. docs-as-code：文档与代码怎么对齐

**这一节回答负责人需求里的"文档"那一半。结论很集中：真实 setup 里，"文档对齐"几乎都不是 git 合并，而是"重新生成 + 比对"，冲突被转化成构建失败。**【子代理实抓，主 agent 抽查复核】

### 15.1 四种真实机制

| setup | 对齐双方 | 触发 | 算法 | 冲突路径 |
| --- | --- | --- | --- | --- |
| **`kubernetes/kubernetes`** `hack/verify-generated-docs.sh` | 代码 → 生成的文档 | CI | 重新生成 + 比对（`git status --porcelain`） | **构建失败**；生成在 `git worktree` 隔离副本里做 |
| **Terraform provider** `make generate` + `git diff --exit-code` | 代码（schema/示例）→ `docs/` | CI / 人 | 重新生成 + `git diff --exit-code` | **构建失败**，提示重跑生成器 |
| **`rust-lang/rust`** tidy 的 `unstable_book` 检查 | 编译器 feature 名集合 → 文档文件名集合 | CI | 集合比对 | **PR 上警告、合并上阻断**（见下） |
| **Copybara** | 仓库 A 的某条 ref → 仓库 B | 外部调度器 | transform 流水线 + 三方合并 | 见 §12 |

**隔离工作副本（对无人值守最直接可复用的一条）。** `kubernetes/kubernetes` 的 `kube::verify::generated` 用 `git worktree add -f -q "$_tmpdir" HEAD` 在**临时工作树**里跑生成，因此**中断也不会把开发者的工作副本留在半途**。**【子代理实抓】**

**漂移门可以分级——同一检查、两种门控强度。** 主 agent **亲自复核**了 `rust-lang/rust` 的 `src/ci/github-actions/jobs.yml`：

```yaml
pr:
  - name: test-tidy
    continue_on_error: true
```
```yaml
# Auto jobs may not specify `continue_on_error: true`, and thus will fail-fast.
```
**【实抓】即：PR 阶段 tidy 只警告，Auto/合并阶段硬失败。** 这是"同一检查按场景调门控强度"的一手实现。

### 15.2 两条必须点名的负面结果

- **`googleapis/googleapis` 的生成流水线公开不可复现**：`BUILD.bazel` 逐字写 `build_gen needs to be run internally, not on GitHub repository.`，且仓库**没有**公开 workflow。**【子代理实抓】**
- **`MicrosoftDocs/azure-docs` 的镜像/生成对齐未能证实**：README 与 CONTRIBUTING 都完整读过，**没有**任何生成脚本、CI 或镜像声明；Azure SDK/文档生成指向内网 wiki。**【子代理实抓，明确标注未证实】**

- **Copybara 用于 docs 同步的具体流水线未能证实**：官方 docs 目录下只有 `README.md` / `examples.md` / `reference.md` / `CONTRIBUTING.md`，`docs/index.md`、`docs/faq.md`、`docs/use_cases.md`、`https://google.github.io/copybara/` **均 404**。**只能证实 Copybara 被设计用于仓库间文件搬运（文档属于其可搬运范围），不能证实任何具体的 docs 流水线。**【子代理实抓】——任务书里"Copybara is used for this at Google"这一说法**本次未能取得一手支撑**。

**引用**
- https://raw.githubusercontent.com/kubernetes/kubernetes/master/hack/verify-generated-docs.sh 【子代理实抓】
- https://raw.githubusercontent.com/rust-lang/rust/master/src/ci/github-actions/jobs.yml 【实抓，主 agent 复核分级门控】
- https://raw.githubusercontent.com/rust-lang/rust/master/src/tools/tidy/src/unstable_book.rs 【子代理实抓】
- https://raw.githubusercontent.com/hashicorp/terraform-provider-scaffolding-framework/main/GNUmakefile 【子代理实抓】
- https://raw.githubusercontent.com/googleapis/googleapis/master/BUILD.bazel 【子代理实抓】
- https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/README.md、`CONTRIBUTING.md` 【子代理实抓】

---

## 16. git 自身的"每仓库定时任务"：`git maintenance`

**这一节是本文在 git 原生能力里找到的、与"每工作区定时器"最同构的实现。** 全部【实抓】自 git 源码里的 man page 源文件。

**对齐双方。** 不适用——它做的是**每仓库的对象库维护**（commit-graph、prefetch、gc、loose-objects 清理等），不是分支对齐。**但它解决的是同一个工程问题：如何为"每一个仓库"可靠地跑周期性工作。**

**触发与调度实现（这是本节的全部价值）。**

- `git maintenance start` 把计划**写进操作系统的调度器**，而不是让一个进程常驻。`--scheduler=auto|crontab|systemd-timer|launchctl|schtasks`，**默认 `auto`**；Linux 上优先 `systemd-timer`，否则 `crontab`。
- POSIX 下写入的 crontab 区域（逐字）：
  ```
  # BEGIN GIT MAINTENANCE SCHEDULE
  0 1-23 * * * "/<path>/git" --exec-path="/<path>" for-each-repo --config=maintenance.repo maintenance run --schedule=hourly
  0 0 * * 1-6 "/<path>/git" --exec-path="/<path>" for-each-repo --config=maintenance.repo maintenance run --schedule=daily
  0 0 * * 0 "/<path>/git" --exec-path="/<path>" for-each-repo --config=maintenance.repo maintenance run --schedule=weekly
  # END GIT MAINTENANCE SCHEDULE
  ```
- systemd：每档频率一个 timer（`git-maintenance@hourly.timer` / `@daily` / `@weekly`），落在 `~/.config/systemd/user/`；macOS 用 `launchctl` + `~/Library/LaunchAgents/org.git-scm.git.*.plist`；Windows 用 `schtasks`。

**"哪一档跑哪些任务"和"要跑哪些仓库"分别存在哪——状态持久化的答案。**
- **要维护的仓库清单**：git config 的多值项 **`maintenance.repo`**（`git for-each-repo --config=maintenance.repo` 读它）。
- **每档频率跑哪些任务**：git config 的 **`maintenance.<task>.schedule`**（官方原文："The `git maintenance` process then determines which maintenance tasks to be configured to run on each repository with each `<frequency>` using the `maintenance.<task>.schedule` config options."）。
- **调度相位不在 git 里**，而在 OS 调度器里。**因此跨重启存活靠的是"进程外的调度器 + 配置里的声明"，不是进程内存。**

**并发保护。** 官方原文：

> Each `git maintenance run` command takes a lock on the repository's object database, and this prevents other concurrent `git maintenance run` commands from running on the same repository. Without this safeguard, competing processes could leave the repository in an unpredictable state.

**已知失败模式（官方文档化的"TROUBLESHOOTING"节，逐字要点）：**
1. **"Users may find some cases where scheduled maintenance tasks do not run as frequently as intended."**——原因就是上面那把锁在竞争。**即：静默地少跑，是这个设计的已知代价。**
2. `git maintenance start` **会覆盖它自己写的那段区域**："Any modifications within this region will be completely deleted by `git maintenance stop` or overwritten by `git maintenance start`."；要定制得用 systemd drop-in（`~/.config/systemd/user/git-maintenance@.service.d/`）或另起文件名。
3. **`git gc` 不能与 `git maintenance run` 混用**："`git gc` modifies the object database but does not take the lock in the same way… use `git maintenance run --task=gc` instead of `git gc`."

**对本特性的四点直接启发。** ①**把周期挂在宿主调度器/外部调度器上**，进程内只保留"这次该做什么"的判断；②**把"跑哪些目标"和"每档做什么"写成持久声明**（对应：workspace 记录 + 每档对齐策略）；③**每次运行必须有互斥锁**，并接受"锁竞争时少跑"是正常代价而不是故障；④**运行要有时间预算**（见 §17 的 `RUN_TIME`）。

**引用**
- https://raw.githubusercontent.com/git/git/master/Documentation/git-maintenance.adoc 【实抓，全文相关章节】
- https://raw.githubusercontent.com/git/git/master/Documentation/git-rerere.adoc 【实抓】

### 16.1 附：`git rerere`——重复冲突的复用（与定时对齐强相关）

定时对齐意味着**同一个冲突可能被反复遇到**。git 原生对此有专门机制：

> `git rerere` - Reuse recorded resolution of conflicted merges … This command assists the developer in this process by recording conflicted automerge results and corresponding hand resolve results on the initial manual merge, and applying previously recorded hand resolutions to their corresponding automerge results.
> **NOTE: You need to set the configuration variable `rerere.enabled` in order to enable this command.**

**注意默认是关闭的。** 相关事实（逐字）：`git am [--skip|--abort]` 或 `git rebase [--skip|--abort]` 会**自动调用 `git rerere clear`**（即"中止时就丢掉这次记录的解决"）；`git rerere remaining` 打印"**没被 rerere 自动解决**的冲突路径"（含子模块这类无法追踪的冲突）；`gc.rerereUnresolved` / `gc.rerereResolved` 控制保留期（默认未解决 15 天、已解决 60 天）。

**对本特性**：一个"每周期重试对齐"的模块**应当默认开启 rerere**，否则同一个冲突会被人反复解一遍；同时要意识到**`rerere` 只复用"同样的前置文本"**，base 一变就失效。**【实抓】**

---

## 17. 服务端"每仓库周期性 git 作业"的工业实现：GitLab

**为什么写这一节。** 这是本文找到的、**规模最大、且实现完全公开**的"每个仓库一个周期性 git 任务"的落地代码。它回答的正是本功能最难的一问：**周期性工作怎么做到可恢复、可观测、不失控。**

### 17.1 仓库检查（`RepositoryCheck`）：定时器 + 数据库水位线

**对齐双方。** 不适用（它跑 `git fsck` 做完整性检查）。**但它的调度骨架可以整体照搬。**

**触发与调度实现（主 agent 亲自读源码）。** `app/workers/repository_check/batch_worker.rb`：

```ruby
RUN_TIME = 3600
BATCH_SIZE = 10_000
LEASE_TIMEOUT = 1.hour

include CronjobChildWorker
include ExclusiveLeaseGuard
```

`perform` 里有三道前置拒绝：功能开关未开、分片不健康、拿不到锁——全部**直接返回不做事**。拿到锁后进入 `perform_repository_checks`：

```ruby
# This loop will break after a little more than one hour … or if it runs out of
# projects to check. By default sidekiq-cron will start a new
# RepositoryCheckWorker each hour so that as long as there are repositories to
# check, only one (or two) will be checked at a time.
project_ids.each do |project_id|
  break if Time.current - start >= RUN_TIME
  next unless try_obtain_lease_for_project(project_id)
  SingleRepositoryWorker.new.perform(project_id)
end
```

**四个可照搬的机制：**
1. **外层 cron 每小时起一次；单次运行有硬时间预算 `RUN_TIME = 3600`，到点就走**，剩下的下个小时继续。
2. **两级互斥锁**：整分片一把 `ExclusiveLeaseGuard`（`LEASE_TIMEOUT = 1.hour`，key `repository_check_batch_worker:<shard>`），**每个项目一把 24 小时的 Redis 租约**（`project_repository_check:<id>`，注释逐字解释："Use a 24-hour timeout because on servers/projects where 'git fsck' is super slow we definitely do not want to run it twice in parallel."）。
3. **"谁该被跑"完全由数据库列推导，不由队列位置决定**——这就是它跨重启存活的全部秘密：
   ```ruby
   def never_checked_project_ids(batch_size)
     projects_on_shard.where(last_repository_check_at: nil)
       .where('created_at < ?', 24.hours.ago).limit(batch_size).pluck(:id)
   end

   def old_checked_project_ids(batch_size)
     projects_on_shard.where.not(last_repository_check_at: nil)
       .where('last_repository_check_at < ?', 1.month.ago)
       .reorder(last_repository_check_at: :asc).limit(batch_size).pluck(:id)
   end
   ```
   **即：水位线是记录上的两个时间戳列（`last_repository_check_at`、`last_repository_check_failed`），调度器每小时重算"谁到期了"。崩溃重启后进度天然保留。**
4. **失败是被记录的、不是被重试的**（`single_repository_worker.rb`）：
   ```ruby
   def update_repository_check_status(project, healthy)
     project.update_columns(last_repository_check_failed: !healthy,
                            last_repository_check_at: Time.current)
   end

   def git_fsck(repository)
     return false unless repository.exists?
     repository.raw_repository.fsck
     true
   rescue Gitlab::Git::Repository::GitError => e
     Gitlab::RepositoryCheckLogger.error("#{repository.full_path}: #{e.message}")
     false
   end
   ```
   失败 → **打日志 + 把记录标成 `failed` + 照常推进水位线**（`sidekiq_options retry: 3` 是唯一的重试，且是 worker 级）。**没有无限重试，也不会卡住队列。**

**人对失败的可见性。** 频率由 `gitlab_rails['repository_check_worker_cron']`（Linux 包）或 `gitlab.cron_jobs.repository_check_worker`（源码安装）配置；官方文档的语义是：**"A project is checked no more than once per month, and new projects aren't checked for at least 24 hours."**；有检查失败时**每周给全体管理员发邮件**；失败清单可在 `/admin/projects?last_repository_check_failed=true` 查看。【实抓】

### 17.2 仓库 housekeeping：为什么必须加定时器

官方文档给的理由**几乎就是本特性的立项理由**（逐字，【实抓】）：

> While GitLab automatically performs housekeeping tasks based on the number of pushes, it does not maintain repositories that don't receive any pushes at all. As a result, **dormant repositories or repositories that are only getting read requests** may not benefit from improvements in the repository housekeeping strategy. Administrators can enable a background job that performs housekeeping in all repositories at a customizable interval to remedy this situation.

**即：纯事件驱动（push 触发）会漏掉"安静的"仓库，所以必须补一条定时路径。**

两条策略（逐字要点）：**eager**（"independent of the repository state"，用于 manual trigger 与 **push-based trigger**）vs **heuristical / opportunistic**（"analyzes the repository's state and executes housekeeping tasks only when it finds one or more data structures are insufficiently optimized"，**用于 scheduled housekeeping**）。

**scheduled housekeeping 的真实参数（逐字，【实抓】）：**

> By default, Gitaly performs background repository maintenance **every day at 12:00 noon for a duration of 10 minutes**. You can change this default in Gitaly configuration. … The Gitaly node **stops processing repositories if it takes longer than the configured interval**. … If a scheduled housekeeping run reaches the duration specified, the running tasks are **gracefully canceled**. On subsequent scheduled housekeeping runs, Gitaly **randomly shuffles** the [order].

**可照搬的三点**：定时任务用**随机顺序**遍历全部目标（避免每次都是同一批先跑）、**有硬时长上限**、**超时优雅取消**、下一轮重新洗牌。这与 §16 的 `git maintenance` 的锁竞争问题、§17.1 的 `RUN_TIME` 是同一族设计。

**引用**
- https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/workers/repository_check/batch_worker.rb 【实抓，全文】
- https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/workers/repository_check/single_repository_worker.rb 【实抓，全文】
- https://docs.gitlab.com/administration/repository_checks/ 【实抓】
- https://docs.gitlab.com/administration/housekeeping/ 【实抓】

---

# 第二部分：自动总结 + 自动提交 commit，push 由人决定

负责人追加的需求原文：

> 「在每个工作内部自动总结 自动提交commit 但是push 由人决定」

**这一部分只问两件事，其余都是次要的：**

- **（A）到底把什么放进 commit？** 这是**安全属性**——不是"提交了没有"，而是"提交进去的东西是不是刚好是应该进去的"。一个自动提交器把用户的无关半成品、别人的改动、或凭据文件带进 commit，就是**数据泄露或工作丢失**。
- **（B）人怎么被保护？** 撤销得掉吗？durable 吗？会拒绝吗？

### 本部分最重要的一条前提更正（请勿写成"已有先例"）

> **【事实】调研范围内，没有任何一个产品实现"定时器周期性对齐 git + 自动提交"。** 最接近的两个是 etckeeper 的"每日自动提交"和 git-annex assistant 的常驻守护进程，但前者不是"对齐"、后者是事件驱动而非定时。唯一带 schedule 的 AI 工具是 GitHub Copilot automations 的 hourly/daily/weekly，**它定时启动的是 agent，不是 git 操作**。
>
> **因此：本特性在"定时"这一点上没有直接先例，也没有现成的失败经验可借鉴。** 请在正式设计里把它当作**需要自己论证的新面**，而不是"跟随业界做法"。

另一条同样重要：

> **【事实】"自动 commit 真 git 但不 push"在同类产品里几乎只有 Aider 一例。** Claude Code / Cursor / Windsurf / Cline **全部选择私有快照而非真 commit**；而云端 agent（Copilot / Devin / Claude Code Web / Cursor Cloud）**真 commit，但同时也 push**。

**这个分布本身就是一条结论**：业界在"要不要写真 git commit"上分成两派，而"真 commit 且不 push"这个精确位置几乎无人占据——**它要求同时解决"提交范围可证明正确"和"不 push 仍有价值"两个问题**。

---

## 18. Aider——"自动提交、绝不 push"的最完整先例

**为什么它是最重要的一个。** 它是**唯一一个默认自动写真 git commit、且明确不做 push 的成熟产品**。它的每个设计决策都值得逐条对照。

**触发。** **每次 LLM 回复产生了文件编辑之后提交一次**（并且 lint 之后可能再提交一次）。**不是"按工作单元"的语义**——粒度是 per-LLM-reply，比"工作单元"细。

**（A）到底提交什么——三条路径，语义各不相同（这是本节的核心）。**

| 路径 | 默认 | 提交范围 | 是否会卷进用户的脏改动 |
| --- | --- | --- | --- |
| 自动提交（`--auto-commits`） | **`True`** | **只含它本次改过的文件**——`git add <fname>` + `git commit -m <msg> -- <fnames>`（**path-limited**） | **不会** |
| `--dirty-commits` | **`True`** | 编辑前先提交"**即将被编辑**且已脏"的文件 | **会**（设计如此：为了把用户的既有改动与 Aider 的改动分开） |
| `/commit` 命令 | 手动 | **整个工作树的已跟踪脏改动**——走 `git commit -a` | **会** |

**主 agent 亲自复核的两个默认值**（`aider/args.py`）：`--auto-commits` 默认 `True`、`--dirty-commits` 默认 `True`。【实抓】

**关键的两点：**
1. **自动提交用 path-limited commit，因此正是"只提交本工作单元产生的改动"的 git 原生实现**（见 §28 的 `git commit -- <paths>` 语义）。**这条证明该不变量是可达成的。**
2. **Aider 主动在另外两条路径上放弃了它**——`--dirty-commits` 和 `/commit` 都会提交用户自己的改动。**这不是 bug，是设计**。所以"自动提交"这个词本身不够精确：**必须逐路径写明提交范围。**

**一条容易踩的耦合（源码级）**：`aider/coders/base_coder.py` 里写死

```python
if not auto_commits:
    dirty_commits = False
```

**即关掉 `--auto-commits` 会连带关掉 `--dirty-commits`。** 用户以为只关了一个开关，实际关了两个。【子代理实抓】

**提交消息生成。**
- 默认提示词在 **`aider/prompts.py` 的 `commit_system`**——**注意：不在 `aider/resources/`**（该目录只有 `__init__.py`、`model-metadata.json`、`model-settings.yml`）。任务书此处的前提有误。【实抓】
- 提示词显式列出 Conventional Commits 的 type 集合，**只生成单行消息**。
- 输入是 **diff + 对话历史**，由 **`--weak-model`** 生成（官方文档表述："Aider sends the `--weak-model` a copy of the diffs and the chat history"）。
- **生成失败仍然提交**，用占位消息 `(no commit message provided)`（`repo.py:269-270`）。**这是一个真实且易漏的失败路径：消息生成失败不会阻止提交。**【子代理实抓】

**两条"不做"值得单独记：**
- **`--test-cmd` / `--auto-test` 完全不 gate 自动提交**：`auto_commit()` 在 `base_coder.py:1589` 先执行，测试在 `:1616` 之后才跑。**即"测试没过"不会阻止 commit。**
- **失败处理是"记录并放过"**：git 提交异常被 `ANY_GIT_ERROR` 捕获、只打日志、返回 `None`——**不中断会话**。

**（B）人怎么被保护——`/undo` 的严格边界。**

`/undo` 的拒绝条件（**7 条**，其中最关键的一条是 push 边界）：

- **不是 aiders 本次会话提交的** → 拒绝，并**只建议**（不执行）`/git reset --hard HEAD^`，附带警告 "be aware that this is a destructive command!"。
- **commit 有多个父提交** → 拒绝（`more than 1 parent, can't undo`）。
- **`local_head == origin/<branch>`（即已经推上去了）** → 拒绝，原文：
  > The last commit has already been pushed to the origin. Undoing is not possible.

**`/undo` 的真实恢复动作（主 agent 亲自复核源码）**：对每个被改动的文件执行 `git checkout HEAD~1 <file_path>`，全部恢复成功后执行 **`git reset --soft HEAD~1`**（**soft，不是 hard**）——**注意 CR4 的中间报告把它写成了 `reset --hard`，那是 `commands.py:576` 给用户看的建议文案，不是 `/undo` 执行的动作。以源码为准。**【实抓】

**"不 push"换来的是"可撤销"——这条因果链是本设计最该复制的部分。** 一旦推出去了，`/undo` 就永久关闭。**这正是负责人要求"push 由人决定"的技术理由。**

**（B）一条反向的教训：Aider 默认绕过 pre-commit hook。** `--git-commit-verify` 默认 **`False`**，即 Aider 默认给 `git commit` 加 `--no-verify`，**跳过 pre-commit hook**。【实抓】这条直接削弱了"用 pre-commit hook 拦截 secret"的方案——见 §26。

**是否 push。** **完全没有 push 能力。** `args.py`（完整 CLI 定义）与官方选项页全文中 `push` **零匹配**，无 `cmd_push`、无 `--auto-push`；全仓库唯一出现 `push` 的地方是上面那条 `/undo` 的拒绝文案。【子代理实抓 + 主 agent 复核】唯一的出口是 `/git` 逃逸舱（跑任意 git 命令）。

**attribution。** 提交者变成 `<user> (aider)`；`--attribute-co-authored-by` 默认 `True`，会加一个 trailer。**attribution 默认值最容易记错——建议像 Aider 一样在源码里写死并用测试固定，而不是靠文档约定。**

**引用**
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/args.py 【实抓，`--auto-commits` / `--dirty-commits` / `--git-commit-verify` 默认值】
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/repo.py 【子代理实抓，`commit()` 暂存范围与错误处理】
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/prompts.py 【子代理实抓，`commit_system`】
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/commands.py 【实抓，`cmd_undo` 的 7 条拒绝条件与恢复动作】
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/coders/base_coder.py 【子代理实抓，`auto_commits`/`dirty_commits` 耦合与提交时序】
- https://aider.chat/docs/git.html、https://aider.chat/docs/config/options.html 【子代理实抓】
- **未能核实**：4 条 issue（#4074 / #5033 / #5045 / #3834）的正文——`api.github.com` 单条 GET 被限流，**只读到标题**。

## 19. Claude Code

**（A）到底提交什么——答案是：本地不提交，用私有快照。**

**主 agent 亲自复核的 checkpointing 语义：**
- **触发**：**每个开始新一轮的 prompt 之前**捕获一次状态。
- **捕获范围**：**只跟踪它自己的文件编辑工具所做的改动**。**Bash 改动、后台 subagent 的改动、符号链接不可 restore**——这是它公开的已知边界。【子代理实抓】
- **载体**：**私有快照，不是 git commit**。快照**随对话一起保存**，所以 `/rewind` 在 resume 之后仍然可用。
- **保留**：每个会话保留**最近 100 个** checkpoint；快照在**会话最后一次保存后约 30 天**的清理中被删除；相关设置 `cleanupPeriodDays`。
- **已知失败模式（官方文档化，逐字要点）**：**"Rewinding to a checkpoint whose snapshots are gone can fail with `No files were restored`"**——**即保留期过了之后，回滚会失败。这是"私有快照"路线固有的数据丢失面。**

**（B）人怎么被保护。** `/rewind` 提供五档动作：Restore code and conversation / Restore conversation / Restore code / Summarize from here / Summarize up to here。**并且明确说明 "Summarizing doesn't change files on disk"**——即"从某点重新总结"与"恢复文件"是正交的两件事。【实抓】

**是否 push。** **本地 CLI/IDE 版本不 commit、不 push**；**Web/云端会话**会在云端分支上 commit 并 **push 一个 branch**。**同一个产品两个面语义完全不同——引用时必须指明是哪一个。**

**一条对 harness 设计直接可用的机制。** Claude Code 提供 **`PreToolUse` deny hook**，其匹配表**明确支持 `Bash(git *)` 从而匹配到 `git push`**。**即"不自动 push"是用 hook 强制出来的，而不是靠"没实现 push 功能"。**（对照 §20 的 Cline：只要 agent 有 shell 就能 push。）

**引用**
- https://docs.claude.com/en/docs/claude-code/checkpointing 【子代理实抓】
- https://docs.claude.com/en/docs/claude-code/hooks 【子代理实抓，`PreToolUse` 匹配表】
- https://docs.claude.com/en/docs/claude-code/settings 【子代理实抓，`cleanupPeriodDays`】
- **未能核实**：`docs.claude.com` 的 web/云端会话页中"push"的确切措辞边界。

## 20. Cursor / Windsurf（现 Devin Desktop）/ Cline

### 20.1 Cursor

**（A）本地 Agent 不提交、不 push。** 它用**本地私有 checkpoint（非 git）**，在 Agent 做**重大改动之前**捕获。**只有在用户自己提交之后**才触发 Agent Review。

**Cloud Agent 则相反**：commit 并 **push 到你的仓库**（官方原文含 "then push changes to your repo"）。**同一产品两个面语义相反，引用必须指明。**

**（B）人的保护。** 本地 **Restore Checkpoint**（**独立于 git**）。

**未能核实**：checkpoint 的保留期、是否跨重启、存储位置。

### 20.2 Windsurf / Cascade（现 Devin Desktop）

**（A）不自动提交、不 push**；用**私有快照/revert 点**，**每个 prompt 步骤**可 revert。

**（B）一条硬教训：官方明确 revert 是"不可逆"的**，另提供 named checkpoint。**【事实】即"能回滚"与"能撤销回滚"是两件事——**只有前者时，误 revert 就是永久数据丢失。**

**未能核实**：checkpoint 的存储位置与持久化行为。（`docs.windsurf.com` 返回 HTML 而非 Markdown，已改抓 canonical 源 `docs.devin.ai`。）

### 20.3 Cline——三个机制值得单独抄

**（A）不自动提交真 git。** 它只做"**生成 commit message 填进 SCM 输入框**"，**人再点提交**。

**但它有一个必须正视的风险（官方文档自己列的）**：**auto-approve / YOLO 模式的官方文档把 "Commit and push changes to version control" 列为风险项**——**只要 agent 有 shell，它就能 push。**【子代理实抓，官方 auto-approve 文档】

> **这是第二部分最重要的一条安全结论：`"不自动 push" 不能靠 "不实现 push 功能" 来实现。`** Aider 能成立是因为它的代码里真的没有 push 路径；而**任何给 agent 提供 shell 的工具，都必须把 push 约束加在 harness 层**——对应 Claude Code 的 `PreToolUse` deny hook、Copilot 的 `preToolUse` hook。

**值得抄的机制一：私有 ref（持久化方案）。**
Cline 当前实现把快照存成**用户自己 `.git` 里的私有 ref**：
- ref 名：**`refs/cline/checkpoints/<sessionId>/<runCount>`**
- 私有 index 在 `<Cline data dir>/checkpoint-scratch/<sha256(cwd+sessionId)[:32]>`
- **对 `git log` / `git stash list` / `git branch` 全部不可见**，但**在 git 对象库里 → GC-safe、跨重启存活、可用 stash-apply 语义恢复**

**旧版（tag `v3.17.0`）用的是另一种方案**：`<VS Code globalStorage>/checkpoints/<cwdHash>/.git` 的**独立影子仓库**。**同一个产品演进出了两种方案，私有 ref 那种更好。**

**【事实】这是对"自动提交但用户不想看到满屏 commit"的一个成熟答案**：既拿到了 git 的持久性与 GC 安全性，又不污染用户的可见历史。

**值得抄的机制二：每个新 user turn 一次快照。** 当前源码的触发是 `beforeModel` + `iteration === 1` + `countUserRunMessages`，即**每个新 user turn 一次**。

**但这里有一个必须注意的不一致**：**官方文档写的触发是 "After each tool use"（每次工具调用之后），与当前源码不符。**【子代理实抓，新旧源码对照】 **教训：文档落后于实现时，只有源码能作准——引用行为前先读实现。**

**值得抄的机制三：三档 restore**（而非单一的"回滚"）。

**引用**
- `cline/cline`：`sdk/packages/core/src/hooks/checkpoint-hooks.ts`（23 KB，核心）、`session/checkpoint-restore.ts`、`commit-message-generator.ts`；tag `v3.17.0` 的 `CheckpointUtils.ts` / `CheckpointTracker.ts` 【子代理实抓】
- Cursor：`docs.cursor.com` 的 agent/overview、agent-review、cloud-agent、help/integrations/git 【子代理实抓】
- Windsurf/Devin Desktop：`docs.devin.ai` 的 cascade + ai-commit-message 【子代理实抓】
- **未能核实**：`docs.windsurf.com` 与 `docs.cursor.com` 的 `.md` 路径 **404**；Cursor/Windsurf checkpoint 的保留期与存储位置。

## 21. 云端 agent：GitHub Copilot coding agent 与 Devin

**这两个是"真 commit 且真 push"的一派**，放在这里是因为**它们是"push 由人决定"的反面参照**——看清它们为什么必须 push，才知道本特性为什么可以不 push。

### 21.1 GitHub Copilot coding agent / cloud agent

**（A）自动 commit + 自动 push。** 官方描述含 "automates branch creation, commit message writing, and pushing"。载体是**远端分支 + PR**。

**但官方文档同时明确限制了它的能力边界（逐字要点）：**
- **"cannot directly run `git push`"**
- **"Requires human review before merging"**
- **"Sessions do not create pull requests automatically."**

**【事实】即"自动 push 一个分支"和"能自己推任意东西"是两回事**：Copilot 的 push 被收敛成"为委派任务创建一个分支"，**合并与 PR 创建都留给人**。**这是"push 自动化"能被接受的前提：把 push 的目标收窄成一个受控产物。**

**唯一的定时成分（值得单独记）。** Copilot **automations** 支持 **hourly / daily / weekly** 的 schedule——**这是本次调研在 AI 工具里找到的唯一"定时器"**。**但它定时启动的是 agent，不是 git 操作。** 即：**"定时"在这个生态里的既有含义是"定时唤醒一个会做事的东西"，而不是"定时对仓库做机械对齐"。**

**其他限制**：单分支单 PR；受 repository ruleset 阻塞；automation 创建的 PR **不可自审**；提供 `preToolUse` hook。

### 21.2 Devin（Cognition）

**（A）自动 commit + 自动 push**（官方描述含 "pushing branches, opening pull requests"），载体是远端分支 + PR；**任务被委派时触发**。

**（B）人的保护。** PR 评审 + commit authoring 模式 + security profile。

**一条失败模式**：**会话内 GPG key 会丢失**。【子代理实抓】

**未能核实**：Devin 的 commit message 生成方式；automations 的 schedule 正文（只从 `llms.txt` 摘要看到）。

## 22. jj 的工作副本自动快照——"把冲突变成数据"

**这是"自动提交"最激进的形态：连你想不想提交都不问，工作副本的每一次变化本身就是一次 commit。**

**（A）触发与捕获范围。**
- **自动从工作副本内容创建 commit**，只要内容变了；**大多数 jj 命令都会顺带提交工作副本的改动**。
- **新文件默认被隐式跟踪**（`snapshot.auto-track` 控制）。
- **关键的安全边界（逐字）**：**"Files with paths matching ignore files are never tracked automatically"**——即 **`.gitignore` 里的路径不会被自动纳入**。这是它与 IDE 本地历史（§23，**完全不读 `.gitignore`**）的根本区别。
- 已跟踪的文件保持跟踪；用 `jj file track` / `untrack` 显式管理。
- **每次快照产生一个新的 revision，取代上一个工作副本 revision**——所以不会堆积成满屏 commit。

**（B）冲突怎么处理——这是本文认为最优雅的一条机制（逐字）：**

> Jujutsu's solution is to add conflict markers to conflicted files when it writes them to the working copy. **It also keeps track of the (typically 3) different parts involved in the conflict.** Whenever it scans the working copy thereafter, **it parses the conflict markers and recreates the conflict state from them.** You can resolve conflicts by replacing the conflict markers by the resolved text. **You don't need to resolve all conflicts at once. You can even resolve part of a conflict by updating the different parts of the conflict marker.**

**即：冲突是 commit 内部的 first-class 数据，操作照常成功，没有 "rebase in progress" 状态需要清理，允许部分解决。** 对照 gh-stack 的"整栈回滚"和 git-town 的"停住等人"，这是**第三条路**。

**（B）人的保护。** `.jj/` 内的 **operation log**：每步操作都是可回滚条目，`jj undo` / `jj op revert` / `jj op restore` **可回到任意历史操作点**；并发是 **lock-free** 的（各命令基于自己看到的 operation，分叉由后续 `jj st` / `jj log` 暴露）。

**硬边界（值得抄的一条"拒绝自动化"）。** **`immutable_heads()`：默认拒绝改写从 `trunk()` 可达的一切。** 即**自动 rebase 后代的能力被限制在"未进入主线的提交"上**。

**已知失败模式：stale working copy（见 §10 的逐字引文）。** 工作副本自己记录"最后更新到哪个操作"，因此陈旧可检测（`jj workspace update-stale`）、可恢复（操作丢失时创建一个 recovery commit）。

> ### ⚠️ 一条容易漏掉的交互风险：jj 并不"不动 git"
>
> **在 colocated 工作区（`.git` 与 `.jj` 并存）下，jj 的每条命令都会自动 import/export，并且会通过 `try_reset_git_head` → `jj_lib::git::reset_head` 把本地 Git HEAD 置为 detached 状态。**（`docs/git-compatibility.md` + `cli/src/cli_util.rs` 第 2185–2204、2727–2751 行，子代理实抓）
>
> **对本设计的直接含义**：本特性的第一件事就是"对齐 git"。**如果工作区里存在 jj（或其他会改写 `.git` 的工具），那么"定时对齐 git"这一层必须考虑：它的 `rev-parse` / `status` 观测结果可能被另一个工具同时改写。** §14 的 VS Code autofetch 用 `whenIdleAndFocused()` 规避"人正在操作"的竞态；**这里需要的是对称的东西——"另一个工具没在改 `.git`"的前置检查**（或直接选择不与之共存）。**这类"两个写者都认为自己在管 git"的场景，本文调研的产品里没有一个处理过，属于本设计必须自己决定的部分。**
>
> **另一条相关事实**：jj 官方 FAQ 明说，**对于已被跟踪的文件，"there's no way to prevent Jujutsu from committing changes to the file"**——即 **ignore 规则只在"文件尚未被跟踪"时生效**。**所以"靠 ignore 把敏感文件排除在自动提交之外"这个方案，一旦文件被跟踪过一次就永久失效。**

**引用**
- https://jj-vcs.github.io/jj/latest/working-copy/ 【实抓】
- https://jj-vcs.github.io/jj/latest/conflicts/ 【实抓】
- `jj-vcs/jj` 的 `docs/technical/conflicts.md`、`docs/operation-log.md`、`docs/config.md` 【子代理实抓】

## 23. IDE 本地历史：VS Code 与 JetBrains——"私有快照"路线的完整实现

**这一节回答的是"如果不想写真 git commit，替代方案长什么样、代价是什么"。**

### 23.1 VS Code Local History

**触发。** **只有"保存"会触发；在编辑器里打字本身不会。** 源码入口是 `workingCopyHistoryTracker.ts` 的 `onDidSave`（逐字）：先 `shouldTrackHistoryFromSaveEvent(e)`，再比对 content version，"**return early when content version already has associated history entry**"（即**同一内容版本不重复记录**）。保存来源会被记录（含 `UNDO_REDO_SAVE_SOURCE`）。

**（A）捕获范围——与 jj 最根本的差异：它完全不知道 git，也不读 `.gitignore`。** 源码级证据：`workingCopyHistoryService.ts` 与 `workingCopyHistoryTracker.ts` 中 **`grep -i gitignore` 计数为 0**。【子代理实抓】

> **【推断，但由源码直接推出】因此 `.env`、凭据文件、`node_modules` 里的文件只要被保存过，就会被完整抄进 `User/History/`。** 过滤条件里**没有任何路径白名单/黑名单**。**【事实】这对"自动提交"是一条严重的警示：一个不做忽略判断的自动快照器，会把凭据抄进它自己的存储。**

**载体与位置。** 私有文件，不是 git：
- `environmentService.ts` 逐字：`get localHistoryHome(): URI { return joinPath(this.appSettingsHome, 'History'); }` → **`<User data dir>/User/History/`**
- **每个文件一个子目录，目录名是资源 URI 的十六进制哈希**：`toHistoryEntriesFolder` 逐字 `joinPath(historyHome, hash(workingCopyResource.toString()).toString(16))`
- 目录内有清单文件 **`entries.json`**

**跨重启存活。** 是（普通文件）；**且与工作区无关地全局存放**（`localHistoryHome` 不含工作区哈希），所以**删掉工作区文件夹不会删掉历史**。

**已知失败模式（源码级）。**
- **超出保留上限即永久删除**：`maxFileEntries`（**50**）裁掉最旧的 entry **并从磁盘删除**。
- **> 256 KB 的文件被静默跳过**，用户不会收到任何提示。
- **未保存的编辑不在历史里**——崩溃/断电时未保存的内容没有 entry。

### 23.2 JetBrains Local History

**触发面比 VS Code 宽得多**（官方逐字）：

> It automatically records your project's state as you edit code, run tests, deploy applications, and so on, and maintains revisions for all meaningful changes made **both from the IDE and externally**.

**周期**：官方帮助页**没有写"定时器"式周期快照**；触发被描述为事件驱动。【推断】"IDE 外部改动"意味着有文件系统监听，但**官方未给具体间隔**。

**捕获范围。** **官方未给出排除清单**；官方帮助页与本次抓到的源码中**均未发现 `.gitignore` 感知** →【推断】**同样不尊重 `.gitignore`**。

**（B）拒绝做的事（官方逐字，很干净）：**

> Local History **does not support shared access**, it is stored locally and intended only for personal use. However, you can create a patch file with changes relative to a specific revision, which you can share with others.

**即：不共享、不推送、不创建 git commit；导出 patch 是显式动作。**

**位置与跨重启（官方逐字）：** 存在 IntelliJ **system 目录**下的 `LocalHistory` 子目录（`%LOCALAPPDATA%\JetBrains\<product><version>` / `~/Library/Caches/JetBrains/...` / `~/.cache/JetBrains/...`，可用 `idea.system.path` 改）。**跨重启存活，但跨 IDE 大版本升级不存活**（逐字："Local History is cleared when you install a new version of IntelliJ IDEA"）——**这是"私有快照路线"独有的数据丢失面：宿主软件升级就清空。**

**官方文档化的三条失败模式**：①**升级 IDE 即清空**；②**有保留期与大小上限，不保证持久**（"revisions are not guaranteed to persist"）；③**不支持共享**。

### 23.3 从这一节得出的两条结论

1. **"私有快照"路线的共同代价是"不可预期地被清理"**：VS Code 的 50 条上限 + 静默删除、JetBrains 的升级清空 + 保留期、Claude Code 的 30 天（失败时报 `No files were restored`）。**没有任何一家的私有快照承诺持久。**
2. **"二进制/私有格式 + 不读忽略文件" 是安全上的双重弱点**：既可能把 secret 抄进去，又无法用 git 的工具链审计它。**如果本特性要提供快照，落在 git（哪怕私有 ref）比落在自有格式更好**——Cline 的私有 ref 方案是这两者之间的一个更优点。

**引用**
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/workingCopy/common/workingCopyHistoryTracker.ts 【子代理实抓】
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/workingCopy/common/workingCopyHistoryService.ts 【子代理实抓，过滤条件与目录命名】
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/environment/common/environmentService.ts 【子代理实抓，`localHistoryHome`】
- https://code.visualstudio.com/docs/getstarted/userinterface、https://code.visualstudio.com/updates/v1_66 【子代理实抓】
- https://www.jetbrains.com/help/idea/local-history.html 【子代理实抓】
- `JetBrains/intellij-community`：`platform/vcs-impl/src/com/intellij/history/core/LocalHistoryStorage.java`、`PersistentChangeListStorage.kt`、`ChangeListStorage.java`、`impl/LocalHistoryImpl.kt` 【子代理实抓】
- **未能核实**：JetBrains YouTrack 上的失败 issue（本次未访问）；VS Code 官方**未提供** Local History 的"已知问题"清单，23.1 的失败模式**均由源码行为推出**。

## 24. 真正的"自动提交守护进程"：etckeeper、git-annex assistant、obsidian-git

**这三个是"已经跑了多年的自动提交器"**，它们的取舍值得逐条对照。

### 24.1 etckeeper——"每天提交一次、默认不 push、消息是死字符串"

**取证说明。** 任务书给的 GitHub 路径**全部失效**：`joeyh/etckeeper` 与 `etckeeper/etckeeper` **均 404（仓库不存在）**；上游真实地址是 `git://git.joeyh.name/etckeeper`，而 `https://git.joeyh.name/index.cgi/etckeeper/...` 返回 **403**。因此取证改用两个可达一手来源：官方站 `https://etckeeper.branchable.com/`（200）与 **Debian 源码镜像** `https://sources.debian.org/data/main/e/etckeeper/1.18.23-2/...`（200，内容为上游源码原文）。**来源层级已在笔记中标明。**

**触发（三条路径）。**
1. **包管理器 hook（主要路径）**。官方逐字：
   > Before apt installs packages, etckeeper **pre-install** will check that /etc contains no uncommitted changes. After apt installs packages, etckeeper **post-install** will add any new interesting files to the repository, and commit the changes.
   
   并实现于 dnf / yum / pacman / apk / zypper / xbps / emerge。
2. **cron 每日一次**：
   > There is also a cron job, that will use etckeeper to automatically commit any changes to /etc each day.
3. **systemd timer**（同一频率）：
   ```
   # Etckeeper includes both a cron job and a systemd timer, which each
   # can commit exiting changes to /etc automatically once per day.
   # To enable the systemd timer, run: systemctl enable etckeeper.timer
   # The cron job is enabled by default (unless the systemd timer is also enabled)
   ```

**periodic 实现的两个细节（可直接照抄）：**
- **每日脚本先判脏再提交**（逐字）：`if ! etckeeper unclean; then ... etckeeper commit "daily autocommit" ...`，且**避免在包安装进行中提交**（"avoid autocommit if an install run is in progress"）。
- **提交消息是固定的死字符串 `"daily autocommit"`——完全不做内容总结。** 【事实】即**一个成熟的每日自动提交器选择了"不总结"**，因为它面向的是 `/etc` 的机器状态，而不是人的工作。

**（A）提交什么范围。** `/etc` 整体；**"interesting" 被定义为".gitignore 没忽略的文件"**——**注意它读忽略文件**（与 §23 的 IDE 本地历史相反）。`.etckeeper` 元数据文件由 **pre-commit hook** 生成并入库（`pre-commit.d/30store-metadata`），记录所有者/权限/空目录（因为 git 不能跟踪空目录）。

**一条"非 0 退出阻断"的例子**：`update-ignore` 在已有 `.gitignore` 但**不含** etckeeper 托管标记时会 **exit 1 拒绝改写**，除非传 `-a`。**但它阻断的是"改写 .gitignore"，不是提交。**

**（B）是否 push——`PUSH_REMOTE=""` 默认为空，即默认不 push。**（`etckeeper.conf` 末尾逐字）这与本需求"push 由人决定"的默认姿态**完全一致**。

push 的实现只有 4 行（`commit.d/99push`）：
```sh
#!/bin/sh
if [ -n "$PUSH_REMOTE" ]; then
	if [ "$VCS" = git ] && [ -d .git ]; then
		for REMOTE in $PUSH_REMOTE; do
			git push "$REMOTE" || true
		done
```
**注意 `|| true`：push 失败也不阻断、仍返回 0。** 【事实】**即 etckeeper 认为"推送失败不是提交路径的错误"**——这对"push 由人决定"的设计是个合理态度（push 是人的事，失败了不该影响工作）。

**未能核实**：`git.joeyh.name` 的 https gitweb（403）；etckeeper 的 issue tracker。

### 24.2 git-annex assistant——"守护进程 + 默认会 push"，以及一个绝妙的闸门设计

**触发。** **事件驱动，没有"间隔多久"这个概念**（逐字："Watches for changes to files in the current directory and its subdirectories"）。

**`annex.autocommit`**（定义在 git-annex 主手册页——**注意 `git-annex-autocommit` 独立页面 404，不存在**）：

> Set to false to prevent the git-annex assistant, git-annex assist, and git-annex sync from automatically committing changes to files in the repository.

**（B）它默认会 push——这是与 etckeeper 最大的不同**（逐字）：

> This command first commits any local changes to files that have previously been added to the repository. Then it does the equivilant of git-annex-pull (1) followed by **git-annex-push (1)**.

**三个开关（逐字）：**
- `remote.<name>.annex-sync` — "If set to false, prevents git-annex sync (and pull, push, assist, and the assistant) from operating on this remote by default."
- `remote.<name>.annex-push` — "If set to false, prevents git-annex push, sync, assist and the assistant from ever pushing to the remote."
- **`remote.<name>.annex-sync-command`** — 逐字：

  > If set, the command is run, and **if it exits nonzero, that's the same as setting annex-sync to false.** This allows controlling behavior based on e.g., the current network.

> **【本文认为这是"push 由人决定"最优雅的实现原语。** 它把"要不要 push"外包给一个**任意命令的退出码**：0 = 允许，非 0 = 禁止。**本特性可以照此设计：一个"本工作单元是否已被人工批准"的检查命令，非 0 即不 push。** 这比"在代码里写 if 条件"更灵活，也把策略留给了部署者。

**注意区分**：`annex.synccontent` 管的是**大文件内容的传输**，**不是"要不要 push 提交历史"**；后者由 `annex-push` / `annex-sync` 控制。**这两个极易混淆。**

### 24.3 obsidian-git——"定时 commit-and-sync"，且默认连 push 一起做

**这是本次找到的唯一一个"定时自动提交 + 定时自动 push"的编辑器插件。** 官方 README 逐字：

> 🔁 **Automatic commit-and-sync** (commit, pull, and push) on a schedule.

配置项（逐字）：
- **Auto commit-and-sync interval (minutes)** — "Commit and sync changes every X minutes. **Set to 0 (default) to disable.**"
- **Auto push interval (minutes)** — "Push commits every X minutes. Set to 0 (default) to disable."
- **Auto pull interval (minutes)** — "Pull changes every X minutes. Set to 0 (default) to disable."
- **一条"停止编辑后才提交"的模式**："If turned on, do auto commit-and-sync every X after stopping file edits. This also prevents auto commit-and-sync while editing a file. If turned off, it's independent from the last file edit."

**（A）提交范围是最宽的**（逐字）："`Commit-and-sync`: With default settings, this will **commit all changes**, pull, and push"——**整个仓库，不是当前文件。**

**（B）默认 push 打开**：`src/constants.ts` 逐字 `disablePush: false,`；实现里还有一条注释 "Prevent trying to push every time. Only if unpushed commits are present"。

**【事实】即这个插件把"自动提交"和"自动推送"绑在同一个定时器上、且默认全开。** 它正好是本需求要**避免**的形态——也说明"push 由人决定"是一个需要显式设计的选择，而不是自然默认。

**引用**
- https://etckeeper.branchable.com/ 与其 `README`、`install` 子页 【子代理实抓，200】
- https://sources.debian.org/data/main/e/etckeeper/1.18.23-2/ 下的 `etckeeper.conf`、`daily`、`commit.d/99push`、`pre-commit.d/30store-metadata`、`init.d/50vcs-pre-commit-hook` 【子代理实抓，200】
- https://git-annex.branchable.com/git-annex/（主手册页）、`/git-annex-sync/`、`/git-annex-assistant/`、`/git-annex-watch/`、`/git-annex-assist/` 【子代理实抓】
- https://raw.githubusercontent.com/Vinzent03/obsidian-git/master/README.md 与 `src/constants.ts` 【子代理实抓】
- **未能访问**：`joeyh/etckeeper` 与 `etckeeper/etckeeper`（**404，不存在**）；`git.joeyh.name` 的 https gitweb（**403**）；`git-annex-autocommit` 页面（**404，该页不存在**，定义在主手册页）；`https://etckeeper.branchable.com/README/` **完全没提 `PUSH_REMOTE`**。

## 25. 提交消息生成（"自动总结"）——没有一家自动总结到"工作单元"粒度

**先说结论：本需求里"在每个工作内部自动总结"这个粒度，在同类产品里没有先例。** 最接近的是 Cline 的 per-user-turn 快照和 Copilot 的"每步一个 commit"；Aider 的粒度是 **per-LLM-reply**，比"工作单元"更细。

### 25.1 格式规范：Conventional Commits 1.0.0（主 agent 亲自核对原文）

**结构是规范性的（`MUST`），但"类型词表"不是规范规定的。** 逐字：

> Commits **MUST** be prefixed with a type, which consists of a noun, `feat`, `fix`, etc., followed [by an optional scope, an optional `!`, and a colon and space]
> The type `feat` MUST be used when a commit adds a new feature… The type `fix` MUST be used when a commit represents a bug fix…
> **Additional types are not mandated by the Conventional Commits specification, and have no implicit effect in Semantic Versioning** (unless they include a BREAKING CHANGE).

并且逐字：`BREAKING CHANGE` 是"a footer `BREAKING CHANGE:`，或 after the type/scope 加 `!`"，且"**A BREAKING CHANGE can be part of commits of any type.**"；只有 `fix` → PATCH、`feat` → MINOR、BREAKING → MAJOR 有语义。

**【事实】即：如果本特性采用 Conventional Commits，必须自己决定两件事——① 类型词表（规范不强制）② 允不允许 `!`/`BREAKING CHANGE`（自动总结出的 breaking change 声明风险很高）。** 后者尤其要考虑：**一个自动生成的 `!` 会触发下游的 MAJOR 版本语义。**

### 25.2 各工具的真实做法

| 工具 | 消息从哪来 | 输入是什么 | **它自己提交吗** | push |
| --- | --- | --- | --- | --- |
| **Aider** | `aider/prompts.py` 的 **`commit_system`**（**不是** `aider/resources/`），显式列出 type 集合，**只生成单行** | **diff + 对话历史** → 交给 **`--weak-model`** | **是**（自动提交）。生成失败用占位消息 `(no commit message provided)` **仍提交** | **从不** |
| **commitizen** | 交互式选择 type/scope；配置面见 `defaults.py` 的 `CONFIG_FILES` 与 `BUMP_MAP` | 人 | **是**（`cz commit` 提交） | 否 |
| **cz-git** | 交互式 | 人 | 是 | 否 |
| **opencommit** | LLM 生成，默认走自带 conventional-commit 模块（可切 `@commitlint`） | diff | 是 | **默认会"询问"是否 push**（见 25.3） |
| **aicommits** | LLM 生成后**填进输入框** | **`git add --update`**（见 25.4） | **否** | 否 |
| **ai-commit**（insulineru / guanguans 两个项目） | LLM 生成 | diff | 否 | 否 |
| **GitHub Copilot（VS Code）** | LLM 生成后**只填进 commit message 输入框** | **已暂存的改动（staged changes）** | **否** | 否 |

**一条重要的取证结论：`docs.github.com` 上不存在 Copilot 提交消息生成的专页**（4 个候选路径**均 404**）。**一手来源是 VS Code 文档**，逐字：

> select the sparkle icon in the commit message input box to use AI to generate the message **based on your staged changes**

**【事实】即 Copilot 的输入面是"暂存区"——它不会自己 `git add`，也不会自己提交，更不会 push。人必须点 Commit。** 这是"AI 总结 + 人提交"的干净分界。

**更正**：`.czrc` **不是** commitizen（Python）的配置文件。【子代理实抓】

### 25.3 opencommit：一个"提交消息工具默认会问要不要 push"的先例

官方 README 逐字：

> **A prompt for pushing to git is on by default** but if you would like to turn it off just use: `oco config set OCO_GITPUSH=false` and it will exit right after commit is confirmed **without asking if you would like to push to remote**.

**注意语义是"prompt（询问）"，不是"自动 push"。** 源码里该键已标 `// todo: deprecate`（`src/commands/config.ts:35`）。**【事实】这是一个"提交后由人决定是否 push"的现成先例——它把 push 做成一个默认开启的询问，而不是静默默认动作。**

### 25.4 一个值得抄的暂存细节：`aicommits` 用 `git add --update`

`aicommits.ts:50` 用的是 **`git add --update`**。**【事实】`--update` 只暂存"已跟踪文件的修改与删除"，不会把新文件（untracked）加进来**——因此**一个自动生成消息的工具不可能把意料之外的新文件（例如刚生成的 `.env`）带进 commit**。这是一条**用 git 原语实现的、默认安全**的暂存范围。

### 25.5 对本设计的直接含义

1. **"自动总结"应当只产出消息，不产出"要不要提交"的决定**（除 Aider 外，所有工具都是这个形状）。
2. **消息生成的失败必须显式处理。** Aider 的选择是"用占位消息仍然提交"——这会让一次消息生成失败静默地留下一条垃圾历史。**本设计应当明确表态：生成失败时是"用占位消息提交"、"不提交"还是"提交但标记为待补"。**
3. **输入面要写清楚：diff？暂存区？对话历史？** 三者的安全属性不同：**以"暂存区"为输入（Copilot、aicommits）是最安全的**，因为暂存动作本身是可控的。
4. **类型词表与 `!`/`BREAKING CHANGE` 的产生权必须显式决定**，规范不会替你做。

**引用**
- https://raw.githubusercontent.com/conventional-commits/conventionalcommits.org/master/content/v1.0.0/index.md 【实抓，`MUST` 条款与"类型不受规范强制"】
- https://code.visualstudio.com/docs/sourcecontrol/staging-commits 【实抓，Copilot 消息生成输入面】
- https://raw.githubusercontent.com/di-sukharev/opencommit/master/README.md 与 `src/commands/config.ts` 【实抓，"push prompt 默认开启" + `OCO_GITPUSH` 标记为 todo: deprecate】
- Aider / commitizen / cz-git / aicommits / ai-commit 【子代理实抓，源码与官方文档】
- **未能核实**：Copilot 消息生成的失败路径、是否强制先暂存、Desktop 侧输入范围、`commitMessageGeneration.instructions` 的完整 schema——官方文档均未描述。

## 26. 提交前的 secret 阻断

**自动提交的核心安全问题**：一旦提交由机器发起，**"提交前扫一遍"就成了唯一的拦截点**。所以这一节只问一件事：**它到底会不会"阻断"（非 0 退出码），还是只警告？** 答案在四个工具之间差异极大。

### 26.1 git 自己的 hook 语义（主 agent 亲自核对 `githooks.adoc` 与 `git-commit.adoc`）——结论比预想的更严格

**三个 commit 期 hook 的逐字定义（`githooks.adoc`）：**

- **`pre-commit`**：*"This hook is invoked by git-commit[1], and **can be bypassed with the `--no-verify` option**. … Exiting with a non-zero status from this script causes the `git commit` command to abort before creating a commit."*
- **`commit-msg`**：*"This hook is invoked by git-commit[1] and git-merge[1], and **can be bypassed with the `--no-verify` option**. … Exiting with a non-zero status …"*（非 0 → `git commit` abort）
- **`prepare-commit-msg`**：*"If the exit status is non-zero, `git commit` will abort. The purpose of the hook is to edit the message file in place, and **it is not suppressed by the `--no-verify` option.** … **It should not be used as a replacement for the pre-commit hook.**"*

**`git-commit.adoc` 对 `--no-verify` 本身的定义（逐字）：**

> `--no-verify`:: **Bypass the `pre-commit` and `commit-msg` hooks.**

> ### ⚠️ 本节最重要的结论（本文早期草稿在此处判断有误，已按原文更正）
>
> **在 commit 期，唯一不被 `--no-verify` 抑制的 hook 是 `prepare-commit-msg`——但它只拿到「提交消息文件」，拿不到被提交的文件内容**，所以**无法用来扫描 diff 里的 secret**。它的官方说明甚至自己提醒：**"It should not be used as a replacement for the pre-commit hook."**
>
> **即：不存在一个"既扛得住 `--no-verify`、又能看到文件内容"的 commit 期 git hook。**
>
> 而 §18 已核实：**Aider 的 `--git-commit-verify` 默认是 `False`，即它默认给 `git commit` 加 `--no-verify`。**
>
> **结论：对一个默认带 `--no-verify` 的自动提交器，"装一个 pre-commit hook 扫 secret"在结构上就是无效的**——`pre-commit` 与 `commit-msg` 都能被 `--no-verify` 绕过，而 `prepare-commit-msg` 看不到内容。**真正拦得住的只有两处：① 机器人自己的提交流程内部（提交前自己扫，不依赖 git hook）；② `pre-push` hook / 服务端检查。**
>
> **而第 ② 处正好与本需求"push 由人决定"完全合拍：既然 push 由人触发，那么"人按 push 的那一刻"就是最后一个可靠的闸门。** 这不是巧合——**把 secret 检查放在人 push 的路径上，比放在机器自动提交的路径上更可靠，因为后者总有 `--no-verify`、`SKIP=`、baseline 这些绕过口。**

**这条结论不来自任何产品的文档，也不来自任何博客——它是三个独立一手事实（git 三个 hook 的定义 + `--no-verify` 的定义 + Aider 的默认值）的直接推论。**

### 26.2 四个 secret 扫描器：谁真的阻断

| 工具 | **默认会阻断吗** | 阻断的开关 / 退出码 | 豁免机制 |
| --- | --- | --- | --- |
| **gitleaks** | **会（默认阻断）** | `--exit-code` **默认值就是 `1`**；官方 pre-commit hook 的 `entry` **不传 `--exit-code`**，因此走默认 → 发现即非 0 | `--baseline-path` / `-b`（载体是**任意 gitleaks report**）+ `.gitleaksignore` |
| **trufflehog** | **不会（默认永不阻断）** | **只有显式加 `--fail` 才阻断**，`--fail` → **退出码 183**；扫描本身出错默认也不阻断，需 `--fail-on-scan-errors` | 行内注释 **`trufflehog:ignore`**（**不是**独立 baseline 文件） |
| **detect-secrets** | **会（默认阻断）** | 源码 `return 1`；**另有 `return 3` = baseline 被自动刷新时也非 0**（一个坑：看起来像失败，其实是它更新了豁免清单）。**官方 README 全文无 exit/non-zero 字样**（`docs/pre_commit_hook.md` 抓取 404），退出码**只来自源码** `detect_secrets/pre_commit_hook.py`，**未经文档侧交叉验证** | baseline 文件 |
| **pre-commit（框架）** | **会** | 逐字："The hook must **exit nonzero on failure** or modify files."；commit-msg 侧："**The commit will be aborted if there is a nonzero exit code.**"；源码链 `run.py` 的 `retval \|=` → `hook_impl.py` → `main.py` 的 `SystemExit` 透传；另有 `fail_fast`（默认 `false`） | `SKIP=<hook-id> git commit …`，以及 `--no-verify`（**框架把 hook 装成 git 的 `pre-commit` / `commit-msg` hook，因此两者都受 §26.1 的绕过规则约束**） |

**gitleaks 的一手细节（逐字）：**
> You can always set the exit code when leaks are encountered with the `--exit-code` flag. Default exit codes below:
> `      --exit-code int                 exit code when leaks have been encountered (default 1)`

官方 pre-commit hook 的 `entry` 逐字：
```
entry: gitleaks git --pre-commit --redact --staged --verbose
```
**没有 `--exit-code` → 走默认 1 → 非 0 → pre-commit 判 Failed → 提交被阻止。** 绕过方式官方直接给出：`SKIP=gitleaks git commit -m "skip gitleaks check"`。

`gitleaks git` 的扫描面（逐字）："Under the hood, gitleaks uses the **`git log -p`** command to scan patches. You can configure the behavior of `git log -p` with the `log-opts` option."

**trufflehog 的一手细节——它官方自己承认了"不加 `--fail` 就等于没有门"**（逐字）：
> This change does two things: (1) **removes the `--fail` flag, which means the pre-commit hook will *always* pass**, (2) suppresses `stderr` output…

**【事实】即 trufflehog 的默认姿态是"报告，不阻断"。** 这在实际部署里极易被误认为"已经装了扫描器所以安全"。

**detect-secrets 的定位最适合本场景，代价也最明确**：它走**增量 diff + baseline**，**【推断】最贴合"每个工作单元只提交增量"的自动提交形态**；但**它无法发现 baseline 生成之前就已存在的 secret**——这是设计取舍，不是缺陷。

**两条容易误解的事实（本文明确更正/不编造）：**
- **`.gitleaks-baseline.json` 这个文件名不存在。** gitleaks README 里 baseline 的载体是"**任意 gitleaks report**"，示例文件名是 `gitleaks-report.json`，flag 是 `--baseline-path` / `-b`。
- **trufflehog 的豁免不是 baseline 文件，而是行内注释 `trufflehog:ignore`**（`--no-ignore-tag` 可忽略这些注释、强制报出）。

### 26.3 已有的自动提交器自己怎么对待 secret

| 工具 | 做法 |
| --- | --- |
| **etckeeper** | **没有任何内建 secret 检测**。它安装的 pre-commit hook 只做元数据存储与"特殊文件警告"，且 `pre-commit.d/20warn-problem-files` 名字即 "warn"——**警告，不是阻断**；它在 linked worktree 场景下还用 `exit`（=0）**静默放行**。**更值得注意的是：etckeeper 故意把 `/etc/shadow` 这类文件入库，靠的是文件 mode 700，而不是 `.gitignore`** |
| **git-annex** | **没有内建 secret 检测**；且**默认覆盖整个目录、包含 dotfile**。**`annex.pre-commit-command` 的阻断语义不能假定**——同一份文档里紧邻的 `annex.pre-init-command` **明确承诺**了退出码语义（逐字 "**If it exits nonzero, the repository initialization will fail.**"），而 `pre-commit-command` 的官方描述**完全没有提退出码**。**这种同文档内的表述不对称只是线索、不是结论**；【推断】若本设计要依赖它拦 secret，**必须先实测** |
| **Aider** | **不做任何 secret 扫描**，而且默认 `--no-verify` **绕过别人的 pre-commit 扫描** |
| **obsidian-git** | **无 secret 扫描**（源码 grep `secret` / `scan` / `pre-commit` **零匹配**） |

### 26.4 面向本设计的结论（只写已取证的事实）

1. **"装了扫描器"≠"拦得住"。** 四个工具里**只有 gitleaks 默认阻断**；**trufflehog 默认永不阻断**；detect-secrets 的退出码连官方文档都没有；etckeeper 的 hook 只警告。**任何"我们有 secret 扫描"的说法，都必须落到"哪个工具、在哪个 hook、退出码是多少、谁能豁免"这四个具体问题上。**
2. **hook 的位置决定它是否有效——而 commit 期没有安全的位置。** 对**会传 `--no-verify` 的提交者**（Aider 默认如此），`pre-commit` **和** `commit-msg` 位置的扫描器**都结构性地无效**；唯一不被 `--no-verify` 抑制的 `prepare-commit-msg` **看不到文件内容**，官方自己说"should not be used as a replacement for the pre-commit hook"。**因此结论只能是：要么在机器人自己的提交流程里扫（不依赖 git hook），要么把闸门放到 `pre-push` / 服务端——后者正好与本需求"push 由人决定"合拍：人 push 的那一刻才是最终闸门。**
3. **豁免机制是安全边界，必须入库并审计。** gitleaks 的 baseline、`.gitleaksignore`、trufflehog 的行内 `trufflehog:ignore`、detect-secrets 的 baseline、pre-commit 的 `SKIP=`——**每一个都是"永久放行"的入口**。而在自动提交场景下，**一个生成不当的 baseline 等于把 secret 永久放行**。另注意 **detect-secrets 的 `return 3`**：它表示"baseline 被自动刷新了"，与"发现 secret"用了不同的非 0 码——**不区分这两种非 0，就会把"豁免清单更新了"误报成"发现泄漏"，或反之。**
4. **退出码的"非 0"千差万别**：gitleaks `1`（**且这 1 同时覆盖 leaks 与运行错误，是 fail-closed**）、trufflehog `183`（且需显式 `--fail`）、detect-secrets `1` / `3`、git-annex **未承诺**。**不要假设"非 0 就是被拦住了"，也不要假设"工具会自己决定"。**
5. **最强的一道闸门不在提交侧，而在 push 侧。** 结合 §27：既然 push 由人决定，**把"secret 检查"放在人 push 的那一刻**（`pre-push` hook / 服务端检查 / `push.default=nothing` 之后的显式动作）**比放在自动提交路径上更可靠**——因为自动提交路径上总有 `--no-verify`、`SKIP=`、baseline 这些绕过口。
6. **"忽略"不是唯一的安全手段，"权限"也是——而两者不可互相替代。** **etckeeper 故意把 `/etc/shadow` 入库**，靠的是它的 **mode 700**，而不是靠 `.gitignore`；**git-annex 默认覆盖整个目录、包含 dotfile**。**【事实】即：一个自动提交器可以选择"提交敏感文件"并依赖文件权限保护它。这是一条**有意的**设计取舍，不是疏漏——但**它只在"仓库本身不外传"时成立**，一旦 push（或把仓库共享出去）就立刻失效。**这与本需求"push 由人决定"是同一件事的两面。**
7. **"脏工作区即拒绝"是一个可直接抄的前置条件。** etckeeper 的 `pre-install` **在安装前检查 `/etc` 有没有未提交的改动**，有就**取消安装**，让人手工提交。**【事实】即：把"工作区干净"作为执行前置条件，而不是"先合并再说"——这是 §29 规则 2（预检 + 拒绝）在自动提交侧的对应物。**

**引用**
- https://raw.githubusercontent.com/git/git/master/Documentation/githooks.adoc 【实抓，`pre-commit` / `commit-msg` / `prepare-commit-msg` 三个 hook 的退出码与 `--no-verify` 语义】
- https://raw.githubusercontent.com/git/git/master/Documentation/git-commit.adoc 【实抓，`--no-verify` 逐字 "Bypass the `pre-commit` and `commit-msg` hooks."】
- https://pre-commit.com/ 【实抓，"The hook must exit nonzero on failure or modify files."、commit-msg "The commit will be aborted if there is a nonzero exit code."、`fail_fast` 默认 false】
- https://raw.githubusercontent.com/gitleaks/gitleaks/master/README.md 【子代理实抓，`--exit-code` 默认 1、官方 hook entry、baseline 与 `.gitleaksignore`】
- https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/README.md 与 `PreCommit.md` 【子代理实抓，`--fail` 与退出码 183、`--fail-on-scan-errors`、`trufflehog:ignore`】
- https://raw.githubusercontent.com/Yelp/detect-secrets/master/README.md 与源码 `detect_secrets/pre_commit_hook.py` 【子代理实抓，`return 1` / `return 3`】
- etckeeper 的 `pre-commit.d/` 与 git-annex 主手册页 【子代理实抓】
- **未能核实**：**detect-secrets 的退出码未经文档侧交叉验证**（`docs/pre_commit_hook.md` 抓取 **404**，README 全文无 exit/non-zero 字样，退出码全部来自源码）；`TRUFFLEHOG_PRE_COMMIT=1` 与 pre-commit/Husky 自动探测**具体注入了哪些参数**（README 与 `PreCommit.md` 均未列出）；`git-annex` 的 `pre-commit-command` 是否因非 0 退出而阻止提交**未作承诺**；`.pre-commit-config.yaml` 中 `stages` 的完整取值表未逐一核对。
- **方法学限制（子代理自陈，必须记住）**：**未安装、未运行任何扫描工具，所有退出码结论都是静态阅读（源码级或文档级）的产物，没有一条是实测退出码。** 若正式设计要依赖这些退出码，**应当补一次实测**。

## 27. 谁 push——真实系统怎么停在"已提交未推送"

**这一节把"push 由人决定"在各产品里的落点列全，它是本需求最有直接参照价值的一节。**

### 27.1 git 自己提供的原语（主 agent 亲自核对 `Documentation/config/push.adoc`）

**`push.default` 的默认值是 `simple`**，逐字：

> `simple`;; push the current branch with the same name on the remote. … **This mode is the default since Git 2.0, and is the safest option suited for beginners.**

**但真正用于"push 由人决定"的是 `nothing`**，逐字：

> `nothing`;; **do not push anything (error out) unless a refspec is given.** This is primarily meant for **people who want to avoid mistakes by always being explicit.**

**【事实】`push.default=nothing` 是一个 fail-closed 的闸门：没有显式 refspec 时 `git push` 直接报错。** 这是"push 必须由人显式决定"在 git 层的原生实现——**比在应用层写 `if (approved)` 更硬**，因为它对任何调用方（脚本、agent、逃逸舱命令）一视同仁。

配合 §8 已经写过的 lease 保护，push 侧的完整防线是：**`push.default=nothing`（必须显式）→ `--force-with-lease`（不许覆盖别人的新提交）→ 禁用裸 `--force`**。

### 27.2 各产品的落点（按"是否 push"排序）

| 产品 | 落点 | 关键机制 |
| --- | --- | --- |
| **Aider** | **从不 push** | 代码里**没有 push 路径**（`args.py` 与选项页 `push` 零匹配），唯一出口是 `/git` 逃逸舱 |
| **etckeeper** | **默认不 push** | `PUSH_REMOTE=""`（空串）→ `commit.d/99push` 的 `if [ -n "$PUSH_REMOTE" ]` 不成立；开启后 push 失败**也不阻断**（`|| true`） |
| **opencommit** | **默认"询问"是否 push** | `OCO_GITPUSH` 默认开启 = 提交确认后问一次；关掉则"commit 后直接退出" |
| **git-annex assistant** | **默认会 push**，但有三道闸门 | `annex-push=false` / `annex-sync=false` / **`annex-sync-command`：命令非 0 退出 = 同等关闭同步** |
| **obsidian-git** | **默认 push 打开，且与提交同一定时器** | `disablePush: false`；auto commit-and-sync interval 默认 0（关闭），一旦开启就连 push 一起做 |
| **Copilot cloud agent / Devin / Claude Code Web / Cursor Cloud** | **push**，但收敛成受控产物 | 官方明说 Copilot "**cannot directly run `git push`**"、"Requires human review before merging"、"Sessions do not create pull requests automatically"——**push 的对象被收窄成"为委派任务创建的一分支"，合并留给人** |
| **jj** | **默认不 push，且提供了正向防线** | `jj git push` 必须显式指定分支/bookmark；**`git.private-commits` 是一个 revset，匹配它的提交被拒绝推送，并且连带阻止其所有后代被推送** |

### 27.3 四条结论

1. **"不自动 push"必须是被强制出来的，不能靠"没写这个功能"。** Aider 成立是因为它真的没有 push 代码；而**任何给 agent 提供 shell 的工具，只要 agent 有 shell 就能 push**——Cline 官方文档把 "Commit and push changes to version control" 直接列为 YOLO 模式的风险项就是证明。**所以：push 约束必须加在 harness 层（hook / 权限），不是文档约定。**
2. **"committed 但未 pushed"正是"可撤销"的来源。** Aider 的 `/undo` 在提交推出 origin 之后就会永久拒绝（"The last commit has already been pushed to the origin. Undoing is not possible."）。**换句话说：`不 push` 不是一个保守的默认值，它是"可回滚"这个能力的必要条件。** 这是回应负责人那条追加需求最强的一句话。
3. **push 失败不应当影响提交路径的成功**（etckeeper 的 `|| true`）。**push 是人的事，它的失败是人的问题，不该回滚或污染机器做的事。**
4. **"谁不能 push"比"谁可以 push"更好表达——这是 jj `git.private-commits` 的贡献。** 它是一个 **revset**（不是标签、不是开关）：匹配的提交被拒绝推送，**且连带阻止其后代被推送**。**【事实】即：把"这一批东西还不该出去"表达成一条关于提交内容的可计算谓词，而不是一个运行时的布尔判断。** 对本设计的直接含义：**如果某个工作单元的自动提交"尚未被人确认"，用一条"未确认的提交"谓词去挡 push，比在 push 命令上加 `if` 更可靠**——因为前者对后来新增的提交自动继续生效（后代会继承这个性质），后者只挡当下那一次。**这是本文见到的唯一一个把"push 由人决定"做成可组合、可继承策略的机制。**

**引用**
- https://raw.githubusercontent.com/git/git/master/Documentation/config/push.adoc 【实抓，`push.default` 的 `simple` 与 `nothing` 逐字定义】
- 其余引用同 §18 / §24 / §21。

---

# 第三部分：可迁移的模式

下面每一条都来自前两部分的取证，标注了出处节号。**分成五组：自动还是提议、冲突怎么处理、周期性工作怎么活过重启、对齐方面拒绝自动化什么、提交方面拒绝自动化什么。** 最后单列一节讲 DSH 自身已有的落点。

## 28. (a) 什么时候自动对齐，什么时候只提议

### 28.1 最重要的一条：**没有任何产品做一个"到点就动"的定时对齐器**

调研覆盖的**全部**产品（GitHub / GitLab / bors-ng / homu / Gerrit / Renovate / Dependabot / Kodiak / Mergify / Graphite / Zuul / gh-stack / git-town / jj / Sapling / Copybara / fbshipit / josh / git-subtree / git-subrepo / git-sync / `git maintenance`）里：

- **"automatic" 的含义一律是"挂在某个动作上"**（人点按钮、人跑命令、push 事件、CI 回报），**不是"挂在时间上"**。
- **唯一出现在"时间"上的东西，都是外部的**：OS 调度器（`git maintenance` 写 crontab / systemd timer / launchd / schtasks）、CI 的 cron、平台托管调度。**工具自己只提供"一条可以安全地在无人值守下运行的命令"。**
- `gh stack sync` 是唯一**明确声明自己适合被调度**的（逐字 "`sync` is safe to run in automation"），**但它自己不带定时器**。【§8】

> **对本特性的含义**：本需求是一个**真实空白**，不是"跟随业界"。**这不是坏消息，但要改掉论证方式**——不能说"同类产品都是定时的，我们也定时"，而要说清**"为什么这件事必须由时间驱动而不能由事件驱动"**。GitLab 的 housekeeping 文档恰好给了一个可引用的立项理由（逐字）：
>
> > While GitLab automatically performs housekeeping tasks based on the number of pushes, it **does not maintain repositories that don't receive any pushes at all**. As a result, **dormant repositories or repositories that are only getting read requests** may not benefit…【§17.2】

**即：纯事件驱动会漏掉"安静的"目标，所以必须补一条定时路径。** 这是本特性最有力的立项论据，而且它来自一个大规模生产系统。

### 28.2 **两段式：定时器只负责"跑一次"，陈旧度决定"要不要动"**

**这是本文认为本特性最该采用的架构，而且它有两个独立的一手先例：**

- **Renovate**：外部调度器按 `schedule`（cron）触发一次运行；**在一次运行内部，是否 rebase 由 `rebaseWhen` 决定**，其判定是 `behind-base-branch` = **落后 ≥1 个 commit**。【§5】
- **etckeeper**：cron / systemd timer 每天触发一次；**脚本先跑 `etckeeper unclean`，只有"脏"才提交**。【§24.1】
- **Kodiak / Mergify 的"落后 N"**：Kodiak 完全委托 GitHub 的 `mergeStateStatus == BEHIND`（二值）；Mergify 让用户写 `#commits-behind > 5`——**没有硬编码阈值**。【§7.2】

**【事实】即：定时器触发"评估"，而"评估"的判据是"相对某个记录下来的基线是否真的落后了"，不是"距离上次多久"。** 这与 DSH 的 `dsh-schedule` 已有的处理（**错过的固定间隔不逐次枚举，直接用整数运算取最近一次**）是同一个思路。

**推论**：workspace 记录上应当存的是**"最后对齐到的 rev / operation"**，而不是"上次对齐的时间"。jj 提供了这条的原型：`.jj/working_copy/` **记录工作副本最后被更新到哪个操作**，因此陈旧是可检测的（`jj workspace update-stale`）。【§10、§22】

### 28.3 **自动对齐的强度应当与下游验证能力互补**

**Renovate 的 `auto` 档给出了这条判据的现成实现**（逐字）：【§5】

> **auto**: Renovate will autodetect the best setting. It will use `behind-base-branch` if configured to automerge or repository has been set to require PRs to be up to date. Otherwise, `conflicted` will be used instead. **On GitHub, if the base branch has a merge queue, `conflicted` is used because the merge queue already tests PRs against the head of the base branch. The same applies on GitLab if merge trains are enabled on the project**

**【事实】成熟产品的判断是：如果已经有东西在替你测"合并到最新 base 的结果"，那你就该退让成"只在真冲突时才动"。** 自动对齐不是越勤越好——**它是下游验证机制的补集。**

配套的另一半来自 GitLab：**automatic rebase before merge 明确不重跑 CI**（逐字 "Does not re-run CI/CD pipelines on the rebased result."），**官方因此推荐改用 merge trains**。【§2】**【事实】即"rebase 完要不要重验"是一个必须显式回答的设计问题，不能默认。**

### 28.4 **默认保守，甚至默认关闭**

| 产品 | 默认 |
| --- | --- |
| VS Code `git.autofetch` | **`false`**（周期 fetch 默认关闭）【§14.1】 |
| obsidian-git 的 auto commit-and-sync interval | **`0` = 关闭**【§24.3】 |
| Sapling `amend.autorestack` | **`only-trivial`**（只在能证明不会冲突时才自动做）【§11】 |
| `git rerere` | **`enable` 需要显式设置**（默认关）【§16.1】 |
| GitLab merge train enforcement | **`Allow bypass`**（默认）【§2】 |
| Zuul `disable-after-consecutive-failures` | **默认关闭**【§7.5】 |
| Copilot cloud agent 的 PR 创建 | **默认不自动创建**（"Sessions do not create pull requests automatically"）【§21.1】 |

**【事实】"能做"和"默认做"普遍是分开的。** 一个能自动对齐的功能，**默认值应当是"不自动"或"最保守的自动"**。

### 28.5 **定时器必须抖动 / 随机化**

三个独立产品用三种方式解决同一个问题：

- **bors-ng**：首次轮询时间乘 `rand.uniform(2) * 0.5`（0–1 倍随机）——**避免所有 project 的 batcher 同时打 GitHub**（主 agent 实抓源码）。【§3.1】
- **Dependabot**：逐字 "**By default, Dependabot randomly assigns a time** to apply all the updates in the configuration file."【§6】
- **GitLab scheduled housekeeping**：逐字 "On subsequent scheduled housekeeping runs, Gitaly **randomly shuffles** [the order]."【§17.2】

> **对本特性的含义：N 个工作区的定时器不能对齐到同一时刻。** DSH 的 `dsh-schedule` 已有"错过的间隔不枚举"的处理，但**抖动是另一件事，需要单独设计**。

### 28.6 **同一检查可以分级门控**

`rust-lang/rust` 的 tidy 漂移门（主 agent 实抓 `jobs.yml`）：**PR 阶段 `continue_on_error: true`（只警告），Auto/合并阶段硬失败**，且文件里**逐字写着规则**："Auto jobs may not specify `continue_on_error: true`, and thus will fail-fast."【§15.1】

**【事实】即"自动"与"提议"不必二选一，可以是同一检查在不同场景下的两种强度。** 对本特性：**在有人的场景"提议"，在无人值守的场景按保守策略"自动"。**

### 28.7 **人的动作是唯一的"自动"触发源**（对照组）

gh-stack / git-town / jj / Sapling 都不带定时器。**它们的"自动"是"人做一次，工具替他把后续一串做完"**——gh-stack 的 cascade rebase、git-town 的递归祖先合并、jj 的后代自动 rebase、Sapling 的 auto-restack 都是这个形状。【§8、§9、§10、§11】

**这不是本特性的对立面，而是它的必要组成部分**：定时器负责"没人时也别落后"，而**人一旦在场，对齐应当是"一次操作把整条链处理干净"**。

## 29. (b) 冲突怎么处理——三条哲学 + 四条硬规则

### 29.1 三条（其实是四条）哲学，必须选一条

| 哲学 | 代表 | 冲突时到底发生什么 |
| --- | --- | --- |
| **① 绝不停在半途**（原子回滚） | **gh-stack sync** | 逐字："If a conflict is detected, **all branches are restored to their original state**, and you are advised to run `gh stack rebase` to resolve conflicts interactively."【§8】 |
| | **Copybara `CHANGE_REQUEST`** | rebase 冲突 → 异常中止；**目标仓库零改动、零状态**；人改 origin 后重跑（逐字 "Please sync or update the change in the origin and retry."）【§12.1】 |
| | **fbshipit** | `git am --abort` 只回滚当前 patch，整轮中止，**后续 phase 不执行**；本地有部分落地但**未 push**【§12.2】 |
| **② 停下来等人**（持久化待办） | **git-town** | 冲突 → 停在半途，**`runstate.json` 持久化**，人跑 `continue` / `skip` / `undo`（含 `RunProgram` / `AbortProgram` / `FinalUndoProgram` / `UndoAPIProgram`）【§9】 |
| | **Sapling** | rebase 中断 + `--continue/--abort/--quit`【§11】 |
| | **GitLab merge train** | **踢出列车 + 系统备注写明原因与下一步**，人 rebase 后重新入列【§2】 |
| **③ 冲突变成数据，操作照常成功** | **Jujutsu** | 冲突是 **commit 内的 first-class 数据**；工作副本写入 markers，**jj 记住参与的（通常 3）个部分**，之后每次扫描**解析 markers 重建冲突状态**；**允许部分解决**【§10、§22】 |
| **④ 主操作成功，只留一条 hint 记债** | **Sapling `only-trivial`（默认）** | **不自动 restack 不是失败**，只打一条 hint：`descendants of %s are left behind - use '@prog@ restack' to rebase them`【§11】 |

**本文的判断：对"无人看管的定时对齐"，只有 ① 和 ④ 是安全的。** ② 要求有人来收拾，而定时器的前提恰恰是"没有人在看"；③ 需要一整套"冲突即数据"的底层实现（jj 是为此重写了 VCS）。

### 29.2 四条硬规则

**规则 1：冲突必须映射到一个终止状态，否则就是无限循环。**
bors-ng issue **#61**「Merge conflicts do not mark the batch as "canceled"」的**正文全文只有一句**——逐字：

> **This puts bors in an infinite loop. Fix it!**

这正是 `lib/database/batch_state.ex` 里把 `:conflict` 显式折叠成 `:error`（**而不是** `:canceled` 或独立态）的原因。【§3.1】

> **对一个周期性对齐器，这条是致命的：如果"冲突"没有一个终止语义，它每一个周期都会重试、每一个周期都失败、永远不停。** 本设计必须显式定义：**冲突之后，这个 workspace 的下一周期做什么？** 若不定义，默认行为就是无限重试。

**规则 2：预检 + 拒绝，优于执行 + 回滚。**
- GitHub 的 Update branch 只在无冲突时可用；**strict required checks 是默认**（官方逐字承认这会让"更多构建"成为必需成本）。【§1.2】
- Gerrit：**冲突时 Submit 按钮直接禁用**——逐字 "the submit button in the Gerrit web UI is disabled, if any path conflict would occur"。【§4】
- Kodiak：**完全不做自己的冲突判断**，委托 GitHub 的 `mergeStateStatus == BEHIND`。【§7.2】
- Zuul：**冲突时不跑任何 job**——因为合并结果根本构造不出来，**验证这一步是无需尝试的**。【§7.3】

> **可迁移的形式**：对齐动作开始前先做一次"能不能干净地做"的判断；**不能，就本次什么都不做并记录原因**。

**规则 3：失败原因必须机器可读 + 人可读 + 带明确的下一步。**
GitLab 是全篇最好的范本：**5 类系统备注，每一类都配 "What to do"**（见 §2 的表）。而且官方把"真正原因在 `Explanation:` 之后"这一点单独说明——**因为"Merge request is not mergeable" 本身不说明为什么。**

反面证据同样是证据：
- bors-ng **#378**「bors use of "Merge conflict" message is misleading」被单独立为 issue。【§3.1】
- Gerrit 官方**承认**关闭 content merge 会让失败路径不可解释，**并以此为主要理由反对它**。【§4】

> **"失败路径的可解释性"是设计指标，不是文案问题。**

**规则 4：基于"合成结果"的验证一旦输入变了就不能重试，必须作废。**
- GitLab 逐字：**"the merged result is out of date and the pipeline can't be retried."**【§2】
- GitHub merge queue：**跳到队首会导致所有在飞 PR 全量重建**（逐字 "will cause a full rebuild of all in-progress pull requests, as the reordering of the queue introduces a break in the commit graph"）。【§1.3】
- homu：**用 `merge_sha` 做陈旧结果失效键**——**用"结果标识"而不是"时间戳"。**【§3.2】

**两条配套的细节规则：**
- **区分"冲突"与"竞态"。** bors-ng 把 `pr.head_sha != patch.commit` 判为 **`:race`**（分支被人动过）而非 `:conflict`；Mergify 区分"**与队内前序 PR 冲突**（保持排队位、defer、不摘 label，等前序结果）"和"**与 base 冲突**（立即出队）"。【§3.1、§7.3】**两种情况的正确响应完全不同。**
- **失败要能局部化，不能污染同伴。** GitLab：一个失败 → **后续 PR 的临时分支被重建、把失败者摘掉**；bors-ng：冲突 → `Divider.split_batch_with_conflicts` 拆批。【§2、§3.1】
- **冲突的"解"可以复用。** `git rerere` 记录冲突的自动合并结果与人工解决结果，**下次遇到同样的前置文本直接套用**；`rerere.enabled` **默认关**；`git am/rebase --abort` 会**自动 `git rerere clear`**；`gc.rerereUnresolved` / `gc.rerereResolved` 默认 **15 天 / 60 天**。【§16.1】

  > **对定时对齐的含义**：一个每周期重试对齐的模块**应当默认开启 rerere**，否则人会把同一个冲突反复解一遍。但要注意 **rerere 只复用"同样的前置文本"**——base 一变就失效。

## 30. (c) 周期性工作怎么跨重启存活

### 30.1 五种已落地的答案（按"状态放哪"分类）

| # | 状态放哪 | 代表 | 特点 |
| --- | --- | --- | --- |
| **1** | **数据库记录上的水位线列**，调度器每 tick 重算"谁到期" | **GitLab repository checks** | **最贴合"每工作区一条记录"的形态** |
| **2** | **被同步的产物自身里**（commit message label / trailer / 仓库内文件） | Copybara、fbshipit、git-subtree、git-subrepo | **天然跨重启、天然多实例、跟着仓库被备份** |
| **3** | **进程外的调度器 + 配置里的声明** | `git maintenance` | 调度相位不在进程里 |
| **4** | **工作副本自己记录"最后更新到哪个操作"** | jj `.jj/working_copy/` | 陈旧可检测 |
| **5** | **以工作区路径为键的外部状态目录** | git-town `~/.config/git-town/<sanitized-repo-path>/runstate.json` | 仓库被移动/改名则状态找不到【推断】 |

### 30.2 答案 1 的完整实现（GitLab，主 agent 亲自读源码）

**"谁该被跑"完全由数据库列推导，不由队列位置决定——这就是它跨重启存活的全部秘密：**

```ruby
def never_checked_project_ids(batch_size)
  projects_on_shard.where(last_repository_check_at: nil)
    .where('created_at < ?', 24.hours.ago).limit(batch_size).pluck(:id)
end

def old_checked_project_ids(batch_size)
  projects_on_shard.where.not(last_repository_check_at: nil)
    .where('last_repository_check_at < ?', 1.month.ago)
    .reorder(last_repository_check_at: :asc).limit(batch_size).pluck(:id)
end
```

**失败是被记录的、不是被重试的**：

```ruby
def update_repository_check_status(project, healthy)
  project.update_columns(last_repository_check_failed: !healthy,
                         last_repository_check_at: Time.current)
end
```

**【事实】失败 → 打日志 + 标 `failed` + 照常推进水位线。没有无限重试，也不会卡住队列。** 这是"无人值守"的正确姿态。【§17.1】

### 30.3 六条配套机制（都可直接照搬）

1. **cron 作为"卡死兜底"，而不是主路径。** 主线事件驱动；定时器只负责**把卡死超过租约期的记录捞回来重试**。GitLab 的 `MergeTrains::UnstickStuckMergesCronWorker`：一把 30 分钟租约（`LEASE_TTL = 30.minutes`）包住 `Car.stuck_cars.each_batch`，逐条重新 enqueue `RefreshWorker`，并用 `Set` 去重 `[project, branch]`。而 `STUCK_AFTER = RefreshService::LEASE_TIMEOUT + 5.minutes`（**租约期 + 5 分钟宽限**）。【§2】

2. **双层锁 + 租约，且要覆盖"单次运行超出锁期"的情形。** GitLab 的注释逐字说明了两层各自防什么：
   ```ruby
   # 1. `MergeTrains::RefreshWorker` deduplicates via `deduplicate :until_executed, if_deduplicated: :reschedule_once`
   # 2. This service holds an `ExclusiveLeaseGuard` (scoped to project + branch) and renews it per car,
   #    guarding against cases where a refresh outlives the worker's 10-minute deduplication TTL.
   ```
   仓库检查侧则是**批级 1 小时租约 + 每项目 24 小时租约**（注释逐字解释 24 小时的理由："on servers/projects where 'git fsck' is super slow we definitely do not want to run it twice in parallel"）。【§2、§17.1】

3. **每次运行必须有硬时间预算。** GitLab 逐字：
   ```ruby
   # This loop will break after a little more than one hour … or if it runs out of
   # projects to check. By default sidekiq-cron will start a new RepositoryCheckWorker
   # each hour so that as long as there are repositories to check, only one (or two) will be checked at a time.
   break if Time.current - start >= RUN_TIME      # RUN_TIME = 3600
   ```
   以及 `BATCH_SIZE = 10_000`。**到点就走，剩下的下个小时继续。**【§17.1】
   同一思想的另一种表述在 GitLab housekeeping："Gitaly node **stops processing repositories if it takes longer than the configured interval**"、超时**优雅取消**、下轮**重新洗牌**。【§17.2】

4. **并发保护会带来"少跑"，这是要接受的代价，不是故障。** `git maintenance` 官方逐字：
   > Each `git maintenance run` command takes a lock on the repository's object database, and this prevents other concurrent `git maintenance run` commands from running on the same repository. Without this safeguard, competing processes could leave the repository in an unpredictable state.

   并且官方在 TROUBLESHOOTING 里**自己承认**了后果："Users may find some cases where **scheduled maintenance tasks do not run as frequently as intended**."【§16】

5. **权威状态与可重建缓存必须分开。**
   - Zuul：`ChangeQueue` 是 `ZKObject`，`serialize()` 把**当前自适应窗口值**写进 ZooKeeper；而 merger 的 `working_root` **是可重建缓存**（scheme 不匹配就 `shutil.rmtree` 重 clone）。【§7.5】
   - josh：磁盘 cache 被官方声明为**仅性能用途、不需要备份**。【§13.1】
   - **DSH 自己的 `dsh-schedule` 已经是这个形状**："Session log owns the state"，timers 是可丢弃的投影。【§31】

6. **退出码必须能区分"没做事"与"做成了"。** 这是被低估的一维：
   - **gh-stack sync**：非交互终端遇到栈分叉时**中止，但"exiting successfully"（退出码 0）**——**无人值守时这就是"看起来成功、其实什么都没做"。**【§8】
   - **gh-stack** 另有一张**完整的退出码表（1–10）**，并为并发专门定义了 exit 8（排他锁 5 秒超时）。【§8】
   - **git-sync**：rebase 失败 **exit 1 并留在冲突态**，**下一次运行 exit 2**——"上次没收拾干净"是可观察的状态。【§13.1】

   > **对本设计：绝不能用一个"退出码 0"同时表示"对齐成功"和"发现冲突所以什么都没做"。**

### 30.4 一条容易被漏掉的：崩溃清理会丢数据，必须显式设计

- **bors-ng**：启动时从数据库重建 batcher，但**崩溃清理会删掉 waiting 状态的 batch、把 running 的标为 `:canceled`**；并且**空闲时 batcher 自杀（`{:stop, :normal}`）**。【§3.1】
- **homu**：重启时从 SQLite 重建，但**把 `pending` 重置为 `''`，且源码里留着一条 `FIXME`**——**"正在处理哪个 commit"这个信息会丢**。【§3.2】
- **bors-ng #48** 正文逐字：崩溃后"one PR is stuck on 'running' even though it has already successfully completed"。【§3.1】

> **对本特性：如果对齐状态只存在内存里，进程重启后"上次对齐到哪"就丢了。** 这正是 §30.1 的答案 1/2/4 存在的理由。

### 30.5 遇到平台级错误就把自己关掉

**Kodiak 的做法值得直接照搬**：遇到 GitHub 500 时**给自己贴 `kodiak:disabled` 标签然后停手等人**——这是 issue #397 的教训：**单纯重试 500 会导致同一个 PR 被重复合并。**【§7.5】

**【事实】即：对"外部系统故障"这类错误，正确的动作是"停止并变得可见"，而不是"重试"。** 这与 DSH 的 `dsh-session-checkpoint-policy` 已有的处理完全一致（见 §31）。

## 31. (d)(e) 它们拒绝自动化什么

### 31.1 对齐方面

| 拒绝自动化的事 | 证据 |
| --- | --- |
| **解冲突** | **没有任何一家自动解冲突**：Kodiak 摘 label + 评论；Zuul 出队（且不跑 job）；Mergify 区分两类冲突但都交给人；GitHub Update branch 在冲突态不可用；Gerrit 直接禁用 Submit；gh-stack 建议用**交互式** `gh stack rebase`【§1.2、§2、§4、§7.3、§8】 |
| **接受非快进** | git-subtree：**refspec 里的 `+` 被忽略**，非快进由 **git 自己拒绝**；josh：默认 `OrphansMode::Fail` **拒绝 push**，`-o merge/allow_orphans/edit/force` **默认全关**【§13.1】 |
| **改写已进入主线的历史** | jj 的 **`immutable_heads()`：默认拒绝改写从 `trunk()` 可达的一切**【§10、§22】 |
| **在无终端时做交互式决定** | gh-stack：非交互终端遇到分叉**直接中止**；Copybara 的 `promptConfirmation` 与 `ask_for_confirmation` 都需要终端（**无人值守行为未文档化**）【§8、§12.1】 |
| **覆盖人已经介入的分支** | **Dependabot**：一旦 PR 上被推了额外提交就**停止 rebase**（可用 `[dependabot skip]` 等字符串显式重新授权）；**Renovate**：分支被人改过就**静默不动**，源码里留着 `// TODO: Add warning to PR (#9720)`（即**当前不向 PR 写任何提示**）；**Codex CLI 系统提示词**逐字 "You may be in a dirty git worktree. **NEVER revert existing changes you did not make** unless explicitly requested"、"Do not amend a commit unless explicitly requested"、"**NEVER** use destructive commands like `git reset --hard` or `git checkout --`"【§6、§5、§20】 |
| **行为可预期地被清理** | 私有快照**一律不承诺持久**：VS Code `maxFileEntries` = 50、**超出即从磁盘删除**；JetBrains **升级 IDE 即清空**且"revisions are not guaranteed to persist"；Claude Code 约 30 天后**回滚失败并报 `No files were restored`**【§23、§19】 |
| **空变更也提交** | Copybara 的 `EmptyChangeException` **只 warn 并继续**；etckeeper 先跑 `etckeeper unclean` 判脏；GitHub merge queue 的 prune 只删已合并 PR 的分支【§12.1、§24.1】 |
| **自动开 PR / 自动合并** | gh-stack 逐字 "**Sync never opens pull requests.** Use `gh stack submit` for that."；Copilot 逐字 "**Sessions do not create pull requests automatically.**"、"Requires human review before merging"；Dependabot **不自动合并**【§8、§21.1、§6】 |
| **把 push 失败当作错误** | etckeeper 的 `commit.d/99push` 用 **`git push "$REMOTE" \|\| true`**——push 失败不阻断、仍返回 0【§24.1】 |
| **重试平台级故障** | Kodiak：GitHub 500 → 贴 `kodiak:disabled` 停手【§7.5】 |

### 31.2 提交方面（对应负责人的追加需求）

**这是本需求的核心，逐条列：**

1. **不自动 push。** 唯一的成熟先例是 **Aider**：`args.py` 与官方选项页 `push` **零匹配**，**全仓库唯一出现 `push` 的地方是 `/undo` 的拒绝文案**。【§18】
   而且——**"不 push"不是一个保守的默认值，它是"可撤销"的必要条件**：Aider 的 `/undo` 在提交推上 origin 之后**永久拒绝**，逐字：
   > The last commit has already been pushed to the origin. Undoing is not possible.

   **这是回应负责人那条追加需求最强的一句话：`committed but not pushed` 换来的正是"还能撤销"。**

2. **不把用户的无关改动卷进 commit——而且这件事是可以做到的。** Aider 的自动提交用 **path-limited commit**（`git commit -m <msg> -- <fnames>`，**只含它本次回复改过的文件**），**这就是"只提交本工作单元产生的改动"的 git 原生实现**。【§18】
   但**Aider 主动在另外两条路径上放弃了它**：`--dirty-commits`（默认 `True`）与 `/commit`（走 `git commit -a`）。
   > **所以"自动提交"这个词不够精确：必须逐路径写明提交范围。** 建议把"只提交本工作单元产生的改动"写成**显式不变量**，而不是靠 `git commit -a` 的默认行为。

3. **在提交之前，"不把什么带进来"要靠 git 原语而不是靠自觉：**
   - **`git commit -- <paths>` 默认等于 `--only`**：取这些路径的工作树内容，**无视其他路径已暂存的内容**（逐字："disregarding any contents that have been staged for other paths"）。**这是"提交范围可证明"的机制。**
   - **`git add --update` 只暂存已跟踪文件的修改与删除，不含新文件**——`aicommits` 用的就是它，**因此不可能把意料之外的新文件（例如刚生成的 `.env`）带进 commit**。【§25.4】
   - **`git commit -a` 会包含所有已跟踪的修改与删除**（不含 untracked）——这是 `--dirty-commits` / `/commit` 的语义。
   - **读忽略文件才有安全边界**：etckeeper 的 "interesting" = **".gitignore 没忽略的文件"**；jj 逐字 **"Files with paths matching ignore files are never tracked automatically"**。
     反面：**VS Code Local History 的源码里 `gitignore` 零命中** →**【推断】`.env`、凭据文件只要被保存过就会被完整抄进 `User/History/`**。【§24.1、§22、§23.1】

4. **"人是否已介入"应当编码成机器可判定的证据，而不是靠时间戳猜。** Dependabot 用**"PR 上出现了额外提交"**作为"停止自动改写"的信号，并提供**显式逃生字符串**重新授权。【§6】
   > **这是本设计最该抄的一条**：自动提交/自动对齐在检测到"有人在这个工作单元里留了痕迹"时应当**主动退让**，而不是继续覆盖。

5. **消息生成失败的行为必须显式决定。** Aider 的选择是**用占位消息 `(no commit message provided)` 仍然提交**——**这会让一次生成失败静默地留下一条垃圾历史。**【§18】

6. **不自动产生下游语义。** Conventional Commits 规范**不强制类型词表**（逐字 "Additional types are not mandated by the Conventional Commits specification"），但 `feat`→MINOR、`fix`→PATCH、`!`/`BREAKING CHANGE`→MAJOR **有真实语义**。**一个自动生成的 `!` 会触发下游的 MAJOR 版本语义**——这个产生权必须显式决定。【§25.1】

7. **不共享私有快照**（JetBrains 逐字："Local History **does not support shared access**, it is stored locally and intended only for personal use."）【§23.2】

8. **不动别人的改写**：`--force-with-lease`（**DSH 自己的既有决定也要求"用精确 lease 或 lease 保护的 push 路径，远端移动即中止，禁止裸 `--force`"**）。【§8、§31.3】

9. **"不自动 push"必须在 harness 层强制，不能靠"没实现 push"。** Cline 官方文档把 "Commit and push changes to version control" 列为 **YOLO 模式的风险项**——**只要 agent 有 shell 就能 push**。对应机制：Claude Code 的 **`PreToolUse` deny hook（匹配表明确支持 `Bash(git *)` 从而匹配 `git push`）**、Copilot 的 `preToolUse` hook。**git 侧的原生硬闸门是 `push.default=nothing`**（没有显式 refspec 就报错）。【§20.3、§19、§27.1】

### 31.3 DSH 自身已有的落点（本节的结论直接可用）

**先说一条最重要的边界：对齐的写入方不能挂在 `ctx.git` 上。** `packages/git/git` 明确写着：

> No write operation will be added on this seam; repository mutation belongs to the upstream git plugin that replaces it.

并且该包被标记为 **"a bounded-lifetime temporary artifact"**（随上游 git 插件退役）。【仓库内证据】

**四处可直接复用的既有机制：**

| DSH 组件 | 已经解决的、与本特性同构的问题 |
| --- | --- |
| **`packages/schedule/schedule`** | **"The Session log owns the state"**；timers 是**可丢弃的投影**，从 fold 重建；严格 replay；**persistence-before-decision**（经共享 flush barrier）；**有界 timer 段**，每次唤醒后重读墙钟；**错过的固定间隔不逐次枚举**（整数运算取最近一次）；**重复间隔最小 5 分钟**。→ **定时器与持久状态的正确关系，本特性直接照此实现即可。** |
| **`packages/session/session-checkpoint-policy`** | **在外部副作用之前 fail-closed 地 checkpoint**（模型请求到达 adapter 前、顶层 tool body 可能产生外部副作用前、每个 step 边界）；**checkpoint 失败是 fail-closed**；**已持久化但无结果的调用记录为"结果未知"，而不是自动重试**（正是 §30.5 的"不重试"）。 |
| **`packages/webhook/webhook` + `webhook-github`** | **事件驱动路径**（`ctx.webhookRuntime.register(rule)` / `dispatch(delivery)`，返回 `202` 不等结果）。→ 本特性不必只做定时器：**"定时轮询 + 签名 webhook"可以是互补的两条路径**，与 GitLab 的"事件为主 + cron 兜底"同构。 |
| **`packages/session/session-title`** | **异步模型生成且不阻塞主响应**；被接受的版本是 **log-only 的 `session/title` 事件**；**更新的版本取代旧的**。→ **"自动总结"应当照此形状实现：生成在旁路进行，结果作为 log-only 事件落地，不急、不阻塞、可被取代。** |

**"工作单元"边界在 DSH 里已有对应物**：`packages/session/session-turn-outline` 提供**按 turn 的 outline 投影**（`turn/start` seq + 有界的 prompt/final-response 预览）。**【推断】这是"每个工作单元内部"最自然的既有边界定义，但本特性是否采用它需要另外论证。**

**仓库内已有一份第一方落地的相关决定**：`.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md` —— 落地前必须用官方 GitHub stack 对象；merge-forward 与 rebase 都被允许；远端改写**用精确 lease 或 `gh stack` 的 lease 保护推送路径，远端移动即中止**；**禁止裸 `--force`**；`gh stack sync` 是显式例外（fetch + cascade rebase + push 一次做完），因此**每次重写推送后必须立刻验证，验证通过前受影响的 PR 不得合并**；重写推送后要**重新审计 heads、review threads、approvals、mergeability、checks**；**merge-forward 仍然可用，并且它能保留已完成的冲突解决 checkpoint，代价是额外的 merge commit。**【仓库内证据】

> **最后这条对本特性特别重要**：DSH 已经在"rebase 还是 merge-forward"上做过一次取舍，而且**明确记下了 merge-forward 的代价与收益（保冲突解决 checkpoint vs 多 merge commit）**。定时对齐的设计应当**复用这个已落地的取舍，而不是重新发明一个。**

---

# 第四部分：未能核实

**这一节是本文的证据边界。以下内容本次没有取得一手证据，不得当作事实使用。**

## 32. 全局性限制（先读，它限定了上面所有"否定性结论"的强度）

1. **`web_search` 工具在本会话完全不可用**（端点未配置，报 `DeepSeek returned no web_search_tool_result blocks`）。因此**本文是零搜索的**：全部证据来自 `curl` 直取已知 URL 与仓库原始文件。
   - **好处**：单条证据强度更高（全部一手，无二手博客）。
   - **代价**：**"某机制不存在"这类否定性结论，只覆盖到实际枚举过的页面/仓库集合。** 本文中所有"未找到"都应当这样理解，而不是"业界没有"。
   - 备选搜索引擎也全部失败：`html.duckduckgo.com` / `lite.duckduckgo.com` 返回 **202 挑战页**，`grep.app` 返回 **429**。issue 发现因此依赖 GitHub/GitLab REST API。
2. **`api.github.com` 从本机 IP 被限流**（`API rate limit exceeded for 101.198.192.x`，多个子代理共享同一 IP）。后果：**部分 issue 只读到标题、未读到正文**（已逐条标注）。`raw.githubusercontent.com` 不受影响。
3. **本仓库内的 `git status` 有若干改动文件，经 mtime 比对属于并行 sibling agent 的其他工作，与本任务无关。** 本文的调研**未修改 `deepseek-harness` 下任何文件**，未执行任何 git 写操作。

## 33. 任务书前提被证伪的清单（**请勿在正式设计中沿用任务书措辞**）

| 任务书的说法 | 实际情况 | 出处 |
| --- | --- | --- |
| Gerrit 有 `gerrit.rebaseOnSubmit` 配置 | **查无此配置。** 枚举 Gerrit 全部 57 个文档页面逐个 `grep` 零命中；真实配置是 **`submit.action`**（6 种取值） | §4 |
| `gh stack` 是 `cli/cli` 的命令 | **它是独立扩展 `github/gh-stack`。** 任务书给的 3 个 URL **全部 404**（`cli/cli` 的 `pkg/cmd/` 下无 `stack` 目录） | §8 |
| `https://gerrit-review.googlesource.com/Documentation/config-repo.html` | **404**（已改名 `config-project-config.html`） | §4 |
| `https://www.git-town.com/manual/commands/sync.html` | **404**（文档站已迁到 mdBook） | §9 |
| jj 有 `docs/design/working-copy.md` / `conflicts.md` / `operation-log.md` | **均不存在**；`docs/design/` 下只有 9 个文件 | §10 |
| `sl smartlog` 有 restack 提示 | **未能证实**（`smartlog.py` 搜 `restack` 零命中）；真实 hint 来自 `sl amend` | §11 |
| VS Code 有 `git.auto.fetch.enabled` | **不存在**（那是对 UI 资源键 `settings.git.auto.fetch.text` 的误记） | §14.1 |
| JetBrains 设置叫 "Fetch periodically" | 当前文案是 **"Fetch remote changes automatically"** / **"Check remote for incoming changes"** | §14.2 |
| Renovate 有 `rebaseConflictedPrs` | **当前已不存在**，被 `rebaseWhen` 取代（20.x–24.x 历史文档逐字："this field replaces the previous fields of `rebaseConflictedPrs` and `rebaseStalePrs`"） | §5 |
| Dependabot 不会自动 rebase 有冲突的 PR | **与官方文档不符**：逐字 "By default, Dependabot automatically rebases pull requests to resolve any conflicts." | §6 |
| Kodiak 有 `update_branch: off\|merge\|rebase\|worth` | **不存在**（四重否证，含全对象扫描）；真实动作是 GitHub REST `update-branch`（**从不 rebase、从不 force-push**） | §7 |
| Kodiak 有 `reconcile` / schedule 机制 | **没有**（全仓库 0 命中）；纯 webhook 驱动 | §7 |
| Kodiak 有 `merge_title_format` | 实为 **`merge.message.title`** | §7 |
| Zuul 有 `doMerge` / `doRebase`；有 `zuul.sql`；"gate reset" 是官方术语 | **都没有。** 真实是项目级 **`merge-mode`**（8 值，`MERGER_MAP`）；schema 由 SQLAlchemy 自动建表 | §7 |
| Mergify 有 `strict`；Graphite 有 `gt repo sync` | Mergify 的 `strict` **已于 2022-01-12 移除**；`require_conditions` 全文档 0 命中；Graphite 的 `gt repo sync` **不存在** | §7 |
| Aider 的默认提交提示词在 `aider/resources/` | 在 **`aider/prompts.py` 的 `commit_system`**（`resources/` 只有 3 个非提示词文件） | §18 |
| `docs.github.com` 有 Copilot 提交消息生成的专页 | **不存在**（4 个候选路径 404）；一手来源是 VS Code 文档 | §25.2 |
| `.czrc` 是 commitizen 的配置 | **不是** commitizen（Python）的配置文件 | §25.2 |
| `jj git push --allow-new` 是 CLI flag | **不是** | §27 |
| etckeeper 在 `joeyh/etckeeper` | **该仓库 404，不存在**；上游是 `git://git.joeyh.name/etckeeper`（https gitweb 403） | §24.1 |
| 存在 `git-annex-autocommit` 页面 | **404，该页不存在**；`annex.autocommit` 定义在 git-annex 主手册页 | §24.2 |
| `josh --nopush` 参数 | **当前 master 不存在** | §13.3 |
| `markuswt/git-commit-ai` | **两个分支均 404**，该工具**整体未纳入**，未编造任何机制 | §25 |
| `gen-api-reference-docs` | 实为 **`kubernetes-sigs/reference-docs/gen-apidocs`** | §15 |
| `simon/git-wip` | **404，该仓库不存在**；真实是 **`bartman/git-wip`**，且现行版是 C++ 重写、bash 版在 `Attic/` 已停维护 | §23 |
| `mozilla/git-snapshot` | **404，该仓库不存在**（README 与仓库均 404，API 搜索 `total_count 0`）——"Mozilla 的 git-snapshot"很可能是记忆错误；真实来源是 **`nothingmuch/git-snapshot`** 与 **`mubshrx/git-snapshot`** | §23 |
| JetBrains 本地历史实现在 `platform/vcs-impl/…` | **404**；实现在 **`platform/lvcs-impl/src/com/intellij/history/`** | §23 |
| VS Code 的 `workbench.localHistory.*` 声明在 `contrib/localHistory/` | **任务书给的 4 个路径全部 404**；声明在 **`src/vs/workbench/browser/workbench.contribution.ts`** | §23 |
| Cline 文档所述"独立 shadow 仓库 + captures everything" | **与当前 main 实现不一致**：main 实为"用**用户自己的仓库** + 私有 ref `refs/cline/checkpoints/<sessionId>/<runCount>` + **依赖 `.gitignore`**"；旧实现已从 main 移除，需用 commit `c093ca1760d82d3b32f787f5ee2b0bd042a288` 取证。**引用 Cline 必须标版本/提交** | §20 |
| git 的 man page 源是 `Documentation/*.txt` | **已迁移到 `.adoc`**（`.txt` 路径 404） | §16 |
| `bors.tech` 的 TMIB 76 与 RFCs | **均 404** | §3.1 |
| "Copybara 在 Google 用于 docs 同步" | **未能取得一手支撑**：`docs/index.md`、`docs/faq.md`、`docs/use_cases.md`、`https://google.github.io/copybara/` **均 404** | §15.2 |

## 34. 各产品未能核实的具体项

- **GitHub**：merge queue 的**服务端持久化实现未公开**；**临时分支前缀在官方文档内自相矛盾**（一处 `gh-readonly-queue/{base_branch}`，正文示例 `main/pr-N`）——本文两处照录，未替官方裁决；"Update branch 在有冲突时按钮如何禁用"未取到一手表述。
- **GitLab**：**`https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/merge_trains/` → 404**（handbook 仓库同路径亦 404，search API 需认证）——**未获得 merge trains 的官方架构设计文档**；`merge_trains_use_train_ref_for_standard_merges` 等 feature flag 的**当前默认值与 rollout 状态未查到**。
- **Gerrit**：NoteDb 等持久化机制**未核实**。
- **Renovate**：issue **#11590 / #1364 只读到标题**（API 403），**未作为证据使用**。
- **Dependabot**：**调度实现细节**（表名/队列/worker/重试语义）官方**完全未描述**；**git 层实现**（是否 `--force-with-lease`、是否三方合并）官方只用了 "rebase" 与 "force push" 两个词；**`rebase-strategy` 的显式允许值字面量列表**文档未给；**历史事故/incident report 未找到一手材料**。
- **Kodiak**：`worth` 的**真实出处未能定位**；`optimistic_updates` 的 CI 竞态取舍有源码与文档依据，但**没找到专门讨论它的 issue 编号**。
- **Mergify / Graphite / Aviator / Trunk**：**服务端状态存储实现**（schema、跨重启恢复）官方均未公开；Mergify 清理孤儿 queue branch 的**具体周期**未给数值；Graphite"CLI 无后台自动 sync"属**"未找到反例"式结论**，非官方明确声明。
- **Zuul**：仓库过大无法 `--unshallow`，**只有 HEAD 浅克隆**，故"历史版本是否有过 `zuul.sql`"**无法确认**。
- **Piper / Mondrian / ROSIE**：**有一手来源，见 §12.3**（Google 官方免费全文托管的《Software Engineering at Google》ch16 / ch22，主 agent 已复核）。**仍未能核实的是**：**CACM 2016 论文正文**（`research.google/pubs/pub45424/` 200 但纯 JS 无正文；`cacm.acm.org` 与 `dl.acm.org` 均 **403 Cloudflare**）；**Piper 的"客户端 commit queue"**（26 章 + `research.google` sitemap 20,508 条 URL 全量扫描，`submit queue` / `commit queue` **0 命中**）；**Mondrian 的内部实现**。**注意：不要写"ROSIE 有全局原子提交"**——书上明说单个 shard 可原子提交，而全局 change "too large to fit in a single global change"。
- **Copybara**：`--iterative` 的**性能问题**（仓库全量 grep + GitHub Search API 均无官方命中）；**rename detection 问题**（Search API 返回 0 条）；`--iterative` 在**无终端**时的 `promptConfirmation` 行为（源码中未找到明确的非交互默认值，**本文不做断言**）。
- **VS Code**：`agentsWindow` 覆盖是否真正生效——**本文标注为推断**（`whenIdleAndFocused()` 的 `window.state.focused` 条件仍生效，而无人看管的窗口通常失焦，**未见官方确认**）；官方**未提供** Local History 的"已知问题"清单，§23.1 的失败模式**均由源码行为推出**。
- **JetBrains**：**失败模式/issue 未取得**（GitHub API 限流使 issue tracker 抓取失败）；**未访问 YouTrack**。
- **docs-as-code**：**`googleapis/googleapis` 的生成流水线公开不可复现**（`BUILD.bazel` 逐字 "build_gen needs to be run internally, not on GitHub repository"）；**`MicrosoftDocs/azure-docs` 的镜像/生成对齐未能证实**（README 与 CONTRIBUTING 均无生成脚本/CI/镜像声明）；**Copybara 用于 docs 同步的具体流水线未能证实**。
- **AI 工具**：**Cursor / Windsurf 的 checkpoint 存储位置与保留期**未知；**Devin 的 commit message 生成方式**未知；**Copilot 消息生成的失败路径、是否强制先暂存、Desktop 侧输入范围、`commitMessageGeneration.instructions` 的完整 schema** 官方均未描述；**Devin automations 的 schedule** 只从 `llms.txt` 摘要看到，正文未抓。
- **Aider**：4 条 issue（#4074 / #5033 / #5045 / #3834）**正文未能读取**（API 限流），只读到标题。
- **etckeeper**：`git.joeyh.name` 的 https gitweb **403**；**issue tracker 未访问**。
- **方法学弱点（子代理自陈）**：部分源码取自 `main` 分支**当前快照而非固定 SHA**。若正式文档要引用行号，**建议补一次带 SHA 的抓取**。

---

# 附录：复核记录（主 agent 亲自实抓并核对的条目）

为让读者判断本文的可靠性，这里列出**主 agent 独立复核过**的关键事实（即不依赖子代理转述）。**这些是本文证据链最强的部分。**

| 复核项 | 结果 |
| --- | --- |
| bors-ng `poll_period` 默认值 | `config/config.exs`：`poll_period: {:system, :integer, "BORS_POLL_PERIOD", 1_800_000}` = **30 分钟**；`batcher.ex:84` 的 `rand.uniform(2) * 0.5` 抖动 |
| bors-ng 冲突折叠 | `batch_state.ex` 的 `:conflict -> {:ok, :error}` |
| bors-ng issue #61 正文 | 全文一句：**"This puts bors in an infinite loop. Fix it!"** |
| Gerrit `rebaseOnSubmit` | `config-project-config.html` **0 命中**；`submit.action` 6 种取值定义全部逐字核对 |
| git-town runstate 位置 | `user_config_dir.go`：`filepath.Join(UserConfigDir, "git-town", SanitizePath(repoDir))`；`repo_config_dir.go` 注释 `// Example: ~/.config/git-town/home-user-my-repo.`；`env.go` 取 `~/.config`；`continue.go` 用 `runstate.NewRunstatePath(repo.ConfigDir)` → **确认在仓库外** |
| git-town sync 默认算法 | `sync_feature_branch_merge.go` 全文实读：**merge（非 rebase）+ 递归到最低本地祖先 + phantom conflict 解决 + tracking 合并** |
| VS Code autofetch 默认值 | `extensions/git/package.json`：`git.autofetch` **`false`**、`git.autofetchPeriod` **`180`**（秒）、`git.confirmSync` **`true`**、`git.rebaseWhenSync` **`false`**、`git.pullBeforeCheckout` **`false`** |
| VS Code autofetch 只 fetch | `autofetch.ts` 全文 143 行实读：**只有** `fetchAll` / `fetchDefault`，**无任何 merge/rebase/pull** |
| VS Code autofetch 门控 | `await this.repository.whenIdleAndFocused();` + 认证失败即 `disable()` + 计量连接禁用 |
| rust tidy 分级门控 | `src/ci/github-actions/jobs.yml`：`pr: continue_on_error: true`；文件内逐字 "Auto jobs may not specify `continue_on_error: true`, and thus will fail-fast." |
| jj 工作副本快照与冲突 | `working-copy` / `conflicts` 官方文档逐字（含 "Files with paths matching ignore files are never tracked automatically"、`.jj/working_copy/` 记录最后操作、`jj workspace update-stale`、recovery commit） |
| `gh stack sync` 8 步序列 | `docs.github.com` 的 stacked-PRs CLI 命令页逐字（含 "all branches are restored to their original state"、非交互"exiting successfully"） |
| GitHub merge queue 机制 | 官方 merge queue 页逐字（FIFO、`merge_group`、失败原因清单、build concurrency 1–100、jump-to-top 全量重建、`main/pr-N` 示例） |
| GitHub strict required checks 是默认 | `about-protected-branches` 表格逐字 "This is the default behavior for required status checks." |
| GitHub Update branch 作废审批 | 同页逐字（"clicks **Update branch** … the approving review is dismissed as stale"） |
| GitHub auto-merge 自动失效条件 | 官方页逐字 "Auto-merge is disabled if someone without write permissions pushes new changes to the head branch or switches the base branch." |
| Renovate `rebaseWhen` | 官方配置参考逐字：allowedValues 5 值、default `"auto"`、`auto` 的自适应规则、**merge queue / merge trains 时退化为 `conflicted`** |
| Renovate `rebaseLabel` / `keepUpdatedLabel` | 逐字（`keepUpdatedLabel` 行为等同 `behind-base-branch` 且**不摘除**） |
| `git maintenance` 调度 | `git-maintenance.adoc` 逐字：`--scheduler` 5 值、crontab 区域 `# BEGIN/END GIT MAINTENANCE SCHEDULE`、`for-each-repo --config=maintenance.repo`、`maintenance.<task>.schedule`、对象库锁、**"do not run as frequently as intended"**、`git gc` 不可混用 |
| `git rerere` | `git-rerere.adoc` 逐字：需显式 `rerere.enabled`；`--abort` 自动 `rerere clear`；`rerere remaining`；`gc.rerereUnresolved`/`Resolved` = 15/60 天 |
| GitLab 仓库检查 | `batch_worker.rb` / `single_repository_worker.rb` 全文实读：`RUN_TIME=3600`、`BATCH_SIZE=10_000`、`LEASE_TIMEOUT=1.hour`、两级租约、水位线列推导、失败只记录不重试 |
| GitLab housekeeping | 官方页逐字（eager vs heuristical、push-based 会漏掉 dormant 仓库、**每日 12:00 持续 10 分钟**、超时优雅取消、每轮随机洗牌） |
| Aider 三个默认值 | `aider/args.py`：`--auto-commits` **True**、`--dirty-commits` **True**、`--git-commit-verify` **False**（→ 默认加 `--no-verify`） |
| Aider `/undo` 恢复动作 | `commands.py`：逐文件 `git checkout HEAD~1 <file>` + **`git reset("--soft", "HEAD~1")`**（**不是 `reset --hard`**；`reset --hard` 只是第 576 行给用户看的建议文案） |
| opencommit push 语义 | README 逐字 "**A prompt for pushing to git is on by default**"；`src/commands/config.ts:35` 的 `OCO_GITPUSH` 已标 `// todo: deprecate` |
| Conventional Commits 1.0.0 | 规范原文逐字：`MUST` 条款、`BREAKING CHANGE` 与 `!`、"**Additional types are not mandated by the Conventional Commits specification**" |
| `git push.default` | `Documentation/config/push.adoc` 逐字：`simple` **"is the default since Git 2.0"**；`nothing` **"do not push anything (error out) unless a refspec is given"** |
| `git commit <paths>` 语义 | `git-commit.adoc` 逐字：默认等于 `--only`，**"disregarding any contents that have been staged for other paths"**；`-a` 与 `--include` 的语义 |
| Copilot 提交消息输入面 | `code.visualstudio.com/docs/sourcecontrol/staging-commits` 逐字 "based on your **staged changes**"；**只填输入框，人仍须点 Commit** |
| **git 三个 commit 期 hook 的绕过语义** | `githooks.adoc` 逐字：`pre-commit` **"can be bypassed with the `--no-verify` option"**；`commit-msg` **同样 "can be bypassed with the `--no-verify` option"**；**`prepare-commit-msg` 才是 "not suppressed by the `--no-verify` option"**。`git-commit.adoc` 逐字：`--no-verify` = **"Bypass the `pre-commit` and `commit-msg` hooks."** → **§26.1 的结论据此更正**（本文早期草稿曾误把该句归给 `commit-msg`；**是主 agent 在定稿前的引文抽查中发现的**） |
| **pre-commit 框架** | `pre-commit.com` 逐字："The hook must **exit nonzero on failure** or modify files."；commit-msg 侧 "**The commit will be aborted if there is a nonzero exit code.**" |
| **URL 可达性抽查（定稿后）** | 抽出文档内 28 条外部 URL 逐条 `curl`：**发现并修正 4 处失效引用**——GitLab 的 `docs.gitlab.com/<path>.md` 形式 **403**（真源在 `gitlab.com/…/-/raw/master/doc/…`）；`docs.github.com/…/working-with-dependabot/dependabot-pull-request-comment-commands` **404**（现址在 `reference/supply-chain-security/`）。其余均为 200。**这次抽查同时暴露了上面那处 hook 归属错误，是本文更正的主要来源。** |
| jj `git-annex-autocommit` 页面 | **404**（不存在），定义在主手册页 |
| etckeeper GitHub 仓库 | `joeyh/etckeeper` **404**；`git.joeyh.name` gitweb **403** |
| Piper / Rosie（Google） | `abseil.io/resources/swe-book/html/ch16.html` 与 `ch22.html` **均 200**；主 agent 复核 Piper 的 80 TB 逐字引文、ch22 中 `Rosie` **11 次**与 "atomically" **6 次**、以及 "too large to fit in a single global change" 与 cattle-vs-pets 逐字 |
| Piper 的 CACM 2016 论文正文 | `research.google/pubs/pub45424/` **200 但无任何可提取文本**（纯 JS）；两个 ACM 入口 **403 Cloudflare** |

**子代理侧的自检（各家都做了机械校验，不是自称）**：
- **S1** 用脚本把 **152 条引文**逐条回比原始抓取文件，并修正了 2 处 homu README 的换行保真问题。
- **S4** 把 **146 条 ≥70 字符的英文引文**与本地留存的全部源文件（37 个逐文件复抓件 + Google 一手件 + tarball 解包树）做去标记/去空白/去大小写**全量比对**，除 4 条 issue 正文 + 6 条中文注释 + 1 条网络抖动后重试确认的博文外**全部命中**。
- **CR2** 对正文 **84 个 URL 逐个 `curl` 复核，80 个 200**；4 个非 200 中 3 个是已标注"不存在"的 jj 设计文档、1 个是提取脚本标点误切（已修）。
- **CR3b** 的退出码结论**全部来自 200 的源码或文档原文**（detect-secrets 与 pre-commit 是源码级证据）。
- S2 / S5 / S6 / CR1 / CR4 各自声明了独立复核清单与失败 URL 清单。

**抽查显示各子代理的方法一致（curl 直取、非 200 即判定未抓到、推断显式标注、抓取产物留在 `/tmp/dsh-align-research/` 供抽查），未发现编造机制的情况。** 相反，**多个子代理主动证伪了任务书本身的前提**（见 §33），并主动报告了自己"没抓到"的部分。

**主 agent 定稿后的独立动作**：抽取文档内 URL 逐条复验（发现并修正 4 处失效引用与 1 处 hook 归属错误，见上表）；对 §12.3 的 Google 一手材料做了正文提取与关键词计数复核；对 §26.1 的 git hook 语义回到 `githooks.adoc` / `git-commit.adoc` 原文逐字确认。

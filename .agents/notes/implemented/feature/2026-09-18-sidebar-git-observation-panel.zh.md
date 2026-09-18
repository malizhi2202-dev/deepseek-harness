# Agent Note：右侧栏的只读 git 观察面板

Status: implemented

[English](2026-09-18-sidebar-git-observation-panel.md) | 中文

## Problem

右侧栏已能展示会话的任务、文件与派生，但没有东西展示工作区的仓库：当前检出哪个分支、相对上游处于什么位置、有哪些本地分支、最近的提交做了什么、工作区里有什么未提交的改动。用户接触这些事实的唯一路径是离开 harness、在终端里跑 git——而 harness 本身就坐落在这份状态之中。

## Decision

能力以完整 seam 进入——Service Definition（[`dsh-git`](../../../../packages/git/git/README.zh.md)，`ctx.git`）、Provider（[`dsh-git-local`](../../../../packages/git/git-local/README.zh.md)）与 Consumer（[`dsh-api-workspace-git`](../../../../packages/api/workspace-git/README.zh.md)，`workspaceGit` Remote 命名空间）——面板（[`dsh-client-ui-sidebar-git`](../../../../packages/client/ui-sidebar-git/README.zh.md)）绘制它。这遵循侧栏发现轮的裁定（方案 B，当前版本线上的核心自建），因为工作区事实现在就需要，而版本线迁移之前无法采纳上游插件。

**它是有期限的临时物。** 迁移落地后，上游 git 插件替换整个家族，这四个包随之退役。家族的每份 README 和本注记都写明这一点，因为替代方案——养出一个常驻的树内 git 面——恰恰是裁定所否决的。

其中六个决策值得写下。

**只读，靠词汇表而非自律。** seam 的唯一方法是 `observe`；整个家族里没有 checkout、commit、push、pull，因此任何客户端都无法通过它改写仓库，即使刻意尝试。面板除重读外没有任何动作。

**零模型可见面。** 没有工具、会话事件、资源或请求输入提到 git；面板在浏览器里绘制，seam 只应答它。模型体验契约因此平凡地为空，临时物也不会在会话日志或提示词里留下痕迹。

**历史以 Remote 方法而非资源跨线。** 资源是当前值流——适合文件页签的当前列表，不适合不可寻址的有界提交历史。因此 `workspaceGit` 命名空间暴露唯一的 `@Remote observe`，返回整份有界快照；新鲜度靠面板的重读手势。

**一个安全常量封顶读取。** `MAX_OBSERVATION_ITEMS`（200）同时封顶历史深度、分支数与工作区条目，沿用 `ui-sidebar-agents` 的 `MAX_LINEAGE_DEPTH` 先例。每个列表带自己的 `*Truncated` 标志，截断以截断的样子绘制。`git log -n` 多读一条以精确报告截断。

**判定依据退出码而非 stderr。** git 的消息会本地化（本机打印中文），退出码才是稳定的机器词汇：工作树探测返回 128 就是 `absent` 回答——不在任何仓库、在裸仓库、或损坏到说不出工作树——"不是仓库"是回答而非错误。seam 的失败是两个稳定代码（`GIT_UNAVAILABLE`、`GIT_COMMAND_FAILED`），由 Consumer 映射到两个已声明的 Remote 代码，按 `code` 字段而非类身份判定，因为 `GitError` 类属于 provider 加载的那个 `dsh-git` 实例。

**页签是 `available`，绝非 default-on。** 默认可见预算保持在任务与派生，正如[页签容量裁定](2026-09-17-sidebar-task-observation-tab.zh.md)所固定；git 页签从引导页打开，其余时候保持关闭。order 400 加上全树唯一值，让它排在内建家族之后。

## Alternatives considered

**让面板通过既有通用工具调 shell。** 面向模型的 `bash` 工具属于模型而非浏览器；把面向用户的读取路由到它会把面板可用性绑到工具审批上，并把仓库事实漏进转录——与零模型可见面的决策相反。

**基于资源的面板。** 资源是当前值流；面板的问题（"最近 N 条提交做了什么？"）不是可寻址状态，按提交分资源的方案要么把历史分页塞进模型的资源预算、要么根本建不出来。一次有界取数一次调用就能回答。

**等待上游插件。** 版本线迁移阻挡采纳，而需求是当下的。裁定选择了有期限的树内构建而非无限期等待，替换路径记录在此和每份 README 里。

## Consequences

右侧栏现在无需离开 harness 就能回答"这个会话的仓库长什么样"：HEAD 事实、分支、带泳道槽的有界历史、工作区改动，每处截断以截断可见。家族是增量的——新页签类型加新 seam——既有页签与能力不受影响。

退役路径是明说的，不只是意向：版本线迁移之后由上游 git 插件替换家族，四个包（连同其注册行）一起去。在此之间，任何东西都不应在这个 seam 上构建超出其存在目的（面板）以外的东西。

两个限制记录在包 README 里而非在此解决：读取是一次有界取数、没有订阅（新鲜度靠重读手势）；工作区只列改动侧与类型、没有 diff 或暂存视图——两者都属于上游插件。

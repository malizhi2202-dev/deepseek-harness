---
description: "面向在运行 harness 的机器上对齐仓库的部署方：ctx.gitAlign 的宿主本地 provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-align-local

[English](README.md) | 中文

## 概述

`dsh-git-align-local` 是 `ctx.gitAlign` 的宿主本地 provider。它通过共享的无 shell runner 运行机器自带的 git，因此任何操作都不会构造 shell 字符串。每条命令都受一个可配置超时约束，因为该 runner 自身既没有超时也没有输出上限；每次读取都使用紧凑的机器可读形式（`--numstat -z`、`--name-only -z`、不含计数的列表），绝不携带完整补丁。

冲突探测优先使用 `git merge-tree --write-tree`——它在对象库里构造合并树，不碰工作树——当该命令拒绝其标志时回退到隔离的 `git worktree`。这个选择由实际运行该命令并读取其退出状态决定，绝不从版本号推断能力。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

在本机对齐仓库的地方挂载该 provider。它的配置只有一个字段 `commandTimeoutMs`（默认 60000，最小 1000）：一条 git 命令在被中止前可运行的时限。

`probe` 绝不改动目标：merge-tree 路径只写对象，回退路径在调用方给出的 `worktreeRoot` 下创建自己的临时工作树，随后移除并清理。无法移除临时工作树的探测报告失败而不是冲突列表，因此一个残留注册不会被误认为一个答案。

`commit` 恰好包含给定的路径。由于 `git commit -- <paths>` 拒绝 git 尚不认识的路径，新文件先用 `git add --intent-to-add` 记录；这只记录路径、不暂存内容，也不指名集合之外的任何路径。若提交随后失败，provider 回滚该索引条目并报告回滚是否成功。

`ignoredPaths` 以 `core.quotePath=false` 运行 `git check-ignore`，并把输出归约为调用方指名的路径，因为 `check-ignore -z` 只有配合 `--stdin` 才有意义，而无 shell runner 无法提供。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/parse.ts` 持有纯解码器——退出状态提取、numstat、merge-tree、NUL 分隔与换行分隔的读取器、冲突列表上限，以及提交路径守卫。`src/index.ts` 持有 `LocalGitAligner`，它构造 argv、把调用方信号与自身超时组合，并对返回结果分类。进程边界通过 `internals.run` 为测试注入；生产使用 `runNativeCommand`。

该 provider 是 `ctx.gitAlign` seam 的 provider 角色；抽象契约在 `dsh-git-align`。

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

无。该 provider 只注册 `ctx.gitAlign`：没有工具、提示段落或会话事件，其答案只到达消费方的台账。

#### Token effect

无。没有任何命令输出被渲染进模型请求；provider 把解码后的事实返回给调用方。

#### KV Cache effect

无。这里不贡献任何请求前缀、消息或工具 schema。

## Known Limitations and Deferred Work

- **一个 git，一台机器。** provider 运行 `PATH` 上的 `git`；没有它的宿主回答 `git-unavailable`，且没有内置回退。
- **会提示的 fetch 被有界化而非被回答。** 凭据提示无法通过该 runner 关闭，因此交互式 fetch 被 `commandTimeoutMs` 中止并记录为失败的 fetch，而不是挂住整次运行。
- **换行分隔的忽略输出。** `check-ignore -z` 需要 `--stdin`，而无 shell runner 无法提供，因此 git 加引号或换行的路径会被丢弃而不是被报告。
- **intent-to-add 是一个索引条目。** 事实读取之后的拒绝可能为某个可归属路径留下 intent-to-add 条目；`commit` 在提交失败时回滚自己的条目，其他任何操作都不写索引。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：provider 的答案在其自身测试中对照脚本化命令输出与一个真实仓库校验，而不是对照第二次实时观察。

</details>

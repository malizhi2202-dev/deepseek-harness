---
description: "面向挂载仓库写入方的部署方与实现者：ctx.gitAlign 对齐服务契约。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-align

[English](README.md) | 中文

## 概述

`dsh-git-align` 定义 `ctx.gitAlign` 服务：定时对齐运行所需的仓库写操作——取回被跟踪分支、探测它能否干净合并、对齐 HEAD、读取 diff 事实、检查忽略规则、创建按路径限界的提交，以及报告某个提交是否已经到达远端——每个操作都以可判别的值作答，而不是为预期的 git 失败抛异常。它并立于只读的 `ctx.git` 观察 seam 而不是拓宽它：那个 seam 的契约是一次有界读取，而这里的操作全部改写仓库。操作集里有三件事按构造不存在：没有 push、没有 rebase、没有历史改写。这里没有任何东西到达模型；驱动它的消费方把答案记进持久台账。组合挂载一个注册该服务的 provider（如 `dsh-git-align-local`）；本包是抽象契约，不是可加载插件。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

你很少直接加载 `dsh-git-align`：先挂载一个注册为 `ctx.gitAlign` 的 provider，再由消费方调用它的操作。`resolve` 把观察到的坐标解析为 `AlignSpec`，一次性拆开被跟踪分支的 `remote/ref` 拼写，使任何操作都不必重复推导；无法拆分的请求在任何命令运行前抛出 `GitAlignRequestError`。

其余每个操作都以值作答。`fetch` 回答 `fetched` 或一个已分类的失败。`probe` 回答 `clean`、一个有界的冲突报告，或一个失败——并且它不得改动目标工作树、其索引或其引用。`apply` 回答 `aligned`、`merge-failed`，或 `merge-failed-dirty`（后者表示本次尝试自己发起的合并无法回滚）。`changeFacts`、`ignoredPaths`、`commit`、`pushedToRemote` 同形。

失败词汇是 `GitAlignFailure` 上三个稳定代码：provider 自身上限结束命令时 `timeout`，进程从未运行时 `git-unavailable`，命令运行并以非零退出时 `command-failed`。判定依据是 `code`，绝不依赖类身份。调用方取消不是 git 结果：它以调用方自己的中止原因拒绝。

`commit` 恰好包含给定的路径。空路径集被拒绝而不是被解释，因为 `git commit -- ` 不带路径会提交整个索引。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 持有全部词汇表；`src/index.ts` 声明抽象 `GitAligner` 服务与 `GitAlignRequestError`。该 seam 声明的是操作而非命令：用哪条 git 调用实现一次 fetch、探测如何发现它无法构造合并树，都是 provider 的知识。

`GitAligner` 是该 seam 的 Service Definition 角色；`dsh-git-align-local` 是 provider 角色；工作区自动化插件是消费方角色。

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

无。该 seam 不注册工具、提示段落或会话事件；`ctx.gitAlign` 只被工作区自动化消费方调用，其答案成为人阅读的台账记录。

#### Token effect

无。这里没有任何操作组装、过滤或追加任何进入模型请求的内容，也没有任何答案文本渲染给模型。

#### KV Cache effect

无。本包不贡献任何请求前缀、消息或工具 schema。

## Known Limitations and Deferred Work

- **绝无任何远端写操作。** 操作集没有 push、没有标签发布，也没有 fetch 自身远端跟踪引用之外的远端引用更新；加入一项是契约变更，不是 provider 的选择。
- **没有 rebase 或历史改写。** 对齐只通过快进或合并到达上游；想要 rebase 的部署必须在本 seam 之外自建。
- **每个上下文一个实现。** 服务注册为 `ctx.gitAlign`；需要两个执行世界的组合必须把它们拆进两个上下文。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：该 seam 没有可比较的自有状态，provider 的答案在其自身测试中对照脚本化命令输出与一个真实仓库校验。

</details>

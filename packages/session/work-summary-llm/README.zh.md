---
description: "ctx.workSummary 的 provider：向配置好的模型索取一条 Conventional Commits 消息，并在答案不可信时一律拒绝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-work-summary-llm

[English](README.md) | 中文

## 概述

`dsh-work-summary-llm` 是 `ctx.workSummary` seam 的一个 provider。它把单个工作单元改动的路径组织成一次对配置模型的请求，把回复解析成主题与正文，再把提案交回服务，由服务按部署的消息策略校验。

该 provider 选择拒绝而不是猜测。当工作单元没有改动任何路径、当组织好的请求会超过 `maxInputBytes`、当模型因「已完成答案」以外的任何原因停止、以及当回复不含任何非空白文本时，它都拒绝。每次拒绝都会成为服务结果上的一条 note，随后服务回退到机械消息，因此无法作答的 provider 绝不会意外产出一条提交消息。

请求只由路径事实构成——仓库相对路径，附带插入与删除行数以及一个二进制标记。文件内容绝不进入提示，因此摘要器无法泄漏预提交筛查本会拒绝的凭据。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

把该插件与 `dsh-work-summary`、`dsh-llm` 挂载在一起。`provider` 与 `model` 为必填；其余字段都有经过校验的默认值。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `provider` | 必填 | 要请求的 LLM provider 路由。 |
| `model` | 必填 | 要请求的模型。 |
| `maxOutputTokens` | 512 | 回复的上限。 |
| `timeoutMs` | 20000 | 单次请求的时限。 |
| `maxInputBytes` | 16384 | 组织好的请求超过该值即拒绝。 |
| `maxBodyLines` | 20 | 解析器保留的正文行数。 |

插件以 `work-summary-llm` 注册自身，并注入 `workSummary` 与 `llm`。注册是一个 effect，因此销毁该 fiber 会把 provider 从注册表移除。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/prompt.ts` 是纯函数：`systemPrompt` 固定指令文本，`frameRequest` 渲染路径事实，`parseProposal` 通过裁剪空白边缘、剥离一个围栏代码块、再次裁剪空白边缘，并把剩下的第一行作为主题，把回复归约成主题与正文。`src/index.ts` 持有插件的 `name`、`inject`、`Config`、`apply`，以及掌握全部拒绝条件与流式请求的 `generateWithLlm`。

该 provider 既不向 `ctx.llm.stream` 传会话 id，也不传 purpose：该请求不属于任何会话的转录，服务改为在自己的台账中记录这次询问。

<a id="model-experience"></a>
## Model Experience

### Summarization request and reply

#### What the model sees

每次询问一次请求：一段固定的指令文本，外加一条用户消息，列出该工作单元的仓库相对路径及其 `+插入/-删除` 与二进制标记。文本由 `frameRequest` 构造，因此模型只看到路径事实——没有文件内容、没有会话转录，也没有工具定义。

#### Token effect

两侧都有界。组织好的请求超过 `maxInputBytes`（默认 16384 字节）即被拒绝，回复受 `maxOutputTokens`（默认 512）与 `timeoutMs`（默认 20000 毫秒）限制。因此改动路径很多的工作单元会拒绝，而不是让请求无限增长。

#### KV Cache effect

没有需要失效的内容。指令文本是固定字符串，用户消息按每次询问重新构造，因此两个不同工作单元之间不共享稳定前缀，这里也不会延长任何会话的缓存前缀。

## Known Limitations and Deferred Work

- **只有路径事实。** 模型从不读取 diff，因此重命名或移动内容的工作单元只能依据其路径与行数被总结。
- **一次请求，不重试。** 超时、传输失败，或「已完成答案」以外的停止原因都会结束这次询问；服务选择回退而不是重试。
- **回复不会被追问。** 因类型或某个上限被服务拒绝的提案不会被送回要求更正。
- **不在会话日志中。** 该请求被有意排除在会话转录之外，因此无法从日志重放；调用方的台账记录曾发生一次询问及其 note。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：provider 的答案在其自身测试中对照一个脚本化 adapter 校验，且它不拥有任何可能被第二次实时观察推翻的关系。

</details>

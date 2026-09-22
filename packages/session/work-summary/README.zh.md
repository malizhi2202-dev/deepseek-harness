---
description: "ctx.workSummary 服务：一个 provider 注册表，外加一个有界的机械回退，把单个工作单元改动的路径变成 Conventional Commits 消息。"
kind: "package-reference"
---

# @deepseek-ai/dsh-work-summary

[English](README.md) | 中文

## 概述

`dsh-work-summary` 拥有 `ctx.workSummary` 能力。调用方交给它一个已闭合的工作单元——工作区、会话、轮次、结束原因，以及带行数统计的改动路径——它返回一条提交消息，外加这条消息如何产生的记录。

服务按注册顺序询问每个已注册的 provider，并采用第一个可用提案。抛错、拒绝，或提出超出既定策略消息的 provider 会被记为一条 note，随后继续查找，因此一个坏掉或过度积极的 provider 只会降低消息质量，而不会让整次运行失败。当没有任何 provider 给出可用提案时，服务用路径事实拼出一条机械消息——这正是该能力不硬依赖模型的原因。

消息策略是配置而非代码：接受的类型词表、是否可表达破坏性变更、回退类型，以及主题、正文行数与总字节上限，都以经过校验的 `Config` 字段传入。每个上限都施加在拼装完成的结果上，而不是施加在各部分上；标记提交由单个工作单元产生的 trailer 会在截断主题之前先被预留。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

每个 context 挂载一次该服务，然后注册一个 provider，或直接依赖机械回退。

```ts
const dispose = ctx.workSummary.register({
  id: 'my-provider',
  generate: async request => ({ kind: 'proposed', proposal: { subject: 'feat(git): align', body: [] } }),
})
```

`register` 返回自身的 disposer，因此由插件安装的 provider 会随该插件一起移除。`generate` 是唯一的读取入口；它解析为一个 `WorkSummaryResult`，携带消息、消息来自 provider 还是机械路径、提案是否被拒，以及全部询问 note。

当提案主题不匹配 `<type>(<scope>)!?: <description>` 且类型在词表内、当 `allowBreaking` 为假而提案声明破坏性变更、当正文出现 `BREAKING CHANGE` trailer、或当提案超出某个上限时，该提案被拒。拒绝不是失败：服务会回退，note 会写明原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/summary.ts` 是纯函数：主题模式、破坏性变更检测器、UTF-8 截断助手、共享 scope 与逐路径描述、trailer 构造器，以及两个拼装器。`assembleMessage` 产出精确的无界消息；`renderMessage` 施加字节与行数上限并预留 trailer。`validateProposal` 对 provider 的答案分类。`src/index.ts` 持有 `WorkSummaryService`、`Config` 模式、`resolveMessagePolicy`，以及 provider 循环。

本包是 `ctx.workSummary` seam 的 Service Definition 与默认 consumer；provider 位于 `dsh-work-summary-llm`。

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

无。该服务只注册 `ctx.workSummary`，不贡献任何工具、提示段落或会话事件；其结果到达调用方的台账与所创建的提交消息，而不是模型请求。

#### Token effect

无。本包中没有任何内容被渲染进模型请求；它返回的消息作为参数传给 `git commit`。

#### KV Cache effect

无。这里没有可缓存或可失效的请求前缀、消息或工具定义。

## Known Limitations and Deferred Work

- **机械消息是浅层的。** 它只写出共享 scope 并统计改动路径数，因此一个跨无关目录的工作单元要么被读成一个 scope，要么读成没有 scope。
- **上限以字节计并会丢弃内容。** 超过 `maxMessageBytes` 的消息先丢正文行、再丢主题字符；没有任何东西总结被丢弃的部分。
- **只有一个 provider 胜出。** provider 按注册顺序被询问，第一个可用提案即被采用，因此一个 provider 无法改进另一个的提案。
- **没有会话事件。** 询问记录在调用方的台账而非会话日志中，因为该消息不是模型可见输入，而新增会话事件成员会改变日志格式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：服务行为由其自身针对脚本化 provider 的测试固定，且没有任何独立观察能与它自己拥有的注册表产生分歧。

</details>

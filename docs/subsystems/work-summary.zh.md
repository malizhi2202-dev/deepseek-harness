# 工作摘要

[English](work-summary.md) | 中文

`ctx.workSummary` 把一个已闭合的工作单元——工作区、会话、回合、该回合的结束原因，以及该回合写入的路径及其行数——转成该单元提交时所用的提交信息。[`dsh-work-summary`](../../packages/session/work-summary) 声明该服务：一个按注册顺序征询的提供方注册表，外加一个仅依据路径事实拼装的机械回退，这正是该能力不硬依赖模型的原因。[`dsh-work-summary-llm`](../../packages/session/work-summary-llm) 是一个提供方，它询问已配置的模型并在无法可信作答时拒绝作答而非猜测。信息策略是配置而非代码：可接受的类型词汇、是否可表达破坏性变更、回退类型，以及主题、正文行数与总字节上限，全部由经校验的 `Config` 字段给出。该服务不注册任何工具、提示词段或会话事件；一次征询记录在调用方的账本中，而提供方自身的模型请求归该提供方的包所有。它唯一的消费方是 [`dsh-workspace-automation`](../../packages/workspace/workspace-automation)，后者在回合闭合边界调用它。设计记录：[per-workspace git alignment and automatic commit](../../.agents/notes/implemented/architecture/2026-09-22-workspace-git-alignment-and-automatic-commit.zh.md)。

源码：[`packages/session/work-summary/src/types.ts`](../../packages/session/work-summary/src/types.ts)、[`packages/session/work-summary/src/summary.ts`](../../packages/session/work-summary/src/summary.ts)

## 工作单元

一次生成只针对一个工作单元：它在哪个工作区和会话中运行、哪个回合将其闭合、该回合如何结束，以及该回合写入了哪些路径。一条路径事实携带仓库相对路径、其新增与删除行数，以及是否为二进制——二进制条目不带行数，在正文行中读作 `binary`。

```ts type-equiv
/** Everything one summary generation is asked about. */
interface WorkSummaryRequest {
  /** Workspace the work unit ran in. */
  readonly workspaceId: string
  /** Session the work unit belongs to. */
  readonly sessionId: string
  /** Turn number that closed the work unit. */
  readonly turn: number
  /** How the turn ended, as the session log recorded it. */
  readonly endReason: string
  /** Paths the work unit wrote, with their diff facts. */
  readonly paths: readonly WorkPathFact[]
}
```

请求既不携带文件内容也不携带 diff 文本，因此提供方看到的事实就是调用方已经证明的事实。路径为空的工作单元同样有请求、同样会得到信息，因为机械回退无需任何路径即可作答。

## 提议与接受

提供方提议一个主题和一个正文；由服务决定该提议是否成为最终信息。当主题无法解析为带已声明类型的 conventional-commit 头、当部署方禁止破坏性变更而提议却声明了它、当正文中出现 `BREAKING CHANGE` trailer、或当完整渲染后的信息超出上限时，该提议被拒绝。

```ts type-equiv
/** One provider's proposed commit message. */
interface WorkSummaryProposal {
  /** Proposed subject line; a conventional-commit header. */
  readonly subject: string
  /** Proposed body lines; may be empty. */
  readonly body: readonly string[]
}
```

```ts type-equiv
/** What one provider call answered. */
type WorkSummaryProviderResult =
  | { readonly kind: 'proposed'; readonly proposal: WorkSummaryProposal }
  | { readonly kind: 'declined'; readonly reason: string }
```

拒绝不等于失败。被拒绝或被婉拒的提议记为一条备注，搜索继续进行；拒绝原因包括 `empty-subject`、`multiline-subject`、`malformed-subject`、`unknown-type`、`breaking-not-allowed`、`subject-too-long`、`too-many-body-lines` 与 `message-too-long`。提议绝不会被裁剪成提供方没有说过的样子，因此服务要么原样采纳该提议，要么回退。

## 提供方契约

```ts type-equiv
/**
 * One summary provider. A provider proposes a message from the diff facts it is
 * given and must never claim a change the facts do not carry; it may decline.
 */
interface WorkSummaryProvider {
  /** Stable provider identifier used in diagnostics. */
  readonly id: string
  /**
   * Propose one commit message for the request.
   * @param request - the work unit's identity and diff facts.
   * @returns the proposal, or a decline with its reason.
   */
  generate(request: WorkSummaryRequest): Promise<WorkSummaryProviderResult>
}
```

注册是有序的：提供方按注册顺序被征询，第一个可用提议即被采纳，因此一个提供方无法润色另一个的提议。`register` 返回自身的 disposer，因此插件安装的提供方随该插件一并移除。抛错的提供方与被婉拒的提供方同等处理——该失败记为备注并继续征询——因此损坏的提供方只会削弱信息，而不会让整次运行失败。

## 被采纳的信息

```ts type-equiv
/** The complete commit message one summary generation produced. */
interface WorkSummaryMessage {
  /** Subject line, without a trailing newline. */
  readonly subject: string
  /** Body lines, without the trailer. */
  readonly body: readonly string[]
  /** The unit trailer identifying the work unit that produced the commit. */
  readonly trailer: string
}
```

```ts type-equiv
/** The answer to one summary generation. */
interface WorkSummaryResult {
  /** The message to commit with. */
  readonly message: WorkSummaryMessage
  /** Whether a provider or the mechanical fallback supplied it. */
  readonly source: WorkSummarySource
  /** Whether a provider proposed a message that failed validation. */
  readonly proposalRejected: boolean
  /** Why every consulted provider declined or was rejected, in consultation order. */
  readonly notes: readonly string[]
}
```

trailer 为 `${trailerName}: ${sessionId}/${turn}`，正是它让部署侧的推送判定条件能识别出某个提交属于某个工作单元。它先于主题截断而被保留，因此处于字节上限的信息仍然保留使该提交可归属的事实；即使预算小到放不下 trailer，也宁可只保留主题而不放宽上限。正文行随后在能放下的前提下逐条加入，字节上限对每一种已配置的取值都成立。`source` 报告信息出自提供方还是回退，`notes` 按征询顺序保留每一次拒绝。

机械回退只陈述路径事实本身携带的内容：类型 `fallbackType`、所有路径共享的最深目录作为 scope、文件数，以及新增与删除行数合计，其后是每条路径一行正文。

## 信息策略

```ts type-equiv
/** Every deployment-varying bound and vocabulary one message is built under. */
interface MessagePolicy {
  /** Conventional-commit types an accepted subject may declare. */
  readonly commitTypes: readonly string[]
  /** Whether a proposal may declare a breaking change. */
  readonly allowBreaking: boolean
  /** Type the mechanical fallback declares. */
  readonly fallbackType: string
  /** Maximum UTF-8 bytes of a subject line. */
  readonly maxSubjectBytes: number
  /** Maximum body lines, excluding the trailer. */
  readonly maxBodyLines: number
  /** Maximum UTF-8 bytes of the complete rendered message. */
  readonly maxMessageBytes: number
  /** Trailer key that marks a commit as produced by one work unit. */
  readonly trailerName: string
}
```

`resolveMessagePolicy` 把已声明的 `Config` 转换成这份策略，并在加载时拒绝自包含的配置错误：空类型列表、不是小写 conventional-commit 类型的类型、不在列表中的 `fallbackType`，或为空、含多行的 trailer 键。默认值为六个类型 `feat`、`fix`、`docs`、`refactor`、`test` 与 `chore`；`allowBreaking` 为 false；`fallbackType` 为 `chore`；主题 72 字节；正文 50 行；信息 4096 字节；trailer 键为 `Dsh-Unit`。每一条上限都施加到完整拼装后的信息而非其各部分，因此主题、正文与 trailer 不可能组合出超过已声明上限的内容。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworksummary--worksummaryservice"></a>

### `ctx.workSummary` — `WorkSummaryService`

The work-summary service: consults registered providers in registration order and falls back to a mechanical message assembled from the path facts.

```ts cordis-catalog
/**
 * Register one summary provider. Consultation follows registration order, so a
 * deployment that mounts several gets the first one that proposes.
 * @param provider - the provider to consult.
 * @returns the disposer that removes it.
 */
register(provider: WorkSummaryProvider): () => void

/**
 * Produce the commit message for one work unit.
 *
 * Every registered provider is consulted in order until one proposes a
 * message that validates. A provider that throws, declines, or proposes an
 * unusable message is recorded in `notes` and consultation continues; when no
 * proposal is accepted the mechanical fallback is built from the diff facts.
 * @param request - the work unit's identity and path facts.
 * @returns the accepted message, its source, and every consultation note.
 */
async generate(request: WorkSummaryRequest): Promise<WorkSummaryResult>
```

Source: [`packages/session/work-summary/src/index.ts`](../../packages/session/work-summary/src/index.ts)
<!-- END GENERATED cordis-surface -->

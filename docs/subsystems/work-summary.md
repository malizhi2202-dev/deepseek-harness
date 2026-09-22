# Work Summary

English | [中文](work-summary.zh.md)

`ctx.workSummary` turns one closed work unit — the workspace, the session, the turn, its end reason, and the paths that turn wrote with their line counts — into the commit message that unit is committed with. [`dsh-work-summary`](../../packages/session/work-summary) declares the service: a provider registry consulted in registration order plus a mechanical fallback assembled from the path facts alone, which is why the capability has no hard dependency on a model. [`dsh-work-summary-llm`](../../packages/session/work-summary-llm) is a provider that asks a configured model and declines rather than guessing. Message policy is configuration rather than code: the accepted type vocabulary, whether a breaking change is expressible, the fallback type, and the subject, body-line, and total-byte bounds all arrive as validated `Config` fields. The service registers no tool, prompt section, or session event; a consultation is recorded in the caller's ledger, and a provider's own model request belongs to that provider's package. Its only consumer is [`dsh-workspace-automation`](../../packages/workspace/workspace-automation), which calls it at a closed turn boundary. Design record: [per-workspace git alignment and automatic commit](../../.agents/notes/implemented/architecture/2026-09-22-workspace-git-alignment-and-automatic-commit.md).

Sources: [`packages/session/work-summary/src/types.ts`](../../packages/session/work-summary/src/types.ts), [`packages/session/work-summary/src/summary.ts`](../../packages/session/work-summary/src/summary.ts)

## The work unit

One generation is asked about one work unit and nothing else: which workspace and session it ran in, which turn closed it, how that turn ended, and the paths the turn wrote. A path fact carries the repository-relative path, its insertion and deletion counts, and whether it is binary — a binary entry carries no line counts and reads as `binary` in a body line.

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

The request carries no file content and no diff text, so the facts a provider sees are the ones the caller proved. A work unit whose paths are empty still has a request and still gets a message, because the mechanical fallback needs no paths to answer.

## Proposals and acceptance

A provider proposes a subject and a body; the service decides whether that proposal becomes the message. A proposal is rejected when its subject does not parse as a conventional-commit header with a declared type, when it declares a breaking change while the deployment forbids one, when a `BREAKING CHANGE` trailer appears in the body, or when the complete rendered message exceeds a bound.

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

Rejection is not failure. A rejected or declined proposal is recorded as a note and the search continues; the rejection reasons are `empty-subject`, `multiline-subject`, `malformed-subject`, `unknown-type`, `breaking-not-allowed`, `subject-too-long`, `too-many-body-lines`, and `message-too-long`. A proposal is never trimmed into something its provider did not say, so the service either takes the proposal as given or falls back.

## The provider contract

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

Registration is ordered: providers are consulted in registration order and the first usable proposal is taken, so a provider cannot refine another's proposal. `register` returns its own disposer, so a provider installed by a plugin is removed with that plugin. A provider that throws is treated like one that declines — the failure is recorded as a note and consultation continues — so a broken provider degrades the message instead of failing the run.

## The accepted message

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

The trailer is `${trailerName}: ${sessionId}/${turn}`, which is what lets a deployment-side push predicate recognize a commit as one work unit's. It is reserved before the subject is truncated, so a message at the byte bound keeps the fact that makes the commit attributable; a budget too small even for the trailer keeps the subject alone rather than dropping the bound. Body lines are then added while they fit, and the byte bound holds for every configured limit. `source` reports whether a provider or the fallback supplied the message, and `notes` preserves every refusal in consultation order.

The mechanical fallback states only what the path facts carry: the type `fallbackType`, the deepest directory every path shares as the scope, the file count, and the added and deleted line totals, followed by one body line per path.

## Message policy

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

`resolveMessagePolicy` turns the declared `Config` into this policy and rejects a self-contained misconfiguration at load: an empty type list, a type that is not a lowercase conventional-commit type, a `fallbackType` absent from the list, or a blank or multi-line trailer key. The defaults are the six types `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`; `allowBreaking` false; `fallbackType` `chore`; 72 subject bytes; 50 body lines; 4096 message bytes; and the trailer key `Dsh-Unit`. Every bound is applied to the complete assembled message rather than to its parts, so a subject, a body, and a trailer can never combine into something over the declared limit.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

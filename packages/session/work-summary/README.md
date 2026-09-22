---
description: "The ctx.workSummary service: a provider registry plus a bounded mechanical fallback that turns one work unit's changed paths into a Conventional Commits message."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-summary

English | [中文](README.zh.md)

## Summary

`dsh-work-summary` owns the `ctx.workSummary` capability. A caller hands it one closed work unit — the workspace, the session, the turn, the end reason, and the changed paths with their line counts — and receives one commit message plus the record of how that message was produced.

The service consults every registered provider in registration order and takes the first usable proposal. A provider that throws, declines, or proposes a message outside the declared policy is recorded as a note and the search continues, so a broken or over-eager provider degrades the message instead of failing the run. When no provider yields a usable proposal, the service assembles a mechanical message from the path facts, which is why the capability has no hard dependency on a model.

Message policy is configuration, not code: the accepted type vocabulary, whether a breaking change is expressible, the fallback type, and the subject, body-line, and total-byte bounds all arrive as validated `Config` fields. Every bound is applied to the assembled result rather than to its parts, and the trailer that marks a commit as produced by one work unit is reserved before the subject is truncated.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service once per context, then either register a provider or rely on the mechanical fallback.

```ts
const dispose = ctx.workSummary.register({
  id: 'my-provider',
  generate: async request => ({ kind: 'proposed', proposal: { subject: 'feat(git): align', body: [] } }),
})
```

`register` returns its own disposer, so a provider installed by a plugin is removed with that plugin. `generate` is the only read entry point; it resolves to a `WorkSummaryResult` carrying the message, whether a provider or the mechanical path supplied it, whether a proposal was rejected, and every consultation note.

A proposal is rejected when its subject does not match `<type>(<scope>)!?: <description>` with a declared type, when it declares a breaking change while `allowBreaking` is false, when a `BREAKING CHANGE` trailer appears in the body, or when it exceeds a bound. Rejection is not failure: the service falls back, and the note names the reason.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/summary.ts` is pure: the subject pattern, the breaking-change detector, the UTF-8 truncation helper, the shared-scope and per-path descriptions, the trailer builder, and the two assemblers. `assembleMessage` produces the exact unbounded message; `renderMessage` applies the byte and line bounds and reserves the trailer. `validateProposal` classifies a provider's answer. `src/index.ts` holds `WorkSummaryService`, the `Config` schema, `resolveMessagePolicy`, and the provider loop.

This package is the Service Definition and the default consumer of the `ctx.workSummary` seam; a provider lives in `dsh-work-summary-llm`.

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

None. The service registers `ctx.workSummary` and contributes no tool, prompt section, or session event; its result reaches the caller's ledger and the created commit message, not a model request.

#### Token effect

None. Nothing in this package is rendered into a model request; the message it returns is passed to `git commit` as an argument.

#### KV Cache effect

None. There is no request prefix, message, or tool definition here to cache or invalidate.

## Known Limitations and Deferred Work

- **The mechanical message is shallow.** It names the shared scope and counts the changed paths, so a work unit that touched unrelated directories reads as one scope or none.
- **Bounds are byte-based and drop content.** A message over `maxMessageBytes` loses body lines first and then subject characters; nothing summarizes what was dropped.
- **One provider wins.** Providers are consulted in registration order and the first usable proposal is taken, so a provider cannot refine another's proposal.
- **No session event.** A consultation is recorded in the caller's ledger rather than the session log, because the message is not model-visible input and adding a session event member would change the log format.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the service's behavior is fixed by its own suites over scripted providers, and no independent observation can diverge from the registry it owns.

</details>

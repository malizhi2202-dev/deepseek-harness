---
description: "The ctx.workSummary provider that asks a configured model for a Conventional Commits message and declines whenever the answer cannot be trusted."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-summary-llm

English | [中文](README.zh.md)

## Summary

`dsh-work-summary-llm` is a provider for the `ctx.workSummary` seam. It frames one work unit's changed paths as a single request to a configured model, parses the reply into a subject and body, and hands the proposal back to the service, which validates it against the deployment's message policy.

The provider declines rather than guesses. It declines when the work unit changed no paths, when the framed request would exceed `maxInputBytes`, when the model stops for any reason other than a completed answer, and when the reply carries no non-blank text. Every decline is a note on the service's result, and the service then falls back to its mechanical message, so a provider that cannot answer never produces a commit message by accident.

The request is built from path facts only — repository-relative paths with insertion and deletion counts and a binary marker. File contents never enter the prompt, so the summarizer cannot leak a credential the pre-commit screen would have refused.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside `dsh-work-summary` and `dsh-llm`. `provider` and `model` are required; every other field has a validated default.

| Field | Default | Meaning |
| --- | --- | --- |
| `provider` | required | The LLM provider route to request. |
| `model` | required | The model to request. |
| `maxOutputTokens` | 512 | Upper bound on the reply. |
| `timeoutMs` | 20000 | Bound on one request. |
| `maxInputBytes` | 16384 | Framed-request bound above which the provider declines. |
| `maxBodyLines` | 20 | Body lines the parser keeps. |

The plugin registers itself under `work-summary-llm` and injects `workSummary` and `llm`. Registration is an effect, so disposing the fiber removes the provider from the registry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/prompt.ts` is pure: `systemPrompt` fixes the instruction text, `frameRequest` renders the path facts, and `parseProposal` reduces a reply to a subject and body by trimming blank edges, stripping one fenced block, trimming blank edges again, and taking the first remaining line as the subject. `src/index.ts` holds the plugin's `name`, `inject`, `Config`, `apply`, and `generateWithLlm`, which owns the decline conditions and the streamed request.

The provider passes neither a session id nor a purpose to `ctx.llm.stream`: the request is not part of any session's transcript, and the service records the consultation in its own ledger instead.

<a id="model-experience"></a>
## Model Experience

### Summarization request and reply

#### What the model sees

One request per consultation: a fixed system instruction plus a user message listing the work unit's repository-relative paths with `+insertions/-deletions` and a binary marker. The text is built by `frameRequest`, so the model sees path facts and nothing else — no file contents, no session transcript, and no tool definitions.

#### Token effect

Bounded on both sides. The framed request is refused above `maxInputBytes` (16384 bytes by default), and the reply is capped at `maxOutputTokens` (512 by default) and at `timeoutMs` (20000 ms by default). A work unit that touches many paths therefore declines instead of growing the request without limit.

#### KV Cache effect

None to invalidate. The system instruction is a fixed string and the user message is rebuilt per consultation, so no stable prefix is shared between two different work units and nothing here extends a session's cached prefix.

## Known Limitations and Deferred Work

- **Path facts only.** The model never reads a diff, so a work unit that renamed or moved content is summarized from its path and line counts alone.
- **One request, no retry.** A timeout, a transport failure, or a stop reason other than a completed answer ends the consultation; the service falls back rather than retrying.
- **The reply is not re-asked.** A proposal the service rejects because of its type or a bound is not sent back for correction.
- **Not in the session log.** The request is deliberately absent from the session transcript, so it cannot be replayed from the log; the caller's ledger records that a consultation happened and its notes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the provider's answers are checked against a scripted adapter in its own suite, and it owns no relation that a second live observation could contradict.

</details>

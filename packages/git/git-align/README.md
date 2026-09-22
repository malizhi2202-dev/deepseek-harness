---
description: "The ctx.gitAlign alignment service contract for deployments mounting a repository writer and developers implementing one."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-align

English | [中文](README.zh.md)

## Summary

`dsh-git-align` defines the `ctx.gitAlign` service: the repository write operations a scheduled alignment run needs — fetch a tracked branch, probe whether it merges cleanly, align HEAD, read diff facts, check ignore rules, create a path-limited commit, and report whether a commit already reached a remote — each answering a discriminated value instead of throwing for an expected git failure. It sits beside the read-only `ctx.git` observation seam rather than widening it: that seam's contract is a bounded read, and this one's operations all mutate. Three things are absent from the operation set by construction: there is no push, no rebase, and no history rewrite. Nothing here reaches a model; the consumer that drives it records its answers in a durable ledger. A composition mounts one provider (such as `dsh-git-align-local`) that registers the service; this package is the abstract contract, not a loadable plugin.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

You rarely load `dsh-git-align` directly: you mount a provider that registers as `ctx.gitAlign`, then call its operations from a consumer. `resolve` turns the observed coordinates into an `AlignSpec`, splitting the tracked branch's `remote/ref` spelling once so no operation re-derives it; a request that cannot be split throws `GitAlignRequestError` before any command runs.

Every other operation answers a value. `fetch` answers `fetched` or a classified failure. `probe` answers `clean`, a bounded conflict report, or a failure — and it must not modify the target work tree, its index, or its refs. `apply` answers `aligned`, `merge-failed`, or `merge-failed-dirty`, the last meaning the attempt's own merge could not be rolled back. `changeFacts`, `ignoredPaths`, `commit`, and `pushedToRemote` follow the same form.

Failure vocabulary is three stable codes on `GitAlignFailure`: `timeout` when the provider's own bound ended the command, `git-unavailable` when the process never ran, and `command-failed` when a command ran and exited non-zero. Discrimination is by `code`, never by class identity. A caller cancellation is not a git outcome: it rejects with the caller's own abort reason.

`commit` contains exactly the paths it is given. An empty path set is refused rather than interpreted, because `git commit -- ` with no path commits the whole index.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` holds the whole vocabulary; `src/index.ts` declares the abstract `GitAligner` service and `GitAlignRequestError`. The seam declares operations, not commands: which git invocation implements a fetch, and how a probe detects that it cannot build a merged tree, are the provider's knowledge.

`GitAligner` is the Service Definition role of the seam; `dsh-git-align-local` is the provider role; the workspace automation plugin is the consumer role.

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

None. The seam registers no tool, prompt section, or session event; `ctx.gitAlign` is called only by the workspace automation consumer, and its answers become ledger records a human reads.

#### Token effect

None. No operation here assembles, filters, or appends anything to a model request, and no answer text is rendered to a model.

#### KV Cache effect

None. Nothing in this package contributes a request prefix, a message, or a tool schema.

## Known Limitations and Deferred Work

- **No remote write of any kind.** The operation set has no push, no tag publication, and no remote-ref update beyond the fetch's own remote-tracking ref; adding one is a contract change, not a provider choice.
- **No rebase or history rewrite.** Alignment reaches the upstream by fast-forward or merge only; a deployment that wants a rebase must build it outside this seam.
- **One implementation per context.** The service registers as `ctx.gitAlign`; a composition that needs two execution worlds must split them into two contexts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the seam has no owned state to compare, and the provider's answers are checked against scripted command output plus a live repository in its own suites.

</details>

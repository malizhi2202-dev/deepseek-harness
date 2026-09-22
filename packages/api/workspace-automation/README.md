---
description: "The workspace namespace's automation-ledger read for client consumers, and for maintainers of the host endpoint that projects the automation runtime's ledger."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-automation

English | [中文](README.zh.md)

## Summary

`dsh-api-workspace-automation` owns one method of the `workspace` Remote namespace: `automationLedger(workspaceId)` projects the automation runtime's run ledger for one workspace. The namespace is shared with [`dsh-api-workspace-controller`](../workspace-controller/README.md), because both are keyed by the same opaque `WorkspaceId`; the method name is this package's only claim on it. Loading the generated client into `ctx.remote.$mount` makes `ctx.remote.workspace.automationLedger` callable in the browser.

The ledger is authoritative and this package owns no fact of its own: every value it returns is copied from a stored run record, from the stored workspace state, or from the commit one run recorded. It reads and never writes — the runtime stays the only writer, and the panel built on this read offers no control that could change a run, a schedule, or a suspension.

Two bounds are validated configuration: how many runs one read returns and how many paths one path list carries. Both report the count they were cut from, so a reader learns what the bound hid.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Client code calls the method through the Remote carrier the [dsh-api-remotes](../remotes/README.md) client assembly already mounts; no plugin loads this package in the browser directly. One call takes a `WorkspaceId` and returns either the recorded ledger or `unrecorded`, which is the normal answer for a workspace whose timer has never run rather than a failure.

Host compositions mount the package beside the automation runtime and the Gateway; it injects `workspaceAutomation` and `typert`. The runtime's own configuration decides which workspaces have state, how long a ledger is retained, and whether a workspace is suspended; nothing in this package can change any of that.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` is wire vocabulary only, because the generated Remote client consumes it: it mirrors the runtime's closed outcome union with every path list replaced by a bounded list plus its count, and it carries the workspace state, one run per record, and the commit one run created. `src/projection.ts` is the whole transformation, and it is pure: it copies the stored values, cuts each list to the bound, orders the retained runs newest first, and reads the next move off the design's outcome table. `src/index.ts` is the endpoint — a `TypertRemoteService` whose single `@Remote automationLedger` resolves the workspace's report from `ctx.workspaceAutomation` and projects it.

The outcome union is switched exhaustively on its discriminant, so a reason the runtime adds fails the build here rather than reaching the panel as an unexplained card. The next-step tag is derived in the same file from the same outcome, so the panel never infers a consequence the design did not assign.

<a id="model-experience"></a>
## Model Experience

### The automation ledger read

#### What the model sees

Nothing directly. The endpoint registers no tool, prompt section, or session event, and no answer it returns reaches a model request: the design keeps runs out of model requests, and the panel that draws this ledger is browser-only. What a run does reach the model through is the commit message the run writes into the repository, which is repository content rather than a request input, and the commit job's own provider owns that text.

#### Token effect

None on its own. A read adds no tokens to any request, and the workspace state and run records it carries are drawn only in the browser. A run's commit message is sized by the runtime's own `maxMessageBytes` before it is written, which is a repository fact rather than a request input.

#### KV Cache effect

No direct invalidation; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **The ledger's observed upstream id is a local head.** `RunRecord.observedUpstreamOid` is written by the align job from the local `HEAD` oid it observed after fetching, and it is the same value the run stored as its baseline; the git seam's `observe` reports no upstream commit id and `gitAlign.fetch` answers only that a fetch happened. This projection therefore carries the ledger's own value under its own name and asserts nothing about the upstream tip. Naming the upstream tip needs an upstream oid from the git seam, which the seam does not publish.
- **A superseded run cannot name what moved.** That outcome records only the head the run expected, so a reader learns that `.git` changed under the run but not which commit did it.
- **Only a conflict's path list carries a true total.** A refusal's and an ambiguous attribution's lists are already cut by the runtime's `maxPathsPerCommit` before this endpoint sees them, so the count reported beside them is the length the ledger held. Read it as "at least this many", never as the number of paths involved.
- **Two path lists arrive unbounded.** The worktree remainder the last commit job reported and an ambiguous attribution's paths are not bounded by the runtime, so this projection is what bounds them; the count it reports beside them is the length it received.
- **The run bound's default is a product choice.** `maxRuns` defaults to 20 while the design's own retention figure is a 200-entry ring; the ledger's count is reported beside the returned runs, so a deployment that wants the whole retained ledger raises the bound in `cordis.yml`.
- **One call, one workspace.** There is no cross-workspace view: a caller wanting every workspace's timer makes one call per workspace, and nothing here aggregates them.
- **The ledger carries no workspace path or title.** Both live in the workspace registry, and the panel joins them through the client workspace model rather than through this read.
- **The namespace is shared, so activation is coupled.** Because the method lives on `workspace`, a browser consumer injects `remote.workspace`, which the Workspace Controller's client half also mounts; the panel's read therefore depends on that contribution being loaded rather than on this package alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the endpoint owns no relationship that two independent observations could disagree about, and its whole behavior is one pure projection whose mapping is pinned by its own suite against a scripted runtime, at tiny and exact bounds, for every outcome the runtime can record.

</details>

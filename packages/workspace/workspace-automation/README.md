---
description: "The per-workspace timer that aligns a checkout with its upstream and commits one turn's attributable work, with no path to a remote write."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-automation

English | [中文](README.zh.md)

## Summary

`dsh-workspace-automation` owns one timer per workspace and two jobs on it. The alignment job fetches, asks whether the upstream can be taken without a conflict, and then either reports what it found or advances the branch. The commit job runs at a closed turn boundary: it derives the paths that turn's own tool calls proved they wrote, screens them, summarizes them, and creates one commit.

The two jobs share three properties. Every run is recorded as one ledger entry with a closed outcome, so a reader can tell a refusal from a no-op from a failure. Nothing is retried inline: a failure increments a backoff that ends in suspension, and a conflicted workspace is left alone for a cooldown. And **the runtime has no operation that writes to a remote** — pushing stays a human decision.

## Table of Contents

- [Use this package](#use-this-package)
- [How "never push" is enforced](#never-push)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the runtime where `dsh-storage-domain`, `dsh-git`, `dsh-git-align`, `dsh-work-summary`, and `dsh-fs` are available, and declare what each workspace may do.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Whether any timer runs. |
| `intervalSeconds` | `3600` | Nominal interval; the floor is 300. |
| `jitterRatio` | `0.5` | Symmetric jitter applied to the interval. |
| `mode` | `observe` | `observe` probes and reports; `align` may write. |
| `worktreeRoot` | none | Required in `align` mode: where probe work trees are created. |
| `alignStrategy` | `ff-only` | `ff-only` or `merge`; a rebase is not expressible. |
| `dirtyPolicy` | `refuse` | `refuse`, or `commit-attributable` to let the commit job run first. |
| `downstreamVerification` | `none` | `external` defers a clean advance to a verifier that already covers it. |
| `commit.enabled` | `false` | Whether a turn boundary may create a commit. |
| `commit.secretPatterns` | five built-in shapes | Credential patterns; a hit always refuses. |
| `commit.maxPathsPerCommit` | `200` | Paths one commit may contain. |
| `workspaces` | `{}` | Per-workspace overrides keyed by workspace id. |

A `workspaces` entry may set `enabled`, `intervalSeconds`, `mode`, `alignStrategy`, `dirtyPolicy`, or `commitEnabled`. An override that names an unregistered workspace, or that turns on `align` mode without a deployment `worktreeRoot`, fails at load.

Three public methods read or steer the runtime: `report(workspaceId)` returns the stored state, `resume(workspaceId)` clears a suspension, and `runAlign` / `runCommit` run one job on demand. The alignment job also runs on its timer; the commit job also runs when a session closes a turn.

-----

<a id="never-push"></a>
## How "never push" is enforced

Three layers, each checkable on its own:

1. **The capability seam has no remote write.** `ctx.gitAlign` — the only git surface this package may write through — declares `resolve`, `fetch`, `probe`, `apply`, `changeFacts`, `ignoredPaths`, `commit`, and `pushedToRemote`. There is no `push`, and no method takes a remote destination. `pushedToRemote` is a read: it asks whether any `refs/remotes/` ref already contains a commit id.
2. **The provider's argv cannot carry one.** `dsh-git-align-local` builds every argument vector itself, and its live suite records the argv of every command a full alignment and commit run issues, asserts that none contains `push` or `rebase`, and asserts that the bare origin's branch tip is unchanged afterwards.
3. **The runtime only calls the seam.** `workspace-automation` reaches git through `ctx.gitAlign` for writes and `ctx.git.observe` for reads; it never spawns a process. Its two write operations are `apply` and `commit`, both local, and the commit it creates carries a `Dsh-Unit: <sessionId>/<turn>` trailer so a human who later pushes it can attribute it to the work unit that produced it.

The withdrawal path is deliberately non-destructive. A created commit is reported with `git reset --soft <parent>` and `git reset --mixed <parent>`; no `--hard` form is produced, so withdrawing a commit cannot discard a work tree.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` holds the vocabulary: the two job names, the closed `AutomationOutcome` union, and the stored and reported records. `src/spec.ts` projects the stored record into the `workspace_automation` storage domain. `src/config.ts` holds the `Config` schema and the three resolution steps that turn a declaration into one workspace's policy. `src/decision.ts` is pure: the alignment decision, the backoff and cooldown arithmetic, the lease check, the credential screen, the staging bound, the ambiguity check, the withdrawal report, and the two closed switches that describe an outcome. `src/attribution.ts` derives a turn's attributable paths from its own `tool/call` and `tool/result` events. `src/index.ts` holds `WorkspaceAutomationRuntime`.

Each run is one transaction: acquire a lease, act, record one ledger entry, release the lease, and re-arm the timer. The lease is stored, not held in memory, so a second process reading the same domain sees it. A run that finds the lease held records `skipped-locked` and returns without touching the repository.

The timer stores the next run as an absolute `nextEarliestRunAt` timestamp rather than an interval start, because the stored state is the only thing a restarted process can read. Backoff, cooldown, and the normal interval all write that one field, so arming a timer never depends on when the previous run happened.

Attribution is deliberately narrow. A path counts as this turn's work only when the turn contains a `tool/call` for a writing tool whose arguments name the path **and** a matching `tool/result` that reports no error. A call whose result never arrived, a failed result, and a call from another turn are all excluded, so a file a shell command wrote is never attributed.

## Model Experience

### No model-visible surface

#### What the model sees

None. The runtime contributes no tool, prompt section, or session event, and design §7.5 fixes that: the ledger is a stored record rather than a session event, so nothing here reaches a model request. The one model-facing act the runtime causes is a summarization consultation, and the request belongs to the `ctx.workSummary` provider, which frames it from path facts alone.

#### Token effect

None. No part of the stored state, the ledger, or a commit message is rendered into a model request.

#### KV Cache effect

None. There is no request prefix, message, or tool definition here to cache or invalidate.

## Known Limitations and Deferred Work

- **Pull-request alignment is out of scope.** The repository has no forge capability, so nothing here can align a pull request; only the local branch and its upstream are considered.
- **The ledger is read through a bounded projection.** `packages/api/workspace-automation` serves the newest `maxRuns` runs with `maxPaths` paths each, so a reader sees the recent ledger rather than its whole retention; the stored ledger stays the authority.
- **Shell-written files are never attributed.** A path changed by a subprocess produces no first-party `tool/call`, so it appears only in the reported `uncommittedPaths` remainder and is never committed.
- **The host attribution parser can drift.** `src/attribution.ts` restates the change-tool argument vocabulary that the client's turn-deliverables view also encodes; the two are separate implementations of one fact and no shared pure module enforces agreement.
- **The credential screen reads a bounded prefix.** Only the first `commit.maxScanBytes` bytes of each path are inspected, so a credential past that bound is not seen.
- **No cross-workspace view.** The ledger is bounded per workspace and read one workspace at a time.
- **No write-time grace window.** The design's `mtimeGraceMs` is not configurable here because `ctx.fs` reports an opaque freshness token rather than a modification time, so a candidate's write time cannot be compared against a bound; eligibility comes from the turn boundary alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: every relation this package owns is already fixed by its own suites over a real storage domain and scripted git providers, and the one relation that could diverge — a live repository — is covered by `dsh-git-align-local`'s live suite instead.

</details>

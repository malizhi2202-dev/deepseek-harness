# Agent Note: Per-workspace git alignment and automatic commit

Status: implemented

English | [中文](2026-09-22-workspace-git-alignment-and-automatic-commit.zh.md)

## Problem

A workspace is a directory the harness runs sessions in, and a session's work lands in a git checkout that nobody keeps aligned with its upstream and nobody commits until a human notices. The owner asked for two things: a timer on every workspace dimension that periodically aligns git — and the documents, commits, and code inside it — with the remote, and an automatic summary plus commit at the end of each work unit, with the push left to a human.

The second half is the harder constraint. An agent that can push can publish work nobody reviewed, rewrite a branch a colleague is building on, or leak a credential into a remote that keeps history forever. The feature is only acceptable if the harness cannot push at all, not if it merely declines to.

## Decision

Five packages, split along the roles the two seams need. `dsh-git-align` defines `ctx.gitAlign`: `resolve`, `fetch`, `probe`, `apply`, `changeFacts`, `ignoredPaths`, `commit`, and `pushedToRemote`. `dsh-git-align-local` is the host provider, running the machine's git through the shared no-shell runner. `dsh-work-summary` defines `ctx.workSummary`, a provider registry with a bounded mechanical fallback that turns one work unit's changed paths into a Conventional Commits message. `dsh-work-summary-llm` is a provider for it. `dsh-workspace-automation` owns the timer and the two jobs that consume all of the above.

Reads stay on the existing `ctx.git.observe`; `ctx.gitAlign` is a new seam rather than new methods on the read-only one, because the observation seam is a bounded-lifetime temporary artifact and a write-capable method on it would put a remote-touching surface behind a name the Web client's read panel already injects.

**Never push is enforced in three layers.** The seam declares no push operation and no method takes a remote destination, so a consumer cannot express one. The provider builds every argv itself and its live suite records the argv of a full alignment and commit run, asserts that none contains `push` or `rebase`, and asserts that the bare origin's branch tip is unchanged. The runtime reaches git only through `ctx.gitAlign` for writes and `ctx.git.observe` for reads, and never spawns a process. `pushedToRemote` is a read — `for-each-ref --contains` over `refs/remotes/` — and its answer only decides whether a created commit is still withdrawable.

**Two jobs, one transaction each.** The alignment job observes, decides, fetches, re-observes, probes, and then either reports or advances. The commit job runs at a closed turn boundary: it derives the turn's attributable paths, reads their bounded prefixes for the credential screen, summarizes, and creates one commit. Each run acquires a stored lease, records exactly one ledger entry with a closed outcome, releases the lease, and re-arms the timer. A run that finds the lease held records `skipped-locked` and touches nothing.

**The timer stores an absolute `nextEarliestRunAt`.** Not an interval start: the stored state is the only thing a restarted process can read, and backoff, conflict cooldown, and the normal interval all write that one field. Arming therefore never depends on when the previous run happened. Failure doubles a delay from `backoffBaseSeconds` to `backoffMaxSeconds` and suspends the workspace after `backoffSuspendAfter` consecutive failures; a conflict imposes a cooldown; a success clears both.

**Attribution is proven, not inferred.** A path counts as this turn's work only when the turn holds a `tool/call` for a writing tool whose arguments name the path *and* a matching `tool/result` reporting no error. A missing result, a failed result, and a call from another turn are excluded, and a path an earlier uncommitted turn also wrote is refused as ambiguous rather than committed twice.

**Withdrawal is never destructive.** A created commit is reported with `git reset --soft <parent>` and `git reset --mixed <parent>`; no `--hard` form exists in the vocabulary, so withdrawing cannot discard a work tree.

## Alternatives considered

**One plugin doing everything.** A single package could hold the seam, the provider, the summarizer, and the timer. It lost because the four roles have different owners and different test surfaces: the provider needs a real repository, the summarizer needs no git at all, and the timer needs neither. Splitting them also keeps the alignment seam reusable by anything that later wants a local fast-forward without the timer.

**Adding write methods to `ctx.git`.** Fewer packages, one injection. It lost because `ctx.git` is the read-only observation seam the Web client's git panel injects, and because a push-shaped hole in a read seam is exactly the affordance this feature must not create.

**A next-run interval instead of an absolute timestamp.** Simpler arithmetic. It lost because a restart would re-derive a schedule from a moment it did not observe, and because three different policies (interval, backoff, cooldown) would each need their own field for the reader to reconcile.

**`git rerere`, so a repeated conflict resolves itself.** It lost because it records resolutions in the repository's own config, which is state the harness would then own silently and which a human debugging a conflict cannot see in the ledger.

**`git reset --hard` for withdrawal.** The obvious undo. It lost because it discards the work tree, which is the one thing a commit created from an agent's work unit must never cost.

**`git commit -- <paths>` without `git add --intent-to-add` first.** One command instead of two. It lost because git refuses a path it does not know yet, and the alternative — `git add -A` — stages paths outside the attributed set.

**A new `SessionEventMap` member for the consultation.** It would put the summarization request in the session log, which is where model-visible input belongs. It lost because the request is not model-visible input to *this* session: adding the member would require regenerating `known-event-types.ts`, the session-format catalog, and the persistence catalog, and the design fixes the ledger as the record instead.

**Requiring `git merge-tree --write-tree`.** One code path instead of two. It lost because the flag set is not available on every git the host may carry — this machine's 2.25.1 rejects it with exit 129 — so the provider runs it and falls back to an isolated scratch worktree on that status rather than inferring a capability from a version number.

## Consequences

The repository gained five packages and two seams, and `dsh-workspace-automation` is the first consumer of both. A deployment that mounts the runtime with `enabled: true` and `mode: align` gets a checkout that advances on its own; the default is `enabled: false` and `mode: observe`, so nothing moves until an operator says so.

What it bought: a push that cannot happen from this code path, a ledger that distinguishes refusal from no-op from failure, and a commit that names the work unit that produced it in a `Dsh-Unit: <sessionId>/<turn>` trailer.

What it cost, and where the shipped code deviates from the design:

- `AbortSignal.timeout` composes the run budget instead of the design's `ctx.timeout` plus `AbortController` pair.
- `changeFacts` is preceded by `git add --intent-to-add`, and `commit` rolls that index entry back with `reset -q -- <paths>` when the commit fails, reporting `indexRestored`. The design did not name the index at all.
- `--no-renames` is passed to the numstat read, so a rename is reported as a delete plus an add rather than as one entry.
- `ignoredPaths` uses newline-separated output with `core.quotePath=false`, intersected with the requested set, because `check-ignore -z` is meaningful only with `--stdin`, which the no-shell runner cannot supply.
- `maxConflictPaths` is a Config field beyond the design's table, because the conflict list a probe returns needed a bound like every other list.
- A fetch cannot disable credential helpers through the runner, so an interactive fetch is bounded by `commandTimeoutMs` and recorded as a failed fetch rather than answered.
- The message-shaping config (type vocabulary, `allowBreaking`, fallback type, trailer) lives on `dsh-work-summary` rather than on the automation Config, because the seam that validates a proposal is the seam that owns the policy it validates against.
- `dsh-work-summary-llm` passes neither a session id nor a purpose to `ctx.llm.stream`, and the consultation is recorded in the caller's ledger rather than the session log, for the reason recorded above.
- The storage domain is named `workspace_automation`, not `workspace-automation`, because the domain-name rule is `/^[a-z][a-z0-9_]*$/`.
- The design's `mtimeGraceMs` is not a Config field at all: `ctx.fs` reports an opaque freshness token rather than a modification time, so a candidate's write time cannot be compared against a bound. Eligibility comes from the turn boundary alone.
- `packages/api/workspace-automation` projects the ledger over Typert Remote as `workspace/automationLedger`, bounded to the newest `maxRuns` runs and `maxPaths` paths each, and the `automation` right-sidebar tab type renders it. The stored ledger remains the authority and the projection derives from it.

## Testing

`pnpm run test:coverage` covers all five packages at per-file 100% statements, branches, functions, and lines. Beyond unit coverage, three suites carry the acceptance argument.

The never-push proof is `packages/git/git-align-local/tests/live.spec.ts`: it builds a real repository and a real bare origin, runs a full alignment and a commit against them while recording every argument vector the provider issues, asserts that no recorded vector contains `push` or `rebase`, and asserts that the origin's branch tip is unchanged afterwards.

The moved-HEAD race is `packages/workspace/workspace-automation/tests/runtime.spec.ts`. The scripted observer returns a different head object id for the re-observation that follows the fetch, and the run records `superseded` without probing or writing — the same outcome a second writer produces. A second case makes the re-observation fail outright, and a third makes the tree settle without reaching the upstream.

Detect-and-refuse covers the rest of the vocabulary: a detached HEAD, a dirty work tree under `dirtyPolicy: refuse`, a repository carrying a colocated `.jj` workspace, a candidate that matches a declared credential shape, an unreadable candidate, a staging set past `maxPathsPerCommit`, and a path an earlier uncommitted turn also wrote. Each is asserted as an outcome and, where a write would have followed, as the absence of the corresponding provider call.

## Deferred

No suite boots this runtime through the Loader. Its composition is exercised with a real storage domain, a real `WorkSummaryService`, and scripted git and filesystem providers, and the real git provider is exercised end to end by `dsh-git-align-local`'s live suite, but the two have not been loaded together from a `cordis.yml`. The pattern to follow is `packages/session/session-title-first-prompt-llm/tests/loader-composition.spec.ts`; a Loader composition also needs its plugin names in a resolver manifest, which lives under the package bundles.

Pull-request alignment needs a forge capability the repository does not have. The ledger's Remote projection belongs with the other Remote namespaces in `packages/api/`. The host-side attribution parser restates the change-tool argument vocabulary the client's turn-deliverables view also encodes; the design recommends one shared pure module and this wave leaves two implementations.

## Related

- `discovery/workspace-git-alignment-2026-09-21/02-timer-and-commit-design.md` — the frozen design this implements, and the source of every deviation listed above.
- `.agents/notes/implemented/architecture/2026-06-13-capability-seams.md` — why both seams carry all three roles.
- `.agents/notes/implemented/architecture/2026-07-24-domain-kv-storage-and-workspace.md` — the storage domain the ledger lives in.
- `.agents/notes/implemented/feature/2026-09-18-sidebar-git-observation-panel.md` — the read-only observation seam this one sits beside. That note's decision stands unchanged: `ctx.git` keeps its single `observe` method, and this package reads through it rather than widening it. The relation is partial, not a supersession, so both notes stay active and cross-linked.

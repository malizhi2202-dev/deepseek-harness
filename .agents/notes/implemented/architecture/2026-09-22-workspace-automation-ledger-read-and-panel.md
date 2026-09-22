# Agent Note: Workspace automation ledger read and panel

Status: implemented

English | [中文](2026-09-22-workspace-automation-ledger-read-and-panel.zh.md)

## Problem

The [timer and commit design](../../../../discovery/workspace-git-alignment-2026-09-21/02-timer-and-commit-design.md) gives the workspace automation runtime a stored ledger and requires a panel over it: for every run, what was compared, what the run did or why it did not, where the conflict is, and what happens next (§7.4). The [runtime half](2026-09-22-workspace-git-alignment-and-automatic-commit.md) — the scheduler, the align and commit jobs, the suspension and backoff rules — records all of that, but nothing projects it to a browser, so the only reader of a recorded run is a person with the session log open.

Two properties of that requirement decide the shape. The failure paths are where such a panel usually degrades: a run that was superseded, skipped a locked workspace, or refused to commit is the case a reader most needs explained, and a card that renders empty for those is a defect by the design's own metric rather than a cosmetic gap. And the ledger is authoritative for what a run did — a run's comparison involves commits as the runtime observed them, not as the repository reads now — so a panel that reconstructed the account from git would report a different history than the one that happened.

## Decision

Two packages, mirroring the channel and resource-library pairs. `@deepseek-ai/dsh-api-workspace-automation` owns one method of the **shared `workspace` Remote namespace**: `automationLedger(workspaceId)` returns the recorded ledger or `unrecorded`, projected from `ctx.workspaceAutomation.report(workspaceId)`. `@deepseek-ai/dsh-client-ui-sidebar-automation` registers `automation` as a right-Sidebar tab type — `order: 800`, `visibility: 'available'`, a page type that claims no address and declares no pattern — whose body draws the workspace's state and every retained run.

**The method joins the `workspace` namespace rather than opening one.** Both reads are keyed by the same opaque `WorkspaceId`, the client already holds that key when it draws a workspace surface, and a peer namespace would give one concept two namespace keys in the client assembly. The cost is real and was paid immediately: the namespace's generated client type obliges every test double that stands in for `remote.workspace` to implement the new member, which took four doubles in `api/workspace-controller` and `api/session-controller` implementing it as an unused throw. A deployment's namespace-to-service mapping is therefore not one-to-one, which matters to any generated catalog that assumes it is.

**The projection is pure and the endpoint holds no state.** `projection.ts` copies the stored values, cuts each list to its bound, orders the retained runs newest first, and reads the next move off the design's outcome table. Nothing is recomputed from git, and nothing is cached: a reload asks the runtime again, so a suspension a person cleared a moment ago is reported cleared.

**Every bound is a validated `Config` field.** `maxRuns` (default 20) bounds how many runs one read returns and `maxPaths` (default 10) bounds every path list — a run's conflict paths, the paths it refused over or could not attribute, a commit's paths, and the worktree remainder the last commit job reported. Each bounded list crosses the wire with the count it was cut from, so a reader learns what the bound hid instead of silently seeing a short list.

**Every run answers the design's four questions in the design's order.** The comparison question draws `baselineBefore` → `observedUpstreamOid` with the expected head and the new baseline when the run recorded them; the outcome question draws one sentence per outcome variant plus the commit a committed run created; the paths question draws the run's own list; the next question draws the step the design's table assigns to that outcome. `lines.ts` holds one function per variant, one per next step, and one for a read that failed, each switching exhaustively on its discriminant, so an outcome the runtime adds fails the build in the host package before it can render as an unexplained card.

**The panel is read-only and its single control is a read.** The timer arms from the workspace registry and its own configuration (§八 keeps arming, pausing, and schedule edits outside the panel), so no enable, disable, retry, run-now, or schedule control exists here; a control that could not work is worse than its absence. What it does have is the workspace join: the ledger carries no path or title, so the body resolves the session's workspace through the client workspace model and draws both, and a session with no registered workspace says so and asks the Host for nothing.

## Alternatives considered

**Open a `workspaceAutomation` namespace.** Rejected: both reads answer the same `WorkspaceId`, and the client's activation edge is the same either way — it mounts a generated remote for a namespaced service. A second namespace would also have to be added to the client assembly's mount list, which is where this change's cost was paid anyway. The measured cost of sharing is the four test doubles above; the measured cost of a peer namespace would have been a second key for one concept in every consumer that already has the workspace id in hand.

**Reconstruct the account from git state.** Rejected: a run's comparison records the commits the runtime observed during that run, and the repository changes afterwards. Recomputing would report a comparison that never happened and would let the panel disagree with the ledger a person is reading in the same breath.

**Persist the panel's own view.** Rejected: the ledger is the authority and the runtime is its only writer. A stored duplicate would need invalidation rules the runtime does not publish, and the panel's whole read is one call.

**Bound the run list in the panel.** Rejected: the bound has to apply where the value leaves the Host. A panel-side cut would still put the whole ledger on the wire, and the response would grow with the retention ring the runtime's own configuration sets.

**Offer a run-now control so a person can act on what they see.** Rejected: the design leaves every arming decision with the workspace registry, and a manual trigger is not in this wave. The finding belongs to the design, not to a control the panel cannot honor.

**Render each retained commit by reading the repository.** Rejected: the ledger already carries the commit's oid, subject, body, summary source, and whether it is still withdrawable, and a second read would make the panel's account depend on the repository's current state rather than on what the run recorded.

## Consequences

- **The ledger's observed upstream id is a local head, and the panel says so by not renaming it.** `RunRecord.observedUpstreamOid` is written by the align job from the local `HEAD` oid it observed after fetching, and `ctx.git.observe` reports no upstream commit id while `gitAlign.fetch` answers only that a fetch happened. The projection carries the ledger's value under its own name and asserts nothing about the upstream tip; the host README records it, and naming the upstream tip needs an oid the git seam does not publish.
- **Some path lists carry no true total.** A refusal's and an ambiguous attribution's lists are already cut by the runtime's `maxPathsPerCommit`, so the count reported beside them is the length the ledger held; only a conflict's list and a commit's path list carry a total. The panel's copy therefore reads as "and N more shown", which is true of every list, rather than as "N remain".
- **Two producer-side lists are unbounded.** The last commit job's `uncommittedPaths` and an ambiguous attribution's paths arrive without a bound; this projection is what bounds them, and a run that named thousands of paths still costs the whole list on the wire.
- **The run-bound default is a product choice.** `maxRuns` defaults to 20 while the design's retention figure is a 200-entry ring; the ledger's own count is drawn beside the returned runs (`runs.bounded`), so the bound is visible rather than silent, and a deployment that wants the whole retained ledger raises it in `cordis.yml`.
- **The panel cannot fill a ledger gap.** Where the ledger lacks a value the panel would want — an upstream tip, a true total for a truncated list — the panel draws what it has. Its known-limitations list names each gap instead of deriving a substitute.
- **Both halves move together through the generated client.** The panel reads `remote.workspace.automationLedger`, whose type comes from the host package's generated artifact; a host-side change to the outcome union fails the panel's build rather than being handled at runtime.
- **Wiring that stays with the parent release.** The two aggregates now carry both packages. What remains outside this change is the Web bundle's `dsh.client` row and dependency entry, and mounting this host package's generated remote client into the client assembly beside the Workspace Controller's.
- **`pnpm run duplication` was not run.** The pinned jscpd binary needs GLIBC 2.32 and this host provides 2.31, so no duplication result is claimed for the projection or the panel.

## Testing

`packages/api/workspace-automation` holds 12 tests and `packages/client/ui-sidebar-automation` holds 49 across six files, both at per-file 100% statements, branches, functions, and lines for every source file.

The endpoint's suite builds the service over a scripted runtime and pins the whole projection: an unrecorded workspace, a copied state, newest-first ordering with the ledger's own count, the bounds at tiny and exact limits, and one case per outcome variant with the next step the design's table assigns — including the variants that did nothing, which is where the design's explainability metric is actually tested. It also covers the pure projection functions directly, so a bound or an ordering regression fails without a Remote call.

The panel's suite mounts the body over a real store instance, a scripted Remote, and a scripted workspace hook, and asserts what the reader sees: loading, failed, unrecorded, and recorded states; a session with no workspace; the four questions present and in the design's order for every outcome variant including `superseded`, `skipped-locked`, and `refused`; the paths with the count that did not fit; and a reload that asks the Host again while an older read cannot overwrite it. The tab type is asserted against the slot declaration contract the right Sidebar publishes.

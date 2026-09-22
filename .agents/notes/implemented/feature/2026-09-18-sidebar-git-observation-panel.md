# Agent Note: A Read-Only Git Observation Panel in the Right Sidebar

Status: implemented

English | [中文](2026-09-18-sidebar-git-observation-panel.zh.md)

## Problem

The right Sidebar could show a session's tasks, files, and derivations, but nothing showed the workspace's repository: which branch is checked out, where it stands against its upstream, which local branches exist, what the last commits did, and what sits uncommitted in the working tree. The user's only path to those facts was leaving the harness and running git in a terminal, for state the harness already sits inside.

## Decision

The capability enters as a complete seam — Service Definition ([`dsh-git`](../../../../packages/git/git/README.md), `ctx.git`), Provider ([`dsh-git-local`](../../../../packages/git/git-local/README.md)), and Consumer ([`dsh-api-workspace-git`](../../../../packages/api/workspace-git/README.md), the `workspaceGit` Remote namespace) — and the panel ([`dsh-client-ui-sidebar-git`](../../../../packages/client/ui-sidebar-git/README.md)) draws it. This follows the sidebar discovery adjudication (option B, core self-built on the current version line), because the workspace facts are needed now and no upstream plugin can be adopted before the version-line migration.

**It is a bounded-lifetime temporary artifact.** When the migration lands, an upstream git plugin replaces the family, and these four packages retire with it. Every README of the family and this note say so, because the alternative — growing a permanent in-tree git surface — is exactly what the adjudication declined.

Six decisions inside are worth stating.

**Read-only, by vocabulary and not by discipline.** The seam's one method is `observe`; there is no checkout, commit, push, or pull anywhere in the family, so no client can mutate a repository through it even by trying. The panel adds no action beyond reload.

**Zero model-visible surface.** No tool, no session event, no resource, no request input names git; the panel draws in the browser and the seam answers it alone. This keeps the model-experience contract trivially empty, and keeps the temporary artifact from leaving a trace in the session log or the prompt.

**History crosses the wire as a Remote method, not a resource.** A resource is a current-value stream — the right home for the files tab's current listing, and the wrong home for a bounded commit history that is not addressable state. The `workspaceGit` namespace therefore exposes one `@Remote observe` returning the whole bounded snapshot; freshness is the panel's reload gesture.

**One safety constant bounds the read.** `MAX_OBSERVATION_ITEMS` (200) caps history depth, branch count, and worktree entries together, following the `MAX_LINEAGE_DEPTH` precedent in `ui-sidebar-agents`. Each list carries its own `*Truncated` flag, so a cut is drawn as a cut. `git log -n` reads one commit past the bound to report truncation exactly.

**Classification rides exit codes, not stderr.** Git's messages are localized (this host prints Chinese), while exit codes are its stable machine vocabulary: exit 128 from the toplevel probe is the `absent` answer — outside any repository, inside a bare one, or broken past naming a work tree — and "not a repository" is an answer, never an error. The seam's failures are two stable codes (`GIT_UNAVAILABLE`, `GIT_COMMAND_FAILED`), mapped by the Consumer to two declared Remote codes, discriminated by the `code` field rather than class identity because the `GitError` class belongs to whichever `dsh-git` instance the provider loaded.

**The tab is `available`, never default-on.** The default-visible budget stays at tasks and derivations, as the [tab-capacity adjudication](2026-09-17-sidebar-task-observation-tab.md) fixed it; the git tab is opened from the guide and stays closed otherwise. Order 400 keeps it after the built-in family with a unique value.

## Alternatives considered

**Shelling out from the panel through an existing generic tool.** The model-facing `bash` tool is the model's, not the browser's; routing a user-facing read through it would couple panel availability to tool approval and leak repository facts into the transcript — the opposite of the zero-model-surface decision.

**A resources-based panel.** Resources are current-value streams; the panel's question ("what did the last N commits do?") is not addressable state, and a per-commit resource would either paginate history through the model's resource budget or not exist. The bounded one-shot read answers it in one call.

**Waiting for the upstream plugin.** The version-line migration blocks adopting it, and the need is current. The adjudication chose a bounded-lifetime in-tree build over an indefinite wait, with the replacement path recorded here and in every README.

## Consequences

The Sidebar can now answer "what does this session's repository look like?" without leaving the harness: head facts, branches, bounded history with a lane gutter, and worktree changes, each cut visible as a cut. The family is additive — a new tab kind and a new seam — so existing tabs and capabilities are untouched.

The retirement path is stated, not merely intended: an upstream git plugin replaces the family after the version-line migration, and the four packages (with their registry rows) go together. Nothing between here and there should build on the seam beyond the panel it exists for.

Two limits are recorded in the package README rather than solved here: the read is one bounded fetch with no subscription (freshness is the reload gesture), and the worktree lists change sides and kinds without diffs or a staging view — both belong to the upstream plugin.

## Related

- [Per-workspace git alignment and automatic commit](../architecture/2026-09-22-workspace-git-alignment-and-automatic-commit.md) — a second, separate git seam (`ctx.gitAlign`) added beside this one. It does not build on `ctx.git`, which stays read-only, and it is not part of the temporary family this note retires.

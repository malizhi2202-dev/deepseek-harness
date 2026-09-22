---
description: "The git group map: the read-only repository observation service, the alignment seam with its local host provider, and the packages that consume them, for users and maintainers navigating the group."
kind: "package-group"
---

# git/ — repository observation and alignment family

English | [中文](README.zh.md)

## Summary

The harness's git surface, in two parts. The observation seam (`ctx.git`) answers a bounded read-only snapshot of the repository containing a working directory — head state, branches, bounded history, worktree changes — and feeds the Web client's right-Sidebar git panel. The alignment seam (`ctx.gitAlign`) answers what it would take to bring a branch up to its upstream and performs that locally: fetch, conflict probe, fast-forward or merge, path facts, ignore checks, and one bounded commit. Neither seam exposes a remote write, so pushing a commit stays a human decision. No tool, session event, or model-visible surface names either one.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`git`](git/README.md) | Defines the repository observation service and its single bound (`MAX_OBSERVATION_ITEMS`) | `ctx.git` |
| [`git-local`](git-local/README.md) | Reads the repository with the host machine's git through the shared no-shell runner | registers on `ctx.git` |
| [`git-align`](git-align/README.md) | Defines the alignment service: fetch, conflict probe, local apply, path facts, ignore checks, and one bounded commit — with no remote write | `ctx.gitAlign` |
| [`git-align-local`](git-align-local/README.md) | Runs those operations with the host machine's git through the shared no-shell runner | registers on `ctx.gitAlign` |

The alignment seam's only consumer is [`workspace-automation`](../workspace/workspace-automation/README.md), which owns the per-workspace timer and the automatic commit. The Remote namespace the panel consumes lives in [`api/workspace-git`](../api/workspace-git/README.md); the panel itself in [`client/ui-sidebar-git`](../client/ui-sidebar-git/README.md).

-----

<a id="related-documentation"></a>
## Related documentation

- [Workspace subsystem](../../docs/subsystems/workspace.md) — the alignment service's vocabulary, and the per-workspace runtime that consumes it.
- [Web client architecture](../../docs/subsystems/web-client.md) — the Slot and props discipline the panel follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

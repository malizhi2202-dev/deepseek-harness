---
description: "The git group map: the read-only repository observation service and its local host provider, for users and maintainers navigating the group."
kind: "package-group"
---

# git/ — repository observation family

English | [中文](README.zh.md)

## Summary

The harness's one read-only view of git repositories: a shared service (`ctx.git`) that answers a bounded snapshot of the repository containing a working directory — head state, branches, bounded history, worktree changes — and a local provider that reads it with the machine's own git. It exists to feed the Web client's right-Sidebar git panel; no tool, session event, or model-visible surface names it. The whole family is a bounded-lifetime temporary artifact, replaced by an upstream git plugin once the version-line migration lands.

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

The Remote namespace the panel consumes lives in [`api/workspace-git`](../api/workspace-git/README.md); the panel itself in [`client/ui-sidebar-git`](../client/ui-sidebar-git/README.md).

-----

<a id="related-documentation"></a>
## Related documentation

- [Web client architecture](../../docs/subsystems/web-client.md) — the Slot and props discipline the panel follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

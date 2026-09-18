---
description: "The right Sidebar's git observation panel for the dsh web client: the session workspace's repository as head facts, branch list, bounded history with lanes, and worktree changes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-git

English | [中文](README.zh.md)

## Summary

The right Sidebar's git panel: the mounted session's workspace, observed as the repository that contains it. One page type, reached from the guide, claims no address, and never opens by itself — the default-visible budget stays at tasks and agents. The panel draws the head's facts (branch or detached, tracking, ahead/behind, the commit it points at), the local branch list, the bounded commit history with its lane gutter, and the worktree's entries with the side each changed on; the header carries the one control, reload, which reads the observation again and replaces whatever the tab holds. Outside a repository the panel says so in one line, and a workspace without a directory says that too.

**Status: a bounded-lifetime temporary artifact.** The panel is replaced by an upstream git plugin once the version-line migration lands, and this package is retired with it.

## Table of Contents

- [What it registers](#what-it-registers)
- [What it reads](#what-it-reads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `git`, id `@deepseek-ai/dsh-client-ui-sidebar-git`, band `builtin`, `visibility: 'available'`, order 400, an icon, no patterns, and one guide entry (order 40, titled from the `sidebarGit` namespace) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: the panel.

Seven source files under `src/client/`: `definition.ts` (the type), `store.ts` (the write set), `face.ts` (the read and its Remote adapter), `history.ts` (the pure folds), `GitBody.tsx` (what it draws), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="what-it-reads"></a>
## What it reads

The observation comes from the `workspaceGit` Remote namespace over the carrier `dsh-api-remotes` mounts, with the session id and the tab record's lifetime signal — so the endpoint resolves the workspace root and the panel never names a directory. The read is a fetch, not a subscription: the body asks once per tab on mount and again on reload, the face retires the read still in flight when a newer one is asked for, and the owner's signal aborting forgets the tab's bucket so a late settlement writes nothing. The workspace directory itself comes from the session list; a session without one shows the no-workspace line and asks for nothing.

<a id="model-experience"></a>
## Model Experience

None, as this package draws repository state in the browser and registers nothing model-facing.

#### KV Cache effect

None; the panel assembles no model request and adds no session event.

## Known Limitations and Deferred Work

- **Observation only.** Nothing in the panel checks out, commits, pushes, or pulls; every action stays outside it by design.
- **One bounded read.** The history depth, branch list, and worktree list carry the seam's single bound with their own truncation notes; there is no paging and no subscription — freshness is the reload gesture.
- **No staging view or diffs.** The worktree shows each entry's change side and kind, not the hunks; that belongs to the upstream git plugin that replaces this panel.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the panel is a pure draw of the last settled observation, with no derived state to compare against.

</details>

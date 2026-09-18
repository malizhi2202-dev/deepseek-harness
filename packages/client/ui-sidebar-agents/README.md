---
description: "The right Sidebar's derivation panel for the dsh web client: the mounted session's complete derivation tree, with each branch's child-catalog read state and diagnostics."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-agents

English | [中文](README.zh.md)

## Summary

The right Sidebar's derivation panel: the mounted session's derivations as one tree, read from the session list the browser already holds, plus each branch's direct-child catalog for the facts a summary cannot carry. It is a page type reached from the guide or from the session header's catalog, and claims no address — nothing in `ui-sidebar-right` knows this package.

## Table of Contents

- [What it registers](#what-it-registers)
- [What it reads](#what-it-reads)
- [What it admits](#what-it-admits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `agents`, id `@deepseek-ai/dsh-client-ui-sidebar-agents`, band `builtin`, `default-on`, order 20, an icon, no patterns, and one guide entry (order 30, titled from the `sidebarAgents` namespace) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: the tree, its rows, and the catalog read states.

Five source files under `src/client/`: `definition.ts` (the type), `lineage.ts` (the tree fold), `AgentsBody.tsx` (what it draws), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="what-it-reads"></a>
## What it reads

The tree comes from `useSessions(state => state.byId)`, so a derivation appears as soon as the session list knows it — including one that has finished or failed, and with no catalog read at all. `useSessions(state => state.ids)` ranks siblings in the list's own order. `useSessions(state => state.subagentsByParent)` is the per-parent direct-child catalog, read for the open branches only: the root and every expanded branch below the depth bound, at most three reads in flight, released when a branch closes and when the panel unmounts.

The panel keeps one piece of state of its own — which branches the user opened or closed — and no subscription beyond the three selections above.

<a id="what-it-admits"></a>
## What it admits

A row opens its session only when the branch's catalog can confirm it: the parent's catalog must be `ready` and carry a `child` entry for that id, and the address's `mode` comes from that entry. Until then the row is drawn disabled with the reason it cannot be opened — the catalog has not been read, is loading, failed, does not list the id, reports it as a diagnostic, or the parent session is offline.

A catalog's three states are drawn as themselves, never as an empty session: not yet read, loading, and failed (with its message and a retry). Diagnostic entries are rows of their own, disabled, with the reason. When the catalog has answered and the session truly has no derivations, the panel says so in one line.

`lineage.ts` holds the only depth bound (`MAX_LINEAGE_DEPTH`); a branch at that bound draws one disabled row saying so rather than dropping its children silently.

<a id="model-experience"></a>
## Model Experience

None, as this package draws session state in the browser and registers nothing model-facing.

#### KV Cache effect

None; the panel assembles no model request and adds no session event.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Observation only.** Nothing in the panel starts, stops, or continues a derivation; a row opens the session, and every action stays in the conversation.
- **One session.** The tree is rooted at the session the tab belongs to, with no cross-session or workspace-wide view.
- **No jobs.** Background jobs are not attached to their nodes; the tasks panel owns them.
- **Depth bound.** Branches stop at eight levels with an explicit row, so a deeper tree is visible only by opening the session below the bound.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel keeps no derived state to compare against: the tree is a pure fold of the three session-list selections, and its one local fact is which branches the user opened.

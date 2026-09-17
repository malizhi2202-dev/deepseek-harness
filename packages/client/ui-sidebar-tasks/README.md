---
description: "The right Sidebar's task-observation tab type for the dsh web client: this session's todo list with its progress summary, then its background jobs, both read from live browser state."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-tasks

English | [中文](README.zh.md)

## Summary

The right Sidebar's task-observation tab type: the session's todo list with a progress summary, then its background jobs, both read from state the browser already holds. It is a page type reached from the guide and claims no address — nothing in `ui-sidebar-right` knows this package.

## Table of Contents

- [What it registers](#what-it-registers)
- [What it reads](#what-it-reads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `tasks`, id `@deepseek-ai/dsh-client-ui-sidebar-tasks`, band `builtin`, no patterns, and one guide entry (order 20, titled from the `sidebarTasks` namespace) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: the two sections, with no control of its own.

Four source files under `src/client/`: `definition.ts` (the type), `TasksBody.tsx` (what it draws, with its counting and marker helpers), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="what-it-reads"></a>
## What it reads

Both facts are already live in the browser, so the panel issues no request and keeps no store.

| Section | Source |
|---|---|
| Todo list | The host-computed `todos` projection, through the standard kit's `useProjection`. It is `null` until the model's first write, and every write replaces the whole list. |
| Background jobs | `useSessions(state => state.jobsBySession[sessionId])`, the Session object layer's job mirror. |

The list is drawn in the model's own write order, because that order is the plan; entries have no identity of their own, so a row is keyed by position and text. A marker and a state word carry each entry's `pending` / `in_progress` / `completed`. The heading row carries the count, and a progress bar aggregates the same list; a list that is absent or empty shows one line instead.

Jobs show their label, their optional detail line, and their state. `stopping` and `killed` share the attention marker, because both end work on request rather than on its own.

<a id="model-experience"></a>
## Model Experience

None, as this package draws session state in the browser and registers nothing model-facing.

#### KV Cache effect

None; both facts are read from state the host already computed, and the panel assembles no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Observation only.** Nothing in the panel changes a todo or stops a job; every such action stays in the conversation or its own surface.
- **One session.** The panel shows the session the tab belongs to, with no cross-session or workspace-wide view.
- **No time facts.** Job start and finish times are not drawn, so no duration formatter is needed; the panel reports state, not elapsed time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The panel holds no state at all — both facts are framework-hook reads — so there is no second observation of them to compare against.

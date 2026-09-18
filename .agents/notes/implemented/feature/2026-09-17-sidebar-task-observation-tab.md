# Agent Note: A Task-Observation Tab in the Right Sidebar

Status: implemented

English | [中文](2026-09-17-sidebar-task-observation-tab.zh.md)

## Problem

The right Sidebar shipped two tab types — the workspace file tree (`@deepseek-ai/dsh-client-ui-sidebar-files`) and the read-only text preview (`@deepseek-ai/dsh-client-ui-sidebar-textpreview`) — plus the pane's own guide. Session work state that the browser already held had no surface there, so answering "what is this session doing, and what is left?" meant scrolling the conversation.

Both facts were already live in the browser: the host-computed `todos` session projection, and the Session object layer's `jobsBySession` mirror. Nothing in the Sidebar read either.

## Decision

`packages/client/ui-sidebar-tasks` registers `tasks` as a third tab type through the documented two-stage path — `ctx.sidebarRightTabs.register({ id, kind, priority: 'builtin', title, guide })`, then the body into the keyed `sidebar.right.pane.tab` seat under that `id` — and draws both facts in one body with no store, no face, and no request: `useProjection('todos')` and `useSessions(state => state.jobsBySession[sessionId])`. Neither is a new data path, so the panel owns no state to invalidate and no Remote call to fail. The registry and the seat are the mechanism the [tab types and navigation](../architecture/2026-09-05-sidebar-tab-types-and-navigation.md) note settled, and this package is its third consumer.

Four decisions inside the body are worth stating.

**The list is drawn in the model's write order, not grouped by state.** `todo/write` carries the complete list and its entries have no identity, so the model's order is the plan; regrouping by status would destroy the sequence. A row is therefore keyed by position and text together, and the aggregate view lives in the heading row — a count and a progress bar over the same list.

**The panel observes and never acts.** Nothing in it changes a todo or stops a job; every such action already belongs to the conversation or to that job's own surface. This keeps the body free of owner actions, which is also why it registers no store.

**The progress trough uses `--dsw-alias-bg-layer-1`, not the elevated `-2`.** `ui-theme`'s scrollbar audit fails any stylesheet that scrolls while referencing an elevated surface it does not rebind, because the scrollbar thumb rung then differs from the surface in the dark palette only. The panel's own surface is transparent, so rebinding the thumb to the l2 rung would state something false about it; using the base rung is the truthful choice, and the audit's own definition of the elevated set excludes it.

**The tab is a page type claiming no address and declares `visibility: 'default-on'` at order 10 with its own `icon`,** so a fresh surface opens it beside the guide and the strip's type picker draws it first ([the default-visible set](../architecture/2026-09-17-sidebar-right-default-visible-set.md)). Its guide entry at order 20 stays, which is how a user brings it back after closing it. Nothing in `ui-sidebar-right` needs to know this package exists. It is composed as a core `web-app` row rather than a profile-local plugin, which is what makes it available to every Web deployment.

## Alternatives considered

**A section inside the conversation.** The facts are about the session as a whole rather than one turn, and the transcript is already the longest surface in the window; a Sidebar tab keeps them beside the conversation instead of in it.

**Reusing the file tree's store and face split.** That split exists because the tree keeps per-tab expansion state and lists levels over a Remote. This panel has neither, so copying the split would add a store and an injected face that the body never writes or calls.

**An elevated trough plus a scrollbar rebind.** This satisfies the letter of the audit but not its intent: the panel is not an elevated surface, so the rebound l2 thumb would be wrong on every palette.

**Reading the jobs through a projection instead of the mirror.** No job projection exists; the Session object layer already mirrors jobs per session for the header action, and a second projection would publish the same records twice.

## Consequences

The Sidebar now answers the session-progress question without leaving the window, and the panel is additive: it registers a new kind, so the file tree, the text preview ([the two shipped types](2026-09-05-sidebar-text-preview-and-file-tree.md)), and any extension tab keep working and the tab set is unchanged for them.

Two limits are recorded in the package README rather than solved here: the panel is observation-only, and it reports state without job timings, so no duration formatter is needed yet.

The `todos` projection is drawn as the model wrote it, so a session whose model never calls the todo tool shows an empty state rather than an inferred plan. The task graph over subagent lineage this note deferred is now decided by the [agent-derivation panel](2026-09-18-agent-derivation-panel.md): the tree is folded from the session list, and the catalogs supply diagnosis and admission. Per-failure root cause and an evaluation of each node stay deferred.

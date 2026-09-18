# Agent Note: An Agent-Derivation Panel in the Right Sidebar

Status: implemented

English | [中文](2026-09-18-agent-derivation-panel.zh.md)

## Problem

The right Sidebar could show a session's files, one file's text, and its work state, but nothing showed its derivations. The session header already drew a subagent catalog in a hover popover, and that surface is deliberately a glance: it is rooted at the current session or its parent, it only lists what the direct-child catalog answered, and it closes as soon as the pointer leaves.

Derivation facts the browser already held had no durable surface. The session list carries every session (including a derivation that has finished or failed) with its `parentId` and `origin`, and the Session object layer already mirrors each parent's direct-child catalog under `subagentsByParent`. The panel that answers "what has this session derived, and what is still running?" needs both, and neither is a new data path.

## Decision

`packages/client/ui-sidebar-agents` registers `agents` through the documented two-stage path — `ctx.sidebarRightTabs.register({ id, kind, priority: 'builtin', visibility: 'default-on', order: 20, icon, title, guide })`, then the body into the keyed `sidebar.right.pane.tab` seat under that `id` — the mechanism the [tab types and navigation](../architecture/2026-09-05-sidebar-tab-types-and-navigation.md) note settled. It is a page type claiming no address, so the [admission rule for new kinds](2026-09-17-sidebar-task-observation-tab.md) leaves it free to be one. It is the second type to declare `default-on`, so a fresh surface opens the guide, tasks, and derivations, inside the budget of three (`MAX_DEFAULT_VISIBLE_TABS`); one slot remains.

Five decisions inside the panel are worth stating.

**The tree is folded from the session list, not from the catalogs.** `useSessions(state => state.byId)` yields every durable derivation, so a finished or failed child appears beside a running one and the panel says something true before any catalog is read. Siblings rank by the list's own `ids` order, and a child the list does not rank sorts last by id, which keeps the order stable instead of dependent on catalog arrival. Reading the catalogs to build the tree would have made the panel's completeness depend on a Remote call.

**The catalogs supply only what a summary cannot.** They carry the diagnostics, `hasChildren` (whether a row can be opened further), the continuation `mode`, and — the decisive one — whether a row may be opened at all. The panel observes the root always and every expanded branch below the depth bound, through `sessions.setSubagentCatalogOpen`, with at most three reads in flight; it releases a branch when it closes and every read when it unmounts.

**A row opens its session only when its parent catalog can confirm it.** A `child` entry of a `ready` catalog is the sole admission; every other case renders the row disabled with the reason it cannot be opened — the catalog has not been read, is loading, failed, does not list the id, reports it as a diagnostic, or the parent session is offline. The address's `mode` also comes from that entry, because the summary does not carry it. So the panel never invents an address and never opens a session the host would refuse.

**A catalog's three states are drawn as themselves.** Not yet read, loading, and failed (with its message and a retry) each get their own line, and a diagnostic is its own disabled row; "no derivations" is said only when a ready catalog answered and the session truly has none. Treating an unread catalog as empty would state a fact the browser has not established, which is the failure mode this panel exists to avoid.

**One depth constant bounds the fold and the read set.** `MAX_LINEAGE_DEPTH` in `lineage.ts` is the only bound; a branch at it draws one disabled row saying so rather than dropping its children silently, and it is not observed, so recursion stops in depth and in concurrency together.

The pure fold is local to this package: `session-controller/client` and the existing lineage helpers are other packages' values, and a feature plugin may not import them. The header's catalog offers the panel as its last entry, and reaches it through `ctx.get('sidebarRight')` / `ctx.get('sidebarRightTabs')` — optional services, so the entry disappears when no derivation panel is installed — and spells the kind `agents`, its public name, because the kind is the only thing the two packages share.

**Jobs stay out.** Neither the derivations nor their failures need a job attached to a node to be readable, and the shape of that attachment is not settled; the tasks panel owns jobs today.

## Alternatives considered

**A footer inside the header popover only.** The popover is transient and hover-driven; a user comparing a running chain against a finished one loses it on the way to the transcript. The header keeps its glance and links to the durable surface instead of growing into it.

**Reusing the existing lineage helpers or `flattenLineage`.** They are other packages' values; the cross-package rule forbids the import, and the duplicate that exists today (`ui-subagent` and `ui-workspace`) is already recorded as a `jscpd:ignore` pair. This fold is a different function anyway: it builds a parent-child forest from summaries, where those helpers answer "which sessions descend from this one".

**Reading every catalog to gain completeness.** It multiplies Remote calls by tree size and makes the tree's contents depend on reads that can fail; the session list already answers which derivations exist.

**Offering an action per row.** Stopping, continuing, or repairing a derivation is its own decision with its own command surface; a panel that can navigate is enough to answer the question the panel exists for.

## Consequences

The Sidebar now holds the derivation tree for as long as the user keeps it, while the header keeps the one-glance summary. The panel is additive: it registers a new kind, so files, text, tasks, and any extension tab keep working.

Two of the three default-visible slots are spent (tasks and derivations). One type may still declare `default-on`; the next is refused by the registry until the budget changes or a type stops opening itself, which is the designed signal rather than an accident to work around.

Two limits are recorded in the package README rather than solved here: the depth bound cuts a deeper tree with an explicit row, and jobs are not attached to their nodes.

The task-graph deferral in the [task-observation note](2026-09-17-sidebar-task-observation-tab.md) is settled by this panel as far as the tree goes: the derivation shape is "complete tree from the session list, catalogs for diagnosis and admission", and per-failure root cause and per-node evaluation remain deferred.

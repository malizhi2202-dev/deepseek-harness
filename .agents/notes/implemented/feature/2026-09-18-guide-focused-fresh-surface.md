# Agent Note: A Fresh Right-Sidebar Surface Opens on the Guide Tab

Status: implemented

English | [中文](2026-09-18-guide-focused-fresh-surface.zh.md)

## Problem

After the declarative tab-visibility stage seated every `default-on` type into a fresh surface, the surface focused whichever type declared the lowest `order` — the task-observation tab in the shipped set. The column's introducing page sat one click away behind whichever product panel happened to sort first, and a type's `order` (a seating choice) silently decided what the user first sees.

## Decision

**`createSurface` focuses the guide tab, not the first default-on type.** The plan that opens a tab no longer captures the first planned tab id; after seating, the surface focuses the pane's guide tab through the same `paneGuide` lookup the settle path already uses. `order` decides where each type sits, not what the column opens on — the introducing page wins by role, not by sort position.

No guide tab exists only when a pane was settled without one; in that arm the previous behavior (no focus entry at all) is unchanged.

## Alternatives considered

- Keep focusing the first default-on type: rejected — it couples the opening view to a seating number, so reordering product panels changes what a new session sees first.
- Focus the newest opened tab (order of `seed.tabs()` traversal): rejected for the same reason with worse determinism across registration order.

## Consequences

- A fresh surface shows the guide's entry boxes immediately; the default-on tabs are seated next to it and take focus only when picked.
- The focus lives in the initial layout, not a recorded history entry, so undo still stops at what the session was born with.
- The store spec, both READMEs, and the lifecycle e2e's guide helper comment state the new behavior.
- The shipped default-visible set (task observation, agent derivation) is unaffected in seating; only the opening view changes.

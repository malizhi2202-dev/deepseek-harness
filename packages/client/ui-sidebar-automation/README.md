---
description: "The right Sidebar's automation tab type: one workspace's automation ledger — what each run compared, what it did or why it did not, the paths it named, and what happens next — for Web users and client-plugin maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-automation

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar-automation` registers `automation` as a right-Sidebar tab type: an available page that draws the workspace automation ledger the [host endpoint](../../api/workspace-automation/README.md) projects — the workspace's timer state, then every retained run newest first. Each run answers the four questions the design requires of it, in the design's order: what it compared, what it did or why it did not, which paths it is about, and what happens next.

The panel is read-only by design. The automation timer arms itself from the workspace registry and its own configuration, so there is no run-now, pause, resume, retry, or schedule control here: a control that could not work would be worse than its absence, and the design keeps every one of those decisions with a person editing the workspace rather than with this page. The one control reads the ledger again.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the right Sidebar's guide page and pick **Automation**, or open `automation` from the type picker. The tab is keyed by workspace rather than by session, so the panel resolves the workspace its session belongs to and reads that workspace's ledger; a session that belongs to none says so and asks the Host for nothing.

The type is `available`, never `default-on`: most sessions never run a timer, and the right Sidebar's always-on seats belong to the surfaces that answer questions about the session. Its `order` of 800 follows the git page, and its guide entry sits at order 80.

## Understand the implementation

The file split is the layering: what the type IS (`definition.ts`), what it keeps (`store.ts`), how it reads the Host (`face.ts`), how an outcome becomes a sentence (`lines.ts`), what it draws (`AutomationBody.tsx`), what it says (`locales.ts`), and `index.ts`, which only wires them together.

The store keeps one bucket per tab: the read in flight, the failure it settled on, or the ledger it settled with. Every run's four answers are derived from the ledger at draw time rather than stored, so the projection stays the single place that decides what a run's outcome means.

The face reads `remote.workspace.automationLedger` for the workspace id the tab supplies and hands the answer to the store. Each read carries the tab's own signal and a generation counter, so a reload that overtakes an earlier read cannot be overwritten by it, and a tab that closes aborts its read and drops its bucket.

`lines.ts` is where the design's explainability requirement lives: one function per outcome variant, one per next step, and one for a refused read, each switching exhaustively on its discriminant so a reason the ledger adds fails the build here rather than rendering as an empty card.

Nothing is written: the panel has no mutation path at all, and its only Remote call is the read.

<a id="model-experience"></a>
## Model Experience

### The automation panel

#### What the model sees

Nothing directly. The tab registers no tool, prompt section, or session event, and its only Host call is `remote.workspace.automationLedger(workspaceId)`, a read whose answer is drawn in the browser; what the panel shows a person reaches a model only through the commit messages the runs themselves wrote into the repository, which are repository content. The panel never assembles a request and never adds a message to a session.

#### Token effect

None. Opening the tab, reading the ledger, and reloading it add no tokens to any request, and nothing here shapes a prompt.

#### KV Cache effect

No direct invalidation; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **Read-only, deliberately.** There is no run-now, pause, retry, or schedule control: the timer arms from the workspace registry and its own configuration, so this page can only show what the ledger already recorded. A reader who wants a different schedule changes the workspace, not the panel.
- **The panel cannot correct a fact the ledger lacks.** The comparison line draws the ledger's `observedUpstreamOid` under its own name, and the host README records that this value is the local head the align job observed rather than the upstream tip. Fixing the reading needs an upstream commit id from the git seam; inventing one here would be a recomputation the design forbids.
- **A workspace with no ledger reads as unrecorded.** That is the normal state of a workspace whose timer has never run, and the panel draws it as one line rather than as a failure, because the two are different facts.
- **Both bounds belong to the endpoint.** How many runs and how many paths arrive is the host read's configuration; the panel only reports what the bound hid, so a reader who wants more changes `cordis.yml` rather than the panel.
- **No cross-workspace view.** One tab draws one workspace, matching the ledger's own key; there is no page that sums the timer across workspaces.
- **A refused read is the whole page.** A carrier or unclassified Host failure replaces the panel with its message and the reload control, rather than leaving a stale ledger on screen; there is no partial read and no retry loop.
- **The workspace is joined from the client workspace model.** The ledger carries no path or title, so the header's name and path come from the workspace hook, and a session whose workspace is not registered in this browser draws the no-workspace state even if the Host has a ledger for it.
- **Built for the current ledger's vocabulary.** A run outcome or next step the ledger adds after this wave fails the projection's exhaustiveness check in the host package first, so the two halves move together rather than one rendering an unexplained card.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the panel owns no cross-plugin relationship, and the rules it depends on — one bucket per tab, one read per workspace, and a settlement that cannot be overwritten by an older read — are enforced by the store and the face in `packages/client/ui-sidebar-automation/src/client/`.

The suite mounts the body over a real store instance, a scripted Remote, and a scripted workspace hook, and asserts what the reader sees: every state the read can settle in, the four questions in the design's order for every outcome variant including the ones that did nothing, the paths with the count that did not fit, and a reload that asks the Host again. The tab type is also asserted against the slot declaration contract the right Sidebar publishes.

</details>

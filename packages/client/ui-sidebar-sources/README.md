---
description: "The right Sidebar's remote-resource tab type: every source instance this Host serves, its state, its credential references, and the settings form its own schema declares, for Web users and client-plugin maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-sources

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar-sources` registers `sources` as a right-Sidebar tab type: an available page that lists every remote-resource instance the Host's resource registry serves, with the state its provider reports, the credential references its configuration names, a settings form built from the kind's own configuration schema, and the hard limits that kind enforces. It is the browser half of the remote resource library — the Host half is `dsh-api-sources` over the resource seam — and it holds no source knowledge of its own: which kinds exist, what each can answer, and which fields configure it all come from the Host.

Two lines of its copy are the panel's honesty rather than chrome. Credentials appear as reference names only: the panel neither reads nor shows a secret value, and a form writes one solely when the reader types it. And a source that is not configured is drawn as unconfigured with no connection control of its own, because the design derives whether a source connects from whether it is configured rather than from a switch.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the right Sidebar's guide page and pick **Remote resources**, or open `sources` from the type picker. The panel reads the Host's source list on mount and draws one card per instance: its state, its last error when it has one, what its provider says it can answer, its credentials by reference name, the settings form its schema declares, and the hard limits its kind enforces. **Test** probes one instance without changing anything, **Reload** re-reads the list, and **Save**/**Discard** stage and drop edits.

The type is `available`, never `default-on`: configuring a remote resource is something the person asks for, and the right Sidebar's always-on seats belong to the surfaces that answer questions about the session. Its `order` of 700 follows the channels page, and its guide entry sits at order 70.

A source's configuration belongs to the Host's settings document, and the Host owns every consequence of writing it: the layer a field lands in, the revision fence, and whether the write is stored at all. The panel sends the staged operations and then reads back what the Host stored.

## Understand the implementation

The file split is the layering: what the type IS (`definition.ts`), what it keeps (`store.ts`), how it drives the Host (`face.ts`), what it draws (`SourcesBody.tsx`), how a schema becomes a form (`form.ts`), what it says (`locales.ts`), and `index.ts`, which only wires them together.

The store keeps each tab's source list, each instance's settings description, the drafts a reader staged, and the busy and failure flags. Its records are keyed by the instance's opaque `key` rather than by kind, because one kind can declare several instances. The instances themselves are Host facts read on mount and after each change, never carried across tabs.

The face is where the Host's contract is spent. `status` and `probe` are unary calls whose results replace the panel's list or one instance's answer. A kind's settings descriptor is read through the settings mirror the settings domain already maintains, and a save sends the staged operations through the bound scope's `mutate` under the revision the form was read at, so a concurrent writer is detected rather than overwritten. A namespace the panel just learned about can be missing from the mirror's startup answer, so the face reads the document once and folds the namespace back through the mirror's own `acceptView`, which keeps the shared mirror the only view of the document. The tab's own signal ends every call it opened, and a closed tab leaves no subscription behind.

`form.ts` is the one piece with no Host knowledge: it turns a kind's serialized configuration schema into the field list the body draws — a control kind, the choices a section declared, the layer that supplied the value, and the default a field falls back to — and turns the reader's drafts back into settings operations, refusing to write a value the field cannot store.

## Model Experience

### The remote-resource configuration panel

#### What the model sees

Nothing directly. The panel drives the `sources` Remote namespace owned by the person and registers no tool, prompt section, or session event. What it configures reaches the model through the resource seam's own consumers — the tools that search and read a source — and those consumers own the text a model receives.

#### Token effect

None on its own. The panel's calls and answers add no tokens to any request; a source it configures changes what those other consumers can return, and their own token accounting covers it.

#### KV Cache effect

No direct invalidation; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **The settings namespace is derived, not declared.** The panel composes a kind's namespace as `resource-<kind>` from the convention the shipped providers follow, because the seam exposes no kind-to-namespace member. A provider that names its namespace differently still draws its card, with the configuration surface reported as unreachable rather than a form for a namespace that does not exist.
- **A kind this build does not name shows its provider's own statement.** The panel's hard-limit copy exists for GitHub, MySQL, and MediaWiki. Any other kind shows the provider's model-facing `description` verbatim, which is the only truthful wording available; the panel states its own "the provider states these limits" line only when the provider states nothing.
- **A secret-role field would be drawn as a plain input.** The Host redacts every `role('secret')` value before the descriptor crosses the wire, so the panel can never echo one; a kind that declared such a field would get a text control rather than a write-only one. No shipped resource provider declares one — each names a `dsh-credentials` reference instead.
- **A field the panel cannot edit is drawn, not hidden.** A nested object or an undeclared control kind appears as its JSON value with a line saying it is not editable here, so a descriptor the panel does not fully understand never looks like one it does.
- **360AI云盘 is deliberately undecided.** The panel lists it among the sources this design does not build and reports what the design records; it implements nothing for it and takes no position on whether it should be built. See the discovery record for the open question.
- **The panel's settings plumbing parallels the channels panel.** Sharing it needs a narrow static owner; `form.ts` is decomposed differently from the channels form and has a smaller surface, and the rest is not measured for duplication on this host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the panel owns no cross-plugin relationship, and the authority rules it depends on — an instance key resolves only against the registry that reported it, and a settings write resolves only against the reader's own document — are enforced in `dsh-api-sources` and `dsh-client-ui-settings`.

The panel's suite mounts the body over a real store instance, a scripted Remote, and a scripted settings port, and asserts what the reader sees: every state the read can settle in, one card per instance, credentials by reference name, the limits each kind states, and a save that sends exactly the staged operations under the revision it read. The tab type is also asserted against the slot declaration contract the right Sidebar publishes.

</details>

---
description: "The right Sidebar's remote-control tab type: every chat channel this Host serves, its connection, its credential references, and the settings form its own schema declares, for Web users and client-plugin maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-channels

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar-channels` registers `channels` as a right-Sidebar tab type: an available page that lists every chat channel the Host's connector registry serves, with the connection it reports, the credential references it declared, and a settings form built from the channel's own configuration schema. It is the browser half of the chat-channel seam — the Host half is `dsh-api-channels` over `dsh-channel` and `dsh-channel-bridge` — and it holds no platform knowledge of its own: what a channel is, which credentials it needs, and which fields configure it all come from the Host.

Two lines of its copy are the panel's honesty rather than chrome. Credentials appear as reference names only: the panel neither reads nor shows a secret value, and a form writes one solely when the reader types it. And a channel is a Host-owned registration with no addressable identity, so the panel lists what the status call reports instead of opening a resource.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the right Sidebar's guide page and pick **Remote control**, or open `channels` from the type picker. The panel reads the Host's channel list on mount and draws one card per channel: its connection state, the session it is bound to and its last failure when it has them, the capabilities its connector declared, its credentials by reference name, and the settings form its schema declares. **Enable** binds the channel to the tab's own session, **Disable** closes it, **Test credentials** probes them without enabling anything, and **Reload** re-reads the list.

The type is `available`, never `default-on`: remote control is something the person asks for, and the right Sidebar's always-on seats belong to the surfaces that answer questions about the session. Its `order` of 600 follows the files, textpreview, git, and terminal pages, and its guide entry sits at order 60.

Enabling a channel is what makes a session reachable from a chat platform, and the Host owns every consequence of that: the bridge's deduplication, the chat lock, admission, and reply delivery. The panel sends the one call and then draws the connection the Host reports.

## Understand the implementation

The file split is the layering: what the type IS (`definition.ts`), what it keeps (`store.ts`), how it drives the Host (`face.ts`), what it draws (`ChannelsBody.tsx`), how a schema becomes a form (`schema-form.ts`), what it says (`locales.ts`), and `index.ts`, which only wires them together.

The store keeps each tab's channel list, each channel's settings description, the drafts a reader staged, and the busy and failure flags. It lives here rather than in a client object layer because this panel is its only consumer: a second view would be the reason to publish it, and there is none. The channels themselves are Host facts read on mount and after each change, never carried across tabs.

The face is where the Host's contract is spent. `status`, `enable`, `disable`, and `probe` are unary calls whose results replace the panel's list. A channel's settings descriptor is read through the settings scope's `describe`, and a save sends the staged operations through the bound scope's `mutate` under the revision the form was read at, so a concurrent writer is detected rather than overwritten. The bridge registers a connector's settings namespace on the first `channels.status`, so a channel the panel just learned about can be missing from the settings mirror's startup answer; when that happens the face reads the document once and folds the namespace back through the mirror's own `acceptView`, which keeps the shared mirror the only view of the document and makes the form appear on first mount. The tab's own signal ends every call it opened, and a closed tab leaves no subscription behind.

`schema-form.ts` is the one piece with no Host knowledge: it turns a channel's serialized configuration schema into the field list the body draws — a control kind, the choices a section declared, and the schema default a field falls back to — and turns the reader's drafts back into settings operations, refusing to write a value the field cannot store.

## Model Experience

None, as the panel drives a Remote namespace owned by the person and registers no tool, prompt section, or session event. Enabling a channel changes what reaches a *chat platform*, not what reaches the model; the bridge's own session events belong to `dsh-channel-bridge`.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **No sign-in flow.** A platform that needs a scan or an interactive authorization is not driven from here: the Host's `AuthorizationPrompt` declares no code or QR kind, so the panel draws the failure the connector reports instead of inventing a flow.
- **Timestamps and chat-lock facts are not drawn.** `lastErrorAt`, `lastInboundAt`, `lockedChatId`, and `replyBudget` reach the client and stay unrendered; a card draws the connection, the bound session, the last failure message, and the declared size bounds.
- **Bridge-owned fields still render.** `enabled` and `sessionId` belong to the bridge rather than to a connector's own configuration, but a channel's schema declares them and the panel renders every field the descriptor holds. The panel's own enable and disable controls are what bind a session.
- **A field the panel cannot edit is drawn, not hidden.** A nested object or an undeclared control kind appears as its JSON value with a line saying it is not editable here, so a descriptor the panel does not fully understand never looks like one it does.
- **The Tuitui connector has no panel of its own.** It ships no UI, so this panel is its whole surface; the id it draws is the Host's, and only the channels this build names get a translated label.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the panel owns no cross-plugin relationship, and the authority rules it depends on — a channel id resolves only against the registered connector, and a settings write resolves only against the reader's own document — are enforced in `dsh-api-channels` and `dsh-client-ui-settings`.

The panel's suite mounts the body over a real store instance, a scripted Remote, and a scripted settings port, and asserts what the reader sees: every state the read can settle in, one card per channel, credentials by reference name, and a save that sends exactly the staged operations under the revision it read. The assembled-browser scenario in `apps/web/tests/sidebar-channels.e2e.ts` is the real-composition case: the shipped bundle's own connector rows over the real Typert Remote.

</details>

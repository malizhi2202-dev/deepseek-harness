# Agent Note: A Remote-Control Panel for Chat Channels

Status: implemented

English | [中文](2026-09-22-sidebar-channels-panel.zh.md)

## Problem

The Host could already drive a session from a chat platform: `dsh-channel` owns the connector registry, `dsh-channel-bridge` owns deduplication, the chat lock, admission, and reply delivery, `dsh-channel-tuitui` adapts the one transport this repository ships, and `dsh-api-channels` publishes the `channels` Remote namespace over all of it. None of that was reachable from the product. A person could not see which channels a Host serves, whether one is connected, which credentials it needs, or which fields configure it, and enabling a channel meant editing the settings document by hand and restarting.

The browser half of that seam is this change.

## Decision

The capability enters as one new client plugin package, `@deepseek-ai/dsh-client-ui-sidebar-channels`, registering `channels` as a right-Sidebar tab type: `builtin`, `available`, order 600, reached from the guide at entry order 60. It is `available` rather than `default-on` for the same reason the terminal and git pages are: remote control is something the person asks for, and the always-on seats belong to the surfaces that answer questions about the session.

**The panel reads the Host's descriptor; it does not own a copy of a channel's configuration.** `channels.status` reports each channel with its connection, bound session, last failure, declared capabilities, and credential *references*; the channel's settings descriptor arrives through the settings scope's `describe`, and `schema-form.ts` turns that serialized schema into the field list the body draws — a control kind per field, the choices a section declared, and the schema default a field falls back to. A new connector therefore needs no panel change to appear: registering it in the Host is enough, and its own schema decides the form.

**A save is an operation list under the revision it read.** The form stages drafts in the tab's store; one Save turns them into settings operations and sends them through the bound scope's `mutate(ops, revision)`, then reads the user layer back to decide whether the write landed. A concurrent writer is detected instead of overwritten, and a save that did not take effect keeps the drafts and says so rather than clearing the form on an optimistic guess.

**Credentials are reference names, and nothing else.** The card lists each declared credential with its reference name, whether it is configured, where its value comes from, and whether it is writable. A secret-role field renders as a write-only password control that the panel never echoes, and it writes only when the reader typed something. `enabled` and `sessionId` belong to the bridge rather than to a connector's own configuration, but a channel's schema declares them and the panel renders every field the descriptor holds.

**The panel does not invent a sign-in flow.** A platform that needs a scan or an interactive authorization has no gesture here: the Host's `AuthorizationPrompt` declares no code or QR kind, so the connector's own failure line is what the reader sees.

**A channel's descriptor can postdate the settings mirror's answer, and the panel repairs that.** The bridge binds a connector, and so registers its settings namespace, on the first `channels.status` — the panel's own first call — because the bridge mounts before the connector rows and no registry change re-triggers it. Registering a namespace whose resolved value did not change emits no `settings/document-updated`, and the client mirror reads once at startup, so its held answer can be current and still lack the namespace the panel just learned about. When the mirror serves no namespace for a channel in the list the panel just read, the panel reads the document once through `remote.settings.describe()` and folds what it found back through the mirror's own `acceptView`, so the shared mirror stays the only view of the settings document and the form appears on first mount rather than after a reconnect. A deployment whose connector config differs from its schema defaults emits the update event at registration, and the repair then finds nothing missing and reads nothing.

Three deviations from the design brief are worth recording. The brief assumed a client plugin could call `ctx.settings.register<Ns, T>()` to obtain its namespace; that call is Host-only, so the client reads the same descriptor through `ctx.settingsScope.describe()` and writes through the bound scope's `mutate`. The brief assumed the tsconfig alias generator would map the new package name; it maps only names exactly equal to `@deepseek-ai/dsh-<directory>`, so a client UI package needs a hand-written alias beside the other client UI aliases. And the brief treated the descriptor read as a plain mirror read; the mirror's read face exposes no refresh, so the repair above is the panel's own.

## Alternatives considered

**Hand-written form fields per known channel.** It would hard-code Tuitui's fields into the panel and make every future connector a panel change. The descriptor already carries the schema; rendering from it is what makes the panel a seam rather than a Tuitui screen.

**Registering the settings namespace on the client.** `ctx.settings.register` is a Host call that owns a namespace; a client cannot mint one, and pretending to would put a second authority beside the connector's own registration. Reading the descriptor and writing through the scope spends the contract that exists.

**A QR or code sign-in flow in the panel.** `AuthorizationPrompt` has no such kind, so the panel would have to invent a protocol the Host does not serve. The failure line is honest; an invented flow would not be.

**Drawing timestamps and chat-lock facts.** `lastErrorAt`, `lastInboundAt`, `lockedChatId`, and `replyBudget` reach the client, and the card draws none of them: the connection, the bound session, the last failure message, and the declared size bounds are what a reader acts on, and a card is not a diagnostics table.

**Enabling a channel without binding it to the tab's session.** The Host's `enable` takes a session id, and the tab already knows which session it belongs to. A separate session picker would ask the reader to repeat what the surface knows.

**Hiding a field the panel cannot edit.** A nested object or an undeclared control kind renders as its JSON value with a line saying it is not editable here, so a descriptor the panel only partly understands never looks like one it fully understands.

## Consequences

The panel is only as complete as the Host's descriptor: a connector that declares no capabilities, no credentials, and an empty schema renders a card with a connection and a form with no fields, which is accurate rather than broken.

Nothing here is persisted. Channels are Host facts read on mount and after each change, the drafts live in the tab's store, and a reload re-reads everything; that is also why the store lives in this package instead of a client object layer — this panel is its only consumer.

Tuitui ships no surface of its own, so this panel is the whole of its UI: the connector registers itself, and the tab renders it from the descriptor it registered.

The e2e scenario is a host-plane program: `apps/web/tests/sidebar-channels.e2e.ts` boots the shipped composition and is listed in `tsconfig.host.json` and in the `apps/web` client project's `exclude`, like the other e2e specs that import the scaffold. It never enables a channel — enabling opens a real transport to a chat platform, which this keyless lane owns no fixture for — so the assembled coverage is the read path, the descriptor, and the credentials-by-reference rule.

## Related

The Host half this panel drives — the connector registry, the bridge, the Tuitui connector, and the settings namespace it registers — is [the Tuitui IM bridge decision](2026-09-16-tuitui-im-bridge.md). That note owns the runtime behavior of a channel; this one owns the surface that reads and enables it.

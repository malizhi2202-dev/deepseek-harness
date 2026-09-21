# Chat Channels

English | [中文](channel.zh.md)

The chat-channel subsystem lets a chat platform drive an Agent Session and mirror that Session's completed replies back into the conversation. It is one capability seam with three roles: [dsh-channel](../../packages/channel/channel) is the Service Definition, [dsh-channel-tuitui](../../packages/channel/channel-tuitui) is the Provider that adapts an existing platform transport, and [dsh-channel-bridge](../../packages/channel/channel-bridge) is the Consumer that every platform shares. [dsh-api-channels](../../packages/api/channels) exposes status and the enable/disable binding over Typert Remote for the configuration panel.

Source: [`packages/channel/channel/src/index.ts`](../../packages/channel/channel/src/index.ts)

## The seam

A connector declares what its platform can do and hands over two things: a normalized inbound message whose media are lazy fetch handles, and an outbound client. It never sees a Session, a settings document, or a credential value.

`ChatChannelIdMap` is merge-extensible, so a provider adds its own platform id from its own `./types` module and adding a platform never edits the Definition. The map is seeded with `tuitui`, the one platform this repository ships, so a consumer compiles against a usable id set on its own.

`ChatChannelCapabilities` is the panel's statement of limits: whether `replyText` quotes, which attachment directions exist, whether Markdown renders, and the platform's text and byte ceilings. The bridge enforces the directions and the ceilings rather than letting a user discover them from silence.

`ChatInboundMessage` carries text plus optional images and files as `fetch(maxBytes)` handles. Nothing is transferred until the bridge has admitted the message, and the byte cap rides into the transfer, so an oversized attachment is refused at the byte that crosses it instead of being buffered whole and measured afterwards.

## What the bridge owns

The bridge is the only place a cross-platform decision lives. Four of them are security properties rather than conveniences.

**The chat lock.** The conversation that first speaks to a bound channel is recorded on the admitted `user/message` event's source, and every later reply goes to that conversation. A second conversation that finds the bot reaches the same Agent but receives nothing back, so a bot added to a public group cannot leak one conversation into another.

**Outbound files.** A delivered file must be both named by the reply and written by that turn. Membership is decided inside the Session workspace through the filesystem seam, and freshness comes from the file's own modification time measured against the turn's start. Naming a path proves nothing, so a reply talked into naming a file outside the workspace, or a pre-existing file inside it, delivers nothing.

**Deduplication.** A platform redelivers after a reconnect, and nothing downstream is idempotent. Two memories answer it: a bounded in-process ring, and a durable watermark derived from the Session's own log, because the admitted message is already an event whose source carries the platform message id. The durable record therefore commits with the turn that claims the input, after admission, so a crash leaves no watermark and a replay is admitted again rather than swallowed.

**Model-visible source.** Every admitted prompt carries `source.kind: "channel"` with the platform, conversation, conversation kind, and platform message id, so the model learns where its input came from and the watermark stays derivable from the log.

The relay itself is deliberately narrow: only completed `assistant/message` text reaches a chat, chunked to the tighter of the deployment's chunk size and the platform's own ceiling, with one plain-text resend when a platform refuses the rendered form. An approval request that no chat participant can answer is announced in the conversation instead of leaving it silent.

## Configuration and credentials

One channel means one `dsh-settings` namespace, `chat-channel-<channel>`, holding the bridge's shared fields (`enabled`, `sessionId`, `markdown`, `finalReplyOnly`) composed around the connector's own fields. The connector's cordis.yml `config` is the namespace's composition layer, so a deployment's defaults live in the file that configures the plugin and a user's edits layer over them. There is no bindings table and no second persistence domain: the binding is the settings section, and the durable dedupe and chat-lock state is the Session log.

Secrets are referenced by name and never stored in the section. A connector declares `credentialFields`, and the Remote endpoint reports each named `dsh-credentials` reference as configured or not, by name and never by value.

At most one enabled channel may serve a Session. Enabling a second one for the same Session is refused with a message naming the channel already bound, because two platforms answering one conversation would double every reply.

## Per-platform facts

`dsh-channel-tuitui` adapts the transport this repository already ships and owns no protocol of its own. Tuitui has no reply-quoting, so `capabilities.quoting` is false and a group reply is a plain message. It carries no attachments in either direction: the transport hands media over only as URLs already rendered into the message text, so the model still receives the URL but never a native image or file block. The transport's receive loop reports no handshake and swallows its own reconnect failures, so the connector reports ready once the loop is running and a socket that never opens is indistinguishable from an idle one at this seam.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxchannels--channels"></a>

### `ctx.channels` — `Channels`

Host Remote service reporting the chat channels and moving one binding.

```ts cordis-catalog
/**
 * Read every channel's status.
 *
 * The bridge binds connectors that registered after it mounted, so this call
 * settles the registry first: a channel a plugin added a moment ago is
 * reported rather than missing.
 * @returns one view per registered channel, in registration order.
 */
@Remote async status(): Promise<ChannelsStatus>

/**
 * Test whether one channel can build a client with its configured credentials.
 *
 * A channel that cannot is answered, not rejected: `ok: false` with the
 * reason is what the panel shows, and only an unregistered channel is an
 * error.
 * @param channel - the channel id to probe, as the panel knows it.
 * @returns what the probe found.
 * @throws {RemoteError} with code `channels/unknown` when no such channel is registered.
 */
@Remote async probe(channel: string): Promise<ChannelProbe>

/**
 * Point one channel at one Session and open its connection.
 * @param channel - the channel id to bind.
 * @param sessionId - the Session the channel drives.
 * @returns the status after the change.
 * @throws {RemoteError} with code `channels/unknown` or `channels/failed`, whose message names what to fix.
 */
@Remote async enable(channel: string, sessionId: string): Promise<ChannelsStatus>

/**
 * Close one channel's connection, leaving its configuration otherwise intact.
 * @param channel - the channel id to close.
 * @returns the status after the change.
 * @throws {RemoteError} with code `channels/unknown` or `channels/failed`.
 */
@Remote async disable(channel: string): Promise<ChannelsStatus>
```

Source: [`packages/api/channels/src/index.ts`](../../packages/api/channels/src/index.ts)

<a id="ctxchatbridge--chatbridge"></a>

### `ctx.chatBridge` — `ChatBridge`

The generic bridge: it binds connectors to Sessions, admits what arrives, and relays what those Sessions produce.

```ts cordis-catalog
/**
 * Bind every registered connector that is not bound yet, and drop the
 * bindings whose connector left the registry. Idempotent; the configuration
 * panel calls it before reading a status so a connector that registered after
 * this plugin mounted is not invisible.
 */
sync(): void

/**
 * Every registered channel's status, in registration order.
 * @returns one status per bound channel.
 */
statuses(): readonly ChatChannelStatus[]

/**
 * One channel's status.
 * @param channel - the channel to read.
 * @returns its status, or undefined while the channel is unregistered.
 */
status(channel: ChatChannelId): ChatChannelStatus | undefined

/**
 * Point one channel at one Session and open its connection.
 * @param channel - the channel to bind.
 * @param sessionId - the Session the channel drives.
 * @throws {Error} when the channel is unregistered, the Session does not exist,
 *   or another channel already serves that Session.
 */
async enable(channel: ChatChannelId, sessionId: string): Promise<void>

/**
 * Close one channel's connection and leave its configuration otherwise intact.
 * @param channel - the channel to close.
 * @throws {Error} when the channel is unregistered.
 */
async disable(channel: ChatChannelId): Promise<void>

/**
 * Test whether one channel can build a client with its configured credentials.
 *
 * The probe never opens a connection: it asks the platform nothing a client
 * cannot answer from its own configuration, which is what makes it safe to
 * run while the channel is live.
 * @param channel - the channel to probe.
 * @returns what the probe found; a failure is a value, not a rejection.
 * @throws {Error} when the channel is unregistered.
 */
async probe(channel: ChatChannelId): Promise<ChatProbeResult>
```

Source: [`packages/channel/channel-bridge/src/index.ts`](../../packages/channel/channel-bridge/src/index.ts)

<a id="ctxchatchannels--chatchannels"></a>

### `ctx.chatChannels` — `ChatChannels`

Registry of chat-channel connectors, keyed by platform id.

```ts cordis-catalog
/**
 * Register one platform's connector. Registration is an effect: the entry
 * disappears when the returned disposer runs or the owning fiber unloads.
 * @param connector - the platform's lifecycle and configuration seam.
 * @returns the disposer removing this entry.
 * @throws when a connector for the same platform is already registered, which
 *   is a composition mistake rather than a race: two connectors for one
 *   platform would leave the panel showing whichever registered last.
 */
register(connector: ChatChannelConnector): () => void

/**
 * Every registered connector, in registration order.
 * @returns a detached array; later registrations do not change it.
 */
list(): readonly ChatChannelConnector[]

/**
 * The connector for one platform.
 * @param channel - the platform to look up.
 * @returns the connector, or `undefined` when this build has none.
 */
get(channel: ChatChannelId): ChatChannelConnector | undefined
```

Source: [`packages/channel/channel/src/index.ts`](../../packages/channel/channel/src/index.ts)
<!-- END GENERATED cordis-surface -->

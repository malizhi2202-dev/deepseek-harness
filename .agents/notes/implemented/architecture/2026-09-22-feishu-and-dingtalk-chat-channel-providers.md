# Agent Note: Feishu and DingTalk chat-channel providers

Status: implemented

English | [中文](2026-09-22-feishu-and-dingtalk-chat-channel-providers.zh.md)

## Problem

The chat-channel seam shipped with one Provider, `channel-tuitui`, and it adapts a transport this repository already owns. Operators driving a Session from the platforms their teams already use need two more, Feishu (飞书) and DingTalk (钉钉), and neither has a transport here. Both authenticate a self-built application with an application id and an application secret, and both deliver robot messages over a long-lived connection, so the work is the same in kind: normalize one platform's inbound event into the seam's message and implement the seam's outbound client, without moving any cross-platform decision out of [the bridge](../../../../packages/channel/channel-bridge/README.md).

Neither platform's protocol is small. Feishu's long connection needs endpoint discovery, a handshake, heartbeats, reconnection, and a typed event envelope; DingTalk's needs gateway discovery, a topic-based subscription, a per-message acknowledgement, and reconnection. Writing both by hand would mean owning two protocols, their retry policies, and their wire formats.

## Decision

Two Provider packages join the seam, `packages/channel/channel-feishu` (`@deepseek-ai/dsh-channel-feishu`) and `packages/channel/channel-dingtalk` (`@deepseek-ai/dsh-channel-dingtalk`). Each is a function plugin exporting `name` / `inject` / `Config` / `apply`, injects `chatChannels` and `credentials`, declares one settings namespace (`chat-channel-feishu`, `chat-channel-dingtalk`), and names the credential-reference field its section holds. Both are registered in the `dsh-web-app` composition, and the remote-control panel draws them from their descriptors with no client change.

Both packages depend on the platform's official SDK for the protocol and hand-roll nothing the SDK owns. Each SDK is an exact-pinned runtime `dependency`, so tsdown externalizes it and Node loads it at runtime.

- **Feishu: `@larksuiteoapi/node-sdk@1.74.0`.** It ships neither an `exports` map nor a `type` field, so Node loads its CommonJS build, where `__dirname` resolves. That was verified on the source launch (`node --import tsx/esm`) and on the bundled `lib/index.js` before the dependency was accepted.
- **DingTalk: `dingtalk-stream@2.1.6-beta.1`.** Its published `latest` tag is a beta, so the version is pinned exactly rather than by range. It owns gateway discovery, the WebSocket connection, the per-message acknowledgement, and reconnection, and it was verified on the same two launch paths.

### Platform facts that forced a deviation from the seam

- **Feishu renders Markdown only inside an interactive card**, and `lark_md` renders no heading and no fenced code block. `packages/channel/channel-feishu/src/markdown.ts` turns a heading into a bold line and drops fence delimiters while keeping the code verbatim, then measures the rendered result against the platform's character ceiling and raises `ChatFormatRejectedError` past it — the error the bridge answers by resending the same chunk plainly.
- **Feishu reports a refusal as a non-zero `code` inside an HTTP 200 body.** A refused interactive card is filed as `ChatFormatRejectedError` and a refused plain message or upload as an ordinary failure carrying the platform's own reason.
- **Feishu declines a malformed application id by logging and returning** rather than by failing, which would leave the panel reporting a connection that never receives anything. The provider therefore validates the `cli_`-plus-16-hexadecimal-digits form at configuration time.
- **`im.message.receive_v1` carries sender ids but no display name.** The normalized message omits `senderName` rather than spending one API call per message to resolve one.
- **DingTalk answers through a session webhook the callback itself carries**, stamped with an expiry, rather than through an authenticated API call. The connector records the URL per conversation as inbound messages arrive and posts to the live one; a send with no live webhook fails with a readable reason instead of falling back to an unverified endpoint.
- **DingTalk's ceiling counts bytes where the bridge counts characters.** `capabilities.maxTextChars` is the byte ceiling divided by UTF-8's longest encoding, so no chunk the bridge builds can exceed the real ceiling in any language, and the rendered result is additionally measured in bytes.
- **DingTalk requires a title on a Markdown message** and shows it in the push notification, so the message's first non-empty line serves as it.
- **The DingTalk SDK swallows a failed initial connect** and retries on its own without a callback, so `connect` reports failure from the socket's own `connected` state.

### Capabilities are declared as implemented

Feishu declares quoted replies, inbound images and files, outbound files, and Markdown; it declares outbound images false because the seam's client has no image send and the provider implements no upload path for one. DingTalk declares Markdown only: a session webhook accepts a text or Markdown body and nothing else, and DingTalk delivers an inbound picture or file as a `downloadCode` this connector does not redeem. Every direction the capabilities declare false has no code path in the provider, and `replyText` and `sendFile` reject with `ChatUnsupportedError` where the capability is false.

## Alternatives considered

**Hand-roll both protocols.** Each SDK deletes owned code, its tests, and its retry policy, which is what [the dependencies-over-hand-rolling policy](../process/2026-07-26-dependencies-over-hand-rolling.md) prefers. The cost is accepted and recorded: Feishu's SDK pulls seven transitive dependencies including `axios` and `protobufjs`, and DingTalk's ships a beta. Hand-rolling was rejected because it would put two more protocol implementations inside a repository whose seam exists to keep platform protocols out of the bridge.

**Send DingTalk messages through the robot OpenAPI endpoints.** `/v1.0/robot/oToMessages/batchSend` and `/v1.0/robot/groupMessages/send` would need an access token and a conversation-to-address mapping. Their endpoint paths and parameter names could not be verified — the platform's reference pages render client-side — so the provider uses the session webhook the callback already carries, which needs no unverified endpoint. The cost is recorded under Known Limitations: the first outbound message of a conversation must follow an inbound one within the webhook's lifetime.

**Declare outbound images for Feishu and upload one anyway.** The seam's client has no image send, so an accepted upload would be a capability nothing could reach. The provider declares it false instead.

**Let the platform reject an over-long message instead of measuring it.** The bridge chunks by characters and neither platform's ceiling is characters, so a chunk that fits the bridge's count can still be refused. Measuring in the provider turns that into a plain resend of the same chunk rather than a lost message.

## Consequences

- **Two more platforms drive a Session, and the bridge learned nothing about either.** Deduplication, the chat lock, admission, outbound relay, and reply-file delivery stay in one place, and the providers carry only platform translation.
- **The repository now depends on two third-party SDKs at runtime.** Both are exact-pinned, both load on the source and bundled launch paths, and neither is bundled into the published artifact.
- **The remote-control panel lists three channels without a client change.** `apps/web/tests/snapshots/sidebar-channels/panel.expected.md` was re-recorded because the assembled composition now serves three connectors; the panel's own code is untouched.
- **DingTalk replies depend on the session webhook's lifetime.** A conversation that has received nothing recently cannot be sent to until it does. This is the platform's model, and the alternative was an unverified endpoint.
- **Feishu messages carry no sender display name and no message type outside text, rich text, image, and file.** Both are recorded under each package's Known Limitations rather than papered over.

## Testing

Each package's suite pins its configuration narrowing and the first field it names, the credential-reference resolution for a malformed name and for a name with nothing stored behind it, the inbound normalization including every payload the reader refuses, the Markdown downgrade at its exact ceiling, the outbound calls with their refusal reasons, the connector's ready/failure reporting, and `apply` registering exactly one connector. Both packages hold per-file 100% coverage. `apps/web/tests/sidebar-channels.e2e.ts` boots the shipped composition and pins the panel the two connectors produce.

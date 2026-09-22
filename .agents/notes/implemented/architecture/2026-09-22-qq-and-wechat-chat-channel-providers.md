# Agent Note: QQ and WeChat chat-channel providers

Status: implemented

English | [中文](2026-09-22-qq-and-wechat-chat-channel-providers.zh.md)

## Problem

The chat-channel seam let a chat platform drive a Session, and operators needed it to reach the two platforms their teams use most after the enterprise pair: QQ (QQ 机器人开放平台) and WeChat (微信). Neither has a transport in this repository, and neither has a Node SDK this repository can depend on: the third-party packages that reach them (`wechaty`, `wechat4u`, `qq-official-bot`) each own the process's message loop, serve a single account, and render their login QR to a terminal, which is the wrong form for a Host that keeps several bindings alive and sends its QR to a browser.

Two platform properties decide the whole design. QQ authenticates each call with a short-lived access token that the credential pair only exchanges for, and it permits a send only as a passive reply to a recent inbound message within a small per-message quota. WeChat's inbound is a long poll the server holds open, which is what makes the channel workable with no public address, and its sign-in is a QR code that carries a one-time login token.

## Decision

Two Provider packages join the seam, `packages/channel/channel-qq` (`@deepseek-ai/dsh-channel-qq`) and `packages/channel/channel-wechat` (`@deepseek-ai/dsh-channel-wechat`). Each is a function plugin exporting `name` / `inject` / `Config` / `apply`, injects `chatChannels` and `credentials`, declares one settings namespace (`chat-channel-qq`, `chat-channel-wechat`), and names the credential-reference fields its section holds. Both are registered in the `dsh-web-app` composition.

**Both protocols are implemented against the endpoints Tencent publishes, and neither adds a dependency.** Node 22 provides global `fetch` and global `WebSocket`, and that `WebSocket` is the undici implementation the reference implementations reach for by name, so using the globals is equivalent rather than a downgrade. The QQ gateway, its token exchange, WeChat's long poll, and WeChat's media download are therefore all built on platform globals plus `node:crypto`.

### QQ

- **The access token is cached and refreshed by the client, not by its callers.** `packages/channel/channel-qq/src/token.ts` holds one token for all callers, single-flights a concurrent burst into one exchange, and replaces the token 60 seconds before its stated expiry, which is the rotation window the platform documents. A call refused with the platform's invalid-token code invalidates the cache and retries once.
- **The reply budget is reported, not enforced.** `capabilities.replyBudget` is 4, the tighter of the platform's 4 replies per single-chat message and 5 per group message, and the bridge's own capping is what stays inside it. Enforcing it in the provider as well would be a second place for the same decision to be wrong.
- **The provider owns the sequence numbers and the reply window.** `packages/channel/channel-qq/src/replies.ts` remembers each inbound message, hands out `msg_seq` per claim, and expires an entry after five minutes. `sendText` and `replyText` reject with `ChatUnsupportedError` when the conversation has no replyable message, because the platform offers no active push this connector implements.
- **The platform's documentation contradicts itself on the single-chat window.** One field's prose states five minutes and the same page's table states sixty. The provider takes the tighter reading, so it never claims a reply the platform may refuse.

### WeChat

- **Inbound is a long poll.** `getupdates` is held open by the server until a message arrives or the window closes, so the connector needs no inbound address.
- **Every conversation is direct.** The platform's bot channel is one-to-one, so the connector reports `direct` for every conversation and the peer's openid is the receive id.
- **An outbound message must carry the `context_token` from that conversation's last inbound message.** The connector keeps a bounded table of them and fails a send whose conversation never spoke or whose token was evicted, rather than sending without one.
- **The media type is sniffed from the downloaded bytes**, because the platform states none, and the chunk bound comes from the official client's own text limit rather than a documented server cap.
- **Sign-in is a QR payload that is secret-equivalent.** It embeds the one-time login token, so anyone who reads it can bind a client to that account. The provider obtains it, polls to completion with the platform's timeout semantics, and reports one discriminated outcome — `confirmed`, `expired`, `blocked`, `already-bound`, `verification-required`, `timeout`, or `cancelled` — reporting each replacement challenge and requesting a verification code when the platform demands one. It never renders the payload, never logs it, and never puts it in an error message.

### Registering a channel id, and the two silent failures that hid it

The channel id map is merge-extensible, and each provider adds its own key by augmenting `@deepseek-ai/dsh-channel/types` from its `src/types.ts`. That requires two conditions to hold together, and breaking either fails silently: the union simply lacks the key, and nothing errors until a call site pins it.

1. **The augmented subpath needs its own `paths` entry.** `tsconfig.base.json`'s generated alias region maps only the bare package name, and to the `src` directory rather than to a file. Without a hand-written entry for `@deepseek-ai/dsh-channel/types`, that subpath resolves through the package's `exports` to the built declarations instead, which is a different module instance from the one the source-plane program reads, so the merge lands where nothing looks. The entry now sits with the other hand-written subpath entries.
2. **The augmenting module must be reachable from the package entry.** An empty `import type {} from './types.ts'` does not keep the module in every program that reaches the entry, while `export type * from './types.ts'` does, which is the form the seam's own entry already used.

A `toEqual` on the registry listing does not catch either failure, because it is generic over its expectation; a lookup by the literal id is what pins the merged union, so `chatChannels.get('qq')` and its siblings now assert it. Both failures were present in all four chat-channel providers and were corrected together.

## Alternatives considered

**Depend on a third-party client.** Rejected on form rather than licence: each owns the process's message loop, serves one account, renders its QR to a terminal, and keeps its state in a dotfile, none of which fits a Host with several concurrent bindings. The official protocol is published and needs no such package.

**Add `undici` as a direct dependency for its `WebSocket`.** Rejected: Node's global `WebSocket` is that same implementation, so the dependency would delete no code.

**Enforce the reply budget in the provider.** Rejected: the bridge already caps replies and builds the chunks, so a second enforcement point would be a second place for the decision to be wrong. The provider reports the budget and owns only what the platform attributes to the message itself.

**Send a WeChat message without a `context_token`.** Rejected: the platform ties a reply to the message that asked for it, and sending without the token would be an unverified request against an undocumented path.

**Add a `qr` kind to the authorization capability.** Deferred, not rejected. A QR payload is secret-equivalent and belongs on the authorization path rather than in ordinary panel text, but widening a shipped capability's prompt union and its client is its own change. Until then the connector exposes sign-in as a typed extra member on its own connector type, which leaves the authorization package and the frozen seam untouched.

## Consequences

- **Five channels drive a Session, and the bridge learned about none of them.** Deduplication, the chat lock, admission, outbound relay, and reply-file delivery stay in one place.
- **The remote-control panel lists all five with no client change.** `apps/web/tests/snapshots/sidebar-channels/panel.expected.md` was re-recorded because the assembled composition now serves five connectors; the panel's code is untouched, and each platform's declared capabilities and settings fields are what it draws.
- **QQ cannot start a conversation.** Every send is a passive reply, and active push has its own quota and approval policy, so a conversation that has not spoken recently cannot be sent to. Recorded under the package's Known Limitations.
- **One reply budget covers two platform budgets.** A group under-uses its allowance by one reply.
- **WeChat sign-in is not yet reachable from the panel.** The connector exposes the flow and its outcome union; displaying the payload needs the deferred prompt kind.
- **No live API call was made against either platform**, because no application exists here. Every wire fact comes from the platforms' published documentation, and every suite drives a stubbed transport.
- **`pnpm run duplication` cannot run on this host.** The pinned jscpd v5 binary needs GLIBC 2.32 or newer and this host provides 2.31. The same thresholds were run through jscpd v4's JavaScript build over every channel provider's `src/`, reporting no clones, but CI must confirm with the real gate.

## Testing

`packages/channel/channel-qq` holds 109 tests and `packages/channel/channel-wechat` 104, both at per-file 100% statements, branches, functions, and lines. The suites pin the token cache's reuse, its rotation boundary, a string-typed `expires_in`, one exchange under concurrent callers, and the invalidate-and-retry; the reply ledger's sequence numbers, its latest-message-wins rule, its exact expiry, and its eviction bound; the WeChat long-poll loop, the `context_token` table's bounds, media sniffing, and the markdown downgrades at their exact ceilings; the QR flow's start, poll, refresh, verify-code, and cancel paths; and `apply` registering exactly one connector, asserted through a lookup by the literal channel id. `apps/web/tests/sidebar-channels.e2e.ts` boots the shipped composition and pins the panel all five connectors produce.

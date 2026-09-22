---
description: "The WeChat chat-channel provider for operators signing a bot account in and for maintainers of its translation between the official WeChat bot channel and the channel seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-wechat

English | [中文](README.zh.md)

## Summary

`dsh-channel-wechat` is the Provider half of the chat-channel seam for WeChat (微信). It speaks the official bot channel's plain-JSON protocol: an account is established by scanning a QR code, inbound messages arrive on a long poll, and an outbound message carries the `context_token` the conversation's last inbound message was issued with. It hands the [bridge](../channel-bridge/README.md) a normalized message stream, declares one settings namespace, `chat-channel-wechat`, and the platform's capability limits.

The platform's bot channel is one-to-one: every message this provider admits is a direct chat. Its media is fetched from the platform's CDN and decrypted with a per-item AES-128 key, and its text carries no Markdown, so a reply's Markdown is downgraded here.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The plugin is a function plugin (`name` / `inject` / `Config` / `apply`) injecting `chatChannels` and `credentials`. Wire it into a `cordis.yml` after the bridge is mounted:

```yaml
- name: '@deepseek-ai/dsh-channel-wechat'
  config:
    tokenRef: WECHAT_BOT_TOKEN
```

| Field | Default | Meaning |
|---|---|---|
| `tokenRef` | — (required) | Name of a `dsh-credentials` reference holding the bot token a QR sign-in issued, never the token. |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | The bot API host. The QR confirmation names the host the account must use, so a deployment records what the sign-in reported. |
| `botAgent` | `DeepSeekHarness` | The value sent as `bot_agent`, which the platform logs and never authenticates on. |

The cordis.yml `config` is the settings namespace's composition layer, so these values are the deployment's defaults and every field is also editable at **Settings → Plugins → Plugin configuration** without a redeploy. An empty `tokenRef` fails at the first connection with a message naming it; a reference that is not a credential reference name, or that nothing is stored behind, fails the same way.

The QR sign-in is the only way to obtain a token, and it needs no token to start, so it is reachable before `tokenRef` resolves. The connector exposes it as an extra member beyond the seam:

```ts
import type { ChatChannelConfig } from '@deepseek-ai/dsh-channel'
import type { WechatConnector, WechatQrChallenge } from '@deepseek-ai/dsh-channel-wechat'

declare const connector: WechatConnector
declare const section: ChatChannelConfig
declare const render: (challenge: WechatQrChallenge) => void

const signIn = connector.signIn(section)
const challenge = await signIn.start()
const outcome = await signIn.wait(challenge, { onChallenge: render })
```

`start` returns `{ qrcode, payload, expiresAt }`. `qrcode` is the opaque session handle the status poll echoes back; `payload` is the string to encode as the QR image; `expiresAt` is when this build stops accepting the challenge, five minutes after it was requested. `wait` polls until the platform confirms the scan, replacing a challenge the platform expired or blocked (reporting each replacement through `onChallenge`, so the caller re-renders) and asking for a verification code through `onVerifyCode` when the platform requires one. It reports one of `confirmed` (carrying the account id, the bot token, and the host), `expired`, `blocked`, `already-bound`, `verification-required`, `timeout`, or `cancelled`.

The payload is secret-equivalent: it embeds the login token, so it belongs on a display and nowhere else. This package never logs it, never puts it in a session log, and never includes it in an error message, and a caller must do the same. The seam's `AuthorizationPrompt` has no QR kind, which is why the flow is a connector member rather than an authorization prompt.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/wire.ts` is the protocol. Every authenticated call carries the bearer token and the `iLink-App-Id` / `iLink-App-ClientVersion` headers; a uint64 identifier is kept as the string the seam treats it as while the body is parsed, because JavaScript would round it; and a media download is refused at the byte that crosses its cap rather than after buffering the body, then decrypted with the item's AES-128-ECB key. The message poll is itself a long poll, so a window that closes empty comes back as a normal empty result and the caller polls again.

`src/client.ts` narrows the settings section and owns `WechatConversations`, the bounded table of the token each conversation's last message carried: the token arrives on the connection and is spent by the client, and the platform requires it back on every outbound message. It also builds the lazy attachment handles, reading an image's media type from the bytes because the platform states none. `src/markdown.ts` downgrades Markdown and chunks a long reply at paragraph boundaries in the window's back half. `src/signin.ts` is the QR flow. `src/index.ts` runs the poll loop: it reports ready once the platform has answered a poll and again after it recovers from a failure, and it retries a failed poll after two seconds, or after thirty once three have failed in a row.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits the normalized messages this provider produces and therefore owns every model-visible field.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **Single-chat only** — the platform's bot channel is one-to-one, so a group message cannot reach the bot and every admitted message is a direct chat.
- **No quoting** — the platform has no reply-to field, so `capabilities.quoting` is false and `replyText` refuses.
- **No Markdown rendering** — the platform renders plain text only, so `capabilities.markdown` is false and a reply's Markdown is downgraded here.
- **No outbound attachments** — the upload path (`getuploadurl`, AES encryption, the CDN POST) is not implemented, so `capabilities.outbound` is false and the bridge's refusal to send a file is the correct outcome.
- **An outbound message to a conversation that never spoke fails** — the platform requires the `context_token` its last inbound message carried, and the table that holds it is bounded at 1024 conversations, so a reply into a conversation evicted from it fails rather than sending without a token.
- **A stale token is not paused** — the platform answers a stale token with `ret: -14` and expects the channel to pause for an hour. This provider reports the refusal as an error and lets the next poll decide, so it keeps retrying against a token that needs re-issuing.
- **No interactive buttons or reactions** — the channel seam has no vocabulary for them.
- **Unverified platform facts** — the server-side QR lifetime, the server's own text cap, and the platform's rate limits are undocumented here, so the five-minute challenge lifetime and the 4000-character chunk size are this build's own bounds; the official client's `textChunkLimit` is the source for the second.
- **One connector per process** — the namespace is fixed at `chat-channel-wechat`, so a deployment cannot bind two WeChat bot accounts at once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the connector is a translation whose only owned relation is that every declared capability matches what the client refuses, which its own suite pins.

</details>

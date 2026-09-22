---
description: "The QQ chat-channel provider for operators configuring the bot application and for maintainers of its translation between the QQ bot open platform and the channel seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-qq

English | [中文](README.zh.md)

## Summary

`dsh-channel-qq` is the Provider half of the chat-channel seam for QQ (QQ 机器人). It speaks the official bot open platform API v2: the application credential pair is exchanged for a short-lived access token, inbound events arrive over the platform's WebSocket gateway, and outbound messages go to the group or single-chat send endpoint. It hands the [bridge](../channel-bridge/README.md) a normalized message stream, declares one settings namespace, `chat-channel-qq`, and the platform's capability limits.

Two platform rules shape the translation. A group or single-chat message is accepted only as a *passive reply* to a message the bot received, carrying that message's id and a sequence that counts the replies already sent for it; and the platform's markdown form needs a template a deployment defines in its own console, so this provider sends plain text and downgrades Markdown itself.

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
- name: '@deepseek-ai/dsh-channel-qq'
  config:
    appId: '102000000'
    appSecretRef: QQ_BOT_APP_SECRET
```

| Field | Default | Meaning |
|---|---|---|
| `appId` | — (required) | The bot application's id from the QQ bot developer console. |
| `appSecretRef` | — (required) | Name of a `dsh-credentials` reference holding the application secret, never the secret. |
| `apiBaseUrl` | `https://api.bot.qq.com` | The API host. A deployment on the sandbox host sets it; the token endpoint is the same for both. |

The cordis.yml `config` is the settings namespace's composition layer, so these values are the deployment's defaults and every field is also editable at **Settings → Plugins → Plugin configuration** without a redeploy. An empty required field fails at the first connection with a message naming it; a reference that is not a credential reference name, or that nothing is stored behind, fails the same way.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/api.ts` is the wire. `QqApi` carries the access token on every OpenAPI call, and `exchangeAccessToken` is the only place the application secret is used. `src/token.ts` owns the token's lifetime: the platform issues a token for at most 7200 seconds and rotates it for a request that arrives inside the last 60 seconds, so the cache replaces the token at that boundary and concurrent callers share one exchange. A call the platform refuses with `11244` invalidates the cache and repeats once.

`src/api.ts` also owns `QqGateway`: identify on the platform's hello frame, heartbeat on the interval that frame states, resume the session after a socket drop, and re-identify when the platform invalidated it. `connect` resolves once the socket is constructed; the session itself is reported through `onReady` when the platform sends `READY` or `RESUMED`.

`src/replies.ts` is the ledger the passive-reply rule requires. It remembers each received message with the moment it stops being replyable and the sequence its replies have used, so `sendText` and `replyText` can hand the platform the `msg_id` and `msg_seq` pair it demands. `src/client.ts` narrows the settings section, normalizes the group and single-chat events into the seam's two conversation kinds, mints the conversation id that carries the send endpoint, and builds lazy attachment handles that download from the URL the event stated. `src/markdown.ts` removes the markers QQ does not render, and chunks a long reply at paragraph boundaries.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits the normalized messages this provider produces and therefore owns every model-visible field.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **Passive replies only** — a group or single-chat message is accepted only as a reply to a message the bot received within the platform's window, so a model turn that outlives it fails loudly instead of being delivered. Sending without a `msg_id` is an *active* message with its own quota and approval policy, which this provider does not implement.
- **One reported reply budget for both conversation kinds** — the platform allows four replies to a single-chat message and five to a group message, and the seam carries one number, so `replyBudget` is 4 everywhere and a group under-uses its budget by one.
- **No Markdown rendering** — the platform's `msg_type: 2` needs a template a deployment registers in its console, so `capabilities.markdown` is false and a reply's Markdown is downgraded to plain text here.
- **No outbound attachments** — the rich-media upload path is not implemented, so `capabilities.outbound` is false and the bridge's refusal to send a file is the correct outcome.
- **No guild (频道) messages** — only the group and single-chat event class is subscribed. Guild channels and their direct messages are a separate event class with separate intents and a different send endpoint.
- **Voice attachments are dropped** — a voice item carries no text this seam can use; the platform's own speech transcript is not read.
- **No interactive buttons or reactions** — the channel seam has no vocabulary for them.
- **The 4000-character chunk size is this build's own bound** — the platform documents no outbound text cap, so it is not a platform fact, and it matches the bridge's default chunk size.
- **One connector per process** — the namespace is fixed at `chat-channel-qq`, so a deployment cannot bind two QQ bot applications at once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the connector is a translation whose only owned relations are that every declared capability matches what the client refuses and that the passive-reply ledger hands the platform a sequence it accepts, both of which its own suite pins.

</details>

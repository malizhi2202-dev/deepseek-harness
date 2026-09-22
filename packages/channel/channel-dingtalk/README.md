---
description: "The DingTalk chat-channel provider for operators configuring the robot and for maintainers of its translation between the official DingTalk Stream SDK and the channel seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-dingtalk

English | [中文](README.zh.md)

## Summary

`dsh-channel-dingtalk` is the Provider half of the chat-channel seam for DingTalk (钉钉). It owns no protocol: it resolves the credential reference its configuration names, builds the official `dingtalk-stream` client, and hands the [bridge](../channel-bridge/README.md) a normalized message stream. It declares one settings namespace, `chat-channel-dingtalk`, and the platform's capability limits.

DingTalk answers a robot message by posting to a session webhook it issues per conversation and stamps with an expiry, so this provider records that URL as inbound messages arrive and sends through the live one. The webhook accepts text or Markdown and nothing else, so every attachment direction is unsupported and `capabilities.quoting` is false.

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
- name: '@deepseek-ai/dsh-channel-dingtalk'
  config:
    clientId: 'ding…'
    clientSecretRef: DINGTALK_CLIENT_SECRET
```

| Field | Default | Meaning |
|---|---|---|
| `clientId` | — (required) | The internal application's Client ID from the DingTalk developer console, which DingTalk also calls the AppKey. |
| `clientSecretRef` | — (required) | Name of a `dsh-credentials` reference holding the Client Secret, never the secret. |

The cordis.yml `config` is the settings namespace's composition layer, so these values are the deployment's defaults and every field is also editable at **Settings → Plugins → Plugin configuration** without a redeploy. An empty field fails at the first connection with a message naming it; a reference that is not a credential reference name, or that nothing is stored behind, fails the same way.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client.ts` is the whole outbound translation. `readDingTalkConfig` narrows the opaque settings section and names the first missing or malformed field. `DingTalkWebhooks` is the connector's record of the URL each conversation can be answered through: an entry is dropped the moment it is read past its expiry stamp, so a stale URL is never posted to. `DingTalkChatClient` sends a plain message as `text` and a formatted one as `markdown`, whose title DingTalk requires and shows in the push notification; it refuses `replyText` and `sendFile` with `ChatUnsupportedError`, which the declared capabilities already tell the bridge never to call.

`src/markdown.ts` owns DingTalk's downgrade and its two bounds. DingTalk renders headings, lists, and emphasis but no fenced code block, so a fence's delimiters are removed and its content kept verbatim. The platform's ceiling counts bytes where the bridge counts characters, so `maxTextChars` is the byte ceiling divided by UTF-8's longest encoding — no message the bridge builds can exceed the real ceiling whatever it is written in — and the rendered result is measured in bytes and refused past it.

`src/events.ts` validates the robot callback. The Stream SDK hands the body over as an unparsed JSON string, so `src/json.ts` reads every field this package depends on. A text callback reads as text; every other message type reads as no text and the bridge answers it with its own unsupported-message notice. The session webhook and its expiry are read from the same callback and recorded before the message is forwarded.

`src/index.ts` builds the connector over the SDK's Stream client, which owns gateway discovery, the WebSocket connection, the per-message acknowledgement, and reconnection. The Client Secret is resolved per operation rather than once at load, which is what lets a rotated secret reach the next connection without a restart.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits the normalized messages this provider produces and therefore owns every model-visible field.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **No attachments in either direction** — a session webhook accepts a text or Markdown body only, and DingTalk delivers an inbound picture or file as a `downloadCode` this connector does not redeem, so `capabilities.inbound` and `capabilities.outbound` are both all-false.
- **Replies depend on a live session webhook** — DingTalk issues one with each inbound message and expires it, so the first outbound message of a conversation must follow an inbound one within the webhook's lifetime; a send with no live webhook fails with a readable reason rather than falling back to another endpoint.
- **No quoting** — `replyText` refuses; an answer is a new message in the same conversation.
- **Connect failures are reported from the socket's own state** — the SDK swallows a failed initial connect and retries on its own without a callback, so the panel reports the attempt as failed and a later background success is not reported.
- **One connector per process** — the namespace is fixed at `chat-channel-dingtalk`, so a deployment cannot bind two DingTalk applications at once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the connector is a translation whose only owned relation is that every declared capability matches what the client implements, which its own suite pins.

The official SDK is a runtime dependency rather than hand-rolled protocol code. It is pinned to an exact version, and its published `latest` tag is a beta; both the source launch through tsx and the bundled `lib/index.js` were checked to load it.

</details>

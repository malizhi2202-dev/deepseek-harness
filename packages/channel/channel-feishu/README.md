---
description: "The Feishu chat-channel provider for operators configuring the robot and for maintainers of its translation between the official Feishu SDK and the channel seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-feishu

English | [中文](README.zh.md)

## Summary

`dsh-channel-feishu` is the Provider half of the chat-channel seam for Feishu (飞书) and Lark. It owns no protocol: it resolves the credential reference its configuration names, builds the official `@larksuiteoapi/node-sdk` client, and hands the [bridge](../channel-bridge/README.md) a normalized message stream. It declares one settings namespace, `chat-channel-feishu`, and the platform's capability limits.

Feishu answers through its own API rather than a per-message webhook, so this provider quotes a specific message, accepts an inbound image or file, and uploads an outbound file. The seam's client has no image send, so `capabilities.outbound.images` is false.

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
- name: '@deepseek-ai/dsh-channel-feishu'
  config:
    appId: 'cli_…'
    domain: 'feishu'
    appSecretRef: FEISHU_APP_SECRET
```

| Field | Default | Meaning |
|---|---|---|
| `appId` | — (required) | The self-built application's id from the Feishu Open Platform console, in the form `cli_` followed by 16 hexadecimal digits. |
| `domain` | `feishu` | Which deployment the application signs in to: `feishu` for `open.feishu.cn`, `lark` for `open.larksuite.com`. |
| `appSecretRef` | — (required) | Name of a `dsh-credentials` reference holding the application secret, never the secret. |

The cordis.yml `config` is the settings namespace's composition layer, so these values are the deployment's defaults and every field is also editable at **Settings → Plugins → Plugin configuration** without a redeploy. An empty field fails at the first connection with a message naming it, and so does an `appId` outside the form Feishu issues, because the official SDK declines a malformed one by logging and returning rather than by failing.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client.ts` is the whole outbound translation. `readFeishuConfig` narrows the opaque settings section and names the first missing or malformed field. `FeishuChatClient` sends a plain message as `text` and a formatted one as an interactive card whose `lark_md` element carries the downgraded text, replies under the inbound message when the bridge asks it to quote, and uploads a file before sending the key Feishu returned. Feishu reports a refusal as a non-zero `code` inside an HTTP 200 body, so a refused card is raised as `ChatFormatRejectedError`, which is what makes the bridge resend the same chunk plainly.

`src/markdown.ts` owns Feishu's downgrade. `lark_md` renders no headings and no fenced code blocks, so a heading becomes a bold line and a fence's delimiters are dropped while its content is kept verbatim. The conversion can lengthen the text, so the rendered result is measured against the channel ceiling and refused past it.

`src/events.ts` validates `im.message.receive_v1`. Feishu sends the message body as a JSON string inside the event, so the event and that string are both checked. A text body reads as text; a rich-text body is flattened to its title, its lines, and its links, with each image collected as its own key; an image or file body becomes a lazy handle. `src/media.ts` downloads through the message that carried the attachment and enforces the byte cap during the transfer rather than after it.

`src/index.ts` builds the connector over the SDK's WebSocket long connection. The SDK owns endpoint discovery, event parsing, heartbeats, and reconnection; this plugin owns the seam. The application secret is resolved per operation rather than once at load, which is what lets a rotated secret reach the next connection without a restart.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits the normalized messages this provider produces and therefore owns every model-visible field.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **No outbound images** — the seam's client has no image send, so `capabilities.outbound.images` is false and this provider implements no upload path for one. An image received inbound still reaches the bridge as a lazy handle.
- **No sender display name** — `im.message.receive_v1` carries sender ids but no display name, and resolving one would cost an extra API call per message, so the normalized message omits `senderName`.
- **No message types beyond text, rich text, image, and file** — audio, media, stickers, and shared chats parse to an empty message and the bridge answers them with its own unsupported-message notice.
- **No card actions** — this provider sends interactive cards, but a button press or a form submission is not routed back into the session.
- **One connector per process** — the namespace is fixed at `chat-channel-feishu`, so a deployment cannot bind two Feishu applications at once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the connector is a translation whose only owned relation is that every declared capability matches what the client implements, which its own suite pins.

The official SDK is a runtime dependency rather than hand-rolled protocol code. It is pinned to an exact version because it ships no `exports` map, so Node loads its CommonJS build where `__dirname` resolves; both the source launch through tsx and the bundled `lib/index.js` were checked to load it.

</details>

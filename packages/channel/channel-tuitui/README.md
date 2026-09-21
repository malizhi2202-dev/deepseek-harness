---
description: "The Tuitui chat-channel provider for operators configuring the robot and for maintainers of its translation between the Tuitui transport and the channel seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-tuitui

English | [中文](README.zh.md)

## Summary

`dsh-channel-tuitui` is the Provider half of the chat-channel seam for Tuitui (推推). It owns no protocol: it resolves the credential reference its configuration names, builds the `TuituiClient` transport this repository already ships, and hands the [bridge](../channel-bridge/README.md) a normalized message stream. It declares one settings namespace, `chat-channel-tuitui`, and the platform's capability limits.

Tuitui has no reply-quoting, so `capabilities.quoting` is false and a group reply is a plain message. It carries no attachments in either direction, and the reason is in the transport rather than in this package — see Known Limitations.

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
- name: '@deepseek-ai/dsh-channel-tuitui'
  config:
    host: 'im.example.com'
    appId: '…'
    appSecretRef: TUITUI_APP_SECRET
```

| Field | Default | Meaning |
|---|---|---|
| `host` | — (required) | Tuitui IM server host, without a scheme or port. |
| `appId` | — (required) | The bot application's id from the Tuitui developer console. |
| `appSecretRef` | — (required) | Name of a `dsh-credentials` reference holding the application secret, never the secret. |

The cordis.yml `config` is the settings namespace's composition layer, so these values are the deployment's defaults and every field is also editable at **Settings → Plugins → Plugin configuration** without a redeploy. An empty field fails at the first connection with a message naming it; a reference that is not a credential reference name, or that nothing is stored behind, fails the same way.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client.ts` is the whole translation. `readTuituiConfig` narrows the opaque settings section and names the first missing field. `toInboundMessage` maps the platform's three conversation scopes onto the seam's two — a team thread behaves like a group for quoting and the chat lock — and brands the conversation and message ids, which are opaque to everything downstream. `TuituiChatClient` forwards text to the transport, reports the configured application as the probe's account, and refuses `replyText` and `sendFile` with `ChatUnsupportedError`, which the declared capabilities already tell the bridge never to call.

`src/index.ts` builds the connector. The application secret is resolved per operation rather than once at load, which is what lets a rotated secret reach the next connection without a restart. The connector's `connect` registers the message handler before opening the transport and reports ready once the receive loop is running; the transport gives no handshake signal to report.

Markdown is declared supported because team threads render `richtext/markdown`, but the choice is per conversation and lives in the transport, so the connector forwards text unchanged and a direct message shows it verbatim.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits the normalized messages this provider produces and therefore owns every model-visible field.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **No attachments in either direction** — the transport hands media over only as URLs already rendered into the message text, so a native image or file block would mean re-deriving the platform's message kinds and downloading bytes outside the transport. The model still receives the URL from the text.
- **No handshake or connect-failure reporting** — the transport resolves `connect()` before its socket opens and swallows its own reconnect failures, so the panel reports the receive loop as running and a socket that never opens is indistinguishable from an idle one.
- **No quoting** — `replyText` refuses; a group reply is a plain message.
- **No interactive cards or reactions** — the transport exposes both, but the channel seam has no vocabulary for them, so `/tree`-style cards and emoji reactions are not reachable from a chat-channel binding.
- **One connector per process** — the namespace is fixed at `chat-channel-tuitui`, so a deployment cannot bind two Tuitui applications at once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the connector is a translation whose only owned relation is that every declared capability matches what the client refuses, which its own suite pins.

</details>

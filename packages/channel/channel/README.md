---
description: "The chat-channel connector seam for developers and maintainers composing a platform, implementing a connector, or reading what a platform can carry."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel

English | [中文](README.zh.md)

## Summary

`dsh-channel` owns the chat-channel capability seam: the `ctx.chatChannels` connector registry, one normalized inbound message whose media are lazy `fetch(maxBytes)` handles, the outbound client a provider implements, and the capability and configuration declarations a connector makes. It holds no protocol, no Session, and no credential value — a provider adapts a platform's own transport and the [bridge](../channel-bridge/README.md) makes every cross-platform decision.

`ChatChannelIdMap` is merge-extensible, so a provider adds its platform id from its own `./types` module; the map is seeded with `tuitui`, the one platform this repository ships, so a consumer compiles against a usable id set on its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A provider registers one connector:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import type { ChatChannelConfig, ChatClient } from '@deepseek-ai/dsh-channel'

declare const ctx: Context
declare const Config: Schema<{ readonly appSecretRef: string }>
declare const MyClient: new (section: ChatChannelConfig) => ChatClient

ctx.chatChannels.register({
  channel: 'tuitui',
  capabilities: { quoting: false, inbound: { images: false, files: false }, outbound: { images: false, files: false }, markdown: true },
  settings: { namespace: 'chat-channel-tuitui', schema: Config, credentialFields: ['appSecretRef'] },
  createClient: async section => new MyClient(section),
  connect: async (section, handlers) => {
    await new MyClient(section).checkCredentials()
    handlers.onReady?.()
    return { close: () => {} }
  },
})
```

`register` returns the disposer; registration is effect-scoped to the calling plugin, so unloading that plugin unregisters the connector. A second registration of the same channel throws rather than silently replacing the first.

A consumer reads `list()` or `get(channel)` and drives connectors through the same two methods the bridge uses.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` is the whole vocabulary and contains no runtime code, so a provider's schema declaration and a consumer's wire declaration read one module without loading Host runtime. It also augments `MessageSourceMap` with the `channel` source: an admitted prompt names its platform, conversation, conversation kind, and platform message id, which is what tells the model where its input came from and what lets the bridge derive its durable dedupe watermark from the Session log.

`src/errors.ts` is the one place a channel failure is classified. A connector throws a typed refusal — `ChatMediaTooLargeError`, `ChatFormatRejectedError`, `ChatUnsupportedError`, `ChatPermissionError`, `ChatConfigError` — and `chatErrorKind(error, site)` decides whether that is the system working as designed or something a human must see. Classification is by class at a named catch site, never by matching message text, because a platform's prose changes without notice while the class it throws is a declared contract. `ChatPermissionError` is `expected` only at the sites that tell the chat about it, because a refusal caught anywhere else leaves the conversation hearing nothing.

`src/index.ts` is the registry. It is a `Map` keyed by `ChatChannelId` rather than a list, so a duplicate registration is a refusal rather than a shadowed entry.

Media crosses as a handle rather than bytes for one reason: the byte cap rides into the transfer, so an oversized attachment is refused at the byte that crosses the limit instead of being buffered whole and measured afterwards. `ChatChannelCapabilities` declares the platform's ceilings so the bridge clamps to them, and declares the attachment directions so the bridge never calls an operation the platform cannot perform.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-channel-bridge`, which admits prompts and therefore owns every model-visible field this seam declares.

#### KV Cache effect

No direct invalidation; the admitting bridge owns any request-prefix change.

## Known Limitations and Deferred Work

- **No bindings persistence** — a channel's configuration is one `dsh-settings` namespace and its durable dedupe and chat-lock state is the bound Session's log; this package stores neither and has no table of its own.
- **No inbound transfer** — the seam declares lazy handles and never performs a transfer, so it cannot enforce a total byte budget across one message's attachments.
- **No quoting fallback** — `capabilities.quoting` is a single boolean for a platform whose quoting may vary per conversation, so a connector that can quote in some conversations declares the conservative value.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the registry's only owned relation is duplicate rejection, which its own suite pins.

</details>

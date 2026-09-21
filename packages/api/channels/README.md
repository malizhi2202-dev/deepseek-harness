---
description: "The channels Remote namespace for client consumers reading channel status, and for maintainers of the host endpoint and its enable/disable binding."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-channels

English | [中文](README.zh.md)

## Summary

`dsh-api-channels` owns the `channels` Remote namespace: `status` reads every registered channel, `probe` tests one channel's credentials by building a client, and `enable`/`disable` move one binding. It is the panel's only way to reach the [bridge](../../channel/channel-bridge/README.md), and it holds no state of its own — every answer is read from the bridge and the credential seam at call time.

Credential references cross as names and presence only. A channel's configuration names a `dsh-credentials` reference; this endpoint reports whether something is stored behind it, never what.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Client code calls the namespace through the Remote carrier the [dsh-api-remotes](../remotes/README.md) client assembly already mounts; no plugin loads this package in the browser directly. Failures cross the wire as two declared codes: `channels/unknown` when the named channel is not registered, and `channels/failed` when an operation that ran failed, whose message names what to fix.

Host compositions mount the package beside `ctx.chatBridge`, `ctx.credentials`, `ctx.settings`, and `ctx.typert`; it injects exactly those.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` re-exports `ChatChannelCapabilities` from [`dsh-channel`](../../channel/channel/README.md) rather than restating it, so the panel's declaration and the connector's declaration are one type, and declares the two error codes in the protocol's details map. `ChannelView` carries the binding, the connection state, the last error with its time, the chat lock, the reply budget, and the capability set — everything the panel shows, in one read.

`src/index.ts` is the endpoint. `status` settles the registry first by calling `ctx.chatBridge.sync()`, because a connector that registered a moment ago is otherwise invisible to a panel that asks once. `probe` builds a client with the configured credentials and answers `ok: false` with the reason rather than refusing, because "the credentials are wrong" is exactly what the panel exists to show. `enable` refuses a second channel for one Session through the bridge's mutual-exclusion rule rather than storing a second binding.

The namespace carries status as a Remote method, not a resource: a resource is a current-value stream, and the panel reads once when it opens and once after each command.

<a id="model-experience"></a>
## Model Experience

None, as the endpoint registers no tool, session event, or request input, and a channel reaches the model only as the `source` the bridge admitted.

#### KV Cache effect

No direct invalidation; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **No channel-list enumeration for the panel's benefit** — the answer is whatever the bridge has bound; an unregistered channel is not reported as absent but refused as unknown when named.
- **Probe proves only that a client can be built** — a credential that resolves and a host that rejects it are both `ok: true`, because the connector's own probe does not open the transport.
- **No configuration write path** — the namespace moves a binding and reads status; editing a channel's fields is the settings namespace's own Remote endpoint.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the endpoint is a thin delegation whose refusal mapping is pinned by its own suite against a scripted bridge.

</details>

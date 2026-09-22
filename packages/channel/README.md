---
description: "Package map for the chat-channel capability family: the connector seam, the shared bridge, the Tuitui provider, and the panel endpoint."
kind: "package-group"
---

# channel/ — chat platforms as a Session driver

English | [中文](README.zh.md)

## Summary

The `channel/` group lets a chat platform drive an Agent Session and mirror that Session's completed replies back into the conversation. `channel` is the Service Definition: the connector registry, one normalized inbound message carrying lazy media handles, and the outbound client a provider implements. `channel-bridge` is the Consumer every platform shares, and it owns the decisions that must be identical everywhere — deduplication, the chat lock, admission through the Agent registry, outbound relay, and which reply files may leave the workspace. Each provider adapts one platform: `channel-tuitui` over the transport this repository already ships, `channel-feishu` over the official Feishu SDK, `channel-dingtalk` over the official DingTalk Stream SDK, `channel-qq` over the official QQ bot open-platform API, and `channel-wechat` over the official WeChat bot channel protocol. `api-channels` exposes status and the enable/disable binding over Typert Remote.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`channel/`](channel/README.md) | Connector registry, the channel configuration and capability declarations, and the normalized message/client contracts. | `ctx.chatChannels` |
| [`channel-bridge/`](channel-bridge/README.md) | Binds connectors to Sessions, admits inbound messages, relays completed replies, and delivers reply files. | `ctx.chatBridge` |
| [`channel-tuitui/`](channel-tuitui/README.md) | Tuitui (推推) provider over the existing transport. | consumes `ctx.chatChannels`, `ctx.credentials` |
| [`channel-feishu/`](channel-feishu/README.md) | Feishu (飞书) and Lark provider over the official `@larksuiteoapi/node-sdk`. | consumes `ctx.chatChannels`, `ctx.credentials` |
| [`channel-dingtalk/`](channel-dingtalk/README.md) | DingTalk (钉钉) provider over the official `dingtalk-stream` SDK. | consumes `ctx.chatChannels`, `ctx.credentials` |
| [`channel-qq/`](channel-qq/README.md) | QQ provider over the official QQ bot open-platform API. | consumes `ctx.chatChannels`, `ctx.credentials` |
| [`channel-wechat/`](channel-wechat/README.md) | WeChat (微信) provider over the official WeChat bot channel protocol. | consumes `ctx.chatChannels`, `ctx.credentials` |
| [`api-channels/`](../api/channels/README.md) | Remote endpoint reporting channel status and moving one binding. | `ctx.channels` / `ctx.remote.channels` |

<a id="related-documentation"></a>
## Related documentation

The [chat-channel subsystem reference](../../docs/subsystems/channel.md) owns the shared types and the rules the bridge enforces. A provider that re-implemented deduplication, the chat lock, or reply-file filtering would be a second place for them to be wrong, so the seam deliberately keeps them out of the connector contract.

<a id="dev-note"></a>
## Dev Note

None.

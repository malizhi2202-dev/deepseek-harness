---
description: "The platform-neutral chat-channel bridge for operators binding a channel to a Session and for maintainers of its dedupe, chat-lock, admission, and reply-file rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-bridge

English | [中文](README.zh.md)

## Summary

`dsh-channel-bridge` is the Consumer half of the chat-channel seam: everything about driving an Agent Session from a chat platform that is not specific to a platform. It binds each registered connector to one Session through that channel's `dsh-settings` namespace, deduplicates what arrives, admits it as an ordinary user turn, and relays the Session's completed replies and the files its turns wrote back into the conversation.

Three of its decisions are security properties rather than conveniences. The **chat lock** makes the conversation that first spoke the only one this channel answers. The **reply-file filter** delivers only files a reply named *and* that turn wrote *and* that live inside the Session workspace. **Deduplication** runs before admission, and its durable record is the admitted message's own session event, so a platform replay cannot become a second run.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The plugin mounts itself; it needs no cordis.yml `config` beyond the bounds below, and it injects `agents`, `attachments`, `chatChannels`, `fs`, `sandboxPolicy`, and `settings`.

| Field | Default | Meaning |
|---|---|---|
| `chunkChars` | `4000` | Characters per outbound message; clamped further by the platform's own `maxTextChars`. |
| `dedupeSize` | `64` | Recently processed inbound ids one binding remembers beyond its durable watermark. |
| `maxReplyFiles` | `5` | Files one reply may deliver; the remainder is counted in a notice. |
| `mtimeGraceMs` | `2000` | How far before a turn's start a file may have been written and still count as that turn's output. |
| `maxInboundFileBytes` | `31457280` | Largest inbound attachment transferred into the Session. |
| `maxOutboundFileBytes` | `31457280` | Largest outbound file read out of the Session workspace. |

Each channel's own settings namespace, `chat-channel-<channel>`, carries `enabled`, `sessionId`, `markdown`, and `finalReplyOnly` composed around the connector's fields. `enable(channel, sessionId)` and `disable(channel)` are the only ways to move a binding; the Remote endpoint in [dsh-api-channels](../../api/channels/README.md) is the panel's caller.

<a id="understand-the-implementation"></a>
## Understand the implementation

**Deduplication.** A platform redelivers after a reconnect and nothing downstream is idempotent, so the check runs before admission. `RecentInboundIds` is a bounded ring seeded from the Session log, and `channelLogMemory` derives the durable watermark from the newest channel-sourced `user/message` event in that log — no second persistence domain, because the admitted message already is the authoritative record. The ring entry is written when admission begins and released again if the message is refused, so a message the chat was told about is not silently dropped on redelivery.

**The chat lock.** `channelLogMemory` also reads the *oldest* channel-sourced `user/message` event, whose source names the conversation that first spoke. A message from any other conversation is dropped before admission: it reaches no Agent and earns no reply. The lock lives in the Session log rather than in this package, so it survives a restart.

**Admission.** The bridge builds content blocks — text, then images, then files — transfers each attachment under a cap, and calls `agent.followup(createUserMessage(...))`. That is the `queueIfBusy` semantics the seam needs: an ordinary follow-up turn that wakes the driver, queued behind whatever is running rather than refused. The prompt's source is `{ kind: 'channel', channel, chatId, chatKind, messageId, senderName? }`, so the model learns where its input came from and the watermark stays derivable.

**Outbound relay.** Only completed `assistant/message` text of a turn this bridge admitted reaches the chat. Every send and notice for one Session is serialized on a single promise tail, so an approval notice cannot land in the middle of a reply. Text is chunked to the tighter of `chunkChars` and the platform's `maxTextChars`, capped at the platform's `replyBudget` by combining the tail rather than dropping it, and resent once as plain text when the platform refuses the rendered form. A group reply quotes the round's inbound message exactly once, and only when the connector declares `quoting`.

**Reply files.** A delivered file must be named by the reply *and* written by the turn. `replyFileMentions` extracts path-shaped candidates, `ctx.fs.resolve` plus `ctx.fs.contains` confine each to the Session workspace, and a host `stat` requires a modification time at or after the turn's start minus `mtimeGraceMs`. Naming a path proves nothing on its own, so a reply talked into naming a file outside the workspace delivers nothing; a name this filter rejected is logged, because that is exactly the read-primitive attempt worth seeing.

<a id="model-experience"></a>
## Model Experience

### Chat turn

#### What the model sees

Each admitted chat message becomes one user turn. Its content is a `text` block carrying the message text, followed by one `image` block per inbound image and one `file` block per inbound file, each holding a durable attachment reference. Its source is `source.kind: "channel"` with `channel`, `chatId`, `chatKind`, `messageId`, and an optional `senderName` — the platform, the conversation, whether that conversation is direct or a group, the platform's own message identity, and the sender's display name when the platform reports one. An attachment the bridge could not transfer is replaced by a bilingual notice sent to the chat, not by a placeholder in the prompt, so the model sees only the blocks that exist.

#### Token effect

The message text and its `channel` source metadata are logged to the Session and re-included on every later request according to the preset's compaction behavior. Images and files become provider-native content blocks sized by the attachment service and the provider adapter, not by this package. Nothing here adds framing, guidance, or system-prompt text.

#### KV Cache effect

Append-only. The source metadata is per-message, and this package contributes no stable prefix of its own, so prefix reuse behaves exactly as it does for any other user turn under the same preset. A notice sent to the chat is not part of the request and cannot invalidate reuse.

## Known Limitations and Deferred Work

- **The chat lock never moves** — the first conversation to speak owns the channel for the life of that binding; rebinding to another conversation requires clearing the bound Session's log or binding a different Session.
- **A channel that cannot carry files delivers none, silently** — `capabilities.outbound.files: false` skips reply-file delivery entirely; the configuration panel states the limit, and the chat hears nothing about the files it will not receive.
- **`mtimeGraceMs` is the only freshness signal** — a turn that rewrites a pre-existing file within the grace window delivers the rewritten file, and a turn that writes nothing but names a file another process touched inside the window delivers that file.
- **The mtime is read through the host filesystem** — containment and bytes come from the filesystem seam, but the modification time comes from a host `stat` of the resolved path, so a backend whose workspace is not on the host cannot apply the freshness filter.
- **No message editing or reaction** — the relay only sends new text and files; a platform's edit-in-place, reaction, and interactive-card operations are outside this seam.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the security properties are enforced in the operations that make them and are pinned by this package's own suite against a connector stub.

</details>

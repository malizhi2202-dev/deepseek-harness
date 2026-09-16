---
description: "Tuitui (推推) IM bridge that drives DeepSeek Harness agent sessions from chat messages."
kind: "package-reference"
---

# @deepseek-ai/dsh-tuitui

English | [中文](README.zh.md)

## Summary

`dsh-tuitui` connects one Tuitui (推推) robot to DeepSeek Harness agent sessions. Inbound chat messages (`single_chat`, `group_chat`, and team posts) become `Agent.followup()` user turns; the assistant's text reply streams back through the Tuitui HTTP send API. Each conversation keeps one Agent session, so follow-up messages continue the same session until `/new` or `/cd` resets it. A `/tree` command opens an in-place-updatable interactive file-tree card for navigating, inspecting, searching, and (with confirmation) renaming, deleting, and copying workspace files.

The robot credentials configure the real WebSocket + HTTP transport; tests inject a stub through the runtime-only `config.transport` seam. Replies accumulate only `assistant/message` `text` blocks (not `reasoning`) and are sent back after `turn/end`; tool calls and results stream through the normal Session without interrupting the chat reply.

## Table of Contents

- [Commands](#commands)
- [Configuration](#configuration)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="commands"></a>
## Commands

The bridge intercepts slash-prefixed chat text before it reaches the agent:

| Command | Effect |
|---|---|
| `/new` | Dispose the current session and start fresh with the next message. |
| `/cd <路径>` | Change the agent working directory and reset the session. |
| `/pwd` | Reply with the current working directory. |
| `/tree [路径]` | Open the interactive file-tree card at the given (or current) directory. |
| `/help` | Reply with the command list and current directory. |
| `/status` | Reply with the directory, session id, and busy state. |

Unknown slash commands fall through to the agent as ordinary text.

<a id="configuration"></a>
## Configuration

All deployment-varying values are `Config` fields changeable from `cordis.yml`.

| Field | Default | Meaning |
|---|---|---|
| `appId` | — (required) | Tuitui application id. |
| `appSecret` | — (required) | Tuitui application secret. |
| `host` | — (required) | Tuitui IM server host (the connection endpoint). |
| `cwd` | process cwd | Agent working directory for new conversations. |
| `agentPreset` | deployment default | Agent preset id; empty uses the default preset. |
| `permissionPreset` | deployment default | Permission preset id; empty uses the default permission preset. |
| `provider` / `model` | deployment default | Optional explicit route, as a registered provider id and a model id. Set both or neither: a card that sets neither uses the deployment default, and an id that does not resolve is rejected in the chat, naming the registered providers or the provider's configured models. Each message re-resolves the route, so a saved change reaches chats that already recorded an earlier one without restarting them. |
| `allowFrom` | `[]` | DM accounts allowed to use the bot; `"*"` allows all. |
| `groupAllowFrom` | `[]` | Group/team ids allowed; `"*"` allows all. |
| `requireMention` | `true` | Require an @-mention in groups and channels. |
| `emojiReaction` | `true` | React to inbound messages. |
| `reactionEmoji` | `收到` | Reaction emoji text. |
| `showThinking` | `true` | Send a "thinking" placeholder before the first reply chunk. |
| `dataDir` | `~/.dsh-tuitui` | Directory for persisted per-chat cwd and tree cards. |
| `treeEnabled` | `true` | Enable the `/tree` workbench. |
| `treePageSize` | `5` | Entries per tree page. |
| `treeShowHidden` | `false` | Include dotfiles in listings. |
| `treeIgnore` | built-in defaults | Extra names hidden from listings. |
| `treeAllowWrite` | `true` | Allow rename/delete/copy (always confirmed). |
| `treePersist` | `true` | Persist tree-card bindings across restarts. |

With no `appId`/`appSecret`/`host` the plugin still loads and serves its settings namespace, but keeps the bridge stopped until all three are set (the GUI card collects them). A non-directory `cwd` fails loudly at load.

Every field above is also editable in the Web GUI: **Settings → Plugins → Plugin configuration** lists a Tuitui card bound to the live `tuitui` settings namespace, so the running robot is reconfigured without a redeploy. `appSecret` is a `role('secret')` field — redacted by the Host on `describe` and written through a settings path-op that never reads it back, so the card reports only whether one is configured.

<a id="composition"></a>

## Composition

The plugin is a function plugin (`name` / `inject` / `Config` / `apply`) and injects `agents`, `agentDefaultModel`, `agentPresets`, `llm`, and `permissionPresets`. It is not added to any shipped default profile; wire it into a `cordis.yml` after Agents, presets, and permission presets are mounted:

```yaml
- name: '@deepseek-ai/dsh-tuitui'
  config:
    appId: '…'
    appSecret: '…'
    allowFrom: ['*']
    groupAllowFrom: ['*']
```

The runtime-only `transport` field is not part of the `Config` schema; it exists so the composition test can inject a stub in place of the real WebSocket + HTTP client.

<a id="model-experience"></a>

## Model Experience

### Chat turn

#### What the model sees

Each inbound chat message becomes one user turn with content `[{ type: "text", text: <message> }]` and `source.kind: "tuitui"`, carrying `chatId`, `chatType`, `senderId`, and `senderName`. Non-text media (images, voice, video, files) are replaced by a descriptive text placeholder plus media URL, in the message text, so the model never receives the binary content.

#### Token effect

The chat text and the `tuitui` source metadata are logged to the Session; no extra framing or system-prompt text is added by the bridge. Multi-turn conversations accumulate on the same Session, so each follow-up re-includes the prior history according to the preset's compaction behavior.

#### KV Cache effect

None introduced by the bridge: the system prompt, tool schemas, and model prefix come from the reused preset. The bridge only appends per-turn user content and `tuitui` source metadata to the Session, so prefix behavior matches a normal Web session under the same preset.

## Known Limitations and Deferred Work

- Sessions are in-memory: a DSH restart drops conversation continuity (the per-chat cwd and tree cards persist, but the Session does not). Resuming via session persistence is deferred.
- A chat Session never prompts for approval, because an IM chat has no interactive answerer: a sandbox escalation is rejected deterministically and the model continues without it. A deployment that wants the chat to have wider access sets `permissionPreset` to a preset carrying that sandbox mode.
- `ask_user_question` is not bridged: a Session whose preset mounts `tool-ask-user` can hold a turn open waiting for an answer no chat participant can give, leaving the chat busy. Bridging questions to chat replies is deferred.
- AI fallback intent parsing is not ported: tree text that matches no deterministic rule shows the hint view instead of asking a model.
- Interactive cards are not delivered to `teams_` channel scopes by the Tuitui API, so `/tree` replies with a send-failure notice there.
- The reference bridge's per-run `/status` history turn count and AI `/tree` text routing are not reproduced.

The wire parsing (`parseEvent`, `parseInteractiveCallback`, `splitMessage`, `guessChatType`) and the file-tree workbench are ports of `tui_coding_agent_bridge`; the divergences above are the only behavioral differences.

**Runtime invariant:** No companion is published: this bridge owns no independently observable package-local relation beyond the Loader-composition test and the transport seam's decode rules, which the unit tests cover.
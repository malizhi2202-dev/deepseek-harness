# Agent Note: Tuitui IM bridge drives DeepSeek Harness agent sessions

Status: implemented

English | [中文](2026-09-16-tuitui-im-bridge.zh.md)

## Problem

A reference prototype — `tui_coding_agent_bridge` — lets a Tuitui (推推) robot drive coding agents, but it does so by spawning external `codex`/`claude` CLI subprocesses. That bypasses DeepSeek Harness entirely: the harness's own Agent sessions, preset composition, permission presets, session log, and tooling cannot be reached from a chat message. The goal is "通过推推的对话控制可以控制 dsh 对话" — control DSH conversations from Tuitui chat — with the same session the Web GUI drives, not a separate CLI.

## Decision

Ship a new function plugin, `@deepseek-ai/dsh-tuitui` (`packages/tuitui/tuitui`), that bridges one Tuitui robot to harness Agent sessions.

**Plugin surface.** A function plugin (`name` / `inject` / `Config` / `apply`, no default export) injecting `agents`, `agentPresets`, and `permissionPresets`. It is not added to any shipped default; it is wired into a profile `cordis.yml` after Agents and presets are mounted.

**Session driving.** Inbound `single_chat`, `group_chat`, and team-post events become `Agent.followup(createUserMessage(...))` turns with a `tuitui` `MessageSourceMap` entry (`chatId`, `chatType`, `senderId`, `senderName`). Each chat maps to one Agent session created via `ctx.agents.create` with `meta.cwd` and the default preset (resolved through `ctx.agentPresets.resolve(undefined)` when no `agentPreset` is configured), then `ctx.agentPresets.mount(agentCtx, preset.id)` and `ctx.permissionPresets.set`. The reply path subscribes to `session/event`, correlates by `session.header.id`, collects only `assistant/message` `text` blocks, and sends the accumulated text after the matching `turn/end`. Before follow-up it sets a single-flight busy guard and records `awaitingTurnStart`/`activeTurn` to match the turn that that message starts.

**Transport seam.** The real wire transport is `TuituiClient` — WebSocket receiver (`wss://{host}:8282/robot/callback/ws?auth={app_id}.{app_secret}`) with reconnect, ACK, and event-id dedup, plus HTTP sender (`POST https://{host}:8282/robot{path}?appid=&secret=`). The plugin consumes it through the runtime-only `tuitui` interface, and `config.transport` (not part of `Config`) lets the real-composition test substitute a stub.

**Slash commands and `/tree`.** Slash-prefixed text is intercepted before the agent: `/new`, `/help`, `/status`, `/cd`, `/pwd`, and `/tree`. `/tree` opens an in-place-updatable interactive file-tree card — a port of the reference `workspace.py` — for listing (paginated), focusing files, searching, and (behind a confirm view) copy/rename/delete and `set_cwd` (which resets the session and persists the per-chat cwd). Card state persists to `dataDir` (`tree_cards.json` and `workspaces.json`) when `treePersist` is on.

**Security and configuration.** `appId`/`appSecret` are required `Config` fields that fail loud at load; credentials stay out of source. `allowFrom` / `groupAllowFrom` gate senders (`*` means open), `requireMention` gates group/channel mentions, and `emojiReaction` reacts with `reactionEmoji`. `cwd` is validated as an existing directory at load. `permissionPreset` empty resolves to the permission default; `provider`+`model` both set routes an explicit `agentOptions` — otherwise the shared default preset applies. The plugin also registers a live `tuitui` settings namespace and a Web GUI card (`ui-settings-plugins`) under **Settings → Plugins → Plugin configuration**, so every field above is editable at runtime; `appSecret` is a `role('secret')` field redacted on `describe` and written through a settings path-op that never reads it back.

## Alternatives considered

- **Spawn `codex`/`claude` CLI like the reference** — rejected: it reproduces the reference's subprocess coupling and leaves DSH sessions, permissions, and the session log unreachable, which defeats the stated goal.
- **Build the transport as a plain `pluggable` service consumed by a thin plugin** — rejected: only one real consumer exists (the bridge), so a runtime-only transport interface with a stub for tests is the smaller surface until a second consumer appears.
- **Defer the `/tree` workbench** — rejected by the product decision: the interactive file-tree card was in scope from the start (chosen over deferral).
- **Session resume across restart via durable Session persistence** — deferred, not rejected: current `ChatSession`s are in-memory, so a DSH restart drops conversation continuity while cwd and tree cards persist; resuming is recorded as a Known Limitation.
- **AI fallback intent parsing** — deferred: tree text matching no deterministic rule stays on the hint view rather than asking a model, mirroring only the deterministic subset of the reference parser.

## Consequences

**Bought.** Tuitui chat drives the harness's own Agent sessions end-to-end — preset and permission composition still apply, everything is reconstructable from the normal session log, and one movable transport seam keeps the real WebSocket/HTTP client testable without a live robot. The full interactive file-tree workbench shipped with confirmation for destructive operations.

**Cost.** Conversation state is in-memory (dropped on restart); interactive cards are not deliverable to `teams_` channel scopes by the Tuitui API (so `/tree` there sends a failure notice); the AI fallback parser and the reference's per-run `/status` history count are not ported. Wire parsing and the file tree are ports of `tui_coding_agent_bridge` with the divergences listed in the package README's Known Limitations section.
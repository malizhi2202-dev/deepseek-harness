# Agent Note: Tuitui 推推桥驱动 DeepSeek Harness 的 Agent 会话

Status: implemented

[English](2026-09-16-tuitui-im-bridge.md) | 中文

## 问题

一个参考原型 `tui_coding_agent_bridge` 让 Tuitui（推推）机器人能够驱动编码智能体，但它的做法是拉起外部的 `codex`/`claude` CLI 子进程。这完全绕过了 DeepSeek Harness：Harness 自身的 Agent 会话、预设（preset）组合、权限预设、会话日志和工具都无法从聊天消息触达。目标是"通过推推的对话控制可以控制 dsh 对话"——用与 Web GUI 相同的会话从 Tuitui 聊天控制 DSH，而不是另起一个 CLI。

## Decision

交付一个新的函数插件 `@deepseek-ai/dsh-tuitui`（`packages/tuitui/tuitui`），把一台 Tuitui 机器人桥接到 Harness 的 Agent 会话。

**插件形态。** 一个函数插件（`name` / `inject` / `Config` / `apply`，无默认导出），注入 `agents`、`agentPresets` 和 `permissionPresets`。它不加入任何内置默认；而是在 Agents 和预设挂载之后，在 profile 的 `cordis.yml` 中接线。

**会话驱动。** 入站 `single_chat`、`group_chat` 和团队帖子事件变成 `Agent.followup(createUserMessage(...))` 用户回合，并带一个 `tuitui` 的 `MessageSourceMap` 条目（`chatId`、`chatType`、`senderId`、`senderName`）。每个聊天映射到一个 Agent 会话：通过 `ctx.agents.create` 创建，携带 `meta.cwd` 和默认预设（未配置 `agentPreset` 时用 `ctx.agentPresets.resolve(undefined)` 解析），然后 `ctx.agentPresets.mount(agentCtx, preset.id)` 并调用 `ctx.permissionPresets.set`。回复路径订阅 `session/event`，按 `session.header.id` 关联，只收集 `assistant/message` 的 `text` 块，并在匹配的 `turn/end` 之后把累积文本发回。在 followup 之前，它会设置单飞行（single-flight）忙碌守卫，并记录 `awaitingTurnStart`/`activeTurn`，以匹配这条消息所启动的那个回合。

**传输接缝。** 真实线协议传输是 `TuituiClient`——WebSocket 接收端（`wss://{host}:8282/robot/callback/ws?auth={app_id}.{app_secret}`），带重连、ACK 和事件 ID 去重，另有 HTTP 发送端（`POST https://{host}:8282/robot{path}?appid=&secret=`）。插件通过仅运行时的 `tuitui` 接口消费它，而 `config.transport`（不属于 `Config`）让真实组合测试能够替换成桩。

**斜杠命令与 `/tree`。** 斜杠前缀文本在进入 agent 之前被拦截：`/new`、`/help`、`/status`、`/cd`、`/pwd`、`/tree`。`/tree` 打开一张可原地更新的交互式文件树卡片——这是参考 `workspace.py` 的移植——用于（分页）列出目录、聚焦文件、搜索，以及（在确认视图之后）复制/重命名/删除和 `set_cwd`（重置会话并持久化每个聊天的工作目录）。当 `treePersist` 打开时，卡片状态持久化到 `dataDir`（`tree_cards.json` 与 `workspaces.json`）。

**安全与配置。** `appId`/`appSecret` 是必需的 `Config` 字段，加载时失败即报错（fail loud）；凭据不进源码。`allowFrom` / `groupAllowFrom` 控制发信人（`*` 表示开放），`requireMention` 控制群/频道提及，`emojiReaction` 用 `reactionEmoji` 回应。`cwd` 在加载时校验为已存在的目录。`permissionPreset` 为空解析为权限默认值；`provider`+`model` 都设置时走显式 `agentOptions`——否则沿用共享的默认预设。插件还注册一个实时 `tuitui` settings 命名空间与一张 Web GUI 卡片（`ui-settings-plugins`），位于**设置 → 插件 → 插件配置**，因此上述每个字段都可在运行时编辑；`appSecret` 是 `role('secret')` 字段，在 `describe` 时脱敏，并经从不读回的 settings path-op 写入。

## Alternatives considered

- **像参考实现那样拉起 `codex`/`claude` CLI** —— 否决：它复刻了参考实现的子进程耦合，让 DSH 的会话、权限和会话日志不可触达，违背既定目标。
- **把传输做成普通 `pluggable` 服务，再由薄插件消费** —— 否决：目前只有一个真实消费者（桥），所以一个仅运行时的传输接口配合测试桩是更小的表面积，直到出现第二个消费者为止。
- **推迟 `/tree` 工作台** —— 被产品决策否决：交互式文件树卡片从一开始就在范围内（选择保留而非推迟）。
- **通过持久化会话实现跨重启恢复** —— 推迟而非否决：当前的 `ChatSession` 是内存态，DSH 重启会丢失对话连续性，而工作目录和树卡片仍会持久化；恢复被记录为已知限制。
- **AI 兜底意图解析** —— 推迟：不匹配任何确定性规则的树文本停留在提示视图，而不会询问模型，只复刻参考解析器的确定性子集。

## Consequences

**所得。** Tuitui 聊天端到端驱动 Harness 自身的 Agent 会话——预设与权限组合仍然生效，一切都可从常规会话日志重建，且一个可替换的传输接缝让真实 WebSocket/HTTP 客户端无需真实机器人即可测试。完整的交互式文件树工作台已交付，破坏性操作带确认。

**代价。** 会话状态在内存中（重启即丢失）；Tuitui API 无法把交互卡片投递到 `teams_` 频道作用域（因此那里的 `/tree` 只发一条失败通知）；AI 兜底解析器和参考实现里 `status` 的每次运行历史回合数并未移植。线协议解析和文件树是 `tui_coding_agent_bridge` 的移植，差异列在包 README 的 Known Limitations 一节。
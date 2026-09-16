# Agent Note：把 tuitui 卡片的模型路由应用到已恢复的 Session

Status: implemented

[English](2026-09-16-tuitui-route-validation-and-resumed-session.md) | 中文

## 问题

tuitui 设置卡片把 `provider` 与 `model` 作为自由文本，而 bridge 只把它们当作传给 `ctx.agents.create` 的路由信号。由此产生三类故障。

两个字段都不填的卡片会得到 `agentOptions: {}`，于是 `context.agent.options.model` 保持 undefined，系统提示词装配在含 `{{model}}` 的部署 `personaPrefix` 上失败，报 `prompt variable "{{model}}" has no value for this assembly`。填入 provider 显示名（`360`，对应已注册路由 `deepseek360`）的卡片会打开一个每次请求都失败的 Session，报 `no adapter registered for provider "360"`；填入 model 显示名（`deepseek-v4.1-flash-360`，对应 id `deepseek/deepseek-v4.1-flash`）则在更深一层以同样方式失败。改正卡片也没有帮助，因为 Session 会保留其 `request/header` 中记录的路由：以聊天固定 `sessionId` 调用 `ctx.agents.create` 会恢复已持久化的 Session，此时创建期选项不再决定路由，那次失败便在每条消息上重现。

## 决策

`TuituiBridge` 为每个聊天保存一个 `ModelSelectionRef`，并在 bridge 本就拥有的 Agent `setup` 中通过 `installModelSelection`（`@deepseek-ai/dsh-agent`）安装它。该 helper 无条件覆盖 `agent/request`，并把 `provider`/`model` 注入 `system-prompt/assemble`，因此已恢复的 Session 会按 bridge 的指定路由，`{{model}}` 也始终可解析。

`handleAgentMessage` 在每条消息上通过 `resolveAgentOptions()` 重新解析路由，并在该轮之前写入 `chat.selection.current`。卡片两个字段都不填时，`resolveAgentOptions()` 取 `ctx.agentDefaultModel.currentSelection()`；只填其中一个时拒绝；否则用 `ctx.llm.listProviders()` 校验 provider、用 `ctx.llm.listModels(provider)` 校验 model——即 `llm-pi-ai` 解析请求所用的同一份目录——并在取值等于某个已注册显示名时给出对应 id。目录无法列举的路由交给请求本身处理。拒绝信息通过既有的 `[错误]` 路径回复到聊天；此前该错误从 `getOrCreateChat` 逃逸成 unhandled rejection，聊天里看不到。

## 考虑过的替代方案

**路由变化时丢弃内存中的聊天会话。** 先试过，但不可行：下一条消息会以同一 `sessionId` 重建 Agent，从而恢复同一个 Session、也就恢复同一条已记录路由。它还会白白丢掉单聊历史。

**为每个路由分配独立 `sessionId`，让路由变化开启全新 Session。** 效果上正确，但它会让每个聊天的历史分叉、留下被取代的 Session 文件，并把模型变更当作新对话，而 Web GUI 是在原地切换模型。

**完全照搬 webhook ingress：创建期 `agentOptions` 加一个「存在持久化请求头后即让位」的 `agent/request` waterfall。** webhook 每次投递都新建 `webhook-<uuid>` Session，因此永不恢复；一个聊天保持单一 Session 的 bridge 需要该覆盖保持权威。

**只校验 provider。** 仅靠部署默认回退即可修复 `{{model}}` 故障，但 provider 只有一个显示名，而每个 model 各有一个，因此显示名错误出现在 `model` 的概率高得多。

## 后果

保存了无法解析路由的卡片会在聊天中失败，并列出已注册的 provider 或该 provider 已配置的 model；当取值是显示名时给出对应 id。两个字段都留空成为一等选择，会在每条消息上跟随部署默认。

保存的路由变更会在下一条消息上到达每个活动聊天，且历史完整保留；`installModelSelection` 会追加其持久化的 `[model changed: …]` 通知，使记录保留切换发生的位置。路由按消息解析与校验，代价是每轮一次内存中的目录查询。

`packages/tuitui/tuitui/tests/loader-composition.spec.ts` 通过真实 Loader 覆盖部署默认路由、未注册 provider、以及 model 显示名；`packages/tuitui/tuitui/tests/settings.spec.ts` 驱动一次设置变更，断言既有 Session 的装配变量切到新 model，且不发生第二次 `agents.create`。

# N2 ③ 结论与建议

**结论：按钮与命令不是两种实现，而是同一条命令的两种呈现。** 但落成规则时是**两条**，不是一个：

- **规则一（位置）**：**按钮属于锚定它事实的那个面板**。这不是新发明 —— 既有架构决议原文：**"A type's controls — a reload, a wrap toggle — live inside its own body; the strip belongs to the panel and carries only the panel's controls."**（`.agents/notes/implemented/architecture/2026-09-05-sidebar-tab-types-and-navigation.md:45`），且 `sidebar.right.tab.menu.item` 是真实存在的 list 座位，注释写明它 "for actions that mean something about **the tab's content**"（`packages/client/ui-sidebar-right/src/client/contract/slots.ts:17`，渲染于 `shell/SidebarRight.tsx:315`）。
- **规则二（可枚举/可审计）**：改状态的动作必须能被 `commands.list` 找到并落 `command/run`+`command/done`。**决定性变量 = "这个动作是否需要在它所在面板之外被枚举或审计"**；若需要 → 走命令路径；若只在本面板内有意义 → 面板按钮 + 必须落一条域事件（否则记为一个**具名例外**）。

**订正一处此前说法**：`{ matched: boolean }` 的"三态不可分"**只对 `SessionFace.command()` 成立**（`api/session-controller/src/client/contract/session.ts:140` → `sessions/session.ts:372-376`，被 `client/ui-conversation/src/client/apply.ts:373-378` 压成裸 bool）。`ui-commands` 实走的 `remote.commands.execute` **本来就可分辨**：throw 带 `error.code`/`message`，`undefined` = 命令名或语法没解析，handler 抛错会 re-throw（`client/ui-commands/src/client/service.ts:343-354`；宿主侧 `interaction/commands/src/index.ts:356-425`）。⇒ **真正的缺口不是"分不清"，而是"分辨之后没有落点"**；而按钮路径（如 `cancel()` 只回 `{accepted:true}`）**根本没有可分辨协议**。

**反例先例（必须在实现时处理）**：`client/ui-goal/src/client/index.ts:90-105` 的按钮直接调 `remote.goals.*`，只落 `goal/change`（`goal/goal/src/domain.ts:20-36`）**且不带 actor** ⇒ 人点击与工具触发**不可分辨**。

**首发阶梯（已采纳）**：`preset → turn → job`。其中 **turn/job 属"这个动作需要在面板之外被枚举/审计吗"的判定对象**；且文档称 `/permission` 是 **"the one write path a web client uses"**（`permission-presets/src/index.ts:252-254`）⇒ **新增第二条客户端写路径必须独立记一笔决策**。

**上线前必须定义**：动作的**声明式可用性谓词**（本地决定隐藏 vs 置灰，而不是调用后拿到 falsy）；动作是否**必须**出现在 `commands.list` 与按钮/命令同名冲突规则（既有 fail-loud：`packages/client/ui-commands/src/client/service.ts:199-201`）；**新动作面**的失败协议（三态 + 日志落点，禁止 falsy reply）；未落事件的行动是否允许存在（建议加 gate）；stop/cancel 的**幂等与"无事可做"语义**。

# N1 ③ 结论与建议

**结论：产品里不存在、也不应新增"人类主体"；三层模型原样够用。**

**三层（已采纳）**：连接主体（浏览器 Cookie = 安全边界）→ 会话主体（`Agent` = 一切 owner 校验的键）→ 人类（**不是主体**，是唯一能提交命令的人）。动作的作用域永远是 Session。

**承重事实**：
1. 唯一主体类型是 `Agent = { readonly id: SessionId }`（`packages/core/agent/src/types.ts:13-16`）。
2. 人类实际拥有的只有浏览器 Cookie 权威，而产品自己写明它 "never establish identity"（`packages/client/connection/README.md:39`）、"Possession of the browser cookie authorizes the complete tool-capable Host API"（`2026-08-24-browser-token-authentication.md:43`）。
3. **人类主体已经存在于命令路径上，是"构造即主体"**：`CommandInvocation.agent` 的 JSDoc 是 "Exact agent whose UI received the command"（`packages/interaction/commands/src/index.ts:39-45`），而 `CommandSourceMap` 的注释写明它 "minimal because **every executor caller is a human-facing UI surface dispatching a human-typed line, so the sole variant is `user`**"（`packages/interaction/commands/src/types.ts:69-74`）。
4. **job 的 owner 就是启动它的 agent**，所以 `/job-kill <id>` 的 handler 传 `({ agent }) => ctx.jobs.kill(id, agent)` 时，传入的 agent 正是 owner，`assertAccess` 自然通过 —— **无需任何新 caller/主体概念**。
5. `caller?` 的陷阱只在**没有 agent 上下文的面板按钮路径**上：省略 caller 不是跳过检查，而是**最严格**（`caller?.id === undefined` 永不等于 `owner.id`，一律 throw）；全仓只有 teardown 走 `cancelForTeardown` 绕开（`jobs-local/src/index.ts:356-361`、`:510-512`）。
6. **面板的主语必须是"面板所属会话"**（专家团自证并复核）：`list(caller)` 的过滤 `owner === undefined || owner.id === session`（`jobs-local:192-197`）与 `assertAccess` 同语义 —— 命令路径给的是"某个" Agent，fence 要的是"那个" owner；二者在会话归属内重合，但 **subagent 自有的 job（owner = 子会话 SessionId）被有意排除**：人只能停"他打字那个会话拥有的"东西。
7. **审批链里没有人类主体**：`ApprovalRequestEvent` 只带 `agent`（`user-approval/src/types.ts:63-65`），审批事件不记录"谁批的"，面板只回 `allowed-once|rejected`（`client/ui-approval/src/client/ApprovalPanel.tsx:26,45-49`）。

**已采纳的决定**：
- **① 三层模型，不新增主体概念**；两条硬条件：**主体由宿主按"面板所属会话"解析**；**非 loopback 前必须先闭合连接层**。
- **② 能力规则（非风格规则）**：会改会话状态的动作**必须走命令路径** —— 只有该路径在宿主侧产出 owner 身份。面板锚定按钮仅当宿主侧消费者**服务端解析主体、绝不接受客户端声称的 owner** 时才可承载改状态动作。**退路条款**：若将来出现别的宿主侧动作端点，规则重述为更强的不变量 ——「主体必须服务端解析」。
- **③ 反对"在审批里指名人类"**（不可实现，且与 ① 自相矛盾）；一致做法是**给审批结算加同一个来源标量 `{kind:'user'}`**，记录"这不是 agent 发起的"。

**上线前必须定义（未决即不得上线）**：连接层契约（`trustedHosts`、`DSH_WEB_LOCAL_NO_AUTH=1` 在 `browser-auth.ts:120-128`（**在 HEAD 中即为提交状态**）、第二个本地用户、共享 `$DSH_HOME`）；哪些域事件必须带来源（`job/change`、`goal/change`、审批结算）；结果协议的归属与 `SessionFace.command` 准入布尔是否冻结；面板动作是否进 `commands.list` 与命名冲突的 fail-loud 扩展；哪些动作"可授权"、哪些只"可撤销"。

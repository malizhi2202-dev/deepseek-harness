# N1 ① 头脑风暴（动作的主语与权限模型）

依据：`Agent = { readonly id: SessionId }`（`packages/core/agent/src/types.ts:13-16`）是唯一主体类型；`jobs-local/src/index.ts:352-361` 的 owner 栅栏；`user-approval/src/types.ts:63-65` 的 `ApprovalRequestEvent.agent`。

15 个方向，Top 5：
1. ★ **"命令即能力"** —— 每个用户动作表达成 session-scoped host command，主体由 `CommandInvocation.agent`（"Exact agent whose UI received the command"）在宿主侧构造。**零新概念、与现有 seam 同构**。
2. ★ **主体 = 目标 Session**，人类是该 Session 的当前持有者；与 jobs 的 owner 栅栏天然对齐。
3. **修掉 `caller?` 的语义陷阱** —— 让"谁在杀"成为显式事实（本轮结论：不需要新标量，但必须写明命令路径为何安全）。
4. ★ **把"单用户 + loopback"写成启动时 fail-loud 的断言**，破缺即报错。
5. ★ **反向复用 approval**：让 agent 成为可见请求者、人类只给 outcome（本轮被否，见 ③）。

其他：显式承认"无人类主体"并写成决定；引入 `Principal = Human|Agent|System`（**否决**，AGENTS.md「能力缝只在角色独立演化时拆分」且全仓无消费者）；polkit 式 subject/authority 分层（**否决**，已由 `2026-08-24-browser-token-authentication.md:31` 拒绝"用 TCP peer 判特权"）；二次确认/token 代替授权（**否决**，把授权伪装成交互）；只补审计主体不补授权主体；把"人"做成与 `Scoped<Agent>` 并列的一层 scope（**否决**）；先落意图事件再执行；授权绑到已有凭证；把"需授权"降级成"可撤销 + 超时回滚"（**否决**）；复用 permission-presets 当授权档位。

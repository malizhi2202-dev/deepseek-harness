# R2-4 ① 头脑风暴

依据：F24（核心终端能力无 client 半边）、F26（`--trusted-host` 可放宽到非回环 authority）、部署侧已装 xterm 与 SSH 类第三方插件（禁用）、规则「Model-visible ⟺ logged」。

15 个方向，Top 5：
1. ★ **只读终端观察面板**：右栏新 tab 列出 agent 的 PTY 会话并分页渲染 `read` —— 唯一完全落在既有契约上、零新攻击面的形态。
2. 挂载既有 `pty`/`terminal-bash` 进 web preset，面板复用既有契约（任何终端形态的前置条件）。
3. ★ 终端固定在沙箱策略内 spawn（不可提权）—— 若真做，唯一能诚实交代边界的形态。
4. 配了非 loopback `trusted-host` 时直接不渲染面板（成本极低的刹车）。
5. ★ 把 PTY 输出做成可回放的"产物卡片"而非活终端（覆盖"我想看 agent 在跑什么"的真实诉求）。

★ 其他：终端当"会话外壳"复用 workspace-files 读写边界；粘贴/快捷键安全化（bracketed paste + 危险命令二次确认）；kill 时写一条 bounded 命令记录（`ignorable` 事件）。

明确否决：**移植 better-sidebar**（自建 `agent-pty`/`pty-manager` 直接 spawn node-pty，绕过 `ctx.terminals` 与沙箱策略，且引入第二个 PTY owner）；**外部 ttyd/gotty sidecar**（另开一个不受 fence 保护的 HTTP 面）；**一次性 token**（无 auth 层，且只护一扇门而文件写仍敞开）；**每条键入走 approval**（`ApprovalRequestEvent` 携带 `agent: Agent`，审批是 agent 发起的，用户发起的终端没有审批主体）。

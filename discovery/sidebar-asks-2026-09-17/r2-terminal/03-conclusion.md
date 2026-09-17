# R2-4 ③ 结论与建议

**结论：真终端"暂不做"；先做只读观察面板（2a），把挂载 PTY 进 web preset（2b）拆成独立决策且暂不做。**

1. **真终端 = 新 host 能力，不是挂载既有能力**：`ctx.terminals` 每个方法都收 `owner: Agent`（`terminal/terminal/src/index.ts:154,231,243,263,274,285,308`），浏览器没有 Agent 身份；消费契约是**有界回溯分页**（`types.ts:104-123`），`sanitize.ts:22-23` 原文 "Full terminal emulation is deliberately deferred"，**服务上既无 push 流也无 resize**；raw 流在下一层 `SubprocessTerminalHandle.output`，而它也没有 `resize()`；传输面只有 fetch/SSE + 远程方法调用，**没有 websocket** ⇒ 输入/输出/尺寸/重连都要自建分帧。`node-pty` 已是仓库既有依赖（`packages/subprocess/subprocess-local/package.json:47`）。
2. **2a（推荐做）**：新增**只读 RPC**，服务端把浏览器请求映射到该会话的 owner Agent，**绝不接受客户端自报 owner** —— 列为**不可配置的安全不变量**；面板列 `TerminalSessionSnapshot` 并分页渲染 `read(owner,id,{offset,count})`。
3. **2b（暂不做）**：把 `pty`/`terminal-bash` 挂进 web preset 会把"有审批、有日志"的通道换成"绕过模型、无日志、无审批"的通道（架构师明确反对）；且要遵守 web-app 注释里的 realm 约束（preset 内 entry-local realm 对 realm 外的兄弟行不可见）。
4. **安全边界**：`api-request-trust.ts:1-13` 自述防 DNS rebinding 与恶意页面跨站请求、且"**不是鉴权层**"；绑定为回环时局域网不可达；**残余风险＝同机其他本地用户**（回环监听不按本地用户隔离）。多用户机器上 per-install 显式开关是必需项而非可选项。
5. **model-visible**：用户自己敲的输出默认不进模型请求 ⇒ 按字面不必入日志；**终端 UI 状态不入日志**。若将来要"人跑了什么"可回放，另加一条 bounded、已清洗的 `ignorable` 事件，**绝不落字节级 transcript**（转义序列、提示符处输入的密钥、无界体量）。
6. **上线前必须为真（六条）**：(1) 目标 preset 确实挂了 PTY 行；(2) 上述 owner 映射只读 RPC；(3) 非 loopback `trusted-host` 存在时默认不渲染，或需显式 per-install 开关；(4) 写权限明确不在本期；(5) 按 `packages/client/AGENTS.md` 完成三处接线 + `./client` 导出 + `dsh.client` manifest + 每文件 100% 覆盖；(6) 文案走 locale 字典。

**Build / Port / Buy**：移植＝第二 PTY owner 且绕过沙箱（架构错）；买＝社区无现货，sidecar 另开不受 fence 保护的 HTTP 面；自建＝架构正确，成本在 host 侧。

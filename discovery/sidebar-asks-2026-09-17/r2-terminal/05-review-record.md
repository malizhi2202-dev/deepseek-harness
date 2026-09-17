# R2-4 ⑤ 人工审核记录

- 审核时间：2026-09-17（第 2 轮审核门）
- 审核原话：「ok」（对 ⑤ 门推荐版本的通过）
- 结果：**拆两个决策并以推荐版本通过**：2a 只读观察面板 → 做（含"拒绝客户端断言 owner"安全不变量）；2b 挂载 PTY 进 web preset → **暂不做**。
- P1 部署绑定面：**已获答（2026-09-17）—— 部署绑定为回环、单人使用**。事实依据：绑定为回环时局域网不可达。结论：只读面板残余风险为低，per-install 开关**可选**；若将来出现第二个本地用户，它即转为必需项（回环监听不按本地用户隔离）。
- 本流程不执行代码改动。

## 后续订正（R7 落盘时追加，不重写本目录结论文件）

第四项议题「真终端的写入形态」（记录见 `../r7-terminal-write-authority/`）在事实扫描中核实到本目录 `03-conclusion.md` 的**两处前提为假**，且六条上线前置条件中有三条状态需改记。此处只追加订正，`03-conclusion.md` 保持冻结，以免重写既有决定。

- **前提一为假（第 5 行）**：该行称传输面只有 fetch/SSE + 远程方法调用、**没有 websocket**。事实是该 WebSocket 复用路由**是既有实现**（定义见 `packages/api/gateway/src/stream-protocol.ts:5-6`，挂载与升级把关见 `packages/api/gateway/src/index.ts:213,215,228`，宿主侧持有 `noServer` 升级服务）。受影响的是同行的「输入／输出／尺寸／重连都要自建分帧」：**输出推送与重连已由该面拥有**，真正缺的只有**输入**（写是行导向而非逐键）与 **resize**（跨三层零命中，只有初始行列）。
- **前提二为假（第 12 行所属论断）**：本目录据 web-app 补丁文件判定「Web 面不挂终端行」。事实是 Web 的 agent 平面由**每会话 agent preset** 拥有，而**可选中**（roster 第 3 位）的 `minimal` preset 已组合 `pty` + `terminal-bash` + pwsh 孪生 + 模型侧持久 shell 工具（`packages/preset/agent-presets/presets/minimal/agent.cordis.yml:25,27-28,30-31,51-52`），并经 web-app 的 `agent-presets` 行暴露（`packages/bundle/web-app/cordis.patch.yml:485-486`）。**⇒ 2b 的真实含义不是「挂 PTY」，而是「把既有 owner 会话暴露给浏览器」。**
- **前置条件状态改记**：(1)「目标 preset 确实挂了 PTY 行」→ **已满足**；(3) per-install 开关 → 改为**由 preset 组合表达**（依据同层注释「preset 即组合」且「与 shell 访问同等信任」）；(4)「写权限明确不在本期」→ 改为**写入口不在本期**（条款先立、实施关闭）。
- **同处「有审批、有日志」对 PTY 不准确**：`packages/terminal/*` 对批准**零命中**（批准只在另一侧）⇒ **PTY 今天只有日志，没有审批**。此项影响本目录 ④ 的风险表述，须按此重述。
- **另有一处缓解未记**：PTY 命令按会话沙箱策略 confine，并继承「有 PTY 活动即拒绝放宽沙箱模式」的既有栅栏 ⇒ 本目录「绕过沙箱」只对「另起第二个 PTY owner／移植」成立。
- **一处引文行号更正**：终端清洗面的那句原文在 `packages/terminal/terminal-bash/src/sanitize.ts:21`（本目录此前写作 `22-23`）。

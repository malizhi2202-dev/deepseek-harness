# N1 ⑤ 人工审核记录

- 审核时间：2026-09-17（`action-seam` 第 1 轮审核门）
- 审核原话（逐字）：「同意推荐的」
- 结果：**通过**。落地为：① 三层模型（Cookie → Agent → 人-as-命令提交者）+ 两条硬条件（主体由宿主按"面板所属会话"解析；非 loopback 前先闭合连接层）；② 能力规则「改状态的动作必须走命令路径」及其退路条款（更强不变量「主体必须服务端解析」）；③ **不新增"指名人类"的审批事件**，改为给审批结算加来源标量 `{kind:'user'}`。
- **已由第 2 轮收口**：连接层的结算不靠新增授权层，而靠「模式判定 + 启动打印生效信任面 + 文档 A/B 对照表」（见 `../r2-connection-authority/03-conclusion.md`）；本条原记为未决的「先闭合还是先发船」，已不再是发版前置。
- **原记录（保留）**：连接层先闭合还是先发船（**硬前置**：不闭合则任何用户发起的动作不得上线）；"必须落域事件"是门还是刹车；停 job 是否进首发；job 动作放 body 还是 tab menu；subagent 自有 job 的排除是能力边界还是可见性缺口。
- 本流程不执行代码改动（仓库与 `~/.dsh` 零改动；侦察产物仅写 `/tmp/bmad-discovery/`）。

## 后续裁定（交接清单第 1 项闭项，2026-09-18）

负责人裁定（选项经只读备忘对照当前代码复核后呈报）：**主体取「会话代理＋来源标量」**——

- **主体模型**：点击＝命令行，主体＝面板所属会话的 Agent，宿主按 sessionId 解析，客户端不携带 owner。与审批/ask-user 先例同构：人类不是主体、是唯一提交者；命令路径的 `source:{kind:'user'}`（`packages/interaction/commands/src/types.ts:69-71`）即此形态。`kill` 的 owner 栅栏因此自然通过（`packages/jobs/jobs/src/index.ts:116-120`；省略 caller 是最严而非跳过，唯一无 caller 旁路是 teardown）。
- **来源标量统一**：给无 actor 的域事件（`goal/change`、`approval/decided`、job 类结算）补 `{kind:'user'|'agent'}`，直接对齐 typed cancel 的成品先例（`packages/core/session/src/types.ts:186-193`、`packages/api/session-controller/src/commands.ts:486`）——把「必须落域事件」从刹车变门。
- **否决**：一等「用户 principal」（牵动 CommandSourceMap、AgentCancelCause、jobs caller 签名、审批事件、SessionEventMap ⇒ 会话格式动作＋双 SDK＋全消费者；cookie 体系明文不建身份，新主体无生根处；无消费者证据）；「收缩范围」（kill 类产品缺口白留）。
- **发布门**：按已采纳阶梯 preset→turn→job 上线；**job 级动作以连接层 P0 为发布门**（模式判定＋启动打印、逃生门判据改实际 bind）。
- **翻转条件**：出现第二个真实用户或共享 harness home 常态化 ⇒ 重启「一等用户 principal」；连接层 P0 短期无法落地 ⇒ 退「收缩范围」（kill 推迟，MVP 竖切面不受影响）。
- **随实现订正**：「`/permission` 是 web client 唯一写路径」的源码注释已过时——ui-goal 按钮直调 `ctx.remote.goals.*` 写动词（`packages/client/ui-goal/src/client/index.ts:90-105`），其域事件无 actor，正是来源标量要治的现存反例。
- **未验证项**：给既有会话事件 payload 增可选字段是否触发会话格式动作（version-named successor vs 直接增补）未查证迁移细则。

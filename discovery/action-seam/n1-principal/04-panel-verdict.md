# N1 ④ 专家团评审

**判词**：1 同意（有保留）· 2′（重构后）同意（有保留）· 2a 无需新主体概念 · 3 **反对**（指名人类不可实现，应改为记录非 agent 来源）。

- 架构师（Winston）第 1 条保留在第一层"无主"：`trustedHosts`、`DSH_WEB_LOCAL_NO_AUTH=1`、多本地用户、共享 `DSH_HOME` 四处未定义；改变条件 = 出现非 loopback、多用户或共享 `DSH_HOME`。
- 第 2′ 条保留：**"只有命令路径"略强** —— 若出现别的宿主侧动作端点，规则必须重述为"主体必须服务端解析"，否则立刻退回风格规则。
- 第 3 条：三人同意其**真实意图**（让审批链不再假装 agent 是发起人），但反对"指名人类"这一实现；改变条件 = 人类主体因多用户而真实存在。

**未收敛（不抹平）**：① 第 2 点中途由 2 重构为 2′，原 2 作废；② **连接层算不算已证边界** —— 架构师要先闭合、产品经理要先发船；③ "必须落域事件"是门还是刹车（`goal/change` 无 actor，会放行反例）；④ 停 job 是否进首发；⑤ job 动作属 body 还是 tab menu；⑥ subagent 自有 job 被排除是正确能力边界（架构师）还是未记录的可见性缺口（分析师）。

**架构师开工前必答项**：连接层契约（含 `NO_AUTH` 定位）；主体由宿主按面板所属会话解析、客户端不得携带 owner、`assertAccess` 与 `cancelForTeardown` 是唯一旁路且不变；结果协议归属与 `SessionFace.command` 准入布尔是否冻结；哪些域事件必须带来源；面板动作是否入 `commands.list`（命名冲突 fail-loud 扩展 `ui-commands/src/client/service.ts:199-201`）；body vs tab menu 与 locale 文案；subagent 自有 job 明确记为 agent 侧。

**验收口径（采纳）**——安全证据：无 Cookie/跨源被拒；跨会话 kill 被拒（含 subagent job）；客户端伪造 owner 无效；`cancelForTeardown` 未被复用；共享 `DSH_HOME` 下两会话互不命中；日志里"人"与"工具"来源可区分。危险信号：人点击与 agent 触发在日志不可区分；新增任何绕过 owner fence 的路径；`DSH_WEB_LOCAL_NO_AUTH=1` 变成默认或被推荐；**没有会话上下文的 UI 动作成功**。

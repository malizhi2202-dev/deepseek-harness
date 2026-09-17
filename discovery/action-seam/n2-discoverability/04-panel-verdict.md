# N2 ④ 专家团评审

**判词**：4 有保留 · 5 同意（有保留）· 6 同意（有保留）。

- 第 4 条保留：**实为两条规则**（位置 + 可枚举/可审计），且原方案自己要用例外救"停 job" ⇒ 决定性变量应明确为"是否需要在本面板之外被枚举/审计"。
- 第 5 条保留：顺序应为 **preset → turn → job**；`/permission` 被称为 "the one write path a web client uses"，**第二条写路径需独立决策记录**。
- 第 6 条保留：**"无 falsy 回复"不能当全局律** —— `SessionFace.command` 的 `{matched:boolean}` 是有意契约，协议须限定在**新的**用户动作面；改变条件 = 新动作面能不动该准入布尔而自有三态协议。

**未收敛（不抹平）**：③ "必须落域事件"是门还是刹车（`goal/change` 无 actor，按现方案会放行该反例）；④ 停 job 是否进首发；⑤ job 动作属 body 还是 tab menu（`2026-09-05-sidebar-tab-types-and-navigation.md:45` 的 strip/body 规则 vs 每个 job 的动作）；⑥ subagent 自有 job 被排除是正确能力边界（架构师）还是未记录的可见性缺口（分析师）。

**分析师最该改的一处**：把"审批记录非 agent 来源"做实，**砍掉"actor 修复之前先立域事件门槛"**（顺序错了会放行反例）。

**验收口径（采纳）**——有用证据：不开命令行即可停 turn / 停 job / 切 preset；动作能在 `commands.list` 或面板里被发现；失败有**可读落点**。危险信号：人点击与 agent 触发在日志不可区分；无会话上下文的 UI 动作成功。

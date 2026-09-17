# R2-3 ① 头脑风暴

依据：F19（失败与反馈信号可得）、F20（`sessionStats` 无失败计数；客户端窗口分页）、`agent/error` 是 bus-only、`step/end` 载荷只有 `{turn,step}`。

14 个方向，Top 5：
1. 新增 `session-outcomes` projection 单元（新 key，既有 schema 零改动）—— 唯一能让"全会话失败数"有权威归属的挂点。
2. ★ 已恢复失败单列（折 `llm/retry`）+ ★ 每条失败带 `authority: terminal | recovered | inferred` + ★ 证据只存锚点 `{seq, turn, step?, callId?}` 不存结论 —— 同一条诚实原则：失败要分级、要指向锚点，缺一条面板就在撒谎。
3. ★ 级联只用两条可证边，其余标推断（级联是原始诉求，可证边恰好够用）。
4. 聚合搭 `session.list` 的 projection hints 顺风车（`SessionSummary.projections` 已随列表下发，分发零成本）。
5. 范围收敛为"本会话 + 直接子代理"（把不可证部分挡在门外）。

★ 其他：工具失败按 toolName 分桶；失败指纹聚合。

明确否决：新增 `turn/failure` 事件带 cause chain（动 `SESSION_FORMAT_VERSION` + 双 SDK 快照 + 相邻迁移，且违背"插件而非改 loop"）；给 `session-stats` 加失败字段（性能域承载结果域，且每加一个维度都要再 bump `stateVersion`）；客户端折叠会话日志（答案随滚动变化）；让 telemetry 承接（firehose、后端可选、不可按会话查询）；把 bus-only 的 `agent/error` 提升为落盘事件（超范围）；人类负反馈作第二权威（量级不足，留 V2）。

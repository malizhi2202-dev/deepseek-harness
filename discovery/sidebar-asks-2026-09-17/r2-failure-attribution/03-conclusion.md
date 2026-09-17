# R2-3 ③ 结论与建议

**结论：聚合归新建投影单元 `session-outcomes`；失败事实必须分级 + 指锚点；不可知项必须显式命名。**

1. **聚合归属（推荐 i）**：新投影单元 —— 1 个新包（`types.ts`/`projection.ts`/`index.ts`/`client.ts` + README + 测试），注册扇出 4 处（`tsconfig.base.json`、`tsconfig.host.json`、web-app 的 `cordis.patch.yml`、web-app 的 `package.json`）；自带 `stateVersion:1` 起算，**既有 schema 零改动**；新 key 自动进 `SessionProjectionHints.values` 并随列表下发。
2. **第 2 轮对第 1 轮的修正**：扩 `session-stats` **不存在"回填"** —— 缓存行 "never authoritative, only a fold shortcut"，版本不匹配即丢弃并按完整日志重折（`packages/session/session-projection/src/index.ts:118-127`）。因此反对它的理由改为**语义**：性能域不该承载结果域（一域一键），且每加一个失败维度都要再 bump `stateVersion`。**结论不变、理由更换**。
3. **不可知项（必须显式，不许假装能分）**：步级失败（`step/end` 只有 `{turn,step}`）；中途失败但终态仍 `completed`（agent-loop 只留最后一个 step 结局）；**宿主与网关之分**（非 `LlmError` 一律压成 `code:'UNKNOWN'`，且 `agent/error` 是 bus-only）⇒ 必须合成**一个** `unattributed` 桶，不许拆 `hostFailures`/`gatewayFailures` 两个假桶；`blocked` 只能报"被阻断"、不能报谁阻断。
4. **已恢复失败 ≠ 失败**：折 `llm/retry` 单独成列并标 `authority: recovered`（OTel 规则支撑）。
5. **证据锚点**：行格式 `{sessionId, seq, turn, step?, callId?, authority}`，复用 `ui-chat` 的 turn-error 先例（`conversation-nodes/turn-error.ts:36-43`）；**窗口外**显示"解释未加载" + 提供"翻到此处"，禁止伪造高亮（无按 seq 随机跳转的 RPC）；`lastAgentError` 是客户端内存态、prompt 即清，**不可**当锚点。
6. **级联**：血缘与 turn/step 顺序**实线**；父 `callId` → 子 `sessionId` 与任何"A 失败所以 B 失败"的跨会话因果一律**虚线标 `inference`**，并给出"可证链长 N / 推断边 M"。
7. **V1 字段清单**：`terminal{error, blocked, maxTokens, interrupted, abortedUser, abortedParent, abortedHook, abortedDisposed}`、`recoveredByCode`、`toolFailuresByName`、`unattributed`、`evidence[]`；**无** `hostFailures`/`gatewayFailures`。
8. **动作不属于投影单元**（架构师）：投影只存锚点，动作（重试/换模型/回滚检查点/派修复子代理）放 UI 层。
9. **义务**：双 schema（`stateSchema` + `viewSchema`）、纯 fold、`ctx.effect` 注册（模板 `packages/session/session-stats/src/index.ts:18-29`）、README 的 Model Experience 段；缺键显示"未知"、不得补 0。

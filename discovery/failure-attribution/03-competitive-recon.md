# ② 竞品与技术核查

方法：`bmad-deep-recon`（technical + competitive 并行，由只读子代理执行），全部结论经 `web_fetch` 直连权威文档或源码取得。**流程偏离声明**：该技能默认的「文件优先」纪律被本循环的只读约束覆盖，未建 run folder / digest / memlog。**引文核验单列一节**：本轮另派一名只读核验员逐条确认引语是否**逐字**存在，结果有 3 处措辞需修正、1 处链接为死链。

## 总发现

调研的 6 组共 12 个系统里，**没有任何一个用纯推导定义执行单元的终局**。凡有「执行单元记录」的系统都在该记录上给了**显式终局字段**；推导只出现在两个位置 —— **策略叠加**（GitHub Actions 的 `conclusion`）与**服务端聚合视图**（LangSmith 的 `Run.status` / `error_rate`），而且它们的推导输入本身**已经是一个显式字段**。

## 分系统证据

| 系统 | 显式终局还是推导 | 关键点 |
| --- | --- | --- |
| OpenTelemetry | 显式（三态） | `StatusCode` ∈ `Unset`/`Ok`/`Error`，默认 `Unset`；`Ok` 的定义是「被 Application developer or Operator **验证**为成功完成」；插桩库 **SHOULD NOT** 设 `Ok`、**SHOULD** 保持 `Unset`；`Ok` 一经设置即终局 |
| OTel 语义约定 | 显式 | 「Errors that were retried or handled (allowing an operation to complete gracefully) **SHOULD NOT** be recorded on spans or metrics that describe this operation.」 |
| Temporal | 显式（执行级 + 失败级） | `Failure` 自身的 `oneof failure_info` 与 `cause` **同级**；Service 判可重试只看结构化 `type` / `non_retryable`，**不看文本**；重试结局另有 `retry_state` |
| Airflow | 显式落库 | `task_instance.state` 是「跑过什么」的唯一真相；`upstream_failed` / `skipped` / `failed` 三分，由调度器写、非 UI 推断 |
| Prefect | 显式（双层） | 当前态列 + `*_run_state` 时间序列表；`TERMINAL_STATES` |
| Argo | 显式 | `NodePhase` 落 Workflow status；`Skipped` / `Omitted` / `Failed` 三分；文档明令**事件流不得用于自动化** |
| JUnit XML | 显式 | `<skipped>` / `<error>` / `<failure>` 三选一；failure = 被断言机制显式判失败，error = 非预期问题 |
| GitHub Actions | **推导**（输入是显式字段） | `steps.<id>.outcome`（事实）→ `.conclusion`（按 `continue-on-error` 的策略判定） |
| LangSmith | 显式（写侧） | 写模型有 `error`；`status` **只在读模型**；`error_rate` 是聚合推导量 |
| Langfuse | 显式 | 观测级 `level` + `statusMessage` |
| OpenAI Agents SDK | 显式（span 级） | `Span.error` 由调用方 `set_error()` 写；trace 本身**没有** error 字段 |
| Claude Code / Codex CLI | 显式（Codex 的 hook 层例外） | `tool_result.success` / `error_type`；Codex 同产品内 OTel 层显式、hook 层需推断，代价是被文档标注为非稳定契约 |

**为什么这组证据重要**：它与 DSH 的现状形成对照 —— DSH 的 **turn** 边界已经是「显式终局 + 可合并扩展 sum type」，而 **step** 边界是整个生命周期里唯一的例外（`step/end` 只有坐标）。同时 OTel 的 `Unset` 先例给出直接的判决：**「字段缺失」绝不能被读成「成功」**，否则旧日志会被追溯判成成功。

## 引文逐字核验（独立核验员）

| 待核 | 结果 |
| --- | --- |
| OTel 的 `Ok` 定义 | 逐字为「The operation has been validated by an Application developer or Operator to have completed successfully.」；子代理原先的「validated as successful by the application developer or operator」是**转述**，引用时须改用逐字句 |
| 「插桩库 **MUST** 保持 unset」 | **原文是 SHOULD**（`trace/api.md` 内无 MUST）；唯一的 MUST 版本在语义约定那句 ⇒ **先例分量下调一档**：是「强烈建议」而非「规范强制」 |
| 「必须在 `End` 之前 `SetStatus`」 | 只有 SHOULD；逐字的强制句是「These **MUST NOT** be changed after the `Span`'s end time has been set.」 |
| OTel 语义约定仓库路径 | 子代理给的仓库名**不存在（404）**；正确仓库为 `open-telemetry/semantic-conventions`，引语本身逐字命中（小节 `## What constitutes an error`） |
| Argo 的警告句 | 逐字命中（位于 `# Workflow Events` 的警告块） |
| LangSmith `error` / `status` | 两条注释逐字命中；`status` **只在继承自 `RunBase` 的读模型 `Run` 中定义**（`RunBase` 区间内无 `status` 声明），独立确认成立 |

汇总：**逐字命中 4/7，未验证 0**。

## 对 DSH 的映射结论

- **「给」的先例**：终态由**产生该操作的组件在结束时写入**，理由是消费者不能假设自己看得见完整事件流，也不能假设所有消费者会做同样的 fold。
- **「不给」的先例**：推导只用于**策略叠加或聚合视图**，且输入已是显式字段。
- **推导一定不够的情形（须记）**：多 attempt 混合结局（fold 规则无处可依）；取消/中断且无任何子事件可 fold；**崩溃/恢复合成的 `step/end` 在 fold 下得到「无错误」＝假成功**（依据 F5、N6）；已处理的工具错（按 OTel 规则不该记为失败）；历史稳定性（fold 规则一改会**追溯改写**历史，写入的字段是冻结的）；顺序约束（`turn/end` 在 `step/end` 之后写，turn 级 reason 无法归给多步中的某一步）。
- **代价清单（若最终加字段）**：属 payload 增补 ⇒ **不构成结构性变更、不必 bump `SESSION_FORMAT_VERSION`**；但须同步冻结成员清单（依据 N3）、三条 close 路径（正常 `finally`、catch、`repair` 合成）必须一致，且必须明确 step 是「步级结局」的**唯一 home**（`tool/result.error` 与 `assistant/attempt` 仍各自是 call / attempt 的 home）。主要成本是含 `step/end` 的录制快照与 SDK 期望输出需在同一改动内更新。

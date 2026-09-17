# 事实基线（全部经独立复核，带 `文件:行号`）

本文件的每条事实都经两步：由只读枚举取得，再由负责人**独立复核原文**（不看转述）。凡未能复核的，标注「未联网验证」或「未复核」，不写成断言。

## 会话事件与 step 的现状

| # | 事实 | 依据 |
| --- | --- | --- |
| F1 | `step/end` 载荷只有 `{turn, step}`，没有任何结局字段；而**结局类型已存在**：`step()` 返回 `StepEndReason \| null`，`stepEnd` 在该步取到后只把 `max-tokens` 折进 turn 级累加器，写 `step/end` 时丢弃结局 | `packages/core/session/src/types.ts:286`；`packages/core/agent-loop/src/agent.ts:50,343,298,301,303` |
| F2 | 模型层失败原因**已经落盘**：`finish` chunk 被原样存入 `assistant/attempt`/`assistant/message` 的 `stream`，而 `FinishReasonMap` 的 `'error'` 与 `'aborted'` 自带 `failure: LlmFailure`；两条事件都带 step 坐标 | `packages/llm/llm/src/assistant-stream.ts:168-173`；`packages/llm/llm/src/types.ts:130-136`；`packages/core/session/src/types.ts:319,305-313` |
| F3 | 步级「是否正常收尾」是**可判定谓词**：`step/end` 由 `finally` 保证每步恰一条；`step()` 的正常 return 之前必先落 `assistant/message`（`max-tokens` 与 `completed` 两个 return 都在其后）；唯一例外是「中断但有内容」 | `packages/core/agent-loop/src/agent.ts:303`；`agent.ts:458` → `:467`；`agent.ts:399` |
| F4 | 工具失败只**半结构化**：`tool/result.error?{name,code}` 只对 `HarnessError` 填；且 **shell 非零退出不是 `isError`**，Host 与 Client **各自用正则反解文本标记** | `packages/core/session/src/types.ts:341`；`packages/core/tools/src/index.ts:635-641`；`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts:88-90`；`packages/shell/shell/src/render.ts:19-40`；`terminal-card-model.ts:265-270` |
| F5 | 崩溃/恢复合成 close 时**两种待遇**：合成的 `step/end` 无任何结局字段，合成的 `turn/end` 却带 `{kind:'interrupted'}` | `packages/core/session/src/repair.ts:131,133` |
| F6 | 仓库唯一的全量 step 统计自陈把三种结局混同：「Closed steps (`step/end` events) — completed, failed, and cancelled steps alike.」 | `packages/session/session-stats/src/types.ts:25` |
| F7 | **今天已存在用户可见的错误归属**：两处都把 turn 级失败/上限挂到**最后一步**；而 `max-tokens` 的粘滞折叠在多步续跑时会掩盖真实步号 ⇒ 位置推断会指错步 | `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts:28`；`turn-max-tokens.ts:23`；`packages/core/agent-loop/src/agent.ts:301` |
| F8 | 「格式级」是**两档**且代价差一个量级：给既有事件**增补 payload 成员**，读取路径不校验 `step/end` 的 data，旧构建**不拒读**；**新增事件类型**则会让旧构建**整条拒读**（未知类型仅 `ignorable === true` 时容忍），而全仓**只有读取方、没有生产者**设置 `ignorable` | `packages/core/session/src/index.ts:224-229`；`packages/session/session-format-v0-to-v1/src/validation.ts:116-127`；`packages/core/session/src/index.ts:205,218` |
| F9 | 待用锚点 `{seq, turn, step?, callId?, authority}`：前四今天有据（`step` **必须可选**，因为 `turn/*`、`request/*` 无 step）；`authority` **既无专用字段，`user/message` 也不带 turn/step 坐标** | `packages/core/session/src/types.ts:457,325,273,282,348,358,294`；`packages/llm/llm/src/brand.ts:31` |

## 专家团复核后新增的事实（N1–N9）

| # | 事实 | 依据 |
| --- | --- | --- |
| N1 | 步级终点在源头本就是**三态**：`step()` 签名是 `Promise<StepEndReason \| null>`，工具跑完但无工具 conclude 时返回 `null`（turn 正常继续下一步）⇒ 判据至少要分四格：`completed` / `max-tokens` / `null`（未 conclude）/ `interrupted: true`。这同时**加固**「布尔 ok/failed 必撒谎」的否决 | `packages/core/agent-loop/src/agent.ts:343,475`；`packages/core/agent-loop/src/tool-calls.ts:38,95,158` |
| N2 | `authority` 今天**可由位置推导**（`user/message` 在该步 `step/start` 之后、该步 seq 窗口内追加），`Message.source` 区分人类输入 / 注入上下文 / goal 续跑 —— 正因能推导，才更应把它交给持久字段，否则两个真源 | `packages/core/agent-loop/src/agent.ts:290-294`；`packages/llm/llm/src/message.ts:139`；`packages/core/session/src/types.ts:287-294` |
| N3 | R3 的格式代价坐标已精确：冻结成员清单那一行是 `'step/end': disposition(['turn','step'])`，v1→v2 经 `retained` 继承；而**生成物不受影响**（目录只列事件类型名） | `packages/session/session-format-v0-to-v1/src/dispositions.ts:90`；`packages/session/session-format-v1-to-v2/src/dispositions.ts:8-16`；`packages/core/session/src/known-event-types.ts`；`scripts/gen-persistence-catalog.ts:17` |
| N4 | 读取路径的严格校验白名单只覆盖 `request/header`、`user/message`、`assistant/attempt`、`assistant/message`、`tool/result`，**不含 `step/end`** ⇒ F8 前半成立 | `packages/core/session/src/index.ts:224-233` |
| N5 | 未知事件类型确实整条拒读：仅当 `ignorable === true` 才容忍，否则抛不支持的迁移错误 ⇒ F8 后半成立 | `packages/session/session-format-v0-to-v1/src/validation.ts:116-127` |
| N6 | 合成路径**内部不对称**：合成的 `tool/result` 至少条件性带 `sourceEventSeqs`，合成的 `step/end` **什么都不带** ⇒ 纯投影的「检疫」只能靠「步内无 `assistant/message`」+ 兄弟 `turn/end {kind:'interrupted'}` **用缺席反推**，不能称为零代价 | `packages/core/session/src/repair.ts:124,131,133` |
| N7 | 要替换的两处 `lastStep` 函数体**逐字相同**（可抽一份共享助手）；而 `turn-process.ts` 的 `steps.at(-1)` 是实时「最新步」语义、指代正确，**不应一并改** | `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts:28`；`turn-max-tokens.ts:23`；`turn-process.ts:118,254,292` |
| N8 | `interrupted: true` 的精确行与正常 return 前的次序（`assistant/message` 先于两个 return） | `packages/core/agent-loop/src/agent.ts:399,458,467` |
| N9 | R1a 的消费者 `session-outcomes` 在仓库中**不存在** | 全仓检索 `session-outcomes` 无命中 |

## 外部先例（联网抓取 + 逐字核验）

核验方式：对每个来源抓取原文并确认引语**逐字**存在；核验结果 **逐字命中 4/7**、0 未验证，另有 3 处措辞修正与 1 处死链修正，详见 `03-competitive-recon.md`。

| 系统 | 显式终局还是推导 | 关键字段 / 原句 |
| --- | --- | --- |
| OpenTelemetry | **显式**（三态，默认 Unset） | 「The operation has been validated by an Application developer or Operator to have completed successfully.」；插桩库 **SHOULD NOT** 设 `Ok`；「These MUST NOT be changed after the `Span`'s end time has been set.」 |
| OTel 语义约定 | 显式 | 「Errors that were retried or handled (allowing an operation to complete gracefully) SHOULD NOT be recorded on spans or metrics that describe this operation.」 |
| Temporal | **显式**（两级） | `Failure.oneof failure_info` 与 `Failure cause` **同级**；重试结局另有 `retry_state` |
| Airflow / Prefect / Argo | **显式落库** | 状态表即权威；Argo 文档：「Do not use Kubernetes events for automation as they can be lost or rolled-up.」 |
| JUnit XML | **显式** | `<skipped>` / `<error>` / `<failure>` 三选一 |
| LangSmith | **显式**（写侧 `error`） | 写模型 `error`；`status` **只在读模型** |
| Langfuse / OpenAI Agents SDK | **显式** | `level` + `statusMessage`；`Span.error`（trace 无 error） |
| GitHub Actions | **推导**（输入已是显式字段） | `steps.<id>.outcome` → `.conclusion` |
| Claude Code / Codex CLI | **显式**（Codex 的 hook 层例外） | `tool_result.success` / `error_type` |

**净结论**：本次调研的 12 个系统里，**没有任何一个用纯推导定义执行单元的终局**；推导只出现在**策略叠加**与**服务端聚合视图**，且其输入本身已是显式字段。DSH 的 turn 边界已经是「显式终局 + 可合并扩展 sum type」，step 边界是整个生命周期里唯一的例外。

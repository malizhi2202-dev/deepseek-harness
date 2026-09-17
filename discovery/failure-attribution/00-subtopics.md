# 步级失败归因：一步到底失没失败 —— 子议题清单与轮次记录

议题 slug：`failure-attribution`
议题来源：上一议题（`sidebar-asks-2026-09-17`）第 3 轮交接清单第 5 项 —— 「**步级失败归因**：唯一需要格式级改动（**新增会话事件**）的项目，须单独立项」（`../sidebar-asks-2026-09-17/99-roadmap.md:146`），以及该议题第 2 轮把「步级失败」列为**不可知项**的结论（`../sidebar-asks-2026-09-17/r2-failure-attribution/03-conclusion.md:7`）。
为什么另开议题而不是接着上一轮：上一个议题按约定**最多三轮**且已收敛；本议题不改动其已落盘结论，而是检验该交接项的两条前提（「需要格式级改动」「需要新增会话事件」）是否成立，并把「这一步失败了吗」从不可知项提升为**可裁决的设计问题**。

## 第 0 步扫描到的事实来源

| 类别 | 来源 |
| --- | --- |
| 负责人原话 | 「继续循环啊」的指令；⑤ 审核门的逐字回答（见文末） |
| 仓库代码（只读） | `packages/core/agent-loop/src/agent.ts`（step 循环与 `StepEndReason`）、`packages/core/session/src/{types,index,repair}.ts`、`packages/llm/llm/src/{types,message,assistant-stream}.ts`、`packages/core/tools/src/index.ts`、`packages/session/session-{stats,format-v0-to-v1,format-v1-to-v2}/src/**`、`packages/client/ui-chat/src/client/conversation-nodes/**`、`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts`、`packages/shell/shell/src/render.ts` |
| 上一议题结论 | `../sidebar-asks-2026-09-17/r2-failure-attribution/03-conclusion.md`、`../sidebar-asks-2026-09-17/99-roadmap.md` |
| 外部规范（联网核验） | OTel trace API 与语义约定、Temporal、Airflow、Prefect、Argo、JUnit XML、LangSmith、Langfuse、OpenAI Agents SDK、Claude Code、Codex CLI（逐字引文见 `03-competitive-recon.md`） |

## 子议题

| # | 子议题 | 事实依据 | 为什么影响主议题 | 状态 |
| --- | --- | --- | --- | --- |
| S1 | 既有事件够不够推出「这一步失败了」 | `step/end` 只有 `{turn,step}`（`packages/core/session/src/types.ts:286`）；`StepEndReason` 已存在却被丢弃（`packages/core/agent-loop/src/agent.ts:50,298,301,303`） | 决定本议题是「补数据」还是「写推导规则」 | 五步完成，审核通过 |
| S2 | 缺的是哪个字段；补它算不算格式级改动 | 读取白名单不含 `step/end`（`packages/core/session/src/index.ts:224-229`）；未知事件类型会整条拒读（`packages/session/session-format-v0-to-v1/src/validation.ts:116-127`）；冻结成员清单 `.../format-v0-to-v1/src/dispositions.ts:90` | 上一轮把「加字段」与「加事件」混为一谈，二者代价差一个量级 | 五步完成，审核通过 |
| S3 | 能否填满 `session-outcomes` 的锚点 `{seq,turn,step?,callId?,authority}` | 前四有据；`authority` 无专用字段，且 `user/message` 不带 turn/step 坐标（`types.ts:294`） | 决定投影单元的验收口径是否今天可达 | 五步完成，审核通过 |
| S4 | `unattributed` 的判定标准 | 工具失败半结构化（`packages/core/tools/src/index.ts:635-641`；shell 退出码不是 `isError`）、崩溃合成无语义（`repair.ts:131`） | 归因必然有落不进任何桶的部分，必须**具名**而非猜 | 五步完成，审核通过 |

## 轮次纪律与结构说明

- 本议题自第 1 轮开始，最多三轮；拆不出有事实依据的新子议题即停止，不硬凑。
- 结论先以对话形式呈审核门；通过后才写入本目录。
- 全程只读：不修改、不新建、不删除仓库内任何源码、配置、测试、脚本。
- 档内只记**产品层事实**；任何实例的部署取值与启动参数**不入档、不入代码**，也不作为证据或断言依据。
- **结构说明（流程偏离声明）**：本轮四个子议题由**一次**五步讨论共同回答（它们是同一机制的四个面：判据、代价、锚点、不可知项），因此五件套落在议题层而非子议题层，不拆四个重复目录。编号上 `01` 为事实基线，五步落在 `02`–`06`；子议题与步骤的对应见下表。

| 子议题 | 主要由哪几步回答 |
| --- | --- |
| S1 可推导性 | `01`（F1–F3、F9）、`04` |
| S2 格式档位 | `01`（F8、N3–N5）、`04` |
| S3 锚点可填性 | `01`（F9、N2）、`04`、`06` |
| S4 `unattributed` 标准 | `01`（F4–F6、N6）、`02`、`04` |

## 第 1 轮结果（已过审核门）

审核原话（逐字）：**「过门落盘，两条缺项作为门内待裁决写明」**；`authority` 归属的裁决原话（逐字）：**「随 R3 走：不进 R1a 纯投影」**。

**本轮推翻的前提（上一议题交接项的两条都需订正）**

1. 「步级失败归因**唯一需要格式级改动**」——**不成立**。步级「是否正常收尾」是**可判定谓词**：`step/end` 由 `finally` 保证每步一条（`agent.ts:303`），而 `step()` 的正常 return 之前必先落 `assistant/message`（`agent.ts:458` → `:467`）；唯一例外是「中断但有内容」（`agent.ts:399`）。模型层失败原因也已落盘（`assistant-stream.ts:168-173` + `llm/src/types.ts:130-136`）。⇒ 主体工作落在**投影层**，不动事件契约。
2. 「须**新增会话事件**」——**不成立且方向相反**。新增事件类型比给既有事件加可选成员**重得多**（未知类型会让旧构建**整条拒读**，`session-format-v0-to-v1/src/validation.ts:116-127`，而首方生产者从不设 `ignorable`）；真正的候选改动是给 `step/end` 加**可选** `outcome` 成员，属 payload 增补。

**本轮落定的设计（详见 `04-conclusion.md`）**：R1a 纯投影竖切面（四格谓词 + 从 `finish` chunk 解原因 + 合成事件检疫 + `unattributed`）、R1b（用它替换两处位置推断、修今天已错的用户可见归属）、R3（`step/end` 可选 `outcome` 排队，`authority` 随它走）。**四条否决**（不需要新增事件 / 不加布尔 / 不给 `turn/end` 加 step 坐标 / 今天不加 `outcome`）见 `04-conclusion.md`。

**门内待裁决（两条，均为文档或裁决级，不需新代码事实）**

1. **消费者缺位**：R1a 服务的 `session-outcomes` 投影在仓库中**不存在**（`01-verified-facts.md` N9），因此 R1a 缺验收标准 —— 需把该投影的需求落成仓库内可引文档。
2. **`authority` 归属**：已在门内裁决 —— **不进 R1a**，随 R3 的持久字段走（理由：今天虽可由 `user/message` 位置推导，但持久字段是唯一真源，推导会制造第二真源）；R1a 期间按「不可知项必须具名」处理。

## 收敛判定

四个子议题均已在第 1 轮得到有事实依据的回答，且**未拆出新的、有事实依据的子议题**（剩余事项为验收口径与实现细节，不是新问题领域）。⇒ 本议题**收敛于第 1 轮**，不再开第 2 轮。

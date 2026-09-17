# ① 头脑风暴

方法：`bmad-brainstorming`（由只读子代理执行）。**流程偏离声明**：该技能默认要求「nothing exists until it is a file」（建 run folder / memlog）；受本循环「审核门通过前不写盘」的硬约束覆盖，未建任何文件、未落 memlog，证据直接落在交付正文。

## 一句话结论

能用既有事件在 step 粒度判「这一步有没有正常收尾」，还能直读模型层失败原因；判不出的是「任务级失败」、非 `HarnessError` 的原因身份、以及 turn 终局到具体 step 的**权威坐标**。补前两类是**纯投影、零格式改动**；第三类的最小改动是 `step/end` 加一个**可选成员** —— **不 bump `SESSION_FORMAT_VERSION`、也不是新事件**。⇒ 交接清单「唯一需要格式级改动（新增会话事件）」的判定应收窄。

## 三个推翻前提的新发现

1. **模型层失败原因已落盘且带 step**：`stream` 原样保留了 `finish` 原始 chunk，其 `error` / `aborted` 分支自带 `failure: LlmFailure`（依据 F2）。不需要新字段。
2. **步级「是否正常收尾」是可判定谓词**：`step/end` 由 `finally` 保证每步恰一条，而 `step()` 的正常 return 之前必先落 `assistant/message` ⇒ 「有 `step/end` 但该 `{turn,step}` 无 `assistant/message`」即未正常收尾；唯一例外是中断但有内容（依据 F3）。
3. **「格式级」必须拆两档**：payload 成员增补旧构建**不拒读**；而**新增事件类型**会让旧构建**整条拒读**（首方从不设 `ignorable`）。上一轮把两者混为一谈，方向也就偏了（依据 F8）。

## 候选方向（D1–D15）

| 方向 | 内容 | 归属档位 |
| --- | --- | --- |
| D1 | 步级「正常收尾」谓词：有 `step/end` 且该步有 `assistant/message` | 纯投影零改动 |
| D2 | 从 `assistant/*` 的 `stream` 里解 `finish.reason.failure` 作为失败原因 | 纯投影零改动 |
| D3 | 归因前先**检疫合成事件**（缺层具名） | 纯投影零改动 |
| D8 | `unattributed` 三问标准（有 finish 记录？有 `HarnessError` code？有指名生产者？） | 纯投影零改动 |
| D9 | 先检疫（`repair` 路径）再归因 | 纯投影零改动 |
| D12–D14 | 本轮未逐条取回语义 | 纯投影零改动 |
| D10 | 用已有字段做 join 的路线 | 纯投影零改动 |
| D6 | 结构化工具结局（shell 非零退出**根本不是 `isError`**，Host 与 Client 各写了一遍正则反解文本标记） | 不改事件契约、改写入端 |
| D7 | 用**已存在**的 `tool/result.meta` 与 `error:{name,code}`（后者今天只有 `HarnessError` 才填） | 不改事件契约、改写入端 |
| D15 | `authority` 四态 | 纯投影零改动（**门内已裁决：砍出 R1a，随 R3 走**） |
| D4 | `step/end` 加可选 `outcome`（唯一直击权威坐标，代价最大） | payload 增补（不 bump；冻结成员清单需同步） |
| D5 | 新增会话事件 | **最重**：不 bump 版本但旧构建拒读 |
| D11 | 本轮未逐条取回语义 | 未定 |

Top 5（子代理排序）：**D1+D2** 双规则 → **D9+D3** 先检疫 → **D8** 三问标准 → **D6** 结构化工具结局 → **D4** 可选 `outcome`（排队不做）。

**诚实标注**：本轮的候选方向共 15 项，上表记录的是**语义可考**的那些（含 Top 5 与全部分档结论）；D11 与 D12–D14 的完整语义**未逐条取回**，不在此臆补。

## 反例（推翻「纯推导总是够」的硬证据）

| # | 反例 | 依据 |
| --- | --- | --- |
| R2 | `max-tokens` 粘滞折叠 ⇒ 多步续跑时**现有 UI 会指错步**（两处都挂 `steps.at(-1)`） | F7、`agent.ts:301-308` |
| R3 | 同一事实缺口在**步级**被 `finish` 记录救回（⇒ 缺口是部分的，不是全部的） | F2 |
| R6 | **`step/end` 之后才发现失败**，turn 仍以 error 结束（既有测试覆盖该形态） | `packages/core/agent-loop/tests/coverage-edges.spec.ts:509-530` |
| R7 | 错误来自 **step 体外**（pre-step 组装、turn-stopping 观察者）⇒ `turn/end` 无坐标；连总线上的 `agent/error.step` 都只是**提议坐标**（`phase.step` 在 `step/start` 之后才更新） | `packages/core/agent-loop/src/agent.ts:215-219,301` |

⇒ 一批反例指向同一结论：**可判定 ≠ 可归因**，归因必然留下一部分 `unattributed`。

**诚实标注**：子代理共给出 14 条反例，本轮逐条取回并复核的是上表 4 条（R2、R3、R6、R7）；其余未逐条取回。

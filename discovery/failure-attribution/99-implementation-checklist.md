# 实现清单

依据 `04-conclusion.md` 的排序与 `05-panel-verdict.md` 的约束。**本清单是实现阶段的施工项，不是本议题的结论**；开工前先收口 §0。

## §0 开工前置（门内待裁决）

- **P0-1** 先写「`session-outcomes` 需求文档」（仓库内可引），含锚点 `{seq, turn, step?, callId?, authority}` 的语义、以及「不可知项必须具名」的判定 —— R1a 缺此则无验收口径（依据 N9）。
- **P0-2** `authority` 归属已裁（**随 R3**）；R1a 期间该键**必须走「不可知项具名」**，不得用位置推导偷偷填上（依据 N2 与门内裁决）。

## §1 R1a：纯投影竖切面（零格式改动、零快照 churn）

- **1.1 谓词四格**：`completed` / `max-tokens` / **`null`（工具跑完但无工具 conclude，turn 正常续跑）** / `interrupted: true`。判据 = 「有 `step/end`（`finally` 保证每步恰一条）且该步有 `assistant/message`」为正常收尾；否则按上述四格定性。依据 F1、F3、N1、N8。
- **1.2 失败原因解码**：从该步 `assistant/attempt` / `assistant/message` 的 `stream` 中取 `finish` chunk 的 `reason`，其 `error` / `aborted` 分支自带 `failure: LlmFailure`。依据 F2。**不得**为此新增字段。
- **1.3 合成事件检疫（必须显式承认是结构性推断）**：`repair` 合成的 `step/end` 与正常 close **同类同形、无任何标记**，只能靠「步内无 `assistant/message`」+ 兄弟 `turn/end {kind:'interrupted'}` **用缺席反推**。依据 F5、N6。**禁止**在文档或代码注释里把它表述为「零代价」。
- **1.4 `unattributed`**：三问标准（有 `finish` 记录？有 `HarnessError` code？有指名生产者？），落不进任何具名桶的一律进该桶，**禁止猜**（工具失败半结构化、shell 退出码靠正则反解、错误可能来自 step 体外）。依据 F4、R7。
- **1.5 投影单元形态**：沿用 `action-seam` 已定的形态（新投影单元、双 schema、纯 fold、`ctx.effect` 注册、缺键显示「未知」不得补 0）。
- **1.6 测试**：单元测试覆盖四格谓词与检疫分支；**R1a 不产生快照 churn**（不改事件、不改写入端）；不新增 `availability` 类线字段（沿用既有裁决）。

## §2 R1b：修今天已错的用户可见归属（依赖 R1a）

- **2.1** 用 §1.1 的谓词替换两处位置推断（函数体逐字相同，**抽一份共享助手**，禁止出现第三份复制）。依据 F7、N7。
- **2.2** **不得**一并改 `turn-process.ts` 的 `steps.at(-1)`（那是实时「最新步」语义、指代正确）。依据 N7。
- **2.3** 必须带多步续跑用例（`max-tokens` 粘滞折叠下真实失败步号被掩盖的形态），证明修好后不再指错步。依据 F7。
- **2.4** 标为「**依赖 R1a**」；不得作为独立小改发出（三方分歧 G1/G2 的交汇解）。

## §3 R3：`step/end` 加可选 `outcome`（排队）

- **3.1 前置裁决**：先裁「**工具失败是否算步失败**」，否则该字段会变成第二个语义不确定的字段。依据 F4。
- **3.2 形状**：**可选**成员、merge-extensible；**不得**用布尔；「字段缺失」**绝不能被读成成功**（OTel 的 `Unset` 先例）。依据 V2、`03-competitive-recon.md`。
- **3.3 冻结成员清单同步**：`packages/session/session-format-v0-to-v1/src/dispositions.ts:90` 那一行需同步，并按「迁移永不移动/替换/删除已提交世代」写明对 v2 世代描述的追认方式。生成物不受影响。依据 N3。
- **3.4 三条 close 路径必须一致**：正常 `finally`、catch、`repair` 合成；其中合成路径**原理上无法知道结局** ⇒ 必须定义它写什么（哨兵值）。依据 F1、F5。
- **3.5 唯一 home**：明确 step 是「步级结局」的唯一 home；`tool/result.error` 与 `assistant/attempt` 仍各自是 call / attempt 的 home。依据 `03-competitive-recon.md` 的代价清单。
- **3.6 同批更新**：含 `step/end` 的录制快照与 TS/Python SDK 期望输出；**不必** bump `SESSION_FORMAT_VERSION`（属 payload 增补，非结构性变更）。依据 F8、N4。

## §4 会让本议题结论翻转的情形（记下以免静默漂移）

- 冻结清单规则改为「新增可选成员不使冻结描述失效」⇒ N4 需重开。
- `step()` 的 `null` 分支被取消 ⇒ 谓词第三态可删。
- `repair` 合成路径补上统一「合成」标记 ⇒ 检疫从「结构性缺席推断」降为「读一个标记」，Mary 的保留降为同意。
- 工具结局结构化（F4）与 R3 同批解决 ⇒ R3 必须提前。

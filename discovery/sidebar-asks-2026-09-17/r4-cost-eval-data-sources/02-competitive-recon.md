# 成本/评估观测数据源 ② 竞品与技术调研

方法：`web_search` 在本环境不可用，全部结论用 `web_fetch` 直连权威源，每条事实带逐字英文引文与 URL。抓取失败或无法确认者集中在「未验证清单」，**不用记忆补齐**。外部分级一律【联网】。

## 一、偏离声明

1. `bmad-deep-recon` 默认要求建 run folder / `brief.md` / `digests/` / `research.md` / `.memlog.md`；本轮硬约束禁止写盘，故不建任何文件，证据只存在于本文件与子代理回传正文。
2. 未做并行搜索扇出，改为逐条直连；覆盖面受单页抓取长度限制。
3. 未派生子代理、未产出 import 文件；技能要求的统计脚本未执行，第 6 节为人工清点。
4. 抓取正文里的第三方产品示例模型名在引用中省略，避免把型号带进结论。

## 二、逐对象要点

### 轴 A · 成本

| 编号 | 对象 | 结论与逐字引文 |
| --- | --- | --- |
| E1 | OTel 用量属性 | 权威源已迁至 `open-telemetry/semantic-conventions-genai`。属性含 `gen_ai.usage.input_tokens` / `.output_tokens` / `.cache_read.input_tokens` / `.cache_write.input_tokens` / `.reasoning.output_tokens` |
| E2 | **OTel 输入口径** | 「The value SHOULD be included in `gen_ai.usage.input_tokens`」（缓存读注）；「This value SHOULD include all types of input tokens, **including cached tokens**」，且「instrumentations SHOULD report the billed count」 |
| E3 | OTel 无钱 | 完整属性表逐行无 cost/price 键；`gen_ai.token.type` 只有 `input`/`output` 两个良定义值 |
| E4 | OTel 指标 | `gen_ai.client.token.usage` 为 Histogram；「When systems report both used tokens and billable tokens, instrumentation MUST report billable tokens」 |
| E5 | 指标与事件分工 | 事件是 Opt-In 的逐次明细；指标是可聚合计数 |
| E6 | LiteLLM 价表 | 「prices every request from its model cost map, a JSON file mapping each model to per-token rates」；缓存价缺失时「inherited from the backend model's default entry so cache reads are not silently billed at zero」；抓取失败时「logs a warning and **silently falls back** to the bundled backup map」 |
| E7 | Helicone 谁算钱 | 「we estimate the cost based on the model returned in the response body, using OpenAI's pricing tables」；措辞是 estimate |
| E8 | Langfuse 谁算钱 | 「Now all **new traces** with this model will have the correct token usage and cost inferred」；`match_pattern` 匹配；用户定义模型优先 |
| E9 | Anthropic 缓存倍率 | 5 分钟写 1.25x、1 小时写 2x、缓存读 0.1x；单列 `cache_read_input_tokens` / `cache_creation_input_tokens`；「All prices are in USD.」 |
| E10 | OpenAI 缓存 | 「Cache-write pricing is not an additive fee: input tokens use the uncached-input, cached-input, or cache-write rate」；Agents 侧「do not expose a separate cache-write count, so they cannot determine the exact model charge」；「These counts are not a final bill.」 |
| E11 | 编码代理的成本呈现 | 会话内累计 + 缓存统计行；「computes the dollar figure locally from token counts at list price, unless a `modelPricing` table is in effect」；「The figure is an estimate」；`/clear` 后归零 |
| E12 | 非货币计量先例 | 有产品用「Agent Compute Units」，计量口径是动作复杂度与虚拟机时间，不是 token 也不是钱 |
| E13 | 额度/告警 | 网关与可观测产品是一等概念（可按 cost / total tokens / 缓存读 / 缓存写分别告警，且有会话级预算上限）；**OTel 规范里完全没有对应物** |

### 轴 B · 评估

| 编号 | 对象 | 结论与逐字引文 |
| --- | --- | --- |
| E14 | **OTel 评估事件（本轮最重要的新增外部事实）** | 具名事件 `gen_ai.evaluation.result`，属性 `gen_ai.evaluation.name`（Required）、`.score.label`、`.score.value`（double）、`.explanation`；关联键 `gen_ai.response.id`「correlate the evaluation event with the corresponding operation when span id is not available」 |
| E15 | OTel 评估的边界 | 只定义「分数怎么被记录和关联」，**不含阈值、不含通过率、不含判定规则**；标签「SHOULD have low cardinality」 |
| E16 | 结果级评估 | 基准逐字「applying their generated patches to real-world repositories and running the repository's tests」；提交物只有实例 id / 模型名 / patch，**没有轨迹**；结果分列「likely infrastructure failures」「ambiguous failures」「incomplete」 |
| E17 | 轨迹级评估 | 「Trace-level scorers evaluate entire execution traces including all spans and conversation history… runs once per trace」；与 span 级并列 |
| E18 | 期望与判断分列 | 离线评估的 dataset 参考答案是「人写的期望」；评分器实现（judge / 代码 / 复合 / 成对）在同一框架内并列 |
| E19 | 阈值是一等字段 | 「Add `__pass_threshold` to the scorer's metadata」；且「apply only to scorers that output numeric scores. Classifiers… don't use them」 |
| E20 | 回归 vs 评估 | 回归的判据是**基线**（「highlights regressions (red) and improvements (green) relative to the baseline」）；评估的判据是**标准/评分器** |
| E21 | judge 可靠性 | 官方措辞是工程化要求：评分器「need to be developed iteratively against real data」、要「Run scorers and classifiers on known examples to verify」、优先用经过测试的内置实现；人工纠正可回灌成 few-shot |

### 轴 C · 公共形态

| 编号 | 对象 | 结论 |
| --- | --- | --- |
| E22 | 时间粒度 | 三层并存：每次调用 / 聚合窗口 / 会话与跨会话；做不到的是「实时流式渲染成本」，权威源普遍声明计数会随对账变化 |
| E23 | 数据留存 | 成本落在会话日志与指标后端两处；评估结果落在独立评分体系并**回指被评对象** |
| E24 | 是否共用数据源 | **不共用，只共用关联键**：成本读 usage/计费口径，评估读评分器输出，连接点是「被评的那个调用或轨迹」 |

## 三、来源清单（外链与取回日期）

取回日期：**2026-09-17**（全部条目均为该日 `web_fetch` 直连抓取，未使用训练记忆）。

| 编号 | 来源 |
| --- | --- |
| E1 / E2 / E3 | `https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/registry/attributes/gen-ai.md` |
| E4 / E5 | `https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-metrics.md`、`https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-events.md` |
| E6 | `https://docs.litellm.ai/docs/proxy/custom_model_cost_map`、`https://docs.litellm.ai/docs/completion/token_usage` |
| E7 | `https://docs.helicone.ai/references/how-we-calculate-cost.md` |
| E8 | `https://langfuse.com/docs/observability/features/token-and-cost-tracking` |
| E9 | `https://platform.claude.com/docs/en/about-claude/pricing.md` |
| E10 | `https://developers.openai.com/api/docs/guides/prompt-caching.md`、`https://developers.openai.com/api/docs/guides/agents-api/observability.md` |
| E11 | `https://code.claude.com/docs/en/costs.md` |
| E12 | `https://docs.devin.ai/admin/billing/usage.md` |
| E13 | `https://docs.helicone.ai/features/alerts.md`、`https://langfuse.com/docs/observability/features/alerts`、`https://docs.litellm.ai/docs/proxy/users` |
| E14 / E15 | 同 E4 的 `gen-ai-events.md` 与 E1 的属性表 |
| E16 | `https://raw.githubusercontent.com/SWE-bench/SWE-bench/main/docs/guides/evaluation.md` |
| E17 / E19 | `https://www.braintrust.dev/docs/evaluate/llm-as-a-judge.md`、`https://www.braintrust.dev/docs/evaluate/write-scorers.md` |
| E18 / E20 | `https://docs.langchain.com/langsmith/evaluation-concepts.md`、`https://docs.langchain.com/langsmith/evaluation-types.md` |
| E21 | `https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge`、`https://www.promptfoo.dev/docs/configuration/expected-outputs/` |
| E22–E24 | 由上述页面综合，无单独来源 |

## 四、对照表

| 对象 | 数据源 | 粒度 | 钱还是 token | 回归还是评估 | 谁触发 |
| --- | --- | --- | --- | --- | --- |
| OTel spans/metrics | `gen_ai.usage.*` 属性与 histogram | 调用 / 窗口 | token（billed 优先，无钱） | 都不是 | 插桩库自动 |
| OTel events | `gen_ai.evaluation.result` | 每次被评操作 | 都不是 | **评估**（只记分数） | 评估方显式发出 |
| 网关类价表产品 | 内置 + 可覆盖价表 × usage | 请求 → 键/团队/会话 | **钱**（USD），由 token 换算 | 都不是 | 网关自动 |
| 可观测产品 | 响应 usage + 服务端推断价表 | 调用 → trace → 告警窗口 | **钱（估算）** + token | 两者都有 | SDK 上报 + 服务端推断 |
| 头部模型 API | 响应 usage（含缓存分列） | 每次调用 | token（缓存分档计价） | 都不是 | Provider |
| 编码代理 CLI | 本地 token × 列表价（可被组织价表覆盖） | 会话内累计 | **钱 + token 同屏**，标 estimate | 都不是 | 用户敲命令 |
| 基准评测 | patch + 仓库测试 | 每个实例（结果级，无轨迹） | 都不是 | **评估** | 评测方跑 harness |
| 评估平台 | dataset 期望 + 评分器 + trace | 用例 / 轨迹 / 实验 | 都不是 | **评估 + 回归**（阈值、基线对比） | 实验运行 / 线上规则 |

## 五、三条对比轴结论

**轴 A**：token 是一等公民，钱是派生量；所有能给出钱的权威源都同时声明「这不是账单」。要算钱必须自带价表，而价表有两种形态（内置可覆盖 / 产品服务端维护），各有失效模式。**缓存必须分桶**，且**「总量是否含缓存」各家口径不同，必须显式选一个**——OTel 规定输入含缓存，而本仓的内部约定是互斥（见 `01-brainstorm.md` 修正 2 与 `03-conclusion.md`）。额度与告警在网关侧是一等概念，在规范里**没有任何对应物**。

**轴 B**：规范层面评估确是一等概念，但**只解决「分数怎么记」，不解决「什么算通过」**；通过与失败全部落在产品侧（必过测试、阈值、基线红绿）。轨迹级与结果级是两个层级而非二选一。人在环与模型判断在数据模型上分列两处，且都留了人工纠正回灌的口子。judge 的可靠性以工程化措辞体现，**没有任何一份文档把 judge 分数当账本**。

**轴 C**：粒度天然三层；成本与评估**不共用数据源，只共用关联键**。因此「把两块做成同一块面板」在数据层不成立；能做的是共用**归属键与时间轴**——成本挂在调用与会话上，评估挂在被评对象上，两者在「哪个会话的哪一轮」汇合。

## 六、对本仓的映射

**已有对应物**（【复核】）：`packages/llm/token-meter/` 是 replay-aware 计量服务，并规定了「envelope 不匹配就不复用 provider 用量」这条更严的规则；四桶投影 `packages/llm/token-meter/src/projection.ts:13-18`；`sessionStats` 投影 `packages/session/session-stats/src/types.ts:22-45`；浏览器侧已有折算式与呈现（`packages/client/ui-chat/src/client/contract/chat-nodes.ts:71,97`）。

**口径风险已有成文先例**（【复核】）：`packages/llm/token-meter/src/projection.ts:20-33` 明写压力字段是「last-wins record of a different moment」「**Switching models** can therefore pair a fresh capacity with the previous route's pressure until the next request reports usage」，并自我声明「the value is a user-facing reference, **not a billing or gating input**」。⇒ 凡会混路由的投影，都必须做同样的自我声明。

**结构性缺失**（【复核】）：货币价格表（`USD`/`usd`/`dollar` 在 `packages/**` 零命中）；评分/阈值/基线概念；宿主级预算与告警；**OTel GenAI 语义对齐（`gen_ai` 在本仓代码命中 0）**；跨会话聚合（`sessionStats` 明说是单会话全域）。

**两块面板的最小可用数据源**：成本面板只读既有四桶与 `sessionStats` 即可，**不需要新增任何会话事件**；货币维度按既有 R14 对策处理。评估面板的最小数据源是**既有 `feedback/*` 事件**（【复核】`packages/feedback/message-feedback/src/types.ts:17-32,53-55`）；**要展示任何「分数」就必然需要一个新持久事件**，而本产品决定不显示分数。

**评估面板要能做决策，最少需要**：基线、通过判据、分数到可复核轨迹的关联键、判断来源与不确定性、覆盖率与不可判态五类。本仓的会话事件序号天然可做关联键，这是相对外部产品的结构优势。

## 七、来源清点与未验证清单

来源主体 13 个（去重）、成功抓取页面 20 个（另有 1 次 404、3 次跨域重定向失败、1 次接口限流）；逐字引文约 60 条。

**中途判断订正（必须遵守）**：子代理中途曾报「评估事件 SHOULD be parented to GenAI operation span being evaluated」——该句**未取得逐字证据**，**不得引用**；以未验证清单为准。

**未找到来源（不能断言文档中不存在）**：编码代理 CLI 的成本命令在当前文档中写作另一个名字，是否存在旧命令别名未确认；另一家 CLI 的用量页跨域重定向失败；OTel 评估事件的完整定义文本被截断（未取得 MUST 句与 Requirement level）；模型 API 的响应字段页被截断，字段名系由价目页示例间接确认；价表大文件未直接抓取；可观测产品的成本归属边界未取到正文；评估平台的 dataset/experiment 定义页未抓取。

**文档中不存在（本轮抓取范围内确认缺席）**：OTel 规范中的货币/价格属性；OTel 规范中的预算/配额/告警概念；OTel 评估语义中的阈值与通过率；本仓的货币计价、评分数据模型、宿主级预算/告警。

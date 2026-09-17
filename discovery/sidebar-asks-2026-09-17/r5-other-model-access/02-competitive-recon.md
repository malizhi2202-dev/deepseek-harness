# R5-2 ② 竞品与技术调研：其他模型接入

取回日期 **2026-09-17**。方法：`web_search` 在本环境不可用，全部经 `web_fetch` 直连一手源；大页面改抓源码原文。

## 一、来源层级与承重警告（必读）

| 项 | 值 |
| --- | --- |
| 来源主体 | 14 个（Anthropic Claude Code 文档、Vercel AI SDK、LiteLLM、OpenRouter、ACP、MCP 规范、OTel GenAI semconv、simonw/llm、askalf/dario、Enderfga/claw-orchestrator、claude-code-openai-wrapper、copilot-api、coder/agentapi、CLIProxyAPI） |
| 成功取回 URL | 21（19 条可引用原文；1 条仅用于发现、未作证据；1 条以 raw 形态重取后采用） |
| 逐字引文 | 50（E1–E50） |
| 承重主张验证状态 | **双源印证 1 条**；单源约 15 条；相互矛盾 0；被推翻 0 |
| 主 agent 自核 | **未自核**（唯一一次直连该来源被截断，无正文返回） |
| 已撤回的预设 | 1 条（「端点协议探测是成熟网关模式」，见第五节） |

**因此本文件的外部事实一律标【联网·子代理·未自核】，且不得作为门禁条款，只能作为方向性参考。** 唯一双源印证的承重主张是：「引擎的线格式与事件格式随版本漂移，围绕它的对接会碎」——由来源方自述 transcript 格式为内部实现且随版本变化，与另一项目独立记录的同类现象相互印证。

## 二、核心对照表（14 个对象）

| 对象 | 做法 | 路由/子代理 | 强制或协商 | 协议判定权 |
| --- | --- | --- | --- | --- |
| 官方 SDK 包装器 | SDK 进程内调用，对外暴露 chat/completions 与 anthropic messages 双端点 | **路由** | 协商：model + 会话 id + 工具开关 | 由包装器按端点固定；**工具循环默认关闭** |
| 常驻子进程编排器 | 常驻 CLI 子进程会话 + OpenAI 兼容桥 | **两者都提供** | 强制：会话键优先级、重置头、工具指纹入 hash | 由**引擎能力表 + 会话状态**判定 |
| 本地双协议网关 | 双入口（messages / chat completions），后端订阅或 API-key | **路由** | 强制：按**客户端线格式**分流 | 由**客户端形状 + 显式声明**决定，门口翻译 |
| 反向工程 HTTP 代理 | 不启 CLI 子进程 | **路由** | 弱协商 | 上游单一协议，双入口各自适配 |
| 凭据复用网关 | 用 CLI 的 **OAuth 凭据**直连上游 | 路由（**非** CLI-as-route） | 强制：配置 + OAuth | 入口由客户端选，上游由 provider 配置 |
| 内存终端仿真器 | HTTP → 终端按键，再从输出切消息 | **子代理/控制面** | 强制：必须显式声明 agent 类型 | 不涉及模型协议 |
| Agent Client Protocol | 编辑器 ↔ 编码代理 CLI 的 stdio 协议 | **子代理** | **强制协商**：未声明能力 **MUST NOT** 调用 | 不涉及模型协议 |
| LiteLLM | 多 provider 网关 | **路由** | 声明 + 探测 | **声明优先；未声明则能力探测并回落 chat completion** |
| Vercel AI SDK | SDK 提供者 | 路由（库内） | 强制：按 model id 自动选，可显式覆盖 | **按 model id（库内表）自动选**；可 `.responses`/`.chat` 覆盖 |
| `llm`（simonw） | CLI 客户端 + 配置目录 | 路由（库内） | 强制：逐模型配置声明 | **逐模型声明**；`--responses` 逐次覆盖；**无探测** |
| OpenRouter | 托管网关 | **路由** | 协商：models / fallbacks 数组 | 入口固定三协议，上游由网关路由；**协议不由模型决定** |
| MCP | 工具能力协商规范 | 不适用（工具面） | **强制**：MUST 声明能力 + 变更通知 | 不涉及 |
| OTel GenAI semconv | GenAI 遥测规范 | 不适用（观测面） | 规范级 | 不涉及 |
| CLIProxyAPI | 见「凭据复用网关」 | 路由 | 强制：配置 + OAuth | 同左 |

## 三、关键逐字引文（承重子集，英文原文）

| # | 引文 | 出处 |
| --- | --- | --- |
| E3 | 「**Function calling** not supported」「**Fast by default** - Tools disabled for OpenAI compatibility (5-10x faster)」 | claude-code-openai-wrapper |
| E5 | 「exposes a drop-in OpenAI-compatible endpoint so any client that speaks `/v1/chat/completions` can talk to a persistent ... session」 | claw-orchestrator |
| E7 | 「subsequent requests with the same key reuse the same persistent CLI subprocess — so ... prompt caching warms across turns」 | 同上 |
| E9 | 「Re-sending the full block each turn grows the prompt without bound — a 54-tool block runs to roughly 17k tokens, so a handful of turns is enough to overflow the context window mid-loop and fail the run outright. Sending _nothing_ on resume turns is not the answer either: the block also carries the "emit a tool call, do not carry out the work yourself" framing, and without it the CLI starts doing the work directly.」 | 同上 |
| E10 | 「'Is there a live thread under this session name?' is not 'is that thread holding this conversation?', and the two come apart constantly.」 | 同上 |
| E11 | 「The fingerprint is written after the send and only when the send landed, because the two ways to be wrong are not symmetric: forgetting a turn that landed replays it once more, while assuming one landed that did not drops context silently.」 | 同上 |
| E12 | 「**A turn can be replayed that the engine already had.** … nothing enforces it.」 | 同上 |
| E14 | 「Where the engine reports usage, those counts are the engine's own. Where it does not, the wrapper falls back to `estimateTokens()` … and the row is flagged `tokensEstimated: true`」 | 同上 |
| E15 | 「**What "input tokens" means is not the same on every engine** … the difference decides whether the cost math may subtract one from the other」 | 同上 |
| E16 | 「**`ok`** — the engine's own terminal verdict … It is a careful signal, but it is the engine talking about itself.」「**`verified`** — an acceptance contract ran against the work … That is the runtime's own measurement.」「**Absent is not false.**」 | 同上 |
| E18 | 「**Model names are discovered, not hardcoded.** The set ... is per-account and moves」 | askalf/dario |
| E19 | 「`/v1/models` never advertises a model that 404s. A name no provider lists at all … is refused locally with `400` and `x-…-upstream-rejection: model_unroutable` instead of spending a pool request on an upstream 404.」 | 同上 |
| E20 | 「Only a **429 or 5xx** fails over; a 400 surfaces, because a bad request that fails over just reproduces itself on the other provider and buries the real cause.」 | 同上 |
| E21 | 「Codex CLI 0.154 dropped the chat wire for custom providers, so dario speaks the Responses API: the request is translated once at the front door」 | 同上 |
| E22 | 「Every substituted response carries `x-…-pool-fallback: <model>` — a silently swapped model family is exactly the surprise this project exists to avoid.」 | 同上 |
| E32 | 「The health check picks the operation to test from the model's `model_info.mode`. … if you leave it unset, LiteLLM auto-detects from the model's capabilities and **falls back to a chat completion**.」 | LiteLLM |
| E33 | 「It runs a real test request against every configured model, so it costs a few tokens per model.」 | 同上 |
| E35 | 「The default OpenAI model factory uses the Responses API. If your custom base URL only supports the Chat Completions API, create chat models with `openai.chat('model-id')` instead」 | Vercel AI SDK |
| E36 | 「It automatically selects the correct API based on the model id. … If you want to explicitly select a specific model API, you can use `.responses`, `.chat`, or `.completion`.」 | 同上 |
| E37 | 「The model `gpt-5.1-codex-mini` is available only via the responses API.」 | 同上 |
| E39 | 「`responses: true` for models that should use the OpenAI Responses API instead of the Chat Completions API」 | simonw/llm |
| E40 | 「The command uses the Chat Completions API by default. Add `--responses` …」「An endpoint that does not support an option will return its own API error.」 | 同上 |
| E42 | 「Filter models by the API parameters they support.」「`expiration_date` … Deprecation date for the model endpoint」 | OpenRouter |
| E45 | 「Servers that support tools **MUST** declare the `tools` capability … `listChanged` indicates whether the server will emit notifications when the list of available tools changes.」 | MCP 规范 |
| E46 | 「If instrumentation cannot efficiently obtain number of input and/or output tokens … Otherwise it **MUST NOT** report usage metric. When systems report both used tokens and billable tokens, instrumentation **MUST report billable tokens**.」 | OTel GenAI semconv |
| E48 | 「Claude Code doesn't pass `OTEL_*` environment variables to the subprocesses it spawns, including the Bash tool, hooks, MCP servers, and language servers.」 | Claude Code 文档 |
| E49 | 「The transcript entry format is **internal** to Claude Code and **changes between versions**, so a pipeline that joins on these fields can break on any release; treat the joins as **version-specific rather than a stable contract**」 | 同上 |

**其余引文索引**（E1、E2、E4、E6、E8、E13、E17、E23–E31、E34、E38、E41、E43、E44、E47、E50）：分别为 SDK 包装器与端点自述、无状态/会话双模式与会话过期、模型参数未映射、两类客户端设计、会话塌缩致 `appendSystemPrompt` 串台的隐私泄漏、逐轮 JSONL 账本、订阅额度计费警告、另一代理的双协议与用量面板、凭据网关自述、终端仿真与逐 agent 类型声明（**该项目已被官方弃用**）、任意元数据挂载与读回、`store` 默认值、自检命令不注册模型、归因头为必填、fallback 触发条件、CLI 侧 OTel 指标与归因属性、请求 id 在第三方后端与重试路径上的缺席。原文与 URL 见调研记录。

## 四、三条结论

**A｜「CLI 作为一等路由」可行且被反复独立实现，边界全由「状态归属」划定。** 两条已确认路线：SDK 进程内、常驻子进程。**工具循环的归属必须先决定且没有免费选项**——一个选择「调用方拥有工具」，代价是重发工具块撑爆上下文或失去「产出调用而非自己动手」的框架（E9）；另一个干脆默认关掉（E3）。**没有任何实现做到「完整工具循环 + 无状态」**。会话状态是最贵的不变量（E10、E11、E12）。**引擎终局信号不能当成功判据**（E16）。计费与合规是硬边界。**最小稳定面是官方 SDK 或官方线协议，不是屏幕抓取**（终端仿真路线已被官方弃用）。

**B｜协议判定权上收到声明，不探测。** 四种位置：SDK 按 model id 自动选并可覆盖（E35/E36）；配置逐模型声明（E39/E40）；模型元数据声明、未声明则能力探测并**回落 chat completion**（E32，**与本仓 F6 的默认行为同构**）；由客户端线格式决定并在门口翻译（E19/E21）。
**关键否证**：**「失败后换协议重试」不是成熟模式**——主流实现只在 429/5xx 上 failover，**400 直接暴露**，理由是换后端只会复现坏请求并埋掉真因（E20）；另一家的 fallback 是**模型/提供者粒度**，触发条件是上下文长度、审核、限流、宕机，**不是协议不匹配**（E44）。**未找到任何规范级或主流网关的「先探测协议再落定」。** ⇒ 判定权应上收到模型声明，并把「未声明」变成**必填状态**而非隐式默认。

**C｜列表与可用性的一致性没有规范要求，是产品自己挣来的。** 五类机制由强到弱：① 列表主动剔除不可服务条目（E19）② 本地拒绝 + **可判别原因**头部（E19）③ 能力字段随列表返回并按能力过滤（E42）④ 列表与可用性分离、另开**真实探测面**且承认其成本（E32/E33）⑤ 协商前置（未声明即 **MUST NOT** 调用，E45）。
**最重要反例**：某 SDK 把「只在一种协议上可用」的模型留在同一张能力表里，靠**文档**而非列表过滤告知（E37）——业界普遍接受「目录是全集、可用性是调用期事实」，真正的工程动作是把元数据放进列表、把不可路由在本地提前拒掉、另设一个会花钱的真实健康面。

## 五、可转移做法（T1–T12）与迁移代价

| # | 做法 | 代价 |
| --- | --- | --- |
| T1 | 把协议提升为模型声明中的**必填**字段，删掉隐式默认（E39/E42/E35） | 中：需一次性迁移全部 provider 条目；外部目录缺该字段时必须有显式回填策略，而非 `?? chat` |
| T2 | 未声明协议时**响亮且可判别**地失败，绝不回落（E19/E40） | **低**：只改默认分支与错误分类；错误需携带「哪段配置缺失」 |
| T3 | **禁止**用「换协议重试」兜底（E20） | 低 |
| T4 | 列表按「可服务」过滤 + 可判别的本地拒绝（E18/E19/E42） | 中高：需权威目录 + 允许名名单 + 缓存 + 机器可读原因，并须**逐条列出例外区间** |
| T5 | 真实可用性放在与列表分离的另一个面，并接受其成本（E33） | 中 |
| T6 | 无 HTTP 头时归因改由子进程自报 + 运行时独立测量双轨（E14/E15/E16/E47/E48） | 高：每 CLI 一个事件解析器；各引擎 token 语义不一致；连 OTel 变量都可能不透传 |
| T7 | 账目把「引擎自报」与「运行时测量」分两列，**缺失态与否定态分开**（E16） | 低到中 |
| T8 | 归因缺失必须可观测，不能静默（E22/E43） | 低 |
| T9 | 子进程终局信号不得作为成功/失败唯一判据（E16） | 中高 |
| T10 | 模型可见输入必须由**自己的**日志承载，**不得**依赖第三方 transcript（E49/E29/E41） | 高：唯一一条架构级建议 |
| T11 | 会话复用必须配指纹，不能只靠会话名（E7/E10/E11/E12） | 高 |
| T12 | 取消语义在协议层定义，不在适配器里各写各的（E30/E2） | 中 |

## 六、撤回声明（照录）

1. **撤回**：初判把凭据复用网关列为「CLI 子进程包装成模型路由」的典型。读其自述后修正——它用 CLI 的 OAuth **凭据**直连上游 HTTP，CLI 是取凭据的入口而非推理进程 ⇒ **不属于** CLI-as-route。
2. **撤回**：初判假设「端点协议探测是网关层的成熟模式」。**未找到**任何主流网关或规范实现「先探测协议再落定」；能拿到的都是声明 + 显式覆盖，最接近的是 LiteLLM 的能力探测并**回落 chat completion**。
3. **降级/撤回**：曾把终端仿真方案视为可迁移样板；其自述显示**已被官方弃用**，且依赖终端仿真与逐 agent 类型声明 ⇒ 降级为「脆弱路线反例」。
4. **修正**：原以为某托管网关按账号可用性过滤模型列表；文档未作此声明，实际提供的是元数据与过滤参数 ⇒ 该假设降级为未验证。
5. **修正（流程）**：按无头模式执行，但**未产出**技能要求的任何落盘物与账本；末尾计数为人工统计，**不能**用技能自带的统计脚本复核。

## 七、未验证清单

**未找到来源**（不构成「不存在」的证明）：① 任何规范级或主流网关的「先探测端点协议再落定」（已查五处，均为声明/覆盖）② 「把 CLI 子进程用量回填统一账目」的标准或规范 ③ 规范级「模型列表必须与可调用性一致」的要求 ④ 模型级 capability probing 的专门端点 ⑤ 「列表里可选但调用必然失败」在 CLI 后端下的公开故障复盘。

**已确认缺席**（来源本身明确表示没有）：某 SDK 不提供按协议过滤模型列表（出路是改代码换构造器）· 该 CLI 工具有协议探测（`--responses` 是人工开关）· 某网关的模型列表不含健康状态（健康在另一个面）· 某本地网关没有 responses 入站端点 · ACP/MCP 都不定义由请求头承载的归因 · 终端仿真方案不再维护。

**本轮无法闭合**：两份来源的后段被单次上限截断未核 · 承重主张中仅 1 条获两个独立发布方印证 · 某本地网关的多项机制来自项目自述、未获独立第三方验证，已降一级置信度。

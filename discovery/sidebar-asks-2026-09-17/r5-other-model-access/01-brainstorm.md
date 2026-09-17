# R5-1 ① 头脑风暴：其他模型接入

本议题源自 `../README.md:55` 的下一轮候选「其他模型接入（**CLI 作为一等 LLM 路由**）」。**该行已过期**：同一行仍把已有档的「记忆时间线」「git-graph 上游修复状态」列为候选，故它只能证明候选被记录，不能证明缺口仍在。

本议题经五步流程后**拆为两件独立议题**（见 `05-review-record.md`）：本文档记录完整扫描与发散，结论落在 `03-conclusion.md`。

组织方式：子代理按 `bmad-brainstorming` 展开。该技能强制写盘且其辅助脚本在本仓根下不存在（无 `_bmad/`），与只读约束冲突，故退到三视角（John 产品/生态、Winston 架构、Mary 业务分析/审计）并声明偏离。

## 一、已核实事实

【复核】= 主 agent 或子代理读代码确认。行号含四处精度订正（见本节末）。

| # | 事实 | 依据 |
| --- | --- | --- |
| F1 | CLI 今天只作**子代理提供者**：一个注册「Profile 命名的 Claude Code 子代理提供者，在委派会话的工作区里跑**真 CLI 子进程**」（经官方 Agent SDK），另一个跑「真 Codex 子进程，走官方 app-server 协议」 | `packages/subagent/subagent-claude-code/README.md:12`；`packages/subagent/subagent-codex/README.md:12` |
| F2 | LLM 能力缝是抽象适配器类 + `ctx.llm.registerAdapter(providers, adapter)`；契约句逐字「**Every provider HTTP request** must include `attributionHeaders()`」 | `packages/llm/llm/src/index.ts:193-195`；`abstract class` 起于 `:197`；`registerAdapter` 声明于 `:384` |
| F3 | **发布用 Provider 包**只有两个适配器（直连 HTTP 的 DeepSeek、库支撑的 pi-ai）⇒ CLI 路由会是第一个非 HTTP 适配器。**限定**：「只有两个」仅在发布用 Provider 包意义上成立，测试替身另有 | `packages/llm/llm-deepseek/src/adapter.ts:353`；`packages/llm/llm-pi-ai/src/adapter.ts:219`；注册点 `llm-deepseek/src/index.ts:476`、`llm-pi-ai/src/index.ts:288` |
| F4 | 模型自带**协议字段** `api`，兼容门按协议分派；最终决议在 `:878` | `packages/llm/llm-pi-ai/src/catalog.ts:327`、`:508`、`:769`、`:878` |
| F5 | 「可列举协议」只有三种 | `packages/llm/llm-pi-ai/src/discovery.ts:39-43` |
| F6 | **协议错配的机制**：协议字段未填时**默认按 chat/completions 问**；注释逐字承认代价「The cost is a misdirected message when the endpoint speaks something else (an Anthropic gateway answers 401, which reads as a credential problem), and hand-entry remains the way out」 | `packages/llm/llm-pi-ai/src/discovery.ts:293-298`（注释）+ `:299`（默认值） |
| F7 | 不可列举协议 ⇒ 抛 `DISCOVERY_UNSUPPORTED`，提示「enter this provider's models by hand」 | `packages/llm/llm-pi-ai/src/discovery.ts:300-305` |
| F8 | 风险条目在案：同一模型在一个协议上失败、在另一个协议上成功；对策含「**不得让『列表里可选、调用必然失败』成为常态**」 | `discovery/sidebar-asks-2026-09-17/05-risks-and-gates.md:33` |
| F9 | 设置页**已有协议字段**（自定义 provider 卡片写 `api: protocol`；模型列表编辑器有 `api?: string`；Config 校验 `api: z.union(supportedProtocols())`）⇒ R1 的验收形态可复用既有控件 | `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx:143`、`:271`；`ModelListEditor.tsx:58`、`:236`；`packages/llm/llm-pi-ai/src/config.ts:321` |

**四处精度订正**（实质不变）：① 事件词汇表 `GENERATED` 在 `packages/core/session/src/known-event-types.ts:1-6`，闭集起于 `:22`，`model/selection` 在 `:44`；② 测试替身的注册调用在 `packages/test-support/llm-replay/src/index.ts:1252`，不是 `:1008`；③ `catalog.ts:871-877` 对重复/空 id 一律 `invalid()`——调用路径通篇「拒绝 + 指名」；④ **防误读**：`packages/test-support/loader-smoke/tests/fixtures/cli-mock-llm.ts:18-19` 自述「Keyless headless-agent adapter」、`:73` 注册 provider `cli-mock`，它是 CLI 冒烟用的 LLM 替身，**不是**「CLI 作为 LLM 路由」的先例，F3 的「测试替身」不可被后续读者当作先例证据。

## 二、复核中新增的仓库事实（N1–N20，摘录承重者）

| # | 事实 | 依据 |
| --- | --- | --- |
| N1 | 手写路由可命名的协议恰三种 | `packages/llm/llm-pi-ai/src/provider.ts:47-51`、`:61-63`；`config.ts:321` |
| N2 | 兼容门覆盖六种协议 | `catalog.ts:311-318` |
| N3 | 逐字「Catalog routes still reach every protocol through their own provider; only an explicit override is refused」 | `provider.ts:44-45` |
| N4 | 协议决议链 `request.api ?? base?.api ?? routeApi`，全取不到时**报错**并教你把 route 的 api 设成端点实际说的协议 | `catalog.ts:878`、`:879-882` |
| N6 | 归因**只有一个** `user-agent` 头；逐字「omission cannot suppress attribution」；契约句只管 HTTP | `packages/llm/llm/src/attribution.ts:61`、`:62`、`:67`；`index.ts:193-195` |
| N8 | **会话日志由 agent-loop 写而非 adapter** | `packages/core/agent-loop/src/agent.ts:552`、`:555`、`:561`、`:575` |
| N9 | `model/selection` 是会话事件（provider/model/reasoningEffort，"Log-only"），写入 `agent.ts:327` | `packages/api/session-controller/src/types.ts:39-41` |
| N10 | 事件词汇表生成且闭合 | `known-event-types.ts:1-6`、`:22` |
| N13 | **CLI 子代理的能力上限成文清单**：每次运行新进程、无续接/池化/进度流/会话持久化；无人工交互；**助手载荷只有最终文本，推理/中间消息/工具流量/用量/stderr/工作区差异留在产品本地**；无输出 schema/人格/工具过滤/深度强制；无墙钟超时与副作用回滚；当 `model` 省略时由 project/user settings 选择 | `packages/subagent/subagent-claude-code/README.md:174-182`（含 `:176`、`:180`、`:181`） |
| N15 | **误归因已实现**：鉴权类状态码被**主动追加凭据结论**，不区分协议错配 | `packages/llm/llm-pi-ai/src/discovery.ts:337-341` |
| N17 | `assertServiceable(config)` 的函数体就是一行 `resolveProfiles(config.providers)`；写入失败时原子交换保留旧路由 | `packages/llm/llm-pi-ai/src/config.ts:360-362`；`index.ts:296-317` |
| N18 | LLM 服务自述不拥有 provider 传输逻辑，且承诺每次请求都被记录 | `packages/llm/llm/README.md:12`、`:108` |
| N20 | `scripts/` 下**无覆盖 provider 归因契约的门禁**（4 处 attribution 命中全属许可证归属、工具目录条目归属、清单路径等其他语义） | `scripts/gen-third-party-notices.ts:412`；`gen-tool-catalog.ts:595`；`rescope-vendor.ts:333`；`type-equiv.manifest.json:428` |

## 三、子议题 S1–S5

| 编号 | 子议题 |
| --- | --- |
| S1 | 非 HTTP 路由的准入条件：能力缝三角色对 CLI provider 是否成立；归因在无 HTTP 请求时挂在哪；「model-visible ⟺ logged」如何满足 |
| S2 | CLI 与子代理两条路的取舍：提升为 LLM 路由会与子代理路重叠哪些语义，哪些能力只有子代理路能给 |
| S3 | pi 转发的协议错配：机制、错配面、「可执行错误 + 降级」的现状与缺口 |
| S4 | 列表与可用性的一致性：如何避免「列表里可选、调用必然失败」 |
| S5 | 用户侧形态：新面板、配置页还是路由；状态与文案归属 |

## 四、方向清单（按子议题压缩，均带层标记）

| 子议题 | 方向 | 层 |
| --- | --- | --- |
| S1 | 准入条件从「HTTP 请求」改为「请求→可重放流」；CLI 身份全做 Config；归因的进程等值物且禁止静默不发；复用同一 `GenerateOptions` 不新增模型可见输入；不变量要求 route 能回答进程身份；适配器必须声明传输与归属 | [文档][Config][宿主][仅诊断][静态门] |
| S2 | 用 N13 对比两路独有能力；不复用子代理生命周期、取消只走 signal；「谁拥有工具集」必须二选一；启动期诊断「工具流量与用量不可见」；子进程工具不受父会话审批约束须显式声明；seat 标记非 HTTP 路由 | [文档][Config][宿主][客户端][仅诊断] |
| S3 | `api` 选择提前到第一步且默认可见；修正错误归因（不得下凭据结论）；可执行错误列出可选协议；显式降级开关默认关；把 N1/N2/N3 的差异写成表 | [Config][宿主][仅诊断][文档] |
| S4 | 从「可服务」反推可选、手写编辑器标灰；写盘前过 `assertServiceable` 并补拒绝用例；`/model` 标注声明来源与协议；`api` 提升为必填或带默认徽章+握手探测 | [宿主][静态门][客户端][仅诊断] |
| S5 | **是路由不是新面板**，进既有 `/model` 分组；名称与出现由新 Provider 包 Config 定；文案与 i18n 归属；必须经 `registerAdapter` 且 `resolveModel` 完整元数据；定性为 LLM Provider 包非 UI 包；非单元真实组合测试；`adapters-updated` 后即时反映 seat 惰性态 | [客户端][Config][宿主][文档][静态门][仅诊断] |

## 五、反例（覆盖七个主要主张，各 ≥2 条）

- **「CLI 能当一等路由」**：① LLM 服务自述不拥有 provider 传输逻辑；② 与子代理路重复养两套取消/错误语义；③ 进 seat 后用户期待同等元数据，而 CLI 给不出用量。
- **「归因可平移」**：④ 契约只管 HTTP，不改措辞就可「合规地不发」；⑤ 现有两个实现用两种不同机制；⑥ 无门禁覆盖（N20）。
- **「日志可重建即够」**：⑦ 字面成立，但子进程的工具流量/用量/中间消息永不进父会话；⑧ 若允许自带工具，审批门不生效且日志里毫无异常。
- **「默认值无害」**：⑨ 默认失败被归因成凭据问题、错配不留痕；⑩ 目录路由可达全部协议而手写只三种，一个默认兜两个语义。
- **「列表过滤越窄越好」**：⑪ 过窄会砍掉 F7 保留的手工录入出口；⑫ 目录内协议不属三种的模型其实可用。
- **「提升为 seat 即可」**：⑬ 设置页已配置同类事，会造成两个配置入口；⑭ seat 只有三元组，承载不了风险信息。
- **「子代理与路由可复用一套契约」**：⑮ 两侧契约本质不同；⑯ 两套 Config 无法合并不留死字段。

## 六、分层汇总与会话格式

只需文档；需 Config 字段；需宿主代码；需客户端；静态门；仅诊断——各方向已在上表标注。

**「需要改动会话格式的方向」：本议题范围内**未发现**。** 理由落在 N8／N9／N10／N18：模型可见输入由 loop 落盘，CLI 路由只要复用同一条 `GenerateOptions` 路径即自动满足；选择语义已被 `model/selection` 覆盖；传输身份非模型可见输入；事件词汇表生成且闭合。
**该断言的证据边界必须写明**：上述四条只覆盖「模型调用」这一种执行体，因此这是一个**范围判断**，不是覆盖全部执行体的**事实判断**。凡涉及「外部自主执行」是否需要新事件，属本议题范围之外。

## 七、三个最危险的假设

1. **「CLI 输出文本 == 模型回答」**：子进程的工具流量、用量、stderr 留在产品本地（N13 `:180`），父会话日志会看起来像一次普通回答；**日志可重建字面成立、语义为假，且不报错**。
2. **「协议字段有默认值 == 用户已选协议」**：F6 是替用户猜，N15 又把错配解释成凭据问题 ⇒ 用户去改 key，而错因**不留痕**。
3. **「归因可无痛平移到非 HTTP」**：无等价 header hook（N6），最省事的实现是**静默不发**，而契约字面仍成立、且无门禁能发现（N20）。

## 八、交给 ③ 的未决问题

`api` 的 UI 归属与默认呈现（谁定）· 子进程可否用自带工具（产品负责人 + 架构后果评估）· 是否允许自动降级重试及费用/审计口径 · 落 `/model` 还是设置页 · 新包归 `packages/llm` 还是 `packages/subagent` · N3 是否显性化 · 是否改公共契约措辞 · 新增哪条门禁覆盖归因与传输声明 · CLI 路由元数据从何而来 · 交互路径语义。

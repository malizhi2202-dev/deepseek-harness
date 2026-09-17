# R5-3 ③ 结论与建议：其他模型接入

**一句话结论：本议题应拆为两件独立的事——「CLI 作为一等 LLM 路由」技术上可行但会让日志的**语义**为假，判为**只留决定记录**；「pi 转发的协议错配」是真缺陷且可低成本修，判为**立刻做**。**

拆分裁决见 `05-review-record.md`；乙议题的独立记录见 `../r6-cli-route-decision/decision-record.md`。

## 一、事一：CLI 不提升为一等 LLM 路由

理由**不是**「调用没有执行」——调用确实执行了。理由是：**日志对这次执行的描述是假的，而且不变量对此结构性失明。**

- `packages/core/agent-loop/src/agent.ts:542-547` 用 `canonicalHeader({ config, …adapterDefaults, system, tools })` 造出 header，`:552`/`:555`/`:561` 把它写进会话日志。
- 而 CLI 子代理的能力上限被成文登记：当 `model` 省略时由 project/user settings 选择；`agentOptions`、输出 schema、工具过滤等被共享服务拒绝；每次运行是**无续接、无池化、无进度流**的新进程；**助手载荷只有最终文本，推理/中间消息/工具流量/用量/stderr/工作区差异留在产品本地**；无墙钟超时与副作用回滚（`packages/subagent/subagent-claude-code/README.md:174-182`，含 `:176`、`:180`、`:181`）。
- ⇒ 日志里 `request/header` 的 model 字段是**本进程无法证实的声明**。
- 而 `packages/core/agent-loop/src/invariant.ts:31-52` 的三项检查**全部是日志↔请求一致性**：`:32-34` 要求存在 `step/start`；`:35-38` 要求存在 `request/header`；`:39-42` 用 `session.deriveMessages()` 比对**出站请求 vs 日志推导**（失败信息自称 "log-reconstruction desync"）；`:44-52` 用 `headerMatches` 比对 `options.model/system/temperature/maxTokens/stop/tools` vs **折叠出的 header**。它们证明「loop 写的 == loop 发的」，**证明不了「实际执行的 == 日志描述的」**。
- 附带代价：`packages/llm/llm/README.md:108` 逐字「**Model-visible ⟺ logged** — anything that reaches a provider request is reconstructable from the session log」，这句在 CLI 路由下于**语义层**失效；而生成式闭集词汇表（`known-event-types.ts:1-6`、`:22`）里**没有事件**能表达「这是一次外部自主执行」。

外部证据同向：**没有任何实现做到「完整工具循环 + 无状态」**（重发工具块撑爆上下文，或干脆关掉工具）；会话状态是最贵的不变量；**最小稳定面是官方 SDK 或官方线协议，不是屏幕抓取**（终端仿真路线已被官方弃用）。外部半句仅作方向性参考（见 `02-competitive-recon.md` 第一节的承重警告）。

### 附带发现（已知盲区，须记录）

- **归因契约天然不覆盖非 HTTP**：契约句逐字只管 HTTP（`packages/llm/llm/src/index.ts:193-195`），而归因实载**只有一个 `user-agent` 头**，且逐字「omission cannot suppress attribution」（`packages/llm/llm/src/attribution.ts:61`、`:62`、`:67`）；`scripts/` 下**无覆盖该契约的门禁**（N20）。⇒ 一个非 HTTP 的 provider **天然在覆盖之外**，用户会以为「凡是出网都带身份」。本议题「不做」实际上以**偶然**方式保护了这段覆盖率——**不是设计，是巧合**。
- **一处无主的已知缺陷**：`packages/llm/llm-pi-ai/src/discovery.ts:293-298` 的注释**书面承认**「鉴权类失败会被读成凭据问题」，而风险清单 `../05-risks-and-gates.md:33` **未收录**该条。

## 二、事二：协议错配是真缺陷，且可低成本修

**误归因是已实现的**：`packages/llm/llm-pi-ai/src/discovery.ts:337-341` 逐字 `` `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}` `` ⇒ 鉴权类状态码被**主动追加凭据结论**，不区分协议错配；而 `:293-298` 的注释已承认该因果链。

**不对称可援引**：同一条路的两条分支对「协议未填」的处理相反——发现路径 `:299` 是 `request.api ?? 'openai-completions'`（**替用户猜**），调用路径 `catalog.ts:878` 是 `request.api ?? base?.api ?? routeApi`，全取不到时**报错**并教你把 route 的 `api` 设成端点实际说的协议（`:879-882`）。

外部方向明确：主流层**不探测协议**，而是**声明 + 显式覆盖**；**「失败后换协议重试」不是成熟模式**（只对 429/5xx failover，400 直接暴露，因为换后端只会复现坏请求并埋掉真因）。

## 三、推荐（R1–R6）

| # | 动作 | 依据 | 处置 |
| --- | --- | --- | --- |
| R2 | **修误归因**：去掉**无条件**的凭据结论，仅在协议**已显式声明**时保留 | `discovery.ts:337-341`、`:299`、`:319-324` | **P0，与 R1 同批** |
| R1 | **删隐式默认**，让「未声明协议」成为显式状态或响亮可判别地失败 | `discovery.ts:299`；姊妹路径 `catalog.ts:878-882` | **P0，与 R1 同批** |
| R3 | 把 `discovery.ts:300-305` 已有的**可执行错误形态**复制到发现失败路径，并列出可选协议 | `discovery.ts:300-305` | **P1，单独一条** |
| R4 | **不把 CLI 提升为一等 LLM 路由** | 本文第一节（修正版理由） | P2，**决定记录**（乙） |
| R5 | **不加「失败后换协议重试」** | 外部规律 B；`../05-risks-and-gates.md:33` 自身对策即「按模型声明选择 API」 | P2，**决定记录**（乙） |
| R6 | 本议题范围**内未发现**需要改会话格式的方向；不动归因契约措辞 | 见下方边界说明 | P3 |

**R1 的验收形态不需要新设计**：设置页**已有协议字段**——自定义 provider 卡片写 `api: protocol`（`packages/client/ui-settings-models/src/client/CustomProviderCard.tsx:143`、`:271`），模型列表编辑器有 `api?: string`（`ModelListEditor.tsx:58`、`:236`），Config 校验 `api: z.union(supportedProtocols())`（`packages/llm/llm-pi-ai/src/config.ts:321`）。该协议状态由 `CustomProviderCard.tsx:84` 的 `useState(protocols[0] ?? '')` 初始化，而 `:13` 自述协议是「不可默认的三字段」之一 ⇒ **设置页永远点名协议**，这条拒绝只对非 UI 调用方可达，与姊妹路径的既有形态一致，**零客户端改动**。

**`api` 的权威归属**：由**包内 owner** 裁定——`provider.ts:46-51` 的 `PROTOCOLS` 与 `discovery.ts:39-43` 的 `LISTABLE_PROTOCOLS` **今天的取值一致**（都是那三种），但**没有声明派生关系** ⇒ 需指定唯一真相来源，否则将来一方增删即漂移。

## 四、不重开 / 不做 / 边界

- **不把 CLI 提升为一等 LLM 路由**（R4）；**不加换协议重试**（R5）。
- **不动归因契约措辞**：契约只管 HTTP、且无门禁（N20）⇒ 改措辞可「合规地不发」。这是**已知盲区**，不是本议题要修的东西。
- **会话格式断言的证据边界（必须写明）**：支撑「本议题范围内未发现需要改格式」的 N8／N9／N10／N18 **只覆盖「模型调用」这一种执行体**，因此这是**范围判断**，不是覆盖全部执行体的**事实判断**。凡涉及「外部自主执行是否需要新事件」，属本议题范围之外。

## 五、三个最危险假设

1. **「CLI 输出文本 == 模型回答」**：子进程的工具流量、用量、stderr 留在产品本地；父会话日志看起来像一次普通回答，**可重建字面成立、语义为假、且不报错**。
2. **「协议字段有默认值 == 用户已选协议」**：F6 是替用户猜，N15 又把错配解释成凭据问题 ⇒ 用户去改 key，而错因**不留痕**。
3. **「归因可无痛平移到非 HTTP」**：无等价 header hook，最省事的实现是**静默不发**，契约字面仍成立，且无门禁能发现。

## 六、一处最会骗人的用户可见文案

`packages/llm/llm-pi-ai/src/discovery.ts:300-305` 的错误说「enter this provider's models by hand」。用户会理解成「**输模型名就能解决**」，但真正必须补的是 **route 上的协议声明**（`catalog.ts:878-882`）。这把「我们要你选协议」包装成了「输入模型名」——R3 要修的正是这个错位。

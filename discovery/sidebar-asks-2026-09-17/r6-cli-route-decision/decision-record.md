# R6 决定记录：不把 CLI 提升为一等 LLM 路由

本档由 `../r5-other-model-access/` 的五步流程派生（该流程对合并议题只跑一次，裁决时拆为甲/乙两件）。**本档是决定记录，不是待办**；它必须长期保留而不是关闭。

## 一、决定

| 编号 | 决定 |
| --- | --- |
| **R4** | **不把 CLI 子进程提升为 LLM 适配器（一等模型路由）**，保持它今天的**子代理提供者**身份 |
| **R5** | **不引入「某协议失败后改用另一协议重试」**的兜底 |
| **R6** | 本决定**范围内未发现**需要改动会话格式的方向；不动归因契约措辞 |

## 二、R4 的理由（修正版）

理由**不是**「调用没有执行」——调用确实执行了。理由是：**日志对这次执行的描述是假的，且既有不变量对此结构性失明。**

1. `packages/core/agent-loop/src/agent.ts:542-547` 用 `canonicalHeader({ config, …adapterDefaults, system, tools })` 造 header，`:552`／`:555`／`:561` 写进会话日志。
2. CLI 子代理的能力上限已成文登记（见第三节）——其中「当 `model` 省略时由 project/user settings 选择」使日志里 `request/header` 的 model 字段成为**本进程无法证实的声明**。
3. `packages/core/agent-loop/src/invariant.ts:31-52` 的三项检查**全部是日志↔请求一致性**：`:32-34` 要求存在 `step/start`；`:35-38` 要求存在 `request/header`；`:39-42` 用 `session.deriveMessages()` 比对**出站请求 vs 日志推导**（失败信息自称 `log-reconstruction desync`）；`:44-52` 用 `headerMatches` 比对 `options.model/system/temperature/maxTokens/stop/tools` vs **折叠出的 header**。⇒ 它们证明「loop 写的 == loop 发的」，**证明不了「实际执行的 == 日志描述的」**。
4. 因此 `packages/llm/llm/README.md:108` 的承诺——逐字「**Model-visible ⟺ logged** — anything that reaches a provider request is reconstructable from the session log」——会在**语义层**失效；而生成式闭集词汇表（`packages/core/session/src/known-event-types.ts:1-6`、`:22`）里**没有事件**能表达「这是一次外部自主执行」。

## 三、边界依据（直接引用既有事实文档，无需新取证）

`packages/subagent/subagent-claude-code/README.md:174-182` 的成文上限清单即本决定的边界依据：

- 每次运行是一个**新查询与新进程**——无续接、无恢复、无池化、无进度流、无产品会话持久化。
- 实例选择是**静态**的：Profile 行固定 provider 名、可选模型与工具绑定，调用不能动态改选。
- 宿主设置**有意保持权威**：`model` 省略时由 project/user settings 选择。
- 鉴权与账号状态**保持原生**。
- **无人工交互路径**：提问被禁用、权限提示被拒、阻断式对话框一律失败关闭。
- **助手载荷只有最终文本**：推理、中间消息、工具流量、用量、stderr、工作区差异**均留在产品本地**。
- **无可选共享能力**：`agentOptions`、输出 schema、子人格、工具过滤、深度强制被共享服务拒绝。
- **无墙钟超时与副作用回滚**。

## 四、本决定防止的那一处误读（护栏作用）

若无本记录，两句话会被后来的读者当作彼此兼容：

- 上节逐字「助手载荷只有最终文本……均留在产品本地」；
- `packages/llm/llm/README.md:108` 逐字「anything that reaches a provider request is reconstructable from the session log」。

⇒ 这两句在**子代理身份**下并存无事（子代理的产物不是模型请求），一旦把 CLI 提升为 LLM 适配器便直接冲突。**本决定是防止该冲突被无意识地引入的唯一护栏。**

## 五、复活条件

本决定**可翻转**，但翻转前必须满足其中至少一条，并把证据附在本档之后：

1. 出现一个做到「**完整工具循环 + 无状态**」的 CLI 路由实现（本轮外部检索未发现），且其 transcript 有**稳定契约**；或
2. `packages/core/agent-loop/src/invariant.ts` 增加「**执行保真**」维度——要求外部执行通道也产出可核验的等价事件；或
3. CLI 侧的上限清单（第三节）中「助手载荷只有最终文本」与「无可选共享能力」两条被上游消除。

**仅「又一个关掉工具循环的实现」不足以翻转。**

## 六、R5 的理由

- **仓库内部**：风险条目的对策本身就是「按模型声明选择 API」（`../05-risks-and-gates.md:33`）——即**声明优先于探测/重试**。
- **外部方向（仅方向性，见 `../r5-other-model-access/02-competitive-recon.md` 第一节的承重警告）**：主流实现只在限流/服务端错误上 failover，**请求错误直接暴露**，理由是换后端只会复现坏请求并**埋掉真因**；另一家的 fallback 是**模型粒度**、触发条件是上下文长度/审核/限流/宕机，**不是协议不匹配**。

## 七、本决定明确不做

- 不新增 `LlmAdapter` 的 CLI 实现。
- 不为归因契约增加「非 HTTP 等价物」的措辞——契约只管 HTTP 且 `scripts/` 下无门禁，改措辞可「合规地不发」；这是**已知盲区**，须由契约所有者另行处置。
- 不把 CLI 子代理路与 LLM 路由路的 Config 合并（两侧契约本质不同）。

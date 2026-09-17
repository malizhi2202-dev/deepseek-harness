# 01 · 已复核事实

约定：路径相对仓库根；行号为本次核查时的工作区行号。标注「自核」的条目由本循环逐行核对过，不是子代理转述。

## 一、失败之后今天只有四条路，没有派生

| 编号 | 事实 | 依据 | 复核 |
| --- | --- | --- | --- |
| F1a | 唯一的内联恢复动作是「重试」，默认不重试 | `packages/core/agent/src/runtime-types.ts:122`（`RequestErrorAction = { kind: 'retry' } | undefined`）；默认返回 `undefined`「leaves the failure terminal」 | 自核 |
| F1b | 不重试即把失败抛成终局，不新建 agent | `packages/core/agent-loop/src/agent.ts:437-447`：`if (action?.kind !== 'retry') throw new LlmError(...)` 然后 `continue` | 自核 |
| F1c | 其余三条路是补日志边界、转成模型可处置的错误结果、递归上限截断 | `packages/core/session/src/repair.ts:29,133`；`packages/core/tools/src/index.ts:590-593`（`{ kind: 'block'; feedback }` 物化为 `isError`） | 自核 |

**结论**：仓库中没有任何代码把 `tool/result.error`、`turn/end.reason.error` 或 `assistant/attempt` 变成新的子代理请求（`packages/subagent/*/src` 与 `packages/guard/*/src` 检索无命中）。

## 二、主体与入口

| 编号 | 事实 | 依据 | 复核 |
| --- | --- | --- | --- |
| F2 | 「谁有权操作这个孩子」是显式枚举，不靠上下文推断 | `packages/subagent/subagent/src/types.ts:65-67`：`SubagentInterruptAuthority = { kind: 'user'; parentSessionId } | { kind: 'ancestor'; agent }` | 自核 |
| F3a | 人类入口与模型入口是两个独立开关 | `packages/skill/skill/src/index.ts:49-54`（`SkillInvocationPolicy { modelInvocable, userInvocable }`），人类路径 `:148-154` | 子代理核，行号一致 |
| F3b | 人类手势不可伪造 | `packages/skill/tool-skill/src/index.ts:163-175`：「Only `source.kind === 'user'` messages are scanned — external text cannot forge the gesture」 | 自核 |
| F3c | 命令的输入源只有人类一种变体 | `packages/interaction/commands/src/types.ts:72-77`；宿主解析输入行并记 `command/run`，`packages/interaction/commands/src/index.ts:362-372` | 子代理核 |
| F4 | 命令路径在结构上无法承载审批 | `packages/interaction/user-approval/src/index.ts:207-215`：`approval.request()` 要求日志位于未闭合 turn 内，原话「must be turn-enclosed (a bare event between turns is crash-tail garbage on reload)」；`packages/interaction/commands/src/index.ts:333-341`：「direct log-only appends — no turn wraps them」 | 自核 |
| F5 | 现有控制 RPC 的父会话是客户端自报 | `packages/subagent/subagent/src/control.ts:19-27`（schema 直接收 `parentSessionId`）；宿主只 `ctx.get('agents')?.get(parentSessionId)` 查活体，否则抛 `subagent/parent-unavailable`，`packages/subagent/subagent/src/index.ts:423-430` | 自核 |
| F13 | 人类侧今天只能对**已存在**的可续跑子代理续写/打断/列举 | `@Remote('list')` / `@Remote('prompt')` / `@Remote('interruptByParent')`，`packages/subagent/subagent/src/index.ts:382-497`；`commands.register` 在 `packages/subagent/**` 命中 0 | 子代理核 |

## 三、载荷、描述符与权限

| 编号 | 事实 | 依据 | 复核 |
| --- | --- | --- | --- |
| F6 | 委派载荷只有一段文本，无结构化 brief、无必填未知项 | `packages/subagent/subagent/src/types.ts:145-149`（`SubagentStartRequest.prompt: ContentBlock[]`）；`packages/subagent/tool-subagent/src/index.ts:509-510` 落成 `prompt: [{ type: 'text', text: args.prompt }]` | 自核 |
| F7a | 持久描述符公共字段只有三样，没有失败来源 | `packages/subagent/subagent/src/descriptor.ts:51-58`（`version` / `mode` / `provider`），版本常量 `:48` | 自核 |
| F7b | 新增组成输入是刻意的版本变更 | `packages/subagent/subagent/src/descriptor.ts:44-47` | 子代理核 |
| F7c | 可续跑描述符**已经**带 `toolFilter` | `packages/subagent/subagent/src/descriptor.ts:72-86`（`readonly toolFilter?: ToolRestriction`，与 `persona`/`agentModel` 同级） | 自核 |
| F7d | 一次性描述符只有可选 `label` | `packages/subagent/subagent/src/descriptor.ts:61-69` | 子代理核 |
| F8 | 已有「具名未知 + 交给模型裁决 + 禁止盲试」模板 | `packages/core/session/src/repair.ts:104-108`：「Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.」；词汇 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` `:15-18` | 自核 |
| F9a | 委派时子代理审批策略被钉成 `'never'` | `packages/subagent/subagent/src/child-agent.ts:229`（JSDoc「its asks are rejected deterministically」）、`:245`、写入 `:265-267` 带 `source: 'delegation'` | 自核 |
| F9b | `'never'` 在派发之前就判掉，结果是 `'rejected'` | `packages/interaction/user-approval/src/index.ts:261-266`：「The 'never' policy is decided HERE, before any dispatch」，随后 `return 'rejected'` | 自核 |
| F9c | 子代理被告知不要重试、应在回复里说明限制 | `packages/subagent/subagent/src/child-agent.ts:171-175` | 子代理核 |
| F10a | 递归闸门存在且有默认值 | `packages/subagent/tool-subagent/src/index.ts:93-98`（`maxDepth` 默认 `3`，`0` 完全禁止派生）；数值上限要求 provider 声明 `depthLimit`，否则装载失败，`:322-325` | 自核 |
| F10b | 深度是单调下限，冷恢复不能降低 | `packages/subagent/subagent/src/depth.ts:35`（`Math.max(header, runtime)`）；`packages/subagent/subagent/src/child-agent.ts:49-58` | 子代理核 |
| F10c | 子代理**默认继承父的工作目录** | `packages/subagent/subagent/src/child-agent.ts:146`（`cwd: parentHeader.cwd`） | 子代理核 |
| F10d | 没有按父级的并发上限；其辩护词不覆盖物理工作树 | `packages/subagent/tool-subagent/src/index.ts:463`（`isConcurrencySafe: () => true`，注释理由为「Children never mutate the parent session」） | 自核 |
| F10e | 每次激活的预算刻意不进持久描述符 | `packages/subagent/subagent/src/descriptor.ts:15-19`：「Cold resume … neither restores the prior budget nor inherits the parent's current one; the resumed route's defaults apply instead」 | 自核 |

## 四、关联与可见性

| 编号 | 事实 | 依据 | 复核 |
| --- | --- | --- | --- |
| F11a | 工具未声明投影，结构化输出只经渲染变成文本 | `packages/subagent/tool-subagent/src/index.ts:422-460`；`tool/result.meta` 缺席，`packages/core/agent-loop/src/tool-calls.ts:282-289`、`packages/core/tools/src/index.ts:283-295` | 子代理核 |
| F11b | 前台运行的子会话 id **不渲染**，父日志里连 id 都不可恢复 | `packages/subagent/tool-subagent/src/index.ts:452-459`（只输出 output 文本） | 自核 |
| F11c | 客户端按工具名前缀猜测委派，属命名启发式 | `packages/client/ui-chat/src/client/contract/turn-process.ts:54-60`（`name === 'subagent' || startsWith('subagent_')`） | 子代理核 |
| F12a | 只有三种事件能进模型历史 | `packages/core/session/src/types.ts:387-396`（`SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'`） | 自核 |
| F12b | 非 surface 事件带 surface 元数据直接抛 | `packages/core/session/src/surface.ts:194-205` | 自核 |
| F12c | 人类对子代理的续写只写子日志，父会话零事件 | `packages/subagent/subagent/src/index.ts:431-456`（source 带 rpcId）；`packages/subagent/subagent/src/continuation.ts:269-284` | 子代理核 |
| F12d | 规则原文 | `AGENTS.md:108`（`SessionEventMap` 成员默认 required-on-read，未知类型拒整份日志除非 `ignorable: true`；只有结构性变更才 bump 版本）、`AGENTS.md:111`（「Model-visible ⟺ logged」：新模型可见输入需要会话事件）；`docs/architecture.md:119` 同义 | 自核 |

## 五、失败的可得素材（S1 的输入面）

- `turn/end` 携带 `TurnEndReason`（completed / aborted / blocked / error{`LlmFailure`} / max-tokens / interrupted）：`packages/core/session/src/types.ts:198-219,282`。
- `assistant/attempt` 保留失败/重试/取消的原始流而不伪造模型可见历史：`packages/core/session/src/types.ts:314-319`。
- `LlmFailure` 字段：`packages/llm/llm/src/types.ts:40-51`。
- 子代理自身终局事实含 `output` / 可选 `structured` / 可选 `diagnostic`（≤4096 字节，与 output 分开呈现）/ `stopReason`：`packages/subagent/subagent/src/types.ts:268-297`。
- 前台与后台对失败产物的处置不对称：前台把 diagnostic 与部分输出拼进错误文本（`packages/subagent/tool-subagent/src/index.ts:182-194,210-214`），后台除 completed 外一律判 failed 且不带部分输出（`packages/subagent/subagent/src/run-settlement.ts:29-53`）。

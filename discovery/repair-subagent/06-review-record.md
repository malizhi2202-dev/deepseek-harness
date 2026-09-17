# 06 · 复核与偏离记录

## 一、方法偏离（必须声明）

| # | 技能默认要求 | 实际做法 | 原因 |
| --- | --- | --- | --- |
| 1 | `bmad-deep-recon` 应建 run folder / `brief.md` / `digests/` / `research.md` / `.memlog.md` | 未建任何文件，证据只存在于回传正文 | 循环硬约束：门通过前不写盘 |
| 2 | 技能要求执行 plan gate / 交互确认 | 直接进入执行 | 任务已给定对象清单与交付格式 |
| 3 | `bmad-party-mode` 应解析 BMAD 名册 | 退到三视角（PM / 架构 / BA） | 仓库根无 BMAD 项目配置；解析脚本需写盘，与只读约束冲突 |
| 4 | 外部检索应交叉验证 | `web_search` 在本环境不可用，全部 `web_fetch` 单点直连 | 环境限制，已在 `03` 的未验证清单声明 |

## 二、本循环自核的条目（逐行核对，非转述）

| 核查项 | 结论 | 依据 |
| --- | --- | --- |
| 失败后是否只有内联重试 | 是，默认 `undefined` 即终局 | `runtime-types.ts:122`、`agent-loop/src/agent.ts:437-447` |
| 子代理主体是否为显式枚举 | 是 | `subagent/src/types.ts:65-67` |
| 命令路径能否承载审批 | 不能 | `user-approval/src/index.ts:207-215`、`commands/src/index.ts:333-341` |
| 控制 RPC 的父会话是否客户端自报 | 是 | `control.ts:19-27`、`subagent/src/index.ts:423-430` |
| 委派载荷是否只有文本 | 是 | `subagent/src/types.ts:145-149`、`tool-subagent/src/index.ts:509-510` |
| 描述符公共字段 | 只有 `version` / `mode` / `provider` | `descriptor.ts:51-58` |
| 可续跑描述符是否已带工具过滤 | **是**，与 `persona`、`agentModel` 同级 | `descriptor.ts:72-86` |
| 子代理审批策略 | 钉成 `'never'`，且派发前判掉 | `child-agent.ts:229,245,265-267`、`user-approval/src/index.ts:261-266` |
| 递归上限默认值与装载校验 | 默认 `3`，`0` 禁派生；缺能力装载失败 | `tool-subagent/src/index.ts:93-98,322-325` |
| 并发是否按父级限流 | 否，`isConcurrencySafe: () => true` | `tool-subagent/src/index.ts:463` |
| 前台是否渲染子会话 id | 否，只渲染 output 文本 | `tool-subagent/src/index.ts:452-459` |
| 可进模型历史的事件类型 | 只有三种 | `core/session/src/types.ts:387-396` |
| 非 surface 事件带 surface 元数据 | 直接抛 | `core/session/src/surface.ts:194-205` |
| 具名未知模板原文 | 逐字一致（含「Do not retry blindly.」） | `core/session/src/repair.ts:104-108` |

## 三、对前序产出的订正

| # | 原说法 | 订正后 | 来源 |
| --- | --- | --- | --- |
| 1 | 「本议题唯一的格式级项是给描述符加失败来源」 | **不完整**：会话事件的 event-ization 也可能是格式级（「Model-visible ⟺ logged」+ surface 类型封闭） | Mary；`AGENTS.md:108,111`、`F12a` |
| 2 | 「只读可以由审批兜底」 | **错**：子代理审批必然被拒，且沙箱内的写不需要审批 ⇒ 只读必须靠工具过滤 / 守卫主动限制 | F9a–F9b 复核时确立 |
| 3 | 递归上限「默认值待定」 | 已定为 `3`，`0` 完全禁止派生，且数值上限要求 provider 声明能力否则装载失败 | `tool-subagent/src/index.ts:93-98,322-325` |
| 4 | 某报告把退出码标记正则的注释区当作实现位置 | 实现位置在注释区之后；引用时按整段区间写，避免只引注释 | 自核 |
| 5 | 把 `repair.ts` 的具名未知当通用归因模板 | 它是冷加载合成的工具结果；照抄须**写明边界**，并声明这是扩大适用面 | ④ 一致同意第 7 条 |

## 四、编号纪律

- `S1–S4`：子议题；`F…`：仓库事实；`E…`：外部证据；`D…`：头脑风暴方向；`J…`：判决依据；`V…`：否决项；`G…`：专家团分歧；`R…`：推荐；`O…`：门后开放项。
- 跨文件引用一律用编号，不重复正文；行号只出现在 `01`，其余文件引用编号。

## 五、合规自检

- 循环全程只读：未创建、修改或删除任何仓库文件，未读 `/tmp`，未运行任何写入类命令。
- 文档在人工审核门之后落盘（门内裁决见 `00` 与 `05`）。
- 全文使用仓库相对路径；不含运行环境与部署专有信息（网络监听、进程标识、家目录绝对路径、账号、第三方网关模型名与错误码）。
- 未复制任何运行时会话的审批策略文案；涉及审批只引用其通用语义（结果枚举与 fail-closed）。
- 文件以单个结尾换行结束；散文一段一行。

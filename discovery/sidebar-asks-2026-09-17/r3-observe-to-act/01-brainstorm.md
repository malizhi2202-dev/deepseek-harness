# R3-1 ① 头脑风暴

依据：第 1、2 轮连续两次由产品经理提出的缺口（五个发现全是观察、没有一个动作）；`packages/client/ui-jobs/src/client/index.ts:24` 证明 tab 体可 `inject: ['sessions']`；`api/session-controller/src/client/contract/session.ts:86,112,133,140` 与 `contract/sessions.ts:97` 提供 `prompt`/`cancel`/`loadThrough`/`command`/`fork`。

15 个方向，Top 5：
1. **回滚检查点（preview → 确认两段式）** —— 唯一今天完整可用且自带可逆保证（rewind 前先拍 guard checkpoint）。
2. ★ **按钮即命令行** —— 动作只生成一行 slash command 经 `session.command()` 派发，走既有 commands 缝合点，免费获得 locale/i18n、快照录制、双 SDK 投影与 `command/run`+`command/done` 审计轨迹。
3. ★ **失败即分叉锚点** —— `fork({atSeq: 失败 turn.seq})` + 换模型 + 重发（切点 = 该 seq 后第一个 `turn/end`，不破坏原会话）。
4. ★ **失败上下文包** —— 把 `turn/end` reason + `isError` 工具结果 + `lastAgentError` 折成可复制文本；它是**用户消息**，因此绕开"Model-visible ⟺ logged 必须新增 session 事件"。
5. ★ **审批即动作** —— 面板只渲染 agent 发起的 `ApprovalRequestEvent`，零新缝合点。

★ 其他：换模型重试、跳到失败事件、打断子代理、暂停/恢复目标、右侧面板＝动作控制台、把 retry-turn 与 resume-at-seq 拆成两个按钮。

明确否决：客户端直调 `ctx.jobs.kill`（跨 wire 边界，必然需新 RPC）；客户端自行推断 host-vs-gateway 归因（`step/end` 无信息，会撒谎）；新造"动作"能力缝合点（过度设计，commands 已是缝合点）；无人值守自动重试（与 agent-initiated 审批冲突，且本 profile 已 `- id: auto-continue disabled: true`）；编辑失败消息再重发（与会话日志不可变性冲突）。

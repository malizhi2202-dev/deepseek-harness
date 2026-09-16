# Agent Note：聊天 Session 永不请求审批

Status: implemented

[English](2026-09-16-tuitui-approval-policy-never.md) | 中文

## 问题

tuitui 的 Session 按部署的权限预设创建，而该预设的审批旋钮是 `'ask'`。在 `'ask'` 下，审批服务会把请求交给所有已组合的应答方，而 `dsh web` 部署会组合 Web GUI 的应答方——它会一直等待有人看着该 Session 的审批卡片。没有人看着，因为这个 Session 属于一个 IM 聊天。

于是该轮永不结束。网桥按聊天维护的 `busy` 标志只有 `turn/end` 会清除，因此它一直为真，后续每条消息都被回复 `上一条还在处理中，请稍等。发送 /new 可中断当前任务。`，聊天在 `/new` 之前彻底卡死。会话日志记录了这次卡住的完整过程：模型通过 `bash` 执行 `pwd`，该主机没有可用的 `workspace-write` 沙箱后端，模型带 `sandbox_permissions: danger-full-access` 重试，`approval/asked` 成为日志的最后一个事件。

只有在应答方能够作答时 `'ask'` 才是安全的。聊天入口做不到，而且它的失败形态是无限期挂起而非拒绝，因此网桥不能让部署预设来决定该策略。

## 决策

`getOrCreateChat` 在配置的权限预设写完自己的旋钮之后，用 `setApprovalPolicy`（`@deepseek-ai/dsh-user-approval`）向新 Session 的审批策略追加 `'never'`。该追加位于最后，因此会话的策略折叠结果为 `'never'`。

`'never'` 会在任何应答方看到之前把每次请求都判定为 `'rejected'`，于是提权立即失败，该轮以模型可以自适应处理的拒绝结束。审批插件本就会在系统提示词中声明这一立场（`Approval prompts are disabled in this session: … do not request sandbox escalation`），因此模型被告知不要发起请求。`setApprovalPolicy` 是文档指定的初始化写入器：面向活动 Agent 的 `setPolicy` 会向一个从未有过其他策略的 Session 注入一条模型可见的「审批策略已变更」通知。

Session 的沙箱仍来自卡片的 `permissionPreset`，因此给聊天更宽权限依旧是显式的部署选择，而不是解除提示的副作用。

该钉死复用了「无人能作答的 Session」已有的答案：[被委派的子代理](2026-08-10-subagent-approval-pinned-never.md) 出于同样的原因通过持久化的 `approval/policy` 事件钉死 `'never'`。那条笔记的 `source: 'delegation'` 被刻意不复用——该事件把 `source` 声明为唯一的委派标记，并把缺失 source 读作运行时切换，而入口在创建时切换 Session 策略正是运行时切换。

## 考虑过的替代方案

**在聊天里请求审批并接受回复。** 这才是聊天网桥真正想要的能力，也是自然的后续：它需要一种消息关联状态，让某轮处于等待裁决的状态，还要处理部分作答。对本次卡死而言超出范围。

**用卡片设置预设的审批旋钮。** 权限预设已按其自身 spec 写入审批值，因此单独加一个卡片字段等于重复声明该预设拥有的旋钮；而且除非每个部署都去改，默认预设仍会留下 `'ask'`。

**保留 `'ask'` 并依赖 fail-closed 兜底。** 该兜底只在没有任何应答方被组合时生效。`dsh web` 总会组合一个，因此本网桥面向的部署永远走不到那条路径。

**给空 catch 定级：用超时兜住 `busy`。** 给挂起切时间片只是掩盖死锁，仍然会丢掉该轮，而且审批请求依旧无人作答。

## 后果

聊天 Session 无法在审批上阻塞。需要提权的工具会以拒绝失败，模型报告它做不到什么——观察到的 `pwd` 案例最终以一段解释收尾，而不是卡死的聊天。

预设的审批旋钮对这些 Session 不再起作用。`permissionPreset` 仍选择沙箱模式，因此想要无需提权的完全访问的部署，应选择携带 `danger-full-access` 的预设。

同一类挂起在挂载了 `tool-ask-user` 的 preset 下对 `ask_user_question` 依然存在；它记录在包 README 的「已知限制」中，尚未处理。

`packages/tuitui/tuitui/tests/loader-composition.spec.ts` 断言所创建的 Session 记录的 `approval/policy` 为 `'never'`。

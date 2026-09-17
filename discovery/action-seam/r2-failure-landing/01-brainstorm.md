# R2-B ① 头脑风暴（动作结果的落点与失败可见性）

15 个方向，Top 5：
1. **用带判别标签的三态结果承载面板动作**，复用 ui-commands 已有的可区分语义。
2. ★ **面板内"动作结果条"**：三态 + 一条指向会话日志对应行的入口。
3. `cancel()` 返回判别结果（`stopped | nothing-running`）—— "什么都没做"语义的死结。
4. ★ 在 `ui-primitives` 提一个 outcome 原语，取代各包各写一遍的 `role="alert"`（实测 **26 处 / 13 文件**，其中 `packages/client/*` 内 20 处 / 10 包）。
5. ★ **文案规范**：失败必须说清"谁的动作、什么状态、什么都没做"。

★ 其他：面板自身谓词判不可用即禁用（insensitive），不点后再报错；`CommandDescriptor` 增加 host 计算的 availability 字段（**本轮决定暂不加**）；会话域 RemoteError 强制携带 `details.reason`；"什么都没做"走 info 级而非 error 级；命令名拼错给最近名建议；面板直接呈现 `command/done` 文本；面板动作即使不是斜杠命令也落一条 `command/run` 式审计事件；跨面板"什么都没做"契约测试套件；面板"推荐唯一下一步"槽位 + 理由文案。

**否决**：把冻结的 `{matched:boolean}` 扩成联合类型（`apply.ts:373-378` 已是压缩点）；availability 由客户端强制（"客户端 busy 不是 enforcement"）；把宿主已记录的结果再回显到 composer（`ui-commands/service.ts:328-341` 已刻意不做）；为面板新增第二套通知服务（违反"按钮属于锚定它事实的面板"）。

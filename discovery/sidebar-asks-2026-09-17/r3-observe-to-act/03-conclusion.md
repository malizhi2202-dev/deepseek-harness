# R3-1 ③ 结论与建议

**结论：前几轮的"只读面板"是设计选择，不是宿主限制。右侧栏 tab 插件今天就能带动作。**

1. **可表达性**：tab 体 `inject: ['sessions']`（先例 `packages/client/ui-jobs/src/client/index.ts:24`）后即可调 `session.command(line)`、`cancel()`、`prompt(content,'queue'|'steer')`、`loadThrough(seq)`、`sessions.fork({sessionId,atSeq})`。六问中 **4/6 零 host 新能力可表达**：换模型重试、跳到失败事件、回滚检查点、重试本轮（⚠️ 是新 turn、新 seq，**不是重放同一 turn**）。
2. **两个做不到的不是缺能力缝，是缺"用户可发起的入口"**：停后台 job（`ctx.jobs.kill` 存在于 `packages/jobs/jobs/src/index.ts:120`，但只有模型工具在调，无 client RPC）与派生修复子代理（`ctx.subagents` 存在，委派只有模型工具，**subagent 包无任何 `commands.register`**）—— 两者都只需补 **Consumer 角色（一个 slash command）**，无需新 Service Definition/Provider。真正需要格式级改动的只有"精确到 step 的失败归因"。
3. **架构规则（经专家团收窄，已采纳）**：**会改会话状态的走命令行，移动视口的走类型化客户端调用**。理由：`session.command(line): Promise<RemoteResult<{ matched: boolean }>>` 是 "pure admission semantics (the host executor durably logs the lifecycle)"，**区分不了"无此命令/审批被拒/执行失败"三态**；且把纯读的 `loadThrough` 包成命令会造出**假审计**。
4. **诚实约束**：动作结果 UI 只能报"已提交/未匹配"并把去处指向 `command/run|done` 轨迹，**不得假装知道更多**（N1）。
5. **MVP 与顺序（负责人决策：先跳转）**：**先「跳到失败事件」**（纯读、零依赖风险、且是回滚的前置）**→ 再「回滚检查点」**，且回滚跟随迁移决策（见 `r3-version-line-cost/`：它整个建立在声明已不兼容的检查点插件上）。
6. **不与面板捆绑的独立议题**：停后台 job、派生修复子代理（专家团一致要求独立决策、独立改动；派生修复子代理另依赖"失败上下文包"）。
7. **设计原则（已采纳）**：面板应**推荐"一个"下一步动作并说明理由**，而不是给四个不排序的按钮 —— 否则用户得回来做面板本该替他做的分析。
8. **验收口径（已采纳）**：有用 = 一次点击把下一步分析变成可判定结果 + 落进 `command/run|done` 可事后归因 + 失败时讲清"什么都没做"；危险 = 不可逆无预览 / 归因不确定仍可点 / 名称暗示做不到的事 / 撤销范围与文案不一致。**按钮文案必须逐项列出恢复什么、不恢复什么，且该文案是被测试断言的字面量**（外部证据：Claude Code `/rewind` 不恢复 bash 改动与多数子代理改动；Cursor 只回文件不回消息；LangGraph 把 replay 与 fork 分开）。

**第 2 轮结论的翻案（已采纳）**：**要翻** —— 失败归因面板（其产出现在是 5 个动作的锚点，归因错＝动作错 ⇒ `unattributed` 时必须把动作按钮**硬禁用**）、智能体派生面板（只读依据作废）、只读终端面板（姿态与"另开 jobs 面板带 kill"自相矛盾）、检查点时间线（回滚的落脚点，"查看器"不够用）；**只翻理由不翻设计** —— 任务观测 tab；**基本不翻** —— 评估面板、成本面板。

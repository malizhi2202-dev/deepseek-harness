# 成本/评估观测数据源 ① 头脑风暴

本议题为 `../README.md:55` 预告之外的下一轮子议题，走专家团给出的**例外路径**（增量含待裁决决策 ⇒ 新起目录走满 01–05），理由见 `05-review-record.md`。

组织方式：子代理按 `bmad-brainstorming` 展开；BMAD 名册解析不可用（需写盘），退到三视角：John（产品/用户价值）、Winston（架构/长期代价）、Mary（业务分析/仓库惯例与审计）。

## 一、对第 1 轮 step-0 的三处修正

| # | 修正 | 依据 | 分级 |
| --- | --- | --- | --- |
| 修正 1 | 右栏 tab 类型**不止一个**：已提交树有三个（`guide`、`files`、`text`），跨包注册 | `packages/client/ui-sidebar-right/src/client/index.ts:145`；`packages/client/ui-sidebar-files/src/client/definition.ts` 的 `kind: FILES_KIND`；`packages/client/ui-sidebar-textpreview/src/client/definition.ts` 的 `kind: TEXTPREVIEW_KIND` | 【复核】 |
| 修正 2 | 会话级用量**丢路由归属**：`tokenUsage` 的 state 只有 `{totals, last{turn,step,buckets}}`，wire 出去是 `state.totals` | `packages/llm/token-meter/src/usage-projection.ts:56-63`、`:149` | 【复核】 |
| 修正 3 | 「无评分」不等于「无事实」：人类判断已是耐久会话事件 | `packages/feedback/message-feedback/src/types.ts:53-55`（声明合并）；`packages/feedback/message-feedback/src/types.ts:17-32`（`messageId`/`rating`/`note?`） | 【复核】 |

修正 2 须与后续精确化合读：**缺的是桶额到路由的归属，不是路由数据本身**（见 `04-panel-verdict.md` 的 A3）。

## 二、方向清单 D1–D20

| 编号 | 方向 | 数据从哪来 |
| --- | --- | --- |
| D1 | 会话级四桶总览 | `tokenUsage` 投影（`packages/llm/token-meter/src/projection.ts:13-18`） |
| D2 | 单轮明细只做入口 | `deriveTurnTokenUsage`（`packages/llm/token-meter/src/turn-usage.ts:178`） |
| D3 | 缓存三桶成列 + 命中率 | `packages/llm/llm/src/types.ts:141-163` |
| D4 | 上下文占用与组成分列 | `packages/llm/token-meter/src/projection.ts:20-66` |
| D5 | **分路由用量投影**（最关键缺口） | 每轮 `routes`（`turn-usage.ts:7-9,26`）+ `assistant/message` 的来源标注 |
| D6 | 用户可编辑价表 | settings 命名空间 + 模型信息的路由键 |
| D7 | 金额派生 + 缺价目态 + 估算分栏 | D5 × D6；估算须标注系统性偏差 |
| D8 | 轮次结局分布（新投影） | 六种 `turn/end` 原因（`packages/core/session/src/types.ts:198-218,282`） |
| D9 | 失败链（时间序 + 工具调用） | `packages/core/session/src/types.ts:341`；`packages/llm/llm/src/types.ts:105` |
| D10 | 人类反馈聚合 | `feedback/*` 事件（已耐久，见修正 3） |
| D11 | 产物事实 | 既有产物面板先例 |
| D12 | 回归门禁信号 | 基准门与快照族，但**结果不落盘** |
| D13 | 遥测严重度作为对外面 | 出站且受反馈门控，不能当本地面板源 |
| D14 | 新右栏 tab 类型 | 两阶段注册（类型进 `ctx.sidebarRightTabs`，body 进 `sidebar.right.pane.tab` 座位） |
| D15 | 写死口径权威 | 两个 cumulative 口径不同，必须指定唯一权威 |
| D16 | 零宿主改动证明 | 座位是会话作用域，标准 props 已含投影读取 |
| D17 | 面板内下钻 | 既有座位机制 |
| D18 | 跨会话/跨项目汇总 | 列表 hints 是 **partial**；存储层无用量列 ⇒ 需宿主聚合端 |
| D19 | 子代理/分叉 roll-up | 会话 header 的父会话与来源字段 |
| D20 | 对外导出面 | 导出与协议面只给占用不给钱 |

## 三、Top 5

1. **D5 分路由用量投影**——唯一上游瓶颈；不做则金额静默错误，且既有 wire 形状不得改动。
2. **D1 会话级总览**——真正零宿主改动的可见价值。
3. **D8 结局分布**——事实已耐久，只差聚合。
4. **D6 + D7 价表与金额**——与既有 R14 重叠，按 R14 对策执行。
5. **D15 口径分工**——否则出现多个互相矛盾的「会话累计」。

## 四、反例（三类说法各 ≥2 条）

**「token 数能当钱用」不成立**：四桶单列本身就是计费价差，按总量计价等于给缓存读按最高档算；路由归属在会话级已丢；失败与重试的尝试同样计费，只数成功消息必低估。

**「没有评分概念就不能做评估面板」不成立**：人类判断已是耐久事件；六种结局词汇已耐久；失败有三条独立来源可交叉。

**「已有行内检查器就不需要新面板」不成立**：两个 cumulative 口径不同，必然不一致；座位不同（会话视图环 vs 右侧栏座位）；右栏已多实例。

## 五、分层与格式结论

- 纯投影即可完成 12 条：D1 D2 D3 D4 D9 D11 D13 D14 D15 D16 D17 D20。
- 需新写入端但不改事件契约 8 条：D5 D6 D7 D8 D10 D12 D18 D19。
- **需新增会话事件或格式变更 0 条 ⇒ 本议题不需要格式变更。**
- 唯一可能触发格式变更的是可选加固项「把当时价表快照绑进日志」，与既有「历史不回填」冲突，不做。

## 六、三个最危险的假设

1. 「四桶足以定价」——错则换过模型的会话金额静默错误，界面无从察觉。
2. 「列表 hints 完整」——错则跨会话面板少算，且结果随缓存冷热漂移。
3. 「会话视图的行内累计就是会话总量」——错则两处都自称权威，口径冲突被伪装成缺陷。

## 七、交给 ③ 的三条未决项

1. 金额做不做、以及它与既有 R14 的关系。
2. 跨会话汇总的归属（宿主聚合端 vs 扩存储索引列）。
3. 评估面板的边界（只展示派生事实，还是引入分数）。

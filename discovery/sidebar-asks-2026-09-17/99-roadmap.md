# 三轮汇总结论与建议改动清单

状态：第 1 轮、第 2 轮均已完成并通过审核门；第 3 轮未开（候选见 `00-subtopics.md`）。**本流程不执行代码改动**，下表的《建议改动清单》只描述改哪个文件、改什么、为什么，执行与否由负责人另定。

## 一、第 1 轮结论汇总

1. **判定依据被纠正三次**（C1 免重启、C2 插件"已安装但已禁用"、C3 成本/评估数据已在客户端），这三条改变了后续所有判断，是第 1 轮最大产出。
2. **任务观测 V1 合理且已交付**，但 jobs 段与会话头部入口重复；侧栏应只留"汇总 + 失败"。
3. **智能体派生面板必须复用既有派生逻辑**，其与头部浮层不重复的关键是"用全量会话摘要建树"。
4. **成本 token 口径可行、金额口径不可行**（无价源）；**评估只展示派生事实**，唯一宿主缺口是全会话失败计数。
5. **只有两类因果可证**（结构级联、时序级联）；任务级依赖不可证，画出来即为伪造。
6. **治理走"默认隐藏 + 溢出入口 + 数量预算 + 准入判据"**，且因缺 `order` 字段，元数据先行是硬前提。

## 二、建议改动清单（第 1 轮结论推导出的，尚未执行）

### 阶段一：让新增面板"能活下去"（负责人决策 5 的直接落实）

| # | 目标文件 | 改什么 | 为什么 |
| --- | --- | --- | --- |
| 1 | `packages/client/ui-sidebar-right/src/client/tab-registry.ts` | 给 `SidebarRightTabDefinition` 增加 `icon`、`order` 与声明式可见性字段（default-on / available / hidden），并定义默认值与校验；`badge?` 与 `section?` 缓做，依据 [r2-metadata-and-visibility/03-conclusion.md](r2-metadata-and-visibility/03-conclusion.md) 第 2 条（Rule of Three） | 没有 `order`，"默认可见预算"无法表达；没有 `icon`，未来降到图标轨道即不可读（VS Code 明文要求每个 View 必须有图标） |
| 2 | 注册表与布局 store（`ui-sidebar-right/src/client/stores.ts`、`ui-dockkit` 的 tab strip） | 按声明式可见性决定默认打开集合；strip 增加溢出入口（"更多"菜单） | 现在 `+` 只打开 guide 页，芯片 44–170px 溢出无菜单，类型一多即不可发现 |
| 3 | 新增卫生门禁（`scripts/`） | 输出所有 kind 的 section/order/default，对重复 `order` 与超预算的默认开启报错 | 把"默认开启"从隐式排序变成可机器检查的预算；今天重复 `order` 静默通过 |
| 4 | `docs/` 或 `.agents/notes/` | 记录"新增 kind 需拥有独立 `dsh-resource://<type>/…` 地址域"的准入判据 | 从源头控制右栏容量，避免用新增 kind 解决本可以是一个镜头的问题 |

### 阶段二：Next（按顺序）

| # | 目标 | 改什么 | 为什么 |
| --- | --- | --- | --- |
| 5 | 新包 `packages/client/ui-sidebar-agents/`（kind `agents`） | 独立 kind + 自己的 guide 条目（名字"智能体派生面板"+ 图标）；用 `useSessions(state => state.byId)` 建摘要森林；`inject` 增加 `sessions`；`zh`/`en` 字典；`role="tree"` 语义 | S6 结论；与头部浮层不重复的关键是完整、可回溯的树 |
| 6 | `packages/api/session-controller/src/client/sessions/lineage.ts` | 从该包 `/client` 导出 `flattenLineage` | 它是真实属主且已有测试；避免第三次复制或违反 `packages/client/AGENTS.md` 导出规则 3 |
| 7 | `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx` | 增加"在面板中打开"入口 | 浮层看一眼、面板留着看；侧栏默认折叠，头部是唯一常驻信号 |
| 8 | 新包 `packages/session/session-outcomes/`（key `sessionOutcomes`） | 照 `session-stats` 模板做纯 fold + `wire.view`，折叠 `turn/end` reason、`tool/result.isError`、interrupted、max-tokens | 唯一真缺口"全会话失败计数"；无新会话事件、无 `SESSION_FORMAT_VERSION` 变更；把聚合放宿主以避免客户端逐会话拉日志（架构师提出的开工前必答项） |
| 9 | 失败归因 UI（面板内） | 失败指纹 + 错误源五分法（模型/工具/宿主/网关/用户中断）+ 证据锚点（跳 trajectory 事件 seq）+ 动作闭环 | 验收口径"任意失败 ≤2 次点击看到属于哪一类"；只有事实没有动作就只是仪表盘 |
| 10 | `packages/client/ui-sidebar-tasks/` | jobs 段收敛为"汇总 + 失败"；补数字来源标签与具名缺失态 | 与头部入口去重；成本/评估数字必须标来源（provider-reported / heuristic / 推断） |

### 阶段三：独立议题（需各自走完发现循环）

- **记忆时间线**（负责人决策 3）：git 历史 + 检查点 + memos 三源合成，需统一时间口径与逐条来源标注。
- **终端**：宿主组合行 + 客户端面板 + PTY + 授权边界（`--trusted-host` 可放宽到非回环 authority）。
- **其他模型接入**：CLI 作为一等 LLM 路由的 adapter。

### 附：Agent Note 义务

第 1 轮交付的 `ui-sidebar-tasks` 已随附 Agent Note 三件套（`.agents/notes/implemented/feature/2026-09-17-sidebar-task-observation-tab.{md,zh.md,i18n.yaml}`）；其 Consequences 目前写着"任务图谱待定形"，而本议题已定形，**实现阶段需同步更新该 note**。上述新增包与新增 kind 同样各自需要 Agent Note 三件套（非平凡改动必须在同一 PR 内）。

## 三、第 2 轮结论与修订后的清单

第 2 轮把第 1 轮的结论按新证据重算了一遍，**推翻了 4 条、更正了 2 条**（对照见下），并新增了两项此前没有的可交付物（检查点时间线、只读终端观察面板）。

### 第 2 轮推翻/更正第 1 轮之处（诚实对照）

| # | 第 1 轮 | 第 2 轮 |
| --- | --- | --- |
| 1 | "新建投影单元优于扩 `session-stats`，因为后者有回填/schema 代价" | **不存在回填**：缓存行 "never authoritative, only a fold shortcut"，版本不匹配即丢弃并按完整日志重折。结论不变，理由更换为**语义**（性能域不该承载结果域；每加维度都要再 bump `stateVersion`） |
| 2 | S2 方向「Git 事实资源地址化」 | **推翻**：资源地址是"当前值流"，不带时间不带顺序，不可能承载历史 |
| 3 | "`terminal-bash`/`tool-terminal` 只挂 sdk-minimal" | **推翻**：`tool-terminal` 在任何 bundle/preset 都未挂载；且 `ctx.terminals` 无 push 流、无 resize（有界回溯分页）⇒ 真终端＝新 host 能力。**r7 后续订正**：工具未挂载半句仍真，但本行据以立论的两前提被推翻——「Web 面不挂终端行」为假（Web 的 agent 平面由每会话 preset 组装终端行：`packages/preset/agent-presets/presets/minimal/agent.cordis.yml:25` 起 `terminals`/`pty`/`terminal-bash`），「传输面无 WebSocket」为假（网关既有复用路由：`packages/api/gateway/src/index.ts:206`）；只读面板前置 (1) 因此已满足，写入形态另行闭闸为不在本期（[r2-terminal/05-review-record.md](r2-terminal/05-review-record.md) 后续订正、[r7-terminal-write-authority/](r7-terminal-write-authority/)） |
| 4 | C2 因果"插件被 API 掀翻" | **因果翻转**：上游在跑甚至跑在前面，成因是检出线 `0.1.3-alpha.2` 落在受支持线之间 ⇒ 答案是"对齐版本线" |
| 5 | 竞品证据「Temporal 用顶层 `failure_info`」 | 规则对、**字段位置错**（它是 `Failure` 的 oneof，不是 `WorkflowExecutionInfo` 字段）；"仅为终止时设置"未验证，已删 |
| 6 | 负责人选择「git + 检查点 + memos 三者合成一条记忆时间线」 | **技术修正**：分源泳道 + 用户显式勾选；V1 只做检查点 lane（git 无接缝、memory 是 profile 级无法归属会话） |

新增外部先例（第 2 轮取回）：**OTel 规定被重试或已处理的错误不得记入该 operation 的权威面** ⇒ `llm/retry` 是证据不是权威（"已恢复失败"必须单列）；OTel `Ok > Error > Unset` 全序 ⇒ "未设 = 未知"合法且必需；K8s `Unknown` 是一等状态且不得假设 ⇒ 缺缓存行必须显示"未知"、不得补 0。

### 修订后的建议改动清单

**阶段零（两个前置，均已获答 2026-09-17）**

- **P1 部署绑定面 = 若绑定为回环、单人使用** ⇒ 只读终端面板残余风险为低，per-install 开关**可选**；一旦出现第二个本地用户即转为必需。
- **P2 版本线 = 先做有界代价评估再定**（不直接迁移、也不直接自建）⇒ 评估成为第 3 轮子议题 `r3-version-line-cost`；评估出来前不启动 Git 的 A/B 任一实现。

**阶段一：让新增面板"能活下去"（第 2 轮收窄为最小集）**

| # | 目标文件 | 改什么 | 为什么 |
| --- | --- | --- | --- |
| 1 | `packages/client/ui-sidebar-right/src/client/tab-registry.ts` | 增 `visibility?`（缺省 `available` = 今日行为）与 `icon?`（default-on 必填）；`order?` 仅用于 core 段唯一性校验（core 0–999、第三方 1000+） | 没有 `order` 与声明式可见性，"默认可见预算"无法表达；纯增量、无数据迁移 |
| 2 | web-app 的 `cordis.yml` + 消费方 Config | 预算 `maxDefaultVisible` + 白名单；负责人的"任务观测 + 智能体派生"写在这里；**必须能在设置界面改** | 满足 "No hardcoded tunables in plugins"；且预算不能只由开发者改，否则不是用户的选择（PM 条件） |
| 3 | 新门 `verify-sidebar-right-tab-types`（`scripts/`） | 断言五条：每 kind 至多一个 id、core 段 order 唯一、default-on 数量 ≤ 预算且 ⊆ 白名单、default-on 必有 icon、新 kind 拥有 `dsh-resource://<kind>/` 地址域 | 把准入判据与预算变成 CI 断言；今天的重复 order 静默通过 |
| 4 | tab strip 与 "+"（`ui-dockkit` + `shell/SidebarRight.tsx`） | 先在芯片裁切处加溢出菜单，再把 "+" 升级为 type picker（guide 居首） | 今天 "+" 只开 guide，芯片溢出无菜单；芯片横向滚动**不可用**（dockkit 注释已定：会抢 press-and-move、废掉拖拽） |

**缓做（Rule of Three）**：`badge?` thunk、`section?` + 新核心分区注册面（目前只有一个 guide 引用方）。预算数字"3"与分段需**现网 chip 实测数与签字人**后才定稿（分析师条件）。

**阶段二：Next（按顺序）**

| # | 目标 | 改什么 | 为什么 |
| --- | --- | --- | --- |
| 5 | 新包 `packages/client/ui-sidebar-agents/`（kind `agents`） | 独立 kind + guide 条目；用 `byId` 建摘要森林；`inject` 加 `sessions`；zh/en 字典 | S6 结论；与头部浮层不重复的关键是完整、可回溯 |
| 6 | `packages/api/session-controller/src/client/sessions/lineage.ts` | 从该包 `/client` 导出 `flattenLineage` | 真实属主且已有测试；避免第三次复制或违反客户端导出规则 3 |
| 7 | 新包 `packages/session/session-outcomes/`（key `sessionOutcomes`） | 照 `session-stats` 模板做纯 fold + `wire.view`；**key/版本纪律/fold 策略一次定死，禁止与 `session-stats` 边界交叉**；缺键显示"未知"、不补 0 | 唯一真缺口"全会话失败计数"；无新会话事件、无格式版本变更 |
| 8 | 失败归因 UI | `terminal{...}`/`recoveredByCode`/`toolFailuresByName`/`unattributed`/`evidence[{seq,turn,step?,callId?,authority}]`；**无** `hostFailures`/`gatewayFailures`（不可得，宁缺勿假）；`unattributed` 带阈值与图例；动作（重试/换模型/回滚/派修复子代理）放 UI 层 | 每条归因可指锚点；窗口外锚点显示"解释未加载"而非伪造高亮 |
| 9 | **检查点时间线**（新） | 只读 `checkpoints` 域记录，分源泳道 + 用户显式勾选；每行标 scope/source/confidence；"时间未知"桶禁止猜序；界面写明"不替代版本控制"；提供显式"创建检查点"入口 | 第 2 轮新增；git 无接缝、memory 无法归属会话 ⇒ 不进 V1 |
| 10 | **只读终端观察面板**（新） | 新增只读 RPC，**服务端把浏览器请求映射到该会话的 owner Agent，绝不接受客户端自报 owner（不可配置安全不变量）**；面板列 `TerminalSessionSnapshot` 并分页渲染 `read`；终端 UI 状态不入日志 | 第 2 轮新增；真终端须先解决分帧与 resize，且写权限不在本期 |
| 11 | `packages/client/ui-sidebar-tasks/` | jobs 段收敛为"汇总 + 失败"；补数字来源标签与具名缺失态 | 与头部入口去重 |

**阶段三：独立议题 / 待决策**

- **Git 面板**：**已裁定走 B（核心自建）**——留在当前线新造 Service Definition / Provider / Consumer 三角（树内无任何既有 git 调用，已核），运行时以工作区是否为 git 仓库为准：**有 git 则用工作区 git，没有则面板不可用**；须显式标注「有期限的临时物」。A（迁移后用上游，其已依赖核心右栏包、是呈现层 owner）保持为迁移后的长期路径，人为前置不变。
- **其他模型接入**：CLI 作为一等 LLM 路由的 adapter。
- **真终端写入形态**：已走完独立发现循环并闭闸——写入口**不在本期**，授权＝preset 组合（「组合即授权」，客户端门控只作呈现不作执法）；允许抢占活动 send，但须补可区分的结算语义；重开的四项前置（威胁模型文档、「无审批即无事件、命令受会话沙箱策略」签认、抢占结算明细、只读半边先有可观察对象）见 [r7-terminal-write-authority/05-review-record.md](r7-terminal-write-authority/05-review-record.md)。
- **第 3 轮首项**：「从观测到动作」的动作闭环（PM 连续两轮提出的同一缺口）。

## 四、第 3 轮结论（动作闭环 + 迁移裁决，均已过审核门）

第 3 轮把"能不能做"变成了事实，并**推翻了两轮以来的一条前提**。

### 4.1 动作闭环：只读曾是设计选择，不是宿主限制

- tab 体 `inject: ['sessions']`（先例 `packages/client/ui-jobs/src/client/index.ts:24`）后，客户端即可调 `session.command(line)`、`cancel()`、`prompt(content,'queue'|'steer')`、`loadThrough(seq)`、`sessions.fork({sessionId,atSeq})`。
- 六问中 **4/6 零 host 新能力可表达**：换模型重试、跳到失败事件、回滚检查点、重试本轮（⚠️ 新 turn、新 seq，不是重放同一 turn）。**做不到的两个不是缺能力缝，是缺"用户可发起的入口"**：停后台 job（`ctx.jobs.kill` 已存在但只有模型工具在调）与派生修复子代理（`ctx.subagents` 存在，但 subagent 包无任何 `commands.register`）。
- **架构规则（收窄后采纳）**：**会改会话状态的走命令行，移动视口的走类型化客户端调用**。理由：`session.command(line): Promise<RemoteResult<{ matched: boolean }>>` 是 "pure admission semantics"，**分不清"无此命令/审批被拒/执行失败"**；且把纯读的 `loadThrough` 包成命令会造出**假审计**。动作结果 UI 只能报"已提交/未匹配"并把去处指向 `command/run|done`。
- **MVP 顺序（负责人决策）**：**先「跳到失败事件」→ 再「回滚检查点」**，且回滚跟随迁移决策。
- **设计原则（采纳）**：面板应**推荐"一个"下一步动作并说明理由**，而不是给四个不排序的按钮。
- **验收口径（采纳）**：有用 = 一次点击把下一步分析变成可判定结果 + 落进 `command/run|done` 可事后归因 + 失败时讲清"什么都没做"；危险 = 不可逆无预览 / 归因不确定仍可点 / 名称暗示做不到的事 / 撤销范围与文案不一致。**按钮文案必须逐项列出恢复什么、不恢复什么，且是被测试断言的字面量**（外部证据：Claude Code `/rewind` 不恢复 bash 改动与多数子代理改动；Cursor 只回文件不回消息；LangGraph 把 replay 与 fork 分开）。

### 4.2 第 2 轮只读结论的翻案（已采纳）

| 面板 | 翻不翻 | 理由 |
| --- | --- | --- |
| 失败归因面板 | **要翻** | 它的产出现在是 5 个动作的锚点，归因错＝动作错 ⇒ `unattributed` 时动作按钮**硬禁用**（不是警告） |
| 智能体派生面板 | **要翻** | 只读依据作废：是缺入口，不是宿主限制 |
| 只读终端面板 | **要翻** | 姿态与"另开 jobs 面板带 kill"自相矛盾 |
| 检查点时间线 | **要翻** | 它是回滚动作的落脚点，"查看器"不够用 |
| 任务观测 tab | 只翻理由，不翻设计 | 设计仍成立，但"只读"不再是它的辩护 |
| 评估面板 / 成本面板 | 基本不翻 | 它们的产物不是动作锚点 |

### 4.3 迁移裁决：有界，但带一扇单向门与四项前置

- **数值（有界）**：格式换代 1 次（`SESSION_FORMAT_VERSION` 2→3，向前迁移边齐全）；SQLite 域变更 **0**；核心包 **157→163 只增不减**；运行时必需包树内齐备；该 profile 的 disabled 插件多数属同一 `@linxin666` 家族，可批量处理。
- **"迁移"在此树上的含义**：fetch fork 的 master（`47f9438`）再在本地开发分支上 rebase（携带一条未推送提交 + 一批未提交改动）；不是换个版本装一下。
- **理由摆正**：**被甩下的是这棵树自己**，不是"救插件"（上游插件已跑到 `^0.1.5-rc.1` 线）。
- **单向门**：新线写过的会话落 v3 generation，0.1.3 线读不了（仓库规则 "predecessors imply neither fallback nor downgrade support"）⇒ 回滚只等于回到迁移前的日志快照。
- **四项前置（负责人已采纳"四前置照办"）**：① 理由摆正；② **用独立 `DSH_HOME` 整份副本验证**（`sessions`/`storages` 在 `DSH_HOME` 级，只换 profile 不隔离日志），并确认"新线**打开** v2 会话是否就会写出 v3 后继文件"；③ **先证实迁移源谱系**（远端是个人 fork，`47f9438` 是否确为上游支持线需先证明）；④ 出具"**迁移后免费 / 仍需自建**"清单。且**不与动作 MVP 捆绑**。

### 4.4 修订后的动作/面板关系（对上文阶段二的替换）

动作不是新面板，而是**既有面板上的一层**：凡产物能锚定到 `{seq, turn, step?}` 的面板（失败归因、智能体派生、任务观测、检查点时间线），都应在其上挂**一个被推荐的动作**（含理由），经 commands 缝合点派发或走类型化客户端调用。成本面板与评估面板维持只读。

**实现顺序（修正）**：先做阶段一（元数据最小集）→ 再做**失败归因（`session-outcomes`）+「跳到失败事件」动作**（这一对是 MVP 的竖切面，且跳转是纯读、零依赖风险）→ 再做回滚（跟随迁移）→ 其余按阶段二。

## 五、循环收敛与交接清单

本循环约定**最多三轮**，三轮均已通过审核门并落盘。第 3 轮结束时仍拆得出有事实依据的新子议题，但按约定**不擅自开第 4 轮**；以下是交接给下一阶段的清单（不属于本循环）。

1. **动作的 principal 与权限模型**（架构师开工前必答项）：**已裁定闭项**——主体＝面板所属会话的 Agent（宿主按 sessionId 解析、客户端不携带 owner，与审批/ask-user 先例同构），并给无 actor 的域事件补 `{kind:'user'|'agent'}` 来源标量（对齐 typed cancel 先例）；job 级动作以连接层 P0 为发布门。详见 [../action-seam/n1-principal/05-review-record.md](../action-seam/n1-principal/05-review-record.md) 后续裁定。
2. **动作的可发现性**（产品经理指出的缺口只是"挪了"）：**已裁定闭项**——改状态动作登记为命令、命令面全量可见（归属沿用 preset 行/host 行既有分层），可见性门控按 Rule of Three 缓做。详见 [../action-seam/n2-discoverability/05-review-record.md](../action-seam/n2-discoverability/05-review-record.md) 后续裁定。
3. **迁移源谱系证实**：个人 fork 的 `master 47f9438` 与上游支持线的对应关系。
4. **"迁移后免费 / 仍需自建"清单**（分析师条件）。
5. **步级失败归因**：**已单独立项**为 `../failure-attribution/`，并于第 1 轮过审核门。原文「唯一需要格式级改动（**新增会话事件**）」**已订正**：步级「是否正常收尾」是**纯投影可判定**的谓词（`step/end` 由 `finally` 保证、正常 return 前必落 `assistant/message`），**不需要新增会话事件**；`step/end` 加**可选** `outcome` 只作为独立增补提案排队（见该议题 `04-conclusion.md` 的 R3）。
6. **停后台 job / 派生修复子代理**：专家团一致要求作为**独立决策、独立改动**（不得拿面板当理由加宽产品命令面）；后者另依赖"失败上下文包"。

**下一步的三个出口**（由负责人选）：① 进入实现（阶段一 → MVP 竖切面）；② 把交接清单里第 1、2 项当新议题继续想清楚（新开一个循环或直接讨论）；③ 先只做迁移的四项前置（谱系证实 + 清单 + 副本验证），其余暂缓。

# 决策与执行顺序

## 一、第⑤步审核门的五问决策（负责人已答）

| # | 决策 | 选择 | 连带后果 |
| --- | --- | --- | --- |
| 1 | 默认可见预算 | **任务观测 + 智能体派生默认可见**，成本/评估/Git 进"+" | 依赖决策 5：今天无 `order` 字段，"默认可见预算"无法表达，必须元数据先行 |
| 2 | Git 面板路线 | **先查上游是否已修 API，能修则启用** | 先做只读调查（`@linxin666/dsh-client-ui-git-graph` 已装但被禁用），得出"可启用 / 需移植 / 只能自建"三选一 |
| 3 | 「git 即为记忆」的含义 | **三者合成一条「记忆时间线」**（git 历史 + 检查点 + memos 知识库） | 三个选项中**最重的一个**：必须有统一时间口径与**逐条来源标注**，否则三源混看即误导（对应竞品规则"推断 vs 声明必须分开标注"）。列为**独立议题** |
| 4 | 成本观察口径 | **token/耗时/上下文占用 + 未定价态 + 可编辑价表** | 与"只展示派生事实"一致；金额一律标 estimate、历史不回填、与实际账单分离 |
| 5 | 元数据先行 + 准入判据 | **采纳** | 执行顺序硬前提：先补 `icon`、`order` 与声明式可见性预算，确立"新增 kind 需独立 `dsh-resource://` 地址域"，再加面板 |

## 二、由五问推出的执行顺序

### Do now（必须先做，且决定后面一切）

1. **tab 类型补元数据**：`icon`、`order`（+ 声明式可见性：default-on / available / hidden），并配一门卫生门禁输出所有 kind 的区段（由 `order` 派生）／order／默认态，对重复 `order` 与超预算默认开启报错；`badge?` 与 `section?` 缓做，依据 [r2-metadata-and-visibility/03-conclusion.md](r2-metadata-and-visibility/03-conclusion.md) 第 2 条（Rule of Three）。
2. **确立准入判据**：**认领地址的 tab 类型**需拥有独立 `dsh-resource://<type>/…` 地址域；**页类型豁免**（按 kind 打开、不认地址），否则该判据会拒绝它自己所促成的页类型。已写入文档与门禁。
3. **只读调查**：`@linxin666/dsh-client-ui-git-graph` 上游是否已修（已装但被 `disabled`）。

### Next（价值项，按此顺序）

1. **智能体派生面板**（S6 结论）：独立 `agents` kind 新包；从 `byId` 建摘要森林；从真实属主导出 `flattenLineage`；jobs 挂到所属节点。
2. **失败归因**（本目录口径："不再叫根因"）：失败指纹 + 错误源五分法（模型/工具/宿主/网关/用户中断）+ **证据锚点**（跳 trajectory 事件 seq）+ **动作闭环**（换模型重试 / 派修复子代理）。
3. **评估观察**：`session-outcomes` 投影（宿主 fold，见开放决策 1）+ 人类反馈 + 具名缺失态；显示字段固定，绝不显示正确性/通过率。
4. **成本观察**：token/耗时/占用 + 数字来源标签 + 未定价态 + 可编辑价表（金额标 estimate、不回填）。

### Later / 独立议题

- **记忆时间线**（决策 3）：git 历史 + 检查点 + memos 三源合成，需统一时间与逐条来源标注。
- **终端**：核心无 client 半边仍真，但「web 组合未挂 terminal 插件」为假——Web 的 agent 平面由每会话 preset 组装终端行（minimal agent preset），只读观察面板因此无需新宿主行与额外 PTY 依赖；**安全边界仍在**（若把 `--trusted-host` 放宽到非回环 authority，浏览器会话即可拿到 shell），且 PTY 今天有日志而无审批；授权边界已闭闸（只读＝2a 的 owner 映射、写入＝preset 组合且不在本期），见 [r2-terminal/05-review-record.md](r2-terminal/05-review-record.md) 后续订正与 [r7-terminal-write-authority/05-review-record.md](r7-terminal-write-authority/05-review-record.md)。
- **其他模型接入**：CLI 作为一等 LLM 路由的 adapter（今天 `claude-code` 只能是被委托的子代理）。

### 冻结

- **archiy**：仓库与 `$DSH_HOME` 零命中，需负责人澄清三问（旁边是什么 / 是否 archive·artifact·ArchiMate 之类笔误 / 想让它出现在哪、点了发生什么）。

### 砍掉（第四步专家团否决 + 负责人未反对）

- **一键导出 Markdown/JSON 任务报告**：新的数据外发面。
- **会话级侧栏预设**：过早。
- **失败传播级联**（"A 失败导致 B 阻塞"）：无依赖模型，画出来是伪造。
- **模型自评判定工具**：与"只展示派生事实"冲突，且引入模型可见输入会触发"Model-visible ⟺ logged"义务。
- **货币金额进 V1 主面板**：无价源。

## 三、验收标准（可勾选，替代"没问题"）

功能可见性：

1. 刷新页面 → 展开右侧栏 → 在"+"引导页里能看到 **任务观测** 与 **智能体派生面板** 两个命名入口（含图标）。
2. 打开任务观测：待办段随会话状态变化；后台任务段显示状态与耗时；空态给出具名文案（不是空白）。
3. 打开智能体派生面板：树按 `byId` 完整呈现（含已完成/失败的派生），运行中的链默认展开；诊断行不可点击且给出原因；`parentAvailable: false` 有显式提示；点击子节点可打开该会话。
4. 中英文案齐全（`zh` 为验收面），无硬编码文案（`verify-client-ui-i18n` 通过）。

质量口径：

5. 成本面板每个数字带来源标签（provider-reported / heuristic / 推断）；未命中价目时显示"未定价"而不是 0；不把不可加项相加（`contextBreakdown` 与 `projectedTokens` 相加即违规）。
6. **任意一次失败，≤2 次点击内看到它属于哪一类（模型/工具/宿主/网关/用户中断）**，并可跳到对应事件 seq。
7. 评估面板不出现正确性、评分、通过率；缺值显示 `unknown` + reason，而不是 0 或"成功"。

## 四、开工前必须定的开放决策

1. **`sessionOutcomes` 的聚合归属**（架构师提出）：定稿建议为**宿主投影单元**（新包 `packages/session/session-outcomes`，照 `session-stats` 三文件模板：`types.ts` / `projection.ts` / `index.ts` + `client.ts`，key `sessionOutcomes`，纯 fold + `wire.view`），不动既有投影 schema，只在 web-app patch 加一行。这样零客户端扇出、无新会话事件、无格式版本变更。**替代方案**（改 `session-stats` 加计数字段）会让 `stateVersion` 递增并波及既有投影 schema，不推荐。
2. **S6 的承重论证需对抗性检验**：只有 tab 类型能拥有 guide 条目 ⇒ 必须独立成 kind。若接受"智能体派生"只作镜头标签，更便宜的可逆路径重新打开。
3. **git-graph 上游修复状态**：决定 Git 面板是移植、自建还是砍。
4. **终端的授权边界**：谁能打开终端、是否逐次确认、受信主机上浏览器会话的边界。

## 五、开放决策的裁定（本节关闭 §四 的闸）

| # | 决策 | 裁定 | 连带后果 |
| --- | --- | --- | --- |
| 1 | `sessionOutcomes` 的聚合归属 | **采用推荐案**：新建宿主投影单元包，照 `session-stats` 三文件模板加 `client.ts`，key `sessionOutcomes`，纯 fold + `wire.view` | 不动既有投影 schema、只在 web-app 补丁加一行；`stateVersion` 不递增、无新会话事件、无格式版本变更。替代案（扩 `session-stats` 加计数字段）落选 |
| 2 | S6「只有 tab 类型能拥有 guide 条目 ⇒ 必须独立成 kind」 | **对抗性检验已完成：判词「仅在 X 条件下成立」，且该主张的字面表述为假** | X ＝「智能体派生」必须是可与任务观测**并排**的独立具名入口（含图标）＋独立 chip。字面为假的依据：guide 页的 body 是可被整页替换的 chain 席位（`packages/client/ui-sidebar-right/src/client/contract/slots.ts:67-77`），任何插件都能自绘带图标的命名入口并 `openTab` 既有 kind ⇒ 「只有 tab 类型能出现在 guide 页」不成立；为真的只是一条更窄的表述——**shipped guide 的每个 entry box 派生自已注册的 tab 类型，且目标恒为该类型自己的 kind**（`tab-registry.ts:60-76,124-125,392-398`；`tabs/guide/GuideBody.tsx:80`）。另：「必须**新建包**」独立地为假（一个包可注册多个 kind，`ui-sidebar-right` 自身即如此）。故若保留并排入口的要求，新 kind 成立但新包可省；若放弃并排入口，既有 `tasks` kind 内加一段即可，回退＝删一段 |

**由第 2 项检验推出的两处计划订正（必须一并记入，否则会写出自相矛盾的规则）：**

- **「新 kind 须拥有独立 `dsh-resource://<type>/…` 地址域」这条准入判据，若落成门禁会让本议题自证不合规**：地址域在代码里即协议（`packages/client/resources/src/client/resources.ts:44-70,84-99`，一协议一 provider、重复注册即抛），而现成三个页类型（guide／files／tasks）**都不带** `patterns` ⇒ 该判据必须**明文豁免页类型**，否则 `agents` 作为页类型会被自己的门禁拒绝。这条规则本身是计划要**新建**的，代码里今天不存在。
- **`99-roadmap.md` 阶段二第 6 项「从 `session-controller` 的 `/client` 导出 `flattenLineage`」按现规范不可行**：该函数未从 `/client` 入口导出（只导类型），值导入会撞客户端包的 purity 门禁（`packages/client/tsdown.client.ts` 的 `INLINE_SAFE` 不含 session-controller 与其「cross-plugin value imports are forbidden」；`scripts/verify-client-packages.ts` 禁止 `packages/client/` 下的特性包声明 `dsh.client.external`）⇒ 新面板只能**自行重复那段纯 fold**，仓内已有同类重复先例（两个特性包各自一份 `subagent-lineage.ts` 且带 `jscpd:ignore`）。另：头部浮层组件确不可复用（其 props 绑在会话头部契约上），但「不能复用组件」推不出「必须新 kind」。
- 顺带更正：`agents` 将是**第五个** kind（现为 guide／files／tasks／text），计划文本里的排序说法需改。

**第 2 项检验的门内裁定（已定）：保留「与任务观测并排的独立具名入口（含图标）+ 独立 chip」，并选择新建包。** ⇒ X 条件成立，独立 kind 成立；`ui-sidebar-agents`（kind `agents`）按原计划执行，并接受其代价：三处注册面（web-app 补丁行、web-app 包清单、客户端 tsconfig）加脚手架／README／i18n 命名空间。随之确定两件连带事项：阶段一要落的那条准入判据**必须明文豁免页类型**，否则会拒绝本包；阶段二第 6 项改为**在新包内自行重复那段纯 fold**（不得从 `session-controller` 做值导入，也不得加 `dsh.client.external`）。
| 3 | git-graph 上游修复状态 | **有界代价评估已完成：无法在有界范围内判定——代价面有界且闭合，卡点在证据不在代价** | 四项前置 ①已满足、②③④未满足（②需整份副本验证、③迁移源谱系本地不可判、④免费/自建清单未出具）；翻转条件与详情见下方「第 3 项评估记录」 |
| 4 | 终端的授权边界 | **就此闭闸** | 只读那半沿用终端轮 2a 决策（服务端把浏览器请求映射到该会话 owner、绝不接受客户端自报 owner）；写的那半由第四项议题闭闸（授权由 preset 是否组合该行表达、写入口不在本期），留待 2b 再提 |
| 5 | 阶段一的可见性数字 | **按计划数字先开工**：默认可见＝任务观测 + 智能体派生，上限 3，其余 `order` ≥ 100 | 原本挂着的「需现网实测数与签字人」降为 **V1 后校准**，不再作为开工阻塞 |

**本节落定后，阶段一（`99-roadmap.md` 第 1–4 项）解除开工阻塞。** 第 2 项的检验结论若与本表冲突，以检验为准并回改本表。

**第 3 项评估记录（只读完成）：** 代价面有界且清单闭合——格式换代 2→3 一次不可逆（旧线拒读 v3；代际不删但非降级支持）；存量 427 份日志（v0×222、v2×205）中 v2 被新线打开即落 v3 后继，且 storages 与 sessions 同级、只换 profile 不隔离；rebase 必先 fetch（远端 master 顶端不在本地对象库）；共享安装层 231 个包 @0.1.3-alpha.2 需重装；快照夹具 v2×145/v0×7/v1×4、53 个 spec 引用格式常量；外部插件家族 14 包全 0.2.0 可批量处理；无加载期 peer 校验，真正耦合在运行时注入且注入面包树内齐备。**新发现（独立于迁移的欠账）：`vendor/README.md` 清单表与 9 个 vendored 包版本全部不一致——抽查 cordis：表记 4.0.0-rc.7、实际 4.0.2（已亲核），且外部生态亦钉 cordis 4.0.2 ⇒ 表是旧的一侧；动 vendor 层前须先补谱系。** 网络补证（当日实查）：`@deepseek-ai` 的 dsh 包在公共 registry 不可匿名读 ⇒ 目标线 0.1.5-rc.1 的今日支持状态仍不可判，需有凭证一方补证；外部 git-graph 公开可读，**latest 已至 0.3.23（本仓装 0.2.0、被补丁层禁用），其 manifest 声明 `dsh.engines.dsh >= 0.1.5-rc.1`，注入三包（client-locale／ui-conversation／api-session-controller）树内齐备** ⇒ 插件生态最新版仍瞄准目标线、未见 0.1.6 迁移信号；但其依赖全钉 `^0.1.5-rc.1`（semver 预发布规则不覆盖 0.1.6-alpha.1），印证既有残余风险。翻转条件：有凭证联网证实目标线仍受支持 + 完成 ②④ ⇒ 有界且值得；副本验证发现「打开 v2 即写 v3」且不可接受 ⇒ 代价大于收益；上游整体推进到 0.1.6 线 ⇒ 目标线重选。

# 已核实事实

每条标注来源等级：【复核】主 agent 直接执行命令或读文件确认；【子代理】子代理读代码确认并给出行号（未逐条复跑）；【联网】竞品一手文档。

## 一、对早期判断的三处纠正

发现循环的价值有一半在于纠正评审依据本身。以下三条早期判断被证据推翻，后续结论以纠正后的事实为准。

### C1（推翻）「需要重启主实例才能看到新 tab」

【复核】运行中的主实例进程启动早于最后一次前端构建，但其 `/` 的启动清单仍含 `ui-sidebar-tasks` 的模块行（`{"id":"@deepseek-ai/dsh-client-ui-sidebar-tasks", …}`），按请求取回该模块返回 HTTP 200，且逐项比对语义标记（tab 定义、任务 id、locale、文案与样式标记）后与工作树中的最新构建一致，差异仅来自构建格式。同一模块的旧 rev 在验证实例上返回 0 字节，说明两个实例都是按请求现算 rev。

**结论**：client 侧改动刷新即可；"先在验证实例上验证、再重启主实例"这条流程指令建立在未经检验的前提上，重启的真实代价是中断正在运行的会话，并连带杀掉作为其子进程的验证实例。

### C2（推翻）「终端 / Git / 后台任务已由生态覆盖」

【复核】该 profile 的补丁把若干第三方 Web UI 插件（含 `better-sidebar` 与全部 `web-ui-*` 行）置为 `disabled: true`，文件顶部注释为 "Temporarily disable third-party Web UI plugins that target an older DSH API"；运行实例的启动清单中 `better-sidebar` 出现 **0 次**。同时【复核】该 profile 的 `node_modules` 内装着若干第三方插件（git 图、SSH、任务板、xterm 等），全部因禁用而未加载（清单中各 0 次）。

**结论**：Git 与终端不是"没人做过"，而是**装过、被 API 版本掀翻**。判定顺序必须改为"先查上游是否已修 → 再决定移植 / 自建 / 砍"，并且任何"已安装"论证都必须核对 patch 层的 `disabled`。

### C3（修正）「除 todos 之外的成本与评估数据读不到」

【复核】`SessionListEntry.projectionValues` 携带投影值，`packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx:309` 已在读 `summary?.projectionValues?.tokenUsage`。可读项包含 `tokenUsage`、`contextPressure`、`contextBreakdown`、`sessionStats`、`turnOutline`、`plan`、`goal`、`schedule`、`agentPreset`、`permissions`、`inbox`、`sessionListMetadata`。

**结论**：成本与评估**不缺数据、只缺入口**；"todos 仅当前会话可读"的限定对其他键不成立，只有跨会话的子会话 todo 仍需按需拉取。

## 二、右侧栏扩展点的真实能力

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | tab 类型定义为 `{id, kind, patterns?, priority?, canOpen?, title, guide?}` —— **无 icon、无 badge、无 order、无 pin** | 【子代理】`packages/client/ui-sidebar-right/src/client/tab-registry.ts:85-126` |
| F2 | guide 条目才带名字与图标：`guide[].{order,title,description,icon}` | 【子代理】同文件 `:61-76` |
| F3 | "新增"入口只打开 guide 页，没有类型选择器；strip 芯片 44–170px 且**溢出无菜单** | 【子代理】`SidebarRight.tsx:156,309`；`ui-dockkit/src/components/TabPanel.tsx:134-266`；`dockkit.module.css:103-116,146-164` |
| F4 | 缺 kind 渲染时已有具名兜底文案，不留空面板 | 【复核】`ui-sidebar-right/src/client/locales.ts:24,47`（`tab.unavailable`：这类内容还没有可用的查看方式。） |
| F5 | 优先级三段 `extension > builtin > fallback`，extension 可顶替 builtin 的同 kind | 【子代理】`tab-registry.ts:48,58` |
| F6 | tab body 按定义的 **`id`** 分派（不是 kind）；body 可拿到 `useTabInfo`（`sidebar.expanded/fullscreen`、`tab.visible`） | 【子代理】`SidebarRight.tsx:193`；`contract/slots.ts:130-145,154-156` |
| F7 | 右栏**默认折叠、单窗格、一个 guide tab，且布局不持久化** | 【子代理】`ui-dockkit/src/engine/initial.ts:70`；`ui-sidebar-right/src/client/stores.ts:88-96,226` |
| F8 | **右栏不是 ~300px**：`RIGHTBAR_MIN = 300` 只是下限，默认比例 0.45、上限 0.7，按视口宽度取 `max(300, round(width*0.45))` | 【子代理】`ui-layout/src/client/columns.ts:24-29`；`ui-layout/src/client/stores.ts:110` |
| F9 | 两窗格上限与 0.2 比例下限是**侧栏嵌入者**的限制，不是 dockkit 的（dockkit：`MAX_DOCK_PANES = 4`、`MIN_PANE_FRACTION = 0.12`） | 【子代理】`SidebarRight.tsx:305-308`；`stores.ts:247-249,317,343`；`ui-dockkit/src/engine/constraints.ts:10,13` |
| F10 | **右栏已有树形先例**：`ui-sidebar-files`（kind `files`）渲染逐层懒加载可展开树，14px 缩进，含 `failed` 行与 `truncated` 提示行，并有自己的 per-tab store（`state.expanded`） | 【子代理】`ui-sidebar-files/src/client/{definition.ts:14,27; FilesBody.tsx:9-10,84-88,120,130,165; FilesBody.module.css:31}` |
| F11 | 现有 kind：`files`、`text`、`tasks` —— 新增第四个 kind 是既有模式 | 【子代理】三个包的 `definition.ts` |

## 三、派生（世系）能力现状

| # | 事实 | 证据 |
| --- | --- | --- |
| F12 | 会话头部已有世系树，但形态是**门户浮层**而非行内：`.menu { position: fixed; width: 336px; max-height: min(560px, calc(100vh - 140px)); overflow: auto }`，已含展开箭头、状态点、label、`title · mode · activity` 次行、token、耗时、诊断行、键盘树导航与点击打开 | 【子代理】`ui-subagent/src/client/SubagentHeaderLineage.module.css:95-112`；`SubagentHeaderLineage.tsx:326-329,472` |
| F13 | `flattenLineage`（孤儿→根、环 fail-soft）不在 `ui-subagent`，而在 `packages/api/session-controller/src/client/sessions/lineage.ts:44-47`，唯一消费者是 `manager.ts:923`，已有测试 `tests/lineage.client.spec.ts` | 【子代理】同上；`packages/client/ui-subagent/src/client/subagent-lineage.ts` 全部公开面仅 46 行，导出 `SubagentDescendantSummary` 与 `indexSubagentDescendants` |
| F14 | `subagentsByParent` 是**懒加载/部分**的：只有被选中或打开过目录的父会话才有键 | 【子代理】`manager.ts:183,201,439,722-724,796-798,813` |
| F15 | 反应式 store 不携带扁平化后的 `items`/`depth`：`SessionListState = ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress` | 【子代理】`service.ts:69-87`；`manager.ts:51,923` |
| F16 | `SessionJob` 没有 owner 字段，归属由 `jobsBySession` 的**键**表达 | 【子代理】`packages/api/session-controller/src/types.ts:527-535,541-545` |

## 四、成本与评估的数据边界

| # | 事实 | 证据 |
| --- | --- | --- |
| F17 | 可读投影：`tokenUsage`（四桶）、`contextPressure`、`contextBreakdown`、`sessionStats`（turns/steps/llmMs/toolMs/ttft/decode） | 【复核+子代理】`packages/llm/token-meter/src/projection.ts:69-76`；`packages/session/session-stats/src/types.ts:44` |
| F18 | **无货币价源**：harness 从不读 pi-ai 的 cost 元数据，`replay.ts` 主动清零，无消费者上报 spend；全仓无价格表 | 【子代理】`packages/llm/llm-pi-ai/src/catalog.ts:34-37`；`llm-pi-ai/src/replay.ts:64` |
| F19 | 评估信号可得：`turn/end` 结局原因（completed/aborted/blocked/error/max-tokens/interrupted）、工具 `tool/result.isError`、`lastAgentError`、人类反馈事件 `feedback/message-put\|delete`（`MessageFeedbackRating = 'positive'\|'negative'`） | 【子代理】`packages/core/session/src/types.ts:198-222`；`packages/llm/llm/src/message.ts:222-233`；`api/session-controller/src/client/contract/snapshot.ts:101`；`packages/feedback/message-feedback/src/types.ts:16,51-56` |
| F20 | **唯一宿主缺口**：`sessionStats` 不含任何失败计数，而客户端窗口是分页的（`SessionWindowResponse.hasMore`），所以"本会话失败了多少次"今天不在任何 seam 里；补法可复用 `session-stats` 的三文件模板而不动既有投影 schema | 【子代理】`packages/session/session-stats/src/types.ts`；`api/session-controller/src/types.ts:506`；`packages/bundle/web-app/cordis.patch.yml:86-87,91-92` |

## 五、模型接入与网关

| # | 事实 | 证据 |
| --- | --- | --- |
| F21 | 该部署的 `settings.yaml` **已声明** 若干第三方模型路由（经路由键 `openai`，端点指向某第三方网关）且 `subagent-model-selection` 已启用并把这些模型列入 `allowedModels` | 【子代理】`$DSH_HOME/settings.yaml`（只读） |
| F22 | 报错为网关侧授权/渠道问题：`POST /v1/chat/completions` 返回 400 不可用渠道错误，同一模型走 `POST /v1/responses` 返回 200，`GET /v1/models` 列出全部声明的模型 id；会话日志中同一类 400 错误（模型未授权）也命中平时可用的模型并自行恢复 | 【复核，本会话早期】 |
| F23 | `claude-code` 已作为子代理 provider 存在；`llm/stream` 是可用的 waterfall 拦截点（重试/路由），但 agent-loop 构造的请求深冻结，监听者只能读或**重派发**、不能改写 | 【子代理】`packages/subagent/subagent-claude-code/src/index.ts`；`packages/llm/llm/src/index.ts:60-73` |
| F24 | 终端：核心 `packages/terminal/*` 是纯宿主能力、**无 client 半边**；`terminal-bash`/`tool-terminal` 只挂在 `sdk-minimal`，web/base 组合未挂 | 【子代理】`packages/bundle/*/cordis.patch.yml` 与 `packages/terminal/*` |

## 六、环境与运维事实

| # | 事实 | 证据 |
| --- | --- | --- |
| F25 | 会话与存储位于 `$DSH_HOME` 级，主实例与验证实例共享同一 `$DSH_HOME` | 【子代理】 |
| F26 | `--trusted-host` 可放宽到非回环 authority（支持多个条目） | 【子代理】 |
| F27 | 应用的启动只允许 `dsh` profile；端口是配置项（`Config.port`），因此"第二端口预检"是部署选择而非产品缺陷 | 【子代理】`packages/host/webserver/src/index.ts` |
| F28 | 评测门现状：`pnpm run test:gui` 全绿（337 文件 / 4666 通过 / 1 跳过）；`DSH_SNAPSHOT=replay pnpm run test:web` 为 **not-green**（14 文件 / 26 用例失败），但同一 e2e 单独跑 3/3 通过 ⇒ 并发/负载抖动，非本次改动引入 | 【复核】 |

## 七、第 2 轮新增事实与对第 1 轮的修正

### C4（修正第 1 轮"把 git 事实资源地址化"的方向）`dsh-resource://` 承载的是"当前值流"，不是历史

【子代理】provider 契约：`packages/client/resources/src/client/contract.ts:73-92` —— "first frame is the current content and every later frame one change"；协议名册为 `packages/client/ui-slots/src/index.ts:44` 的 `interface ResourceProtocolMap {}`；唯一已发布协议是 `file`（`packages/api/workspace-files/src/client/types.ts:10-19`）。地址**不带时间、不带顺序**。

**结论**：资源地址可以承载一条*当前*的 git 事实，但**不可能承载时间线**。第 1 轮 S2 的方向 2（"Git 事实资源地址化"）与 `99-roadmap.md` 中"准入判据"的举例需按此限定：地址域是"当前事实"的家，历史需要另一个家。

### C5（修正 C2 的因果）该 profile 内 `disabled` 插件的真正成因是版本线错位，而非"插件不维护"

【复核，npm registry】已装 `dsh-better-sidebar` 0.13.0 声明 `^0.1.0-rc.6`，而该包版本与目标线的映射为：0.10.0–0.13.0 → `^0.1.0-rc.6`；0.13.1 → `^0.1.0-rc.7`；0.14.0–0.17.1 → `^0.1.0-rc.8`；0.18.0-alpha.0 → `^0.1.2-alpha.2`；0.18.0–0.18.1 → `^0.1.2-rc.1`；0.19.0-alpha.1 → `^0.1.5-alpha.2`；0.19.0–0.19.1 → `^0.1.5-rc.1`（最新 0.19.1，2026-09-11）。本仓库检出为 **0.1.3-alpha.2**，**没有任何上游版本声明支持 `0.1.3-*`**。另：`@linxin666/dsh-client-ui-git-graph` 已装 0.2.0 vs 上游最新 0.3.23（2026-09-16）；`@linxin666/dsh-web-ui-all` 已装 0.2.0 vs 0.3.6。

**结论**：上游没停更（git-graph 昨天还在发版），问题是**检出线落在两条受支持线之间**。决策 2 的诚实答案是"对齐版本线"而非"修插件"：① 把检出推进到上游支持的点（如 0.1.5-rc.1）再装最新版（可一次拿回 Git 图/终端/文件工作台）；② 留在 0.1.3-alpha.2 则核心自建最小只读视图。

### C6（对 S2 事实 F1 的版本限定）"better-sidebar 不消费核心扩展点"只对老版本成立

【复核 + 子代理】已装 0.13.0 的 `lib/client.js` 中 `sidebarRightTabs`/`sidebar.right`/`ui-sidebar-right`/`rightbar` 出现 0 次，`betterSidebar` 29 次、`document.body` 3 次。但**上游 0.19.x 声明依赖 `@deepseek-ai/dsh-client-ui-sidebar-right`**，即新版本已接上核心右侧栏扩展点。同类：`@linxin666/dsh-client-ui-git-graph` 0.2.0 也是 `sidebarRightTabs` 0 次、`document.body` 6 次（同样是 DOM 级挂载）。

**结论**：S2 的结构性批评（缺元数据、发现路径窄、无 provider 缝）仍成立，但"生态整列替换核心"这一现象**是版本错位的产物**，升级到 0.19.x 后可能自然消失。

### F29 DSH 没有 git capability seam

【子代理】`packages/*/*/src` 内无任何 git 工具注册；`grep 'rev-parse|git log|git status'` 只命中提示词示例（`packages/shell/tool-bash/src/index.ts:251`、`packages/shell/tool-pwsh/src/index.ts:261`）与外部编辑器启动项（`packages/host/open-in-app/src/catalog.ts:306,363`）。因此"Git 检查与观察"不是移植问题，而是**要不要新增一个 capability seam**（Service Definition / Provider / Consumer）的问题。

### F30 检查点与记忆的真实归属

【子代理】`dsh-checkpoint-rewind@0.5.2` 记录 `{id, sessionId, cwd, seq, time, provider, kind, triggerTool, turn, step, files, bytes, ref, tree?, config, note?}`（`types.d.ts:8-35`），存 `storageDomain` 域 `checkpoints` v2；其 git provider 只**创建**游离快照对象（`git stash create`/`commit-tree`）并按显式路径恢复，**从不读提交历史**（`tree` 是快照树 SHA，不在任何分支上）。`@memtensor/memos-local-plugin@2.0.16` 数据在 `$DSH_HOME/memos-plugin/data/memos.db`，**profile 级**、无 per-workspace 作用域、无地址协议。会话事件 `seq` 是唯一可信序（`packages/core/session/src/types.ts:456-458`）。

**结论**：三源中只有检查点可按会话排序；git 提交时间可被 rebase/时钟改写，memory 的 `createdAt` 是"学到该事实的时刻"且跨 workspace ⇒ 后两者**不能**归入一条会话时间线。

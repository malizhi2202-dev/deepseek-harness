# 第②步竞品与技术调研证据

本轮调研由子代理执行（service = Run，联网取证；`web_search` 工具当轮不可用，改用 `web_fetch` + 直取一手文档）。原始证据切片在其过程目录 `/tmp/bmad-discovery/recon-2/digests/`。所有条目均来自本轮取回的页面。

## Q1 侧栏组织与容量：成熟 IDE / agent 产品怎么做

| # | 证据 | 来源 |
| --- | --- | --- |
| 1 | VS Code 给出唯一硬性数量上限：单个 View Container 内 View「3–5 是多数屏幕尺寸的舒适上限」；一个扩展通常只需一个容器；能做成命令的不放侧栏；禁止重复既有功能 | [code.visualstudio.com/api/ux-guidelines/sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars) |
| 2 | VS Code 要求**每个 View 必须有图标**，正因为它可能被移到 Activity Bar / Secondary Sidebar（两者纯图标）；「Keep the number of Views to a minimum」；限制自定义 Webview View | [code.visualstudio.com/api/ux-guidelines/views](https://code.visualstudio.com/api/ux-guidelines/views) |
| 3 | VS Code 二级侧栏是「用户财产」：扩展不能直接 contribute，只能由用户拖入；默认可见性由 `workbench.secondarySideBar.defaultVisibility` 策略控制；布局跨会话记忆并可复位 | [code.visualstudio.com/docs/configure/custom-layout](https://code.visualstudio.com/docs/configure/custom-layout) |
| 4 | JetBrains 默认可见性规则：只有「几乎每个项目都会用到的基础功能」（Version Control、Problems）才默认显示，其余默认隐藏但仍可从 "More tool windows" 进入；与当前项目配置无关的工具窗根本不显示；空态必须给 | [plugins.jetbrains.com/docs/intellij/tool-window.html](https://plugins.jetbrains.com/docs/intellij/tool-window.html) |
| 5 | JetBrains 结构规则：名称 ≤2 词、条纹给缩写、20×20/16×16 单色图标、内容变化用彩色 badge 而不是换图标、同类内容用 tabs 归组、纵向窗放树 | 同上 |
| 6 | agent 产品共性 = 一个 agent 面板 + 用户自己摆位 + 命名布局替代无限堆叠；Cursor 论坛记录扩展 agent 面板**无法停靠**二级侧栏（该区域保留给 Cursor Agent 自己） | [docs.cline.bot/usage/ide](https://docs.cline.bot/usage/ide)；[cursor.com/changelog/2-3](https://cursor.com/changelog/2-3)；[forum.cursor.com](https://forum.cursor.com/t/extension-agent-panels-cannot-be-docked-in-the-secondary-sidebar-reserved-for-cursor-agent-leaving-them-stacked-under-the-explorer/171636) |

## Q2 任务/agent 观察面板：缺图与未知状态怎么处理

| # | 证据 | 来源 |
| --- | --- | --- |
| 1 | GitHub Actions 运行图**只画声明关系**（YAML `needs`），状态用图标、点 job 看日志，不推断额外关系 | [docs.github.com — visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph) |
| 2 | Langfuse Agent Graphs 正面文档化「没有显式边」：图可由观测推断（"inferred automatically from the observations' timings and nesting"），也可来自 LangGraph 集成（声明拓扑）；同一 trace 提供 Aggregated 与 Expanded 两种视图，并明说两者回答不同问题、**不是谁更正确** | [langfuse.com — agent graphs](https://langfuse.com/docs/observability/features/agent-graphs.md) |
| 3 | Temporal 把根因做成结构化 cause 链，并写明系统**不信任哪一段**：Service 只用顶层 `failure_info` 决定重试，cause 链保留但不参与判定 | [docs.temporal.io — application failures](https://docs.temporal.io/encyclopedia/application-failures) |

**对第 3 条的更正（第 2 轮核查，2026-09-17 直取一手源）**：规则本身成立（原文 "The Temporal Service only inspects the **top-level** `failure_info` on the Failure proto when making retry decisions. The original error is preserved in the `cause` chain, but the Service does not look at `cause` to determine retryability."），但**字段位置先前引用错了**：`failure_info` 不是 `WorkflowExecutionInfo` 也不是 `DescribeWorkflowExecutionResponse` 的字段，它只是 `Failure` proto 内部的 `oneof failure_info`（`temporal/api/failure/v1/message.proto`，commit 1c27468c）；`WorkflowExecutionInfo` 全字段 1–26 无 failure 字段。另：**"failure_info 只为终止/关闭 workflow 的失败设置"这一说法在 temporalio/documentation 全仓仅 2 处命中且均无此说 ⇒ 未验证，不得继续引用**。可转移的只有"顶层权威 + cause 链仅供人读"这一分层。
| 4 | OTel 把「未知」当默认而非成功：无错误时 span status MUST 保持 `unset`，出错才设 Error + `error.type`；被重试或已处理的错误不记入 | [opentelemetry.io — recording errors](https://opentelemetry.io/docs/specs/semconv/general/recording-errors/)；[traces](https://opentelemetry.io/docs/concepts/signals/traces/) |
| 5 | Kubernetes 用独立状态表达「取不到状态」：Pod phase `Unknown`，condition status 有 True/False/Unknown 并配机器可读 `reason` | [kubernetes.io — pod lifecycle](https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/workloads/pods/pod-lifecycle.md) |
| 6 | Jaeger 对不完整 trace 直接输出告警而不替用户断言因果；Airflow 用**同页 tab**（Overview / Grid / Graph / Runs / Tasks / Events / Code / Details）而非新增面板，Graph View 明确服务三类问题（任务为何没跑、理解跨流水线依赖、查看 run 级状态含 upstream failed） | [jaegertracing discussion](https://github.com/orgs/jaegertracing/discussions/8091)；[jaeger troubleshooting](https://www.jaegertracing.io/docs/2.21/operations/troubleshooting/)；[airflow ui](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) |

AutoGen Studio / CrewAI 的 agent 图视图：**未取证**。

## Q3 无权威价源的用量/成本面板

| # | 证据 | 来源 |
| --- | --- | --- |
| 1 | Claude Code `/usage`：金额由本地按 token × list price 计算；管理员可配 `modelPricing` 表，`Total cost` 行标注 "at your organization's configured rates"；文档明写 "The figure is an estimate, so for authoritative billing see the Usage page in the Claude Console"；plan 归因标 approximate、仅本地历史 | [code.claude.com/docs/en/costs.md](https://code.claude.com/docs/en/costs.md) |
| 2 | 限流降级：显示 60 分钟内 last-known bars + "Showing last-known usage" 与获取时间 | 同上 |
| 3 | ccusage：内置 LiteLLM 价表 + 可覆盖（`ccusage.json`）+ `--offline` + `--no-cost`（连 JSON 里的 cost 字段一并移除）；价表由定时 workflow 变价即开 PR | [github.com/ryoppippi/ccusage](https://github.com/ryoppippi/ccusage/blob/main/apps/ccusage/README.md) |
| 4 | LangSmith：可编辑价格表（按 `ls_model_name` 正则匹配、可设生效日期、可覆盖默认价）；明确「已记录 trace 不会因价格表更新而回填，backfill 不支持」 | [docs.langchain.com — cost tracking](https://docs.langchain.com/langsmith/cost-tracking.md) |
| 5 | Langfuse：推断成本必须命中 model definition 的 `match_pattern`，否则不推断（改为直接 ingest cost）；摄入时定价，故更新只影响新 generation | [langfuse.com — token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking.md) |
| 6 | Helicone 按接入方式标置信度（Gateway "precisely" / 直连 "best-effort estimates"），不支持时干脆不显示 | [docs.helicone.ai — cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking.md) |
| 7 | OTel GenAI 语义约定**只标准化 token 不标准化钱**：定义 `gen_ai.client.token.usage` 等指标；887 行 metrics 文档 grep "cost" 命中 0 次 | [semantic-conventions-genai](https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-metrics.md) |

OpenLLMetry 成本策略、Cursor 按模型成本表覆盖范围：**未取证**。

## 可转移 / 不可转移

**可转移**

1. 治理落在「默认隐藏 + 溢出入口 + 数量预算」而非禁止新类型。默认可见只给每会话必用面板（本目录决策 1：任务观测 + 智能体派生），成本与评估默认收起。
2. 三条硬规则：**推断拓扑必须与声明拓扑分开标注**；**无数据要给具名状态而不是空面板**（DSH 已有 `tab.unavailable` 兜底，同构，沿用即可）；**根因展示要说明哪一段权威**（只信顶层失败原因的 Temporal 做法）。
3. 成本面板必须标来源与时间边界：可编辑价表 + 未命中显示"未定价"而非 0 + 历史不回填。
4. 每个 View 需要图标，而 DSH 的 tab 类型今天没有 `icon` 字段 —— 与决策 5（元数据先行）互为印证。

**不可转移**

1. VS Code / JetBrains 的数量规则建立在宽屏 + 用户可自由拖拽重排的前提上，而 DSH 右栏默认折叠、布局不持久化，5 个上限不能照搬。
2. Airflow 的多 tab 属 DAG 详情页语境，不构成"侧栏可无限加 tab"的许可。
3. Temporal cause 链与 K8s `Unknown` 的可信度来自后端本就产出结构化状态；DSH 若对应事实没有会话事件，面板只能显示"未知"，不能凭推断补图 —— **先有数据源，再谈可视化**。

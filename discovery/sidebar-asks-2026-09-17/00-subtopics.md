# 子议题清单与轮次记录

议题 slug：`sidebar-asks-2026-09-17`
事实文档：`01-verified-facts.md`（F1–F28 与 C1–C3 纠正）、`04-competitive-evidence.md`（竞品一手文档）、负责人原话（见 `README.md` 第 1 节）。

## 第 0 步扫描到的事实来源

| 类别 | 来源 |
| --- | --- |
| 用户原话与选择 | 会话中逐条提出的右侧栏诉求、后补的"智能体派生面板"、第⑤步五问决策 |
| 仓库代码（只读） | `packages/client/ui-sidebar-right/**`（注册表与布局）、`packages/client/ui-subagent/**`（头部世系浮层）、`packages/client/ui-jobs/**`、`packages/client/ui-sidebar-files/**`（右栏树形先例）、`packages/client/ui-layout/**`（右栏宽度）、`packages/api/session-controller/**`（会话列表/投影/任务）、`packages/llm/token-meter/**` 与 `packages/session/session-stats/**`（成本投影）、`packages/llm/llm-pi-ai/**`（无价源）、`packages/subagent/**`、`packages/terminal/**`、`packages/bundle/*/cordis.patch.yml` |
| 部署环境（只读） | profile 的 `{package.json,cordis.patch.yml,node_modules}`、运行中的主实例与验证实例（启动清单、模块 URL）|
| 竞品文档（联网） | VS Code、JetBrains、Cursor、Cline、GitHub Actions、Langfuse、Temporal、OTel、Kubernetes、Jaeger、Airflow、Claude Code、ccusage、LangSmith、Helicone（URL 见 `04-competitive-evidence.md`）|

## 第 1 轮（已完成并通过审核门）

| 子议题 | slug | 事实依据 | 状态 |
| --- | --- | --- | --- |
| S1 任务观测的形态与信息架构 | `s1-task-observation` | V1 已交付 `packages/client/ui-sidebar-tasks/`；头部已有后台任务列表；DSH 无任务依赖模型 | 五步完成，审核通过 |
| S2 核心自研 vs 生态已装 | `s2-core-vs-ecosystem` | 事实 C2（插件装过但被禁用）；F1–F3（tab 元数据与发现路径）；负责人"先查插件库"原话 | 五步完成，审核通过 |
| S3 成本与评估的数据可得性 | `s3-cost-and-evaluation` | F17–F20；C3（投影值已在列表行上） | 五步完成，审核通过 |
| S4 不属于右侧栏的三项归属 | `s4-out-of-sidebar` | F21–F23、F25；archiy 零命中 | 五步完成，审核通过 |
| S5 右侧栏容量与导航 | `s5-capacity-and-navigation` | F1、F3、F7–F10；负责人决策 1 与 5 | 五步完成，审核通过 |
| S6 智能体派生面板 | `s6-agent-derivation-panel` | 负责人后补原话；F12–F16 | ① 完成、③ 已给；②④ 未单独跑（负责人已在审核门就其位置作答） |

## 第 2 轮（五步完成，已过审核门）

第 0 步重新扫描（含第 1 轮已通过的结论）后，拆出下列**有事实依据**的下一层子议题：

| 子议题 | slug | 事实依据 | 为什么影响主议题 | 状态 |
| --- | --- | --- | --- | --- |
| R2-1 右侧栏元数据与可见性治理 | `r2-metadata-and-visibility` | F1（`tab-registry.ts:85-126` 无 icon/badge/order/pin）、F2（guide 才有名字与图标）、F3（`+` 是 guide-only 且芯片溢出无菜单）、负责人决策 1 与 5、VS Code 每条 View 必须有图标 | 决策 1（默认可见预算）在无 `order` 字段时**无法表达**；`kind` 一旦进入布局记录再补 `order` 属破坏性迁移，故它是所有新增面板的前置条件 | 五步完成，审核通过 |
| R2-2 记忆时间线（三源合成） | `r2-memory-timeline` | 负责人决策 3（git 历史 + 检查点 + memos 合一条时间线）；部署侧已装检查点、记忆与 git-graph 类第三方插件（部分禁用）；S2 方向 2（`dsh-resource://` 地址语义）；竞品规则"推断与声明必须分开标注" | 这是负责人主动选的最重选项，涉及三个来源的时间口径与来源标注，必须先想清楚再实现 | 五步完成，审核通过 |
| R2-3 失败归因的数据路径与聚合归属 | `r2-failure-attribution` | F19（失败与反馈信号可得）、F20（无全会话失败计数、客户端窗口分页 `types.ts:506`）、架构师提出的开工前必答项、边界视角 R4/R5 | 决定"失败归因面板"能不能不靠客户端逐会话翻日志；直接决定是否需要新宿主投影单元 | 五步完成，审核通过 |
| R2-4 终端面板的可行性与安全边界 | `r2-terminal` | F24（核心 `packages/terminal/*` 无 client 半边；`terminal-bash`/`tool-terminal` 只挂 `sdk-minimal`）、F26（`--trusted-host` 可放宽到非回环 authority）、部署侧已装 xterm 与 SSH 类第三方插件（禁用）、仓库规则"Model-visible ⟺ logged" | 唯一一个"真缺失 + 成本最高 + 有安全后果"的诉求，值得单独定边界再决定做不做 | 五步完成，审核通过 |
| R2-5 git-graph 上游修复状态 | `r2-git-graph-upstream` | 事实 C2（`@linxin666/dsh-client-ui-git-graph` 已装、被 `disabled`，理由 "targets an older DSH API"）、负责人决策 2（先查上游是否已修） | 决定 Git 面板走"启用 / 移植 / 自建"哪条路，是决策 2 的直接落实 | 主 agent 直接调查，审核通过 |

## 轮次纪律

- 一轮 = 一次"扫描事实 → 拆子议题 → 所有子议题走完五步并过审核门"。
- 第 2 轮结束时重新执行第 0 步判断：拆得出有事实依据的新子议题就继续，拆不出就停止，不硬凑、不擅自开第 4 轮。
- 本轮全部子议题的 ⑤ 审核门已过（审核原话：「可以」针对记忆时间线的技术修正；「ok」针对 ⑤ 门的推荐版本），其五件套已一次性写入 `r2-*/`。
- 第 2 轮的两个前置已在审核门后获答（2026-09-17）：**P1 = 若部署绑定面为单人使用** ⇒ 只读终端面板的残余风险为低，per-install 开关变为可选项而非必需项（一旦出现第二个本地用户即转为必需）；**P2 = 先做有界代价评估再定**（不直接迁移，也不直接自建）⇒ 评估结果出来前不启动 A 或 B 的实现。P2 评估因此成为第 3 轮的子议题之一。

## 第 3 轮候选（未开）

第 0 步在第 2 轮结束时的判断：仍拆得出有事实依据的新子议题，故**不停止**，第 3 轮可继续。优先候选：

1. **「从观测到动作」的缺口**（PM 在第 1、2 轮连续两次提出的同一问题）：五个发现全是观察面，没有一个动作 —— 看见失败归因之后按哪个按钮（重试 / 换模型 / 回滚到检查点 / 派修复子代理，一个都没有）。依据：`03-decisions-and-plan.md` 的验收标准第 6 条与 `r2-failure-attribution/03-conclusion.md` 第 8 条。
2. **P2 版本线**的代价评估（迁移到 0.1.5-rc.1 的成本是否有界）。
3. **S6 承重论证的对抗性检验**（"只有 tab 类型能拥有 guide 条目 ⇒ 必须独立成 kind"）。

## 第 3 轮（五步完成，已过审核门）

| 子议题 | slug | 事实依据 | 状态 |
| --- | --- | --- | --- |
| R3-1 从观测到动作：动作闭环 | `r3-observe-to-act` | `packages/client/ui-jobs/src/client/index.ts:24` 证明 tab 体可 `inject: ['sessions']`；`api/session-controller/src/client/contract/session.ts:86,112,133,140` 与 `contract/sessions.ts:97` 提供 `prompt`/`cancel`/`loadThrough`/`command`/`fork` | 五步完成，审核通过 |
| R3-2 迁移版本线的有界代价评估 | `r3-version-line-cost` | 浅克隆/无 tag/若干本地提交、`SESSION_FORMAT_VERSION` 2 vs 3、若干插件 peer 声明、npm 发布线（均在 ③/② 内） | 五步完成，审核通过 |
| R3-3 S6 承重论证对抗性检验 | 无需独立目录 | `SidebarRightGuideEntry` 契约「contributed by the type it opens (picking it opens that type as a page)」+ `SidebarRightGuideBox.kind`（无镜头参数） | **已由主 agent 直接验证并关闭**：承重论证成立，独立 kind 既必要也充分 |

**第 3 轮决策（审核原话逐字）**：「1/3/4/6 按推荐，2 选「先跳转」，5 选「迁移，四前置照办」」

**第 3 轮推翻/修正**：
1. **"只读面板"是设计选择，不是宿主限制** —— 推翻第 1、2 轮把"只读"当作约束的前提；连带翻案四个面板的理由（失败归因、智能体派生、只读终端、检查点时间线），任务观测 tab 只翻理由不翻设计。
2. **"按钮即命令行"被收窄**为"改会话状态走命令行、移动视口走类型化客户端调用"（`session.command` 只回 `{ matched: boolean }`，三态不可分；纯读包成命令会造假审计）。
3. **动作 MVP 与迁移决策被同一个插件焊死** —— `dsh-checkpoint-rewind 0.5.2` 精确钉 `0.1.0-rc.6`（既非 0.1.3-alpha.2 也非 0.1.5-rc.1）；故回滚跟随迁移决策。（第 2 轮曾把"回滚检查点"当作零依赖的干净动作。）
4. **"迁移只需新建 profile"是错的** —— `sessions`/`storages` 在 `DSH_HOME` 级，profile 隔离不了日志迁移；副本验证必须用独立 `DSH_HOME`。

## 循环收敛（第 3 轮为上限轮）

本循环约定最多三轮。第 3 轮结束时重新执行第 0 步判断：**拆得出**有事实依据的新子议题（动作的 principal 与权限模型、动作的可发现性、迁移源谱系证实、"迁移后免费/仍需自建"清单），但它们不属于本循环的下一轮 —— 按约定**不擅自开第 4 轮**，改为交接清单（见 `99-roadmap.md` 第五节）。

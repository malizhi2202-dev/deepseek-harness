# 动作面：谁能发起、从哪儿发起 —— 子议题清单与轮次记录

议题 slug：`action-seam`
议题来源：第 3 轮循环收敛时交接清单的第 1、2 项（负责人选择「先把交接清单第 1、2 项当新议题讨论」）。
为什么另开议题而不是接着上一轮：上一个议题（`sidebar-asks-2026-09-17`）按约定**最多三轮**已收敛；本议题的答案不改动已落盘的结论，而是决定"**动作**"这一层能不能上线 —— 它是在第 3 轮把"只读是设计选择而非宿主限制"揭出来之后才成立的问题。

## 第 0 步扫描到的事实来源

| 类别 | 来源 |
| --- | --- |
| 负责人原话 | 第 3 轮 ⑤ 的逐字回答、本次出口选择 |
| 仓库代码（只读） | `packages/jobs/jobs/src/index.ts:116-120`（kill 的 caller/owner 校验）、`packages/interaction/user-approval/src/types.ts:65`（`ApprovalRequestEvent.agent`）、`packages/interaction/commands/**`（命令注册与执行面）、`packages/interaction/permission-presets/**`、`packages/api/session-controller/src/client/contract/session.ts:86,112,133,140` 与 `contract/sessions.ts:97` |
| 上一议题结论 | `../sidebar-asks-2026-09-17/r3-observe-to-act/03-conclusion.md` 第 3、4、6 条；`../sidebar-asks-2026-09-17/99-roadmap.md` 第五节交接清单 |
| 部署面（只读） | 绑定/监听面、`$DSH_HOME` 下的 profile 与插件清单（**具体取值不归档**，仅用于判定边界是否成立） |

## 子议题

| # | 子议题 | slug | 事实依据 | 为什么影响主议题 | 状态 |
| --- | --- | --- | --- | --- | --- |
| N1 | 动作的 principal 与权限模型 | `n1-principal` | `kill(id, caller?)` 的契约：「@param caller - killing agent checked against the owner. … Throws for an unknown or foreign job.」；审批事件携带 `agent: Agent`（审批是 agent 发起的）；`session.command(line)` 只回 `{ matched: boolean }` | 用户点击**没有 Agent 身份** ⇒ 未定义之前，「停后台 job」「派生修复子代理」这类动作不能上线（不是技术做不做得到，是权限上谁批准） | 五步完成，审核通过 |
| N2 | 动作的可发现性 | `n2-discoverability` | 按钮只在对应面板打开时存在；命令缝合点已有注册与执行面、且已有 `command/run`+`command/done` 审计轨迹；客户端是否收录会话级命令 | 决定"动作"是**面板的附属按钮**还是**产品级命令面**；也决定第 3 轮采纳的验收口径（能否被找到、能否被事后归因）是否够用 | 五步完成，审核通过 |

## 轮次纪律

- 本议题自第 1 轮开始，最多三轮；拆不出有事实依据的新子议题即停止，不硬凑。
- 结论先以对话形式呈审核门；通过后才写入本目录的 `n1-*/`、`n2-*/` 五件套。
- 全程只读：不修改、不新建、不删除仓库与 `~/.dsh` 内的任何源码、配置、测试、脚本。
- 档内只记**产品层事实**；任何实例的部署取值与启动参数**不入档、不入代码**，也不作为证据或断言依据。

## 第 1 轮结果（已过审核门）

- 审核原话（逐字）：「同意推荐的」
- **N1 落定**：三层模型（连接主体 Cookie = 安全边界 → 会话主体 `Agent` = owner 校验的键 → 人类 = 不是主体、是唯一能提交命令的人），**不新增主体概念**；两条硬条件（主体由宿主按"面板所属会话"解析；非 loopback 前先闭合连接层）；能力规则「**改状态的动作必须走命令路径**」（+ 退路条款：出现别的宿主侧动作端点时重述为「主体必须服务端解析」）；**不给审批加"指名人类"**，改为给审批结算加来源标量 `{kind:'user'}`。
- **N2 落定**：两条规则 —— ①位置：按钮属于**锚定它事实的面板**（既有架构决议原文）；②可枚举/可审计：改状态动作要能被 `commands.list` 找到并落 `command/run`。**决定性变量 = 这个动作是否需要在它所在面板之外被枚举或审计**。首发阶梯 **preset → turn → job**，新增第二条客户端写路径需独立决策记录；失败协议（三态 + 日志落点、禁止 falsy reply）与声明式可用性谓词**只约束新的动作面**，不改 `SessionFace.command` 的有意契约。
- **未决（本次未表态，按约定保留；实现前必须收口）**：① 「必须落域事件」是门还是刹车（`goal/change` 无 actor 的反例今天会被放行）—— **已回填实施清单 §8，不收口不得上线动作**；② job 动作放 body 还是 tab menu；③ subagent 自有 job 的排除是正确能力边界还是未记录的可见性缺口。**已收口**：连接层「先闭合还是先发船」由第 2 轮改为「模式判定 + 启动打印生效信任面 + 文档 A/B 对照表」（不需要新授权层）；「停 job 是否进首发」按已采纳的首发阶梯 `preset → turn → job`（job 类居第三级）。

## 第 0 步重跑（第 1 轮结束时）

拆得出两个**有事实依据**的新子议题，且都属于同一批"上线前必须定义"的事项，不是新领域：

1. **连接层授权契约与破缺条件** —— `trustedHosts` 与 `DSH_WEB_LOCAL_NO_AUTH=1`（`packages/client/connection/src/browser-auth.ts:120-128`，**在 HEAD 中即为提交状态**）、第二个本地用户、共享 `$DSH_HOME` 四种情形今天都没有定义；`--host 0.0.0.0` 已 fail loud（`packages/bundle/web-app/src/startup.ts:75`）。它是**任何用户动作上线的硬前置**。
2. **动作结果的落点与失败可见性** —— 专家团指出真正的缺口是"分辨得开却没有落点"；外部证据（VS Code 的 `when`/`enablement` 分离、Apple HIG 置灰但菜单可开、GNOME "make invalid buttons insensitive"）都要求**本地谓词决定隐藏/置灰**，而不是事后报错。

⇒ 第 2 轮据此开启（负责人选择「继续第 2 轮」）。

## 第 2 轮结果（已过审核门）

对应目录：`r2-connection-authority/`（连接层授权契约与破缺条件）、`r2-failure-landing/`（动作结果的落点与失败可见性）。

**审核原话（逐字）**：「ok」（对"其余按推荐"的确认）。

**本轮最硬的发现（独立成条）**：**逃生门的"本地性"判据是请求 Host 头，可伪造。** `localNoAuthEnabled` 读 `requestAuthority(headers)`，而围栏（`api-request-trust.ts:103`）对任意 `127/8` 与 `localhost` 无条件放行 ⇒ 一旦 bind 被放宽（cordis 文件路径不拦，`resolveLanTrust` 还会自动补进 LAN 字面量），远端调用者只要写 `Host: 127.0.0.1:<port>` 就能**零凭据拿到完整工具能力 API**。今天拦住它的是**绑定地址**，不是这段代码。

**其他承重事实（产品层）**：逃生门**在 HEAD 中即为提交状态**（`browser-auth.ts:120-128`，生效于 `:251` 与 `:301`；工作树相对 HEAD 只多一处类型签名改动），且 `scripts/start-web-local.sh:61` 是**已跟踪文件**并在用它启动；**不存在 per-session 授权**（会话可见性只按 `header.cwd !== undefined` 过滤，`packages/api/session-controller/src/list.ts:138`，会话根跨 profile 共享）。

**本轮推翻/订正**：① "loopback 下 `trustedHosts` 必须为空"是**假门**（围栏对 `isLoopbackHostname` 无条件放行，那些授权本来就惰性）⇒ 改为 **bind ↔ 信任面一致性检查**；② 共享 `$DSH_HOME` 下 **cookie 并不互通**（cookie 名与载荷绑 authority 含端口），真正共享的是**签名密钥来源与 sessions 根**；③ `role="alert"` 实测 **26 处 / 13 文件**（非 21/11）。

**已采纳的决定（产品层）**：契约按**模式对照**写（模式 A = token→cookie + 回环 + 围栏；模式 B = 显式无认证 + 回环 + 围栏，此时"Host 是回环即等于『是你』"）；**启动响亮打印当前模式与生效信任面**；断言以可机器验证的警告为主、`bind=0.0.0.0` 升级为拒绝；**逃生门判据从请求 Host 头改为实际 bind**；LAN-bind 不对称按"把 `0.0.0.0` 从 webserver schema 移除"处理；共享 `$DSH_HOME` 契约按实测更正；**发布门**：模式 B 下上线用户可见的状态变更动作而操作者不知情 = 危险，故"启动打印模式"是所有动作的硬前置；R2-B 整包（三态、`cancel()` 判别结果先于动作上线、outcome 原语、`when`/`enablement`、日志指针规则、不加 `availability` 字段）。

**残余风险（产品层）**：**模式 B** 下认证不在链路上，因而任何授权判断都不能依赖认证，只能依赖绑定地址与围栏。

**未决（保留）**：逃生门最终形态（换名 opt-in / 保留原名 / 直接删并让脚本走 token）。**已作废两项**：「live 证据的权重分歧」不适用（档内只记产品层事实）；「信任清单裁剪权」属部署所有者事务，不作产品议题。

## 循环收敛（第 2 轮结束时重跑第 0 步）

重跑第 0 步的结论：**拆不出新的、有事实依据的子议题** —— 剩余事项（模式判定点与断言位置、启动打印内容、文件权限归属、`0.0.0.0` 的处置、`cancel()` 的兼容与迁移、outcome 原语的落位）全部是**实现细节**，不是新的问题领域；未决三项也已在档中定性。

⇒ 按约定**停止**：本议题收敛于第 2 轮（上限三轮），不再开第 3 轮。后续工作属于实现阶段，不属于本循环。

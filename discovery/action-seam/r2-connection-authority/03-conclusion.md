# R2-A ③ 结论与建议

## 独立一条（本轮最硬的发现）：逃生门的"本地性"判据是请求 Host 头，可伪造

`localNoAuthEnabled(headers)` 读 `requestAuthority(headers)`（请求头里的 Host），而围栏（`api-request-trust.ts:103`）对任意 `127/8` 与 `localhost` **无条件放行** ⇒ 一旦绑定被放宽，远端调用者只要伪造该请求头就能**在零凭据下拿到完整工具能力 API**。真正不可伪造的判据是**实际 bind**，且宿主侧本就持有它。此条**独立成条**，不作为"另一个本地进程"的子情形。

## 其余承重事实（产品层）

1. **逃生门是已出货代码路径**：`browser-auth.ts:120-128` **在 HEAD 中即为提交状态**（工作树相对 HEAD 只多一处类型签名改动），生效于 `:251`（`authorizeIndex`）与 `:301`（`isAuthenticated` 第一行）；`scripts/start-web-local.sh:61` 是**已跟踪文件**并在用它启动。
2. **不存在 per-session 授权**：会话可见性只按 `header.cwd !== undefined` 过滤（`packages/api/session-controller/src/list.ts:138`、search `:181`），会话根跨 profile 共享 ⇒ 任一实例的 cookie 可读该 home 的全部 session。
3. **订正（推翻本子议题 ① 的一条设想）**："loopback 下 `trustedHosts` 必须为空"是**假门** —— 围栏对 `isLoopbackHostname` 无条件放行、根本不看 `trustedHosts`，那些授权在 loopback bind 下**本来就是惰性的**。应改为 **bind ↔ 信任面一致性检查**。
4. **订正（推翻 R2-A 的一处推断）**：共享 `$DSH_HOME` 下 **cookie 并不互通** —— cookie 名与载荷都绑 authority（含端口）、Set-Cookie 无 Domain；真正共享的是**签名密钥来源与 sessions 根**。

## 已采纳的结论（产品层）

**契约（按模式陈述）**：
- **模式 A**：`token → cookie` + 回环绑定 + Host/Origin 围栏 —— 认证在链路上。
- **模式 B**：**显式**无认证 + 回环绑定 + Host/Origin 围栏 —— 此时"Host 是回环就等于『是你』"。
- 产品必须：**load 时判定当前模式**、**启动打印模式与生效信任面**、**文档给出 A/B 对照表**。
- "**绑定地址是唯一边界**"是**模式 B 下的性质**，不是产品契约的默认。

- **断言级别**：以「响亮且可机器验证的警告」为主，存量安装不拒启。**通配 bind（`0.0.0.0`）的处置以下一条为单一定论** —— 该取值从 schema 移除后，「升级为拒绝」与「逐条点名」两种分支都**不再可达**。
- **信任面检查**：loopback bind 时警告「所列授权在本次 bind 下无效」；**通配 bind 分支随 schema 移除而不可达**（若将来恢复该取值，必须逐条点名「以下授权现可被远端送达」）。
- **逃生门的门从请求 Host 头改到实际 bind**（三人一致；这是让"绑定是唯一边界"在**代码层也成立**的唯一结构性方式）。
- **LAN-bind 不对称（单一定论，取代上两条里的通配分支）**：把 `0.0.0.0` 从 webserver schema 移除，使「绑定即边界」结构化；因此 P0-3 的通配分支与 P0-5 不再冲突。
- **共享 `$DSH_HOME` 契约更正**：写为"cookie 是单 authority 的 bearer；`$DSH_HOME/sessions` 共享 —— 持有该 home 上任一实例 cookie 的浏览器可读该 home 全部 session"，并加测试。
- **发布门**：模式 B 下上线"用户可见的状态变更动作"而操作者不知情 = 危险 ⇒ 启动打印模式是所有动作的硬前置。
- **残余风险**：模式 B 下认证不在链路上，任何授权判断都不能依赖认证。

## 上线前仍须定义（未决即不得上线）

模式判定点与断言位置（推荐落在 `dsh-client-connection` plugin load，紧邻既有 `assertTrustedAuthority`/`assertImageBodyCapacity`，`connection/src/index.ts:104-118`）；启动打印的确切内容；反向代理/隧道是明确不支持还是文档化；契约定稿进哪份文档。**已定（不再是未决）**：文件权限断言的形式 = **点名路径的响亮警告**而非拒启。

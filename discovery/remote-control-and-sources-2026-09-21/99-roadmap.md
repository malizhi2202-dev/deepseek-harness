# 分阶段路线

裁定见 `00-request-and-rulings.md`（R1 设置级可编辑、R2 只做官方 API 的源、R3 先 MediaWiki），事实见 `01-verified-facts.md`。本议题**不跑完整发现循环**：负责人要求直接接入并在独立端口验证，故此处只排交付顺序与验收面。

## 阶段一：右边栏文件可编辑

**问题**：右栏 `files` 只能列目录、`text` 只能看。**做法**：给 `workspaceFiles` 远程命名空间加 `write`（带 `WorkspaceFileStat.version` 作为陈旧保护令牌，见 F4），在现有 `text` 查看器上加编辑模式。

- **范围**：`packages/api/workspace-files`（加写方法与类型）、`packages/client/ui-sidebar-textpreview`（编辑模式：进入编辑/保存/脏状态/冲突不丢用户输入/不可编辑原因）。
- **不做**：新建 tab kind 或新包（该类型已是文件地址的拥有者，见 F3）；二进制编辑。
- **前置判断**：分页读取意味着"只读了一半就保存"会截断文件——编辑必须先满足全文已读，或明确拒绝并给出理由；`fs/edit-intent` 与观察策略对"人经 Web 界面写"的口径须先查清（F6），不绕过策略。
- **验收**：保存成功、版本冲突不覆盖、拒绝理由可见；改动后相关门全绿。

**状态：已完成**（提交 `9836255`）。写方法带 `WorkspaceFileStat.version` 陈旧令牌；版本不符与超限都在写出前拒绝，而非写出后补救；查看器只在"全文已读且版本已知"时才给出编辑入口。

## 阶段一之二：右栏终端（新建 shell 并可操作）

负责人新增要求：「右边栏再添加一个新建 shell，可以 shell 操作、操作终端」。

**这不是"挂载既有终端能力"，且先前已有裁定要求暂缓**——`../sidebar-asks-2026-09-17/r2-terminal/03-conclusion.md`：`ctx.terminals` 的每个方法都收 `owner: Agent`，浏览器没有 Agent 身份；消费契约是**有界回溯分页**，服务上**既无 push 流也无 resize**（`sanitize.ts` 原文 "Full terminal emulation is deliberately deferred"）；传输面只有 fetch/SSE + 远程方法调用，**没有 websocket**，输入/输出/尺寸/重连全要自建分帧。该裁定还明确反对"把 PTY 挂进 web preset"：那会把"有审批、有日志"的通道换成"绕过模型、无日志、无审批"的通道。

**负责人本次明确要求可操作 ⇒ 按推翻该裁定的方向做，但必须自建独立接缝并满足原裁定的安全前置**：

1. **owner 映射只读**：服务端把浏览器请求映射到该会话的 owner，**绝不接受客户端自报 owner**——列为不可配置的安全不变量。
2. **非 loopback 的 `trusted-host` 存在时默认不渲染**，或需显式 per-install 开关；`api-request-trust.ts` 自述**不是鉴权层**，回环监听也不按本地用户隔离，残余风险是同机其他本地用户。
3. **写权限本次在范围之内**（负责人要求可操作），但要在界面上把"这不是模型通道、无审批、无日志回放"讲清楚。
4. 终端 UI 状态**不入会话日志**；用户自己敲的字节流不产生字节级 transcript。
5. 三处接线齐全 + `./client` 导出 + `dsh.client` manifest + 每文件 100% 覆盖；文案走 locale 字典。
6. 传输自建：输出走 SSE，输入/尺寸走远程方法；`node-pty` 已是仓库既有依赖（`packages/subprocess/subprocess-local`）。

**tab kind order 预留（全局唯一，避免并发新增撞号）**：`terminal` 500、`channels` 600、`sources` 700。

**状态：已完成**（提交 `4f380c4`）。实现与本节的裁定有两处**实测出入**，以实现为准：

- **第 6 条错了：本仓库有 websocket 载体。** `/api/remote.mux` 就是（`packages/api/gateway/src/stream-server.ts:26` 的 `new WebSocketServer({ noServer: true })`，路径常量在 `stream-protocol.ts:6`），远程流即走它，`packages/api/workspace-files/src/index.ts:332` 已有 `@Remote({ mode: 'stream' })` 先例。因此没有自建 SSE——第二个传输要为同一件事重做代际、重连与背压。裁定里的「没有 websocket」是错的。
- **仍然没有 resize。** PTY 接缝在 spawn 时固定行列且不暴露 resize，所以面板不给尺寸控制，而不是给一个永远不支持的控件。
- 安全前置 1–5 全部落地：owner 由服务端从 Session 身份解析（客户端不自报）、非环回接入面默认拒绝、界面写明"不是模型通道"、字节流不入会话日志、三处接线 + `./client` 导出 + 每文件 100% 覆盖 + 文案走 locale 字典。

**遗留一项**：兄弟面板 `ui-sidebar-git` 有真实装配的 e2e（`apps/web/tests/sidebar-git.e2e.ts`，经 vendored Loader 起真实 `cordis.yml`），终端面板尚无对应件。按 `packages/AGENTS.md`「产品可见插件需要非单测的真实装配测试」，这一项在阶段五的装配通道里补，不在本轮关闭。

## 阶段二：通道接缝 + 远程控制面板 + 推推接入（竖切面）

先立**接缝**，再让**已有的推推**成为第一个真实渠道——这样面板一上线就有真数据可看，而不是空壳。

| 新增 | 角色 | 内容 |
| --- | --- | --- |
| `packages/channel/channel` | Service Definition | 通道注册表服务；类型：`ChatChannelConnector {channel, replyBudget?, createClient(config), connect(config, handlers)}`、出站 `ChatClient`、入站 `ChatInboundMessage`（媒体用惰性 `fetch(maxBytes)` 句柄，不用 URL 数组）。按 P1 的形状，不按 DSH 现有 `TuituiTransport` 单独成缝。 |
| `packages/channel/channel-bridge` | Consumer | 通用桥：绑定、去重+持久水位线、会话锁、忙碌排队、完成文本收集、分段/节流/引用、文件投递（mtime 过滤）、通知话术、状态、错误分类。按 P2/P6/P7 移植；**入站准入改为走本仓库的 agent/session 服务**。 |
| `packages/channel/channel-tuitui` | Provider | 把现有 `packages/tuitui/tuitui` 的 transport 适配进接缝（其 `TuituiTransport` 正好是**线缝**，接缝在其上一层，见 P1）。 |
| `packages/api/channels` | Host BFF | 远程命名空间：状态、探测（连接/发测试消息）、启用/停用。与 git 面板同构。 |
| `packages/client/ui-sidebar-channels` | Client | 新 kind **`channels`**（order 600，`available`）：渠道选择、连接状态、启用开关、配置字段、凭据状态、探测按钮、"为何置灰"提示。 |

**配置与凭据（按 R1）**：每个渠道注册一个 `dsh-settings` 命名空间（面板拿到 F10 的描述符即可渲染表单与"字段来自哪一层"）；密钥一律按名字经 `dsh-credentials` 引用，**不上线**；扫码/贴码类绑定（微信、QQ）实现为 `dsh-authorization` 的一条流程。**不新增持久化域**——这是 R1 相对 penguin 的 P4 表结构的主要差异。

**保留本仓库的差异（勿照抄 penguin）**：模型**必须**知道消息来源——沿用 F8 的 `MessageSourceMap` 声明合并，而不是 penguin 的 P6「刻意隐藏」。

## 阶段三：平台连接器

按"已有参考 → 全新"排序，每个连接器都要把 P8 的硬限制作为界面提示暴露出来。

1. **飞书**：官方 SDK 的 WebSocket 长连接（`@larksuiteoapi/node-sdk`，新依赖），凭据 appId/appSecret。参考实现存在（P2/P8），移植成本最低。
2. **钉钉（全新）**：官方 Stream 模式长连接。penguin 无先例（P3），DSH 亦无（F7）——适配器、回调 ACK、回复窗口全是新写。
3. **QQ**：WebSocket 网关 + **被动回复额度记账**（P8：单聊 4 / 群 5，窗口 5 分钟）——这段额度记账是最值得原样移植的渠道级策略。
4. **微信**：**扫码获取凭据**（无控制台可抄），仅单聊，长轮询。
5. **推推**：阶段二已接入。

**验收**：无凭据时验证"未配置/不可用/为何置灰"三类状态；协议解析用夹具单测；有凭据的端到端由负责人在面板上实测。

## 阶段四：远程资料库

| 新增 | 角色 |
| --- | --- |
| `packages/resource/resource` | Service Definition：源注册表 + 每个源认领一个 `dsh-resource://<source>/` 地址域（F2 的准入规则）；三角色模板照 `packages/web`（`ctx.web` + 可换 provider + 消费者） |
| `packages/resource/resource-github` | Provider：仓库文件/目录/issue（官方 REST；SDK 用 `@octokit/rest`，不手写 fetch） |
| `packages/resource/resource-mysql` | Provider：只读账号 + 语句白名单 + 行/字节上限 + `max_execution_time`（`mysql2`） |
| `packages/resource/resource-mediawiki` | Provider（R3）：公开 wiki 免鉴权，私有用 bot 密码 |
| `packages/client/ui-sidebar-sources` | Client：新 kind **`sources`**（order 700，`available`） |

**关键复用**：远程文件**不新造查看器**——通过 `dsh-resource://<source>/…` 地址交给既有 `text` 类型打开（F2/F3）。因此资料库的产物天然是"右栏多出可打开的资源"，无需另写渲染。

**按 R2 明确不做**（并已在面板说明理由）：

- **360云盘**——该产品**已停止服务**（2016-11-01 停止写入，2017 清空数据），无物可接。若负责人指的是 **360AI云盘**，那是另一个产品（官方开放平台 + Apache-2.0 工具链），需单独立项。
- **网易云盘**——**产品已停**（2019-11-30 关闭入口，2023-07-19 文件中心停服）。注意与"网易云音乐云盘"无关。
- **夸克云盘**——无官方 API，仅 cookie 重放 / 逆向签名；其用户协议点名禁止第三方客户端并允许封号，**拒做**。
- **百度云**——官方开放平台存在且设备码授权无需回调，但未审核应用被限制在 `/apps/{appname}` 且 **10 请求/小时、10 用户**，作为"资料库"实际不可用。**先按"有条件"实现并在界面写明配额**，若负责人认为不值则降级为"不可用并说明"。

**替代路线（给上述源的兜底）**：WebDAV / S3 兼容 / 本地挂载目录。后两者几乎零新代码——本地挂载由既有 `fs` 能力直接覆盖，S3 已有 `@aws-sdk/client-s3` 在树内。

**一条待决的省力路线（不在本轮范围）**：本仓库已有 MCP 客户端桥（`packages/mcp/mcp-client`），上述多数源已有 MCP 服务器，走它可以"配置而非写包"；但**它只桥接 Tools，不桥接 Resources**，"可浏览的资源库"抽象仍须自建。是否扩展 MCP 桥去支持 Resources，是比逐个写 provider 更通用的做法，值得单独评估。

## 共同约束与风险

- **新 kind 的准入**：每个新 kind 必须过 `verify-sidebar-right-tab-types`（order 全局唯一、地址域恰好一个、默认可见不超过上限，见 F1/F2）。
- **新包三处注册**：`packages/client/tsconfig.client.json` 聚合、`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/package.json`——缺一处会在更晚的时点以不同方式失败。
- **模型可见 ⟺ 已记录**：入站消息成为模型可见输入，必须有对应会话事件与来源标量；新增渠道不得绕开这条。
- **密钥边界**：settings-controller 已做命名空间脱敏（F12），新配置面必须复用这条通道，不得自建传密钥的接口。
- **不新增存储域的代价**：R1 下"每会话绑定"的能力弱于 penguin 的 P4；若日后需要"同会话多渠道并存 + 渠道账号互斥"，须单独立项评审存储。
- **并发写者**：多个工作流同时改共享接线文件（bundle patch、tsconfig 聚合、`packages/api/remotes`）会互相打断门禁——同一时间只允许一个工作流持有接线面。

## 验证

另起一个端口跑最新构建，逐项核对：右栏文件可编辑并可保存、远程控制面板列渠道与状态、资料库源可列可读、以及先前已落地的两块（git 观测面板、智能体派生面板）与引导页聚焦仍然正常。

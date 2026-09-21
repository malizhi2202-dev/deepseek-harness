# 已核实事实

来源等级：【复核】主 agent 本轮直接执行命令或读文件确认；【子代理】子代理读代码确认并给出行号（未逐条复跑）；【联网】竞品一手文档——**本轮不可用**，见 F11。

## 一、本仓库现状（决定"新写什么、复用什么"）

| # | 事实 | 依据 |
| --- | --- | --- |
| F1 | 右栏当前恰好 **6 个 tab kind**：`tasks`(order 10, default-on)、`agents`(20, default-on)、`guide`(100)、`files`(200)、`text`(300, 认领 `dsh-resource://file/`)、`git`(400)。默认可见上限 3，其余 order ≥ 100。**新面板取 500/600 即可**。 | 【复核】运行 `scripts/verify-sidebar-right-tab-types.ts` 输出 |
| F2 | 地址认领是**新 kind 的准入规则**：能识别地址的类型必须恰好拥有一个 `dsh-resource://<type>/` 域；页面型（`guide`/`files`/`tasks`）不认领地址。 | 【复核】该 gate 的文件头注释 |
| F3 | `files` tab 只做**列表**，打开文件走 `tabActions.openResource`；实际读文本的是 `text` 类型。 | 【复核】`packages/client/ui-sidebar-files/src/client/{definition,face}.ts` |
| F4 | 文本读取是**按行分页**的：Host 侧有页长上限，返回体带 `offset`/`lines`/`eof`；`WorkspaceFileStat.version` 被文档定义为"stat 时刻的不透明新鲜度令牌，从不解析"。 | 【复核】`packages/api/workspace-files/src/types.ts:22-62` |
| F5 | `workspaceFiles` 远程命名空间当前声明 **list / read / readBytes / stat / changes**（外加一条变更帧流）——**没有写**。 | 【复核】`packages/api/workspace-files/src/` 文件清单与类型 |
| F6 | fs 能力**已有写**：接口声明 `writeText(target, content, expected?: FsWriteIntent, signal?)` 与 `editText(...)`，并有 `fs/edit-intent` 瀑布事件与 `fs-observation-policy` 插件；写是原子的，`expected` 提供陈旧保护。 | 【复核】`packages/fs/fs/src/index.ts:66,239-275` |
| F7 | **本仓库没有任何通道/连接器抽象**：`ChannelBridge`/`ChannelConnector`/`chatChannel`/`messagingBinding` 在 `packages/*/*/src` 下 0 命中。 | 【复核】grep 计数 |
| F8 | **推推已存在**：`packages/tuitui/tuitui`，函数式插件（`name='tuitui'`、`inject=['agents','agentDefaultModel','agentPresets','llm','permissionPresets']`、`Config`、`apply`），内部有 `TuituiBridge` 类；`src/types.ts` 已声明 `IncomingMessage`/`IncomingCallback`/`TuituiTransport` 与 `MessageSourceMap['tuitui']` 声明合并。 | 【复核】读 `src/index.ts`、`src/types.ts` |
| F9 | 推推按 **profile 配置**接入，不在 bundle 里：`cordis.patch.yml` 用 `insert: [{id: tuitui, name: '@deepseek-ai/dsh-tuitui', config: {}}]`；`packages/bundle/*` 下无 tuitui 引用。 | 【复核】profile 目录与 `packages/bundle` grep |
| F10 | 已有三套可直接复用的配置/凭据基础设施：`dsh-settings`（注册带 schema 的命名空间；解析值按"schema 默认 → 部署 base → 用户覆盖"合成；**配置界面每个命名空间拿到一份描述符**：schema、当前值、每个字段来自哪一层、生效时机；写入只改用户覆盖、按命名空间串行、可带期望修订号拒绝陈旧写者）；`dsh-credentials`（密钥不进配置，按名字引用；每插件持久凭据记录；配置界面能说明"是否已设/来自哪/可否改"而不显示值）；`dsh-authorization`（**每个凭据注册一条交互流程**，人在页面上登录/贴码/答题，流程解决即把凭据记录提交进 credentials 存储）。 | 【复核】三者 README 摘要 |
| F11 | **本机 web 搜索不可用**：搜索端点未配置（报错指向 `api.360.cn` 端点未设）。因此所有"某网盘有无官方 API"的判断**无法在本环境联网核实**，只能标注为"据已知、未验证"。 | 【复核】本轮实际调用失败 |
| F12 | Client 侧配置面已有落点：远程命名空间 `packages/api/settings-controller`（命名空间词汇已做脱敏，密钥不上线），客户端有 `ui-settings` 及其 general/models 子包。 | 【复核】`packages/api/remotes/src/client/index.ts` 与 `packages/client/ui-settings/` |

## 二、penguin-harness 的通道设计（作为参考实现）

来源均为【子代理】，行号为其报告所引（未逐条复跑）。

| # | 事实 | 依据 |
| --- | --- | --- |
| P1 | 接缝是**两个接口**：`MessagingChannelConnector {channel, replyBudget?, createClient(config), connect(config, handlers)}` 与出站 `MessagingClient`（`checkCredentials`/`sendText`/`replyText`/`sendImage`/`sendFile`）；入站归一化为 `MessagingInboundMessage`，媒体是**惰性句柄**`fetch(maxBytes)` 而非字节或 URL。 | `packages/server/src/runtime/messaging/connector.ts:16-252` |
| P2 | 通用层（`MessagingBridge`）拥有：绑定存储与状态机、按平台 messageId 的去重、会话锁、忙碌排队、回合创建、回复收集/分段/节流/引用、文件投递、通知话术、状态上报、错误分类。渠道专属只有：配置形状、线协议、事件归约、引用编码、markdown 渲染器、`replyBudget`、媒体端点、探测语义。 | `messaging/bridge.ts:758`、`connector.ts:1-13` |
| P3 | 平台**恰好 5 个**：feishu、telegram、qq、wechat、tuitui；**钉钉零匹配**（全仓含 `pnpm-lock.yaml` 搜 `dingtalk|ding-talk|dingding|钉钉` 均无）。 | `connector.ts:16` |
| P4 | 绑定存 `messaging_bindings`，主键 `(session_id, channel)`，`enabled` 是**意图**；**"启用"即绑定、停用即解绑**；两条互斥在同一次切换上：每会话至多一个启用渠道、每 `(渠道, 账号)` 至多一条启用行。 | `packages/server/src/db/schema.ts:119-135`、`http/routes/messaging.ts:9-17,367-399` |
| P5 | **面板的真名是「远程控制」/ "Remote control"**（`Messaging` 在 0.2.9 改名）；「消息软件」只出现在文档散文里，不是 UI 字符串。 | `packages/web/src/features/lib/strings.ts:2206,2208`、`changelog/0.2.9/2026-08-28-messaging-wechat.md:80-82` |
| P6 | 入站顺序：陈旧连接守卫 → 按平台消息 id 去重（每绑定 64 条环形 + 持久水位线**最后写**）→ **会话锁**（一个绑定只服务最先开口的那个会话，其余静默忽略）→ `startTask([userText(text)], {queueIfBusy:true})`，即与网页输入框同口径；图片转 `data:` URL，文件落 scratchpad 并以 `[attached file: …]` 具名。**模型被刻意设计为无法得知消息来自聊天软件**（无标记块、无特殊 sender）。 | `messaging/bridge.ts:1140-1221,17-21` |
| P7 | 出站只取**已完成的助手文本**，默认"每条完成即发"；所有发送与通知串在一条 promise 尾巴上；4000 字符格式感知分段；每渠道 markdown 渲染器，被平台拒绝时**退回纯文本重发一次**；群聊只给整轮第一条加引用；文件投递只发"本轮提到且本轮真写过"的文件（mtime ≥ 本轮开始）——这条是**安全属性**而非体验细节。 | `messaging/bridge.ts:1465-1787`、`error-kind.ts:1-30` |
| P8 | 平台硬限制（面板需作为提示暴露）：QQ **被动回复额度 4（单聊）/5（群）每条入站、窗口 5 分钟**；Telegram 4096 字符、群隐私模式；微信**只能扫码获取凭据**、仅单聊；推推单 WebSocket、无引用字段。 | 各 `*-connector.ts` / `*-api.ts` |

## 三、远程资料库可行性（已取得一手依据）

**方法纠正**：F11 只说明 `web_search` 工具不可用；**`web_fetch` 与 `curl` 可用**，故下表的判断多数已由子代理直接取回一手文档/npm registry 数据（仅少数中文平台条款页为转述后抽查）。来源等级：【子代理-已取一手】或【子代理-抽查】。

| 源 | 官方 API | 鉴权 | 可行性 | 关键限制 |
| --- | --- | --- | --- | --- |
| GitHub | 有（REST v3 + GraphQL v4） | PAT / GitHub App / OAuth **设备码** / **loopback 回调** | **可做** | 代码搜索 **10 次/分**且必须鉴权；其余 5000 次/时。注册应用无需审批。 |
| MediaWiki | 有（Action API + REST v1） | **bot 密码**（`Special:BotPasswords`）或 OAuth 扩展 | **可做** | 七个源里鉴权最友好：自助、仅 API、权限可分、无外部审批。无需 SDK（纯 JSON over GET）。 |
| Outline | 有（OpenAPI） | API token 或 **loopback** OAuth | **可做** | 自托管用 `--base-url`；服务端真实搜索。 |
| Notion | 有 | **PAT**（新，无需回调）/ 内部连接 / OAuth | **可做** | **`/v1/search` 只搜标题**，不搜正文；正文要递归取块。免费版仅空间所有者可建 PAT。 |
| Confluence | 有（Cloud v1+v2 / DC REST） | Cloud=邮箱+API token；DC=PAT | **可做** | 避开需公网回调的 3LO；两套正文格式（storage XHTML / ADF）。 |
| 语雀 | 有（OpenAPI + 官方 MCP） | 个人访问令牌 | **可做（有节流）** | 官方令牌限流紧到生态里出现 cookie 重放包——只走官方令牌，不碰 cookie。 |
| 百度云 | 有开放平台 + 官方 MCP | OAuth2 **设备码**（无需回调） | **有条件** | 新应用仅限 `/apps/{appname}`；未审核应用 **10 请求/小时、10 个授权用户**——"这不是资料库，是一个信箱格"。 |
| **360云盘（原）** | **无——服务已终止** | — | **不可做** | 2016-11-01 停止写入、2017 清空数据。无物可接。 |
| 360AI云盘（**另一个产品**） | 有开放平台 + 官方 MCP/CLI（Apache-2.0） | API key（`yunpan_` 前缀）或微信扫码 | **有条件** | 官方但标注**限时体验 / 请勿商用**，无企业接入路径。 |
| **夸克云盘** | **无官方 API** | 非官方：重放 `__pus` cookie 或硬编码签名密钥 | **拒做** | 用户协议点名禁止第三方客户端、禁止逆向，并允许冻结/封禁账号。七个源里封号风险最高。 |
| **网易云盘** | **无——产品已停** | — | **不可做** | 2019-11-30 关闭入口，2023-07-19 文件中心停服；无任何 npm 包目标于此。与"网易云音乐云盘"是两回事。 |
| MySQL | 无关（直连） | 数据库只读账号 | **可做** | 用 `mysql2`（`mysql` 已停更）；分层防护：只 SELECT 账号 + `transaction_read_only` + 语句白名单，收回 FILE 权限，绝不开 `multipleStatements`。 |

### 两条改变做法的发现

- **本仓库已有 MCP 客户端桥**：`packages/mcp/mcp-client`（stdio + Streamable HTTP），把 MCP 工具注册进 `ctx.tools`，命名为 `mcp__<server>__<tool>`。上表中多数源**已有官方或成熟的 MCP 服务器**（GitHub 官方、百度官方、360AI 官方、语雀官方、Outline、Confluence DC、社区 MySQL）——因此其中相当一部分"接入"可以是**配置**而不是写新包。
- **但 MCP 的 Resources 没有桥接**：该包 README 的 Known Limitations 明确写着只有 Tools 被桥接，Resources 与 Prompts 没有 harness 消费机制、已推迟。所以"右栏可浏览的资源库"这个**一等抽象目前不存在**，要做就得自建；现成的三角色模板是 `packages/web`（`ctx.web` + 可换 provider + tool 消费者）。
- **替代路线**（给做不了的源兜底）：WebDAV / S3 兼容 / 本地挂载目录——无厂商 API 门槛、无条款风险；本仓库桌面应用已依赖 `@aws-sdk/client-s3`，本地挂载则连新代码都不需要（`fs` 能力已覆盖）。
- **打包坑（写飞书连接器前必看）**：`@larksuiteoapi/node-sdk` 使用 `__dirname`，曾在 penguin 的 ESM 打包里以 `__dirname is not defined` 使连接失败，需先确认打包形态。

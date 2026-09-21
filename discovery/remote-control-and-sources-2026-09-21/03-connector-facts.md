# 连接器事实（T3 前置核查）

本文只记**实现前必须知道的事实**，来源为 npm registry 实查与参考实现逐文件阅读。凡本文件与 `01-verified-facts.md` 的 P8 表冲突，以本文件为准（P8 的微信/QQ 风险判断当时未读到参考实现的协议注释）。

## 一、SDK 可得性（实查 npm registry，HTTP 200）

| 包 | 最新版 | 许可 | 仓库 | 判定 |
| --- | --- | --- | --- | --- |
| `@larksuiteoapi/node-sdk` | 1.74.0 | MIT | `larksuite/node-sdk` | **官方**（飞书开放平台） |
| `dingtalk-stream` | 2.1.6-beta.1 | MIT | `open-dingtalk/dingtalk-stream-sdk-nodejs` | **官方**（钉钉开放组织），但 `latest` 是 **beta** |
| `qq-official-bot` | 1.3.0 | MIT | `zhinjs/qq-official-bot` | 第三方，**不采用**（见下） |
| `wechaty` | 1.20.2 | Apache-2.0 | `wechaty/wechaty` | 第三方 RPA，**不采用**（见下） |
| `wechat4u` | — | — | — | 第三方网页协议重写，**不采用** |
| `mysql2` | — | — | — | 资料库用（T4） |
| `@octokit/rest` | — | — | — | 资料库用（T4） |

registry 可达，新增依赖可安装。

## 二、重要更正：微信与 QQ 走的是**官方协议**

参考实现在 `wechat-api.ts` 与 `qq-api.ts` 的文件头写明了协议来源，这推翻了我此前「微信只能靠非官方库、属夸克同类」的判断：

- **微信**：腾讯**官方发布**了该 bot 通道（`https://github.com/Tencent/openclaw-weixin`，MIT），协议是 **HTTPS 上的纯 JSON**，无专有二进制、无混淆产物。另有一个由它派生的独立 SDK（`https://github.com/wong2/weixin-agent-sdk`，MIT，npm `weixin-agent-sdk`）。参考实现**不把二者作为依赖**，理由是**形态**而非许可：两者都独占进程的消息循环（`login()` 后 `start(agent)`）、只承载一个账号、把登录二维码渲染到 TTY（`qrcode-terminal`）、状态落在 `~/.openclaw`。本产品需要多个绑定并存、各自一份配置文档、二维码要送进浏览器，所以按同一组端点自行实现。
- **QQ**：走**官方 QQ 机器人开放平台 API v2**（应用 access token 交换、两种发消息、WebSocket 网关）。腾讯没有本产品可用的 Node SDK（扫描流那个是 `UNLICENSED`），所以生产适配器是 **plain fetch + undici 的 WebSocket**——两者每次调用都解析 undici 的全局 dispatcher，因此自动继承管理端的代理设置。

**结论**：T3 的微信与 QQ 应当是**按官方协议自行实现**，而不是引入第三方包。第三方包（`wechaty`、`wechat4u`、`qq-official-bot`）不采用。

## 三、QQ 的两条平台性质（下游全部继承）

1. **认证是短期 token，不是凭据本身**。每次 OpenAPI 调用带 `Authorization: QQBot <access_token>`，token 最长 7200 秒；凭据对（App ID + App Secret）只用来换新 token。因此**客户端自己拥有 token 缓存与提前刷新**，不让调用方操心；平台规定有效期末 60 秒内的请求行为需要按文档处理。
2. **被动回复额度**：单聊 4 条 / 群 5 条、窗口 5 分钟——这是最值得单测的策略（见 `02-channel-seam-design.md` 第六节的额度记账）。

## 四、微信的可行性支点：入站是长轮询

`getupdates` 由服务端挂住直到有消息或窗口关闭。这是该通道在**无公网**条件下可行的原因，也决定了它的入站模型与其他渠道不同（其余为长连接）。

## 五、参考实现规模（行数，用于估工）

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `messaging/bridge.ts` | 1900 | **通用桥**——本次最值得原样搬的部分 |
| `messaging/connector.ts` | 252 | 连接器缝（已记入 `01-verified-facts.md` P1） |
| `messaging/tuitui-api.ts` | 987 | 推推线协议 |
| `messaging/tuitui-connector.ts` | 122 | 推推连接器 |
| `messaging/qq-api.ts` | 914 | QQ 线协议 |
| `messaging/qq-connector.ts` | 631 | QQ 连接器 |
| `messaging/qq-scan.ts` | 434 | QQ 扫码绑定 |
| `messaging/qq-markdown.ts` | 247 | QQ 专用 markdown |
| `messaging/wechat-api.ts` | 832 | 微信线协议 |
| `messaging/wechat-connector.ts` | 412 | 微信连接器 |
| `messaging/wechat-scan.ts` | 467 | 微信扫码登录 |
| `messaging/wechat-markdown.ts` | 294 | 微信专用 markdown |
| `messaging/feishu-sdk.ts` | 782 | 飞书 SDK 适配 |
| `messaging/feishu-connector.ts` | 313 | 飞书连接器 |
| `messaging/feishu-card.ts` | 331 | 飞书卡片 |
| `messaging/media.ts` | 170 | 入站媒体处理 |
| `messaging/reply-files.ts` | 223 | 出站文件投递（含「本轮真写过」过滤） |
| `messaging/markdown.ts` | 289 | 通用 markdown 降级 |
| **合计（不含 telegram）** | **≈ 9.0k** | |

**钉钉在参考实现中完全不存在**（`grep -ril "dingtalk\|钉钉" packages/server/src/` 无命中），所以钉钉是全新工作。可选路径：用官方 `dingtalk-stream` SDK（注意 `latest` 是 beta），或按 Stream 模式协议自行实现——与微信/QQ 同一取舍逻辑，实现时定。

## 六、对 T3 的直接影响

- 飞书：可用官方 SDK，但要注意 `__dirname` 在 ESM 打包形态下的问题（`01-verified-facts.md`）。
- 钉钉：全新；`dingtalk-stream` 官方 SDK 存在，优先评估直接采用。
- QQ / 微信：按官方协议自行实现；QQ 需要 token 缓存 + 额度记账；微信需要长轮询入站 + 二维码送进浏览器（对应 `dsh-authorization` 的一条流程）。
- 每个渠道都要有自己的 markdown 降级与分段（平台差异真实存在，参考实现为 QQ 与微信各写了一份）。

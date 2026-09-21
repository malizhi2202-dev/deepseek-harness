---
description: "terminalConsole Remote 命名空间：宿主 PTY 注册表之上的浏览器 shell 控制台，面向客户端消费者与宿主组合维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-terminal-console

[English](README.md) | 中文

## 概述

`dsh-api-terminal-console` 拥有 `terminalConsole` Remote 命名空间：`open`、`list`、`write`、`close` 以及 `output` 流，共同让 Web 右栏在会话工作区内运行一个 shell。该服务是**建立在 PTY 能力之上的控制台 seam**，而不是第二个 PTY owner：spawn、沙箱约束、边界与回收仍全部由 `ctx.terminals` 负责，本包只补上浏览器在其之上所需的东西——由服务端铸造的 shell 身份、网络可达面开关，以及有界的输出流。

权限正是该 seam 的全部意义。每个方法都接收 `agent: Agent`，由 Gateway 从线上 Session 身份解析而来；shell 身份在此铸造并按会话存储。因此，解析到另一个会话的请求找不到这样的 shell，而 PTY 会话 id 根本不会跨线。控制台不向会话日志追加任何内容，也没有任何类型化字节进入模型请求：这是人的通道，不是模型的。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

客户端代码通过 `dsh-api-remotes` 客户端装配已经挂载的 Remote 载体调用该命名空间；浏览器中没有插件直接加载本包。`open` 铸造一个 shell，`list` 报告调用方存活的 shell，`write` 投递一次面向行的输入，`close` 结束一个 shell，`output` 则是逻辑 Remote 流：一串经过净化的文本帧，以一个退出帧收尾。

宿主组合把该端点与一个 `ctx.terminals` 注册表一同挂载，且该注册表为 `backendType` 注册了后端。Web 应用为此挂载自己的 PTY 行：`minimal` preset 的注册表位于条目本地 realm 中，浏览器无法触达，而复用它等于把模型自己的 shell 交给面板。

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 只承载线上词汇表，包括六个已声明的错误代码。`src/output-window.ts` 是把相邻两个有界回滚页折叠为一帧的函数：当新页仍以已发送的全部内容开头时追加，否则整页替换，因为后端的字节与行边界可能从头部落下已保留文本。两个分支都是精确的，都不会对缺口作猜测。`src/index.ts` 是服务本体。

其中三个决定值得点名。第一，PTY seam 没有推送流，因此 `output` 是以 `offset: 0`（最新一页）轮询 `ctx.terminals.read`，并作为逻辑 Remote 流投递——那正是浏览器载体已经拥有的推送与重连面。第二，`write` 报告的是接受与否，而非命令结果：shell 一收下输入它就返回，结果由输出流报告。第三，`acceptReachableSurface` 是安全默认值。loopback 监听并不按本机用户隔离，而 `trustedHosts` 权威是可达性声明而非认证层，因此在组合明确声明接受"另一台设备可达的面"之前，控制台一律被拒绝。

<a id="model-experience"></a>
## Model Experience

None, as the namespace serves a browser panel over the PTY registry and registers no tool, prompt section, or session event.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **没有完整终端仿真。** 输出是净化后的文本：没有颜色、没有光标寻址、没有备用屏幕，也没有 TUI。面板如实说明这一点，而不暗示自己是终端。
- **没有 resize。** PTY seam 在 spawn 时固定行列；没有可暴露的 `resize` 方法，因此面板选择不提供，而不是交付一个永远不支持的调用。
- **面向行的写入与单一独占发送。** 长时间运行的命令会一直占用发送槽，直到 PTY seam 的就绪超时；在那之前或关闭 shell 之前，后续写入以 `terminal-console/busy` 被拒绝。对运行中命令的人工抢占被推迟。
- **轮询而非推送。** 帧延迟下界由 `pollIntervalMs` 决定；当 shell 的输出超出保留窗口时，面板收到的是整窗替换而非追加。
- **在可达面上默认拒绝。** 添加了 `trustedHosts` 权威的安装必须刻意设置 `acceptReachableSurface`，否则面板只显示拒绝原因，不提供铸造入口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

不发布运行时 invariant companion：该服务只拥有一条关系——shell id 只能针对铸造它的会话解析——而它自己的测试套件通过 `write`、`close` 与 `output` 拒绝外来会话，而不是断言服务存在。

PTY 基座由 `dsh-terminal` 与 `dsh-terminal-bash` 覆盖。本包的测试套件在一个注册表替身上驱动控制台，该替身保留真实 seam 的 owner 作用域、最新相对分页与独占发送规则。

</details>

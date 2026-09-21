# Agent Note: 右侧边栏里的 shell 控制台

Status: implemented

[English](2026-09-22-sidebar-terminal-console.md) | 中文

## Problem

右侧边栏已经能显示会话的任务、文件、派生树和仓库，但看着 agent 工作的用户没有办法自己运行一条命令。进程里每个 shell 都属于模型：`bash` 工具和它的持久化兄弟把 `ctx.terminals` 放在按 agent preset 挂载的入口本地 realm 里，而从浏览器去够它，就意味着把用户的按键送进模型的审批与记录通道——这正是让面向模型的工具成为错误载体的那种耦合。

## Decision

这项能力以一个新的 host 面接缝 `dsh-api-terminal-console`（`terminalConsole` Remote 命名空间）和一种新的右侧边栏标签页类型 `dsh-client-ui-sidebar-terminal` 进入。

**它是在 PTY 能力之上的控制台接缝，不是第二个 PTY 所有者。** 每个 shell 仍然由 `ctx.terminals` 创建、受沙箱约束、限定 scrollback 并被回收；控制台只补上浏览器在一个为工具调用而建的接缝上需要的东西：服务端创建的 shell 身份、网络访问面闸门，以及有界的输出流。直接自己持有 PTY 被否决，因为那会绕过 `terminal-bash` 的 `ensureSandboxModeFence`——那个把 shell 限制在会话沙箱模式内的检查。

**控制台的 PTY 底座是它自己的注册表。** agent preset 用 `isolate: { terminals: true }` 挂载自己的 `terminals` 分组，所以控制台即使想复用也够不到。web-app bundle 因此在 `backendType: console-shell` 下挂载第二对 `pty` + `terminal-bash`。没有任何面向模型的工具会写这个 backend type，所以没有工具调用能寻址到控制台的 shell，控制台的 shell 也不与模型的 shell 共享注册表。

内部有五个决定值得说明。

**权限是创建的，不是接受的。** 每个 `@Remote` 方法都接收 `agent: Agent`，由 Gateway 从线上传输的 Session 身份解析出来；控制台以该 Agent 为键，保存自己按会话创建并持有的 shell 身份（`console-1`……）。因此一个解析到会话 B、却携带会话 A 的 shell id 的请求找不到该 shell，会被以 `terminal-console/unknown-shell` 拒绝；PTY 的 session id 根本不会跨越线上传输。控制台新增的保证恰恰就是：shell 身份由服务端创建并按 Agent 归属——session id 本身是仓库既有的线上寻址机制，不是这个接缝加强的东西。

**在可达访问面上，拒绝是默认。** Gateway 的 `HostConnectionService` 把 `trustedHosts` 保持私有，而 Remote 方法看不到任何请求事实，所以在这个层次上逐请求的可达性检查是不可能的；闸门因此是配置项（`acceptReachableSurface`，默认 `false`），由组合声明部署事实。web-app 的行从 `ctx.webRuntime.trustedHosts.length === 0` 取该值，所以只监听 loopback 的安装会提供控制台，而添加过 authority 的安装必须显式接受它。拒绝以 `terminal-console/refused` 到达，面板画出理由且不提供任何创建控件，而不是给出一个无法工作的控件。

**输出是逻辑 Remote 流，在源头轮询。** 任务书原本预期 SSE；`/api/remote.mux` 是浏览器已经拥有、已经能重连、已经复用的载体，为这个面板再加一条传输只会白白复制 generation 与背压处理。生成器轮询 `ctx.terminals.read({offset: 0})`——最新的有界页——并用 `advanceConsoleOutput` 折叠相邻页：当新页仍以已经发送过的全部内容开头时产出追加，否则产出整窗替换，因为 PTY 的界限会从头部丢弃保留文本。每一代的第一帧被标记为 `replace: true`，这正是让重连的消费者替换而不是重复的原因。

**界限按 owner、按帧。** `maxShellsPerOwner`（默认 2）用进行中的预留计数限制存活 shell，使并发创建无法冲过上限；`maxFrameLines` 限制单次轮询；保留的 scrollback 由 backend 限定；每一条可能结束 shell 的路径——退出帧、关闭、owner 的销毁、服务的拆除——都会 kill 并移除它。任何内容都不会写入会话记录：字节流不是会话事件，而 `write` 报告的是接受与否，不是命令的结果。

**面板画的是文本，不是终端。** 否决 `@xterm/xterm` 有一个先于风格理由的机械理由：动态客户端 bundle 的 CSS virtual-id 插件无法解析裸的 `@xterm/xterm/css/xterm.css`，所以终端模拟器会不带样式表地到达。面板画的是有界的、经过净化的文本，按行组织，没有颜色、没有光标寻址、没有备用屏幕，并且文案里就这么说。shell 的输出放在标签页的 store 而不是客户端对象层，因为这个面板是它唯一的消费者，沿用 `ui-sidebar-git` 的先例；有第二个视图才是发布它的理由。

这个标签页类型是 `available`、从不 default-on，`order` 为 500——shell 是用户主动要的东西，常驻位置留给那些回答会话问题的界面。

## Alternatives considered

**复用模型的 `ctx.terminals` 注册表。** 它是 agent preset 隔离分组的入口本地注册表：浏览器够不到；而够到它就意味着把用户的 shell 放进模型的注册表，让工具调用可以寻址到它。

**在控制台包里直接持有 PTY。** 那会跳过 `terminal-bash` 的沙箱模式闸门，并重复 PTY 能力已经拥有的创建、沙箱、scrollback 与拆除行为。

**用 Server-Sent Events 传输出。** 在 `/api/remote.mux` 旁边再加一条传输，会为一个面板需要自己的重连、generation 与背压处理。

**逐请求的 loopback 检查。** Remote 方法拿不到请求事实，而 `HostConnectionService.trustedHosts` 是私有的，所以这个检查在这一层没有落脚点；用组合自身部署事实驱动的配置开关，如实说明了决定是在哪里做出的。

**用 `@xterm/xterm` 渲染。** 客户端 bundle 的 CSS virtual-id 插件无法解析它的样式表入口，所以宁可否决，也不发布没有样式的版本。

**为字节流写会话事件。** 那会把终端输出放进模型读取的记录里，使用户的 shell 成为模型可见输入，与"这是用户的通道"这一决定相矛盾。

## Consequences

控制台恰好在组合挂载了带 `backendType` backend 的 `ctx.terminals` 注册表的地方可用，在其他地方以 `terminal-console/unavailable` 被拒绝；改变 `backendType` 的部署必须在 backend 行和控制台行两处都改。

超出保留窗口的 shell 收到整窗替换而不是追加，所以面板每次轮询的开销有界，而带宽无界：这是在没有第二条流协议的前提下换取重连正确性的代价。

长时间运行的命令会占用 PTY 唯一的发送槽，因此后续写入在命令结束或 shell 被关闭之前都会被以 `terminal-console/busy` 拒绝；抢占正在运行命令的人工操作被推迟，`close` 是逃生口。

没有 resize：PTY 接缝在 spawn 时固定行数和列数且不暴露 resize，所以面板不提供尺寸控件，而不是提供一个永远不支持的控件。

什么都不持久化。刷新页面会丢掉屏幕上的文本，只重新列出会话仍然持有的 shell——这与"字节流不进入会话记录"是同一个性质。

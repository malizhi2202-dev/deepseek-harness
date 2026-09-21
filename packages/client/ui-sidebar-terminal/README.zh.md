---
description: "右侧边栏的终端标签页类型：用户自己的 shell 控制台，通过 terminalConsole Remote 命名空间驱动，面向 Web 用户与客户端插件维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-terminal

[English](README.md) | 中文

## 概述

`dsh-client-ui-sidebar-terminal` 把 `terminal` 注册为右侧边栏的一种标签页类型：一个 available 页面，在会话的工作区里开一个 shell，并画出它打印的内容。它是控制台接缝的浏览器半边——Host 半边是 `dsh-api-terminal-console`——本身不持有任何 PTY 知识：每个 shell 都由服务端创建、限界和回收，这个面板只列出服务端报告的内容、流式读取它的文本，并写入用户输入的行。

它有两行文案是面板的诚实说明，而不是装饰。这里是经过净化的文本，不是终端：没有颜色、没有光标控制、没有全屏程序。而且它属于用户，不属于模型：这里的任何内容都不会进入会话记录，也不会成为模型请求。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

打开右侧边栏的引导页并选择 **终端**，或者从类型选择器里打开 `terminal`。面板会连接，在会话还没有 shell 时创建一个，并显示它的文本。**新建终端** 会再开一个，标签按钮在它们之间切换，**关闭** 结束当前这一个，输入行每次提交一行。已退出的 shell 会把最后的文本留在屏幕上并注明已退出；已经不存在的 shell 会从标签栏里移除。

这个类型是 `available`，从不 `default-on`：shell 是用户主动要的东西，而右侧边栏常驻的位置属于那些回答会话问题的界面。它的 `order` 是 500，排在 files、textpreview 和 git 页面之后。

如果某个安装对外提供网络可达的访问面，控制台会被拒绝，面板会如实说明，而不是给出无法工作的控件。开关本身和它的理由属于 `dsh-api-terminal-console`；这个面板只负责画出拒绝。

<a id="understand-the-implementation"></a>
## 理解实现

文件划分就是分层：类型是什么（`definition.ts`）、它保存什么（`store.ts`）、它如何驱动控制台（`face.ts`）、它画什么（`TerminalBody.tsx`）、它说什么（`locales.ts`），以及只负责把它们接起来的 `index.ts`。

store 保存每个标签页的 shell、当前显示的那一个，以及各自已经产生的文本。它放在这里而不是客户端对象层，是因为这个面板是它唯一的消费者：有第二个视图才是发布它的理由，而这里没有。它持有的内容由服务端的帧上限约束，因为每一帧要么是接缝定过大小的追加，要么是整窗替换。

face 是控制台契约被兑现的地方。`output` 作为受监督的逻辑流被消费，所以载体掉线重连时面板不会察觉；而服务端会把每一代的第一帧标记为替换——重连后的一代因此替换视图，而不是追加一个面板已经持有的窗口。标签页自己的 signal 会结束它打开的流，所以关闭标签页不会留下订阅。拒绝会被画成独立状态；单个 shell 的失败画在那个 shell 旁边；每次写入都是一行提交，因为输入行就是全部手势。

<a id="model-experience"></a>
## Model Experience

None, as the panel drives a Remote namespace owned by the person and registers no tool, prompt section, or session event.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **是经过净化的文本，不是终端。** 面板画的是预换行的文本：没有颜色、没有光标寻址、没有全屏程序。它在控制台里如实说明，而不是暗示别的。
- **没有 resize。** PTY 接缝在 spawn 时固定行数和列数，也不暴露 resize，所以面板没有尺寸控件可给；用户看到的是浏览器自己的文本换行。
- **一次一行，一次一个发送。** 输入行每次提交一行，并且在一个写入还在进行时被禁用，因为接缝对每个 shell 只接受一个独占发送。粘贴多行是后续工作。
- **shell 不可恢复。** 面板打开时会重新列出会话持有的 shell；在更早的标签页记录里创建的 shell，只有在会话还在时才还在。没有"重新接入某个具名 shell"的手势。
- **没有记录。** 控制台打印的任何内容都不会被持久化，所以关闭标签页或刷新页面就会丢掉屏幕上的文本。这正是让字节流不进入会话记录的同一个决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

没有发布运行时不变式伴随包：面板不持有任何跨插件关系，而它依赖的那一条权限规则——shell id 只对创建它的会话可解析——在 `dsh-api-terminal-console` 自己的测试里被强制并拒绝。

面板的测试在真实 store 实例和脚本化控制台上挂载组件，手工驱动帧、退出、载体拒绝和一元调用结果，并断言读者看到什么、以及什么到达了命名空间。

</details>

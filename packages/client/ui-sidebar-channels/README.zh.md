---
description: "右侧边栏的远程控制标签页类型：列出本 Host 提供的每个聊天渠道、它的连接状态、它的凭据引用，以及由渠道自身 schema 声明的设置表单，面向 Web 用户与客户端插件维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-channels

[English](README.md) | 中文

## 概述

`dsh-client-ui-sidebar-channels` 把 `channels` 注册为右侧边栏的一种标签页类型：一个 available 页面，列出 Host 的连接器注册表提供的每个聊天渠道，连同它报告的连接状态、它声明的凭据引用，以及按渠道自身配置 schema 构建的设置表单。它是聊天渠道接缝的浏览器半边——Host 半边是 `dsh-api-channels`，其下是 `dsh-channel` 与 `dsh-channel-bridge`——本身不持有任何平台知识：渠道是什么、需要哪些凭据、由哪些字段配置，全部来自 Host。

它有两行文案是面板的诚实说明，而不是装饰。凭据只以引用名出现：面板既不读取也不显示密钥值，表单只在用户亲自输入时才写入。而渠道是 Host 拥有的注册项，没有可寻址的身份，因此面板列出状态调用报告的内容，而不是打开某个资源。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

打开右侧边栏的指南页并选择 **远程控制**，或从类型选择器中打开 `channels`。面板在挂载时读取 Host 的渠道列表，并为每个渠道画出一张卡片：连接状态、它绑定的会话与最近一次失败（如果有）、连接器声明的能力、以引用名表示的凭据，以及由它的 schema 声明的设置表单。**启用** 把渠道绑定到当前标签页自己的会话，**停用** 关闭它，**测试凭据** 在不启用任何东西的前提下探测凭据，**重新读取** 重新拉取列表。

该类型是 `available`，从不是 `default-on`：远程控制是用户主动要求的东西，而右侧边栏的常驻席位属于回答会话问题的界面。它的 `order` 是 600，排在 files、textpreview、git、terminal 页面之后，指南条目的序号是 60。

启用渠道意味着让某个会话可以被聊天平台触达，这件事的一切后果都由 Host 拥有：桥接的去重、聊天锁、准入与回复投递。面板只发出那一次调用，然后画出 Host 随后报告的连接状态。

## Understand the implementation

文件划分就是分层：类型是什么（`definition.ts`）、它保存什么（`store.ts`）、它如何驱动 Host（`face.ts`）、它画什么（`ChannelsBody.tsx`）、schema 如何变成表单（`schema-form.ts`）、它说什么（`locales.ts`），以及只负责把它们接起来的 `index.ts`。

store 保存每个标签页的渠道列表、每个渠道的设置描述、用户暂存的草稿，以及忙与失败标志。它放在这里而不是客户端对象层，是因为这个面板是它唯一的消费者：出现第二个视图才是发布它的理由，而这样的视图并不存在。渠道本身是 Host 的事实，在挂载时以及每次变更后读取，从不跨标签页携带。

face 是 Host 契约被花掉的地方。`status`、`enable`、`disable`、`probe` 都是一元调用，其结果替换面板的列表。渠道的设置描述通过设置作用域的 `describe` 读取，保存则通过已绑定的作用域 `mutate` 提交暂存的操作，并带上表单读取时的 revision，因此并发写入会被发现而不是被覆盖。桥会在第一次 `channels.status` 时注册连接器的设置命名空间，因此面板刚刚得知的渠道可能不在设置镜像启动时的答复里；遇到这种情况，face 会读一次设置文档，并把这个命名空间经镜像自身的 `acceptView` 折回去，从而让共享镜像仍是文档的唯一视图，表单也在首次挂载时就出现。标签页自身的 signal 会结束它开启的每一次调用，关闭的标签页不会留下任何订阅。

`schema-form.ts` 是唯一不含 Host 知识的一块：它把渠道的序列化配置 schema 变成正文要画的字段列表——控件种类、某个 section 声明的可选值、字段回退到的 schema 默认值——并把用户的草稿还原成设置操作，拒绝写入该字段无法保存的值。

## Model Experience

无：面板驱动的是属于用户的 Remote 命名空间，不注册任何工具、提示词段落或会话事件。启用渠道改变的是到达*聊天平台*的内容，而不是到达模型的内容；桥接自身的会话事件属于 `dsh-channel-bridge`。

#### KV Cache effect

无；这里没有任何内容组装或塑造模型请求。

## Known Limitations and Deferred Work

- **没有登录流程。** 需要扫码或交互式授权的平台不从这里驱动：Host 的 `AuthorizationPrompt` 没有声明 code 或二维码种类，因此面板画出连接器报告的失败，而不是自造一套流程。
- **时间戳与聊天锁事实不画。** `lastErrorAt`、`lastInboundAt`、`lockedChatId`、`replyBudget` 会到达客户端并有意保持不渲染；卡片画出连接、绑定的会话、最近一次失败消息，以及声明的大小上限。
- **桥接拥有的字段仍然渲染。** `enabled` 与 `sessionId` 属于桥接而不是连接器自身的配置，但渠道的 schema 声明了它们，面板渲染描述符持有的每个字段。真正把会话绑定起来的是面板自己的启用与停用控件。
- **面板无法编辑的字段会被画出，而不是隐藏。** 嵌套对象或未声明的控件种类会以它的 JSON 值出现，并附一行说明它不能在此编辑，因此面板未能完全理解的描述符，不会看起来像是完全理解的。
- **推推连接器没有自己的面板。** 它不提供任何 UI，因此这个面板就是它的全部界面；它画出的 id 来自 Host，只有本构建命名的渠道才会得到翻译后的标签。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

不发布运行时不变式伴随包：面板不拥有任何跨插件关系，而它依赖的权威规则——渠道 id 只对已注册的连接器解析，设置写入只对用户自己的文档解析——分别在 `dsh-api-channels` 与 `dsh-client-ui-settings` 中强制执行。

面板的测试套件在真实 store 实例、脚本化的 Remote 与脚本化的设置端口之上挂载正文，并断言用户看到的内容：读取可能落定的每一种状态、每个渠道一张卡片、以引用名表示的凭据，以及一次只提交恰好那些暂存操作、并带上读取时 revision 的保存。`apps/web/tests/sidebar-channels.e2e.ts` 中的组装浏览器场景是真实组合用例：在真实 Typert Remote 之上运行发布包自身的连接器行。

</details>

---
description: "面向读取远程资源源状态的客户端消费方，以及维护推导该状态的宿主端点并对某个实例执行探测的维护者的 sources Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-sources

[English](README.md) | 中文

## 概述

`dsh-api-sources` 拥有 `sources` Remote 命名空间：`status` 报告本宿主服务的每个远程资源实例，`probe` 用该实例提供方已解析的设置与凭据测试这一个实例。它是配置面板触达资源缝隙的唯一途径，自身不持有任何配置——每个答案都在调用时从 `ctx.sources`、设置提供方与凭据缝隙读出。

凭据引用只以名称与存在性穿越。某个源类型的设置 schema 标出哪些字段点名一个 `dsh-credentials` 引用；本端点报告每个名称背后是否存有值，绝不报告该值。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

客户端代码通过 [dsh-api-remotes](../remotes/README.zh.md) 客户端装配已挂载的 Remote 载体调用该命名空间；浏览器不直接加载本包。`status` 不接受参数，返回每个实例；`probe` 接受某次 `status` 答案报告的 `key`。本宿主不服务的实例以已声明的 `sources/unknown` 代码穿越线路，而仅仅无法连通的源以带原因的 `ok: false` 作答。

宿主组合把本包与 `ctx.sources`、`ctx.credentials`、`ctx.settings`、`ctx.typert` 一同挂载；它恰好注入这些。

<a id="understand-the-implementation"></a>
## 理解实现

`src/types.ts` 承载线路类型，并从 `src/seam.ts` 重新导出 `SourceCapabilities` 而非重述它，因此面板的声明与提供方的声明保持同一个类型。`SourceView` 携带一个实例的身份、配置其类型的设置命名空间、它当前所处状态、带时间的最近错误、已声明能力，以及该实例点名的每个引用对应的一条凭据事实。

`src/seam.ts` 是资源缝隙提供方契约的本地镜像，因为本包不新增任何依赖：它搭载的服务由另一个包提供，该镜像记录了在取得该依赖时替换为 `@deepseek-ai/dsh-resource/types` 的那一行改动。

`src/index.ts` 是端点。`status` 向每个已注册提供方询问其自身配置声明的实例，因此刚刚读过设置的提供方按那些值报告，而不是按某个副本；每个实例的状态来自提供方自己的 `configured` 答案加上本进程观察到的最近一次探测，而探测之后被编辑过的实例重新读作未检查，因为该结果描述的是已不再成立的设置。`probe` 把该提供方解析出的实例交给它，并以带原因的 `ok: false` 作答而非拒绝，因为「凭据有误」正是面板存在的意义。

凭据字段以结构化方式读出：设置提供方把 schema 发布为 JSON，其中嵌套节点要么内联、要么是共享 `refs` 表中的下标；端点沿凭据引用可被声明的容器下行——`object`、`dict`、`array` 与 `intersect`——收集节点声明 `meta.role === 'credential-ref'` 的字段。字段名随后从提供方解析出的实例上读出，因此用户刚刚改过的引用按新值报告，本端点不缓存任何东西。

<a id="model-experience"></a>
## 模型体验

### 远程资源源状态

#### 模型看到什么

不直接看到任何内容。本端点不注册工具、提示词段落或 session 事件，它返回的任何答案都不会进入模型请求。某个源能回答什么，是经由资源缝隙自己的消费方——检索与读取某个源的工具——到达模型的，而本端点只是把同一份 `capabilities` 声明报告给面向人的面板。

#### Token 影响

自身没有影响。一次 `status` 或 `probe` 答案不会给任何请求增加 token；用户在此配置的源会改变那些其他消费方能返回的内容，其 token 计账由它们自己覆盖。

#### KV Cache 影响

无直接影响；此处不装配也不塑造任何模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **设置命名空间是推导而来，而非声明而来。** 每个提供方包把自己的命名空间命名为 `resource-<kind>` 并从其中解析实例，但缝隙与设置域都不暴露「类型到命名空间」的成员，因此本端点自行拼出该名称。命名方式不同的提供方仍会报告其实例，其配置界面读作不可用，而不是为一个并不存在的命名空间展示表单。修复属于缝隙：在 `SourceProvider` 上增加 `settings` 或 `namespace` 成员。
- **探测结果只存活于本进程。** 设计没有为它们增加持久域，因此重启后每个已配置实例都读作未检查，直到有人再次探测。
- **本构建读不到的凭据引用报告为未设置。** 声明在 schema 遍历触及不到的字段上的引用——藏在联合分支或 transform 里的那种——根本不会被报告；值不是引用名的那种则以空名报告，而不是被悄悄略去。
- **没有启用或停用。** 设计从「是否已配置」推导源是否连接，因此该命名空间不移动任何激活状态，也不提供任何无法生效的控件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

不发布运行时不变式伴随包：该端点是一次薄推导，其状态映射与 schema 遍历已由其自身测试套件针对脚本化提供方、设置描述符与凭据事实固定。

该套件以设置提供方发布的同一 `{uid, refs}` 形式手工构造序列化设置 schema，因此凭据遍历下行的每个容器都由一个用例覆盖，而不是依赖某个真实提供方的当前 schema。

</details>

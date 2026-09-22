---
description: "ctx.sources 的 MediaWiki source 提供方：通过 Action API 进行全文检索、页面读取与分类列表，并逐次操作解析 wiki 凭据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-mediawiki

[English](README.md) | 中文

## 概述

有了 `dsh-resource-mediawiki`，模型可以像访问其他远程集合一样，通过同一个 source seam 检索、读取与浏览一个或多个 MediaWiki wiki。该提供方使用 Action API：`list=search` 做全文检索，`action=parse` 读取整页，`list=categorymembers` 列出某个分类的成员，`list=allcategories` 列出该 wiki 的分类。需要登录的 wiki 使用机器人账号认证，其密码在每次操作时按名称从 `dsh-credentials` 解析，因此轮换后的密钥无需重启即可在下次调用生效，且配置中不含任何密钥值。匿名 wiki 完全不需要凭据。该提供方拒绝 HTTP 重定向，因此带凭据的请求不会被转发到其他源。面向模型的工具位于 `dsh-tool-resource`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先挂载 source 注册表，再挂载本提供方。每个 wiki 是 `resource-mediawiki` 设置命名空间下的一个实例，实例 id 即模型传给工具的 `source` 参数。

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
  config:
    maxReadBytes: 200000
    instances:
      handbook:
        baseUrl: https://wiki.internal
        username: Bot@Reader
        passwordRef: WIKI_BOT_PASSWORD
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxReadBytes` | `200000` | 单次读取的字节上限；提供方裁剪完整文档并追加截断标记 |
| `maxListItems` | `50` | 单次列表的条目上限 |
| `instances.<id>.baseUrl` | 必需 | wiki 的基础 URL，含脚本路径（如 `/w`）；只接受 `http` 与 `https` |
| `instances.<id>.username` | 省略 | 机器人账号名；存在时 `passwordRef` 为必需，且登录必须成功 |
| `instances.<id>.passwordRef` | 省略 | 保存机器人密码的凭据名，逐次操作通过 `ctx.credentials` 解析 |

当实例的 URL 可解析、且在其声明用户名时凭据当前能解析出非空值时，该实例即视为已配置。未配置的实例不注册任何工具，并在打开任何连接之前以 `SOURCE_UNCONFIGURED` 使 `check` 失败。

### 已配置的 source 能回答什么

已配置的 wiki 回答三种操作，面向模型的工具集由此派生。

- `search` 执行全文检索并返回带 snippet 的页面命中。
- `read` 返回单个页面的 wikitext，并按读取上限裁剪。
- `list` 返回某个分类的成员；未指定容器时返回该 wiki 的分类。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方只拥有 wiki 协议，别无其他。工具 schema、渲染与呈现属于消费方。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、设置段、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `MediaWikiSourceProvider`：实例解析、三种操作与限制 |
| [`src/client.ts`](src/client.ts) | `MediaWikiClient`：请求派发、cookie jar、登录与拒绝重定向 |
| [`src/wire.ts`](src/wire.ts) | 收窄 Action API 载荷的响应守卫，遇到不可用载荷时抛出 `SOURCE_PROVIDER_ERROR` |
| [`src/types.ts`](src/types.ts) | 实例与已解析配置类型 |
| — | 不发布运行时 invariant 伴生包；该提供方不拥有可被独立观测推翻的关系。 |

### 认证与重定向

带用户名的 wiki 每个会话登录一次：客户端先取登录 token，再提交凭据，并在后续请求中保留返回的 cookie。没有用户名的 wiki 发出匿名请求。所有请求都以 `redirect: 'error'` 发送，因此重定向响应会让调用失败，而不会把带凭据的请求转发到 wiki 指定的任何源。

### 设置与变更通知

该 kind 逐次操作读取配置，因此已提交的设置变更无需重新注册即可在下次调用生效。当设置段变化时，提供方为其 kind 发出 `sources/changed`，工具消费方正是借此得知需要重新派生工具描述中列出的实例列表。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级说明不够时，请阅读以下页面。

- [resource 包导览](../README.zh.md)——五包家族及各自角色。
- [dsh-resource](../resource/README.zh.md)——本提供方注册到的 seam。
- [dsh-tool-resource](../tool-resource/README.zh.md)——由本提供方派生的面向模型工具。
- [dsh-resource-github](../resource-github/README.zh.md)——代码仓库提供方。
- [dsh-resource-mysql](../resource-mysql/README.zh.md)——只读数据库提供方。

-----

<a id="model-experience"></a>
## 模型体验

### wiki source 工具

#### 模型看到的内容

一个 `source_mediawiki_search`、一个 `source_mediawiki_read` 与一个 `source_mediawiki_list` 工具，各自携带该 kind 的限制说明，并以已配置 wiki 的 id 作为 `source` 参数说明。结果以 `- <标题> [<句柄>] — <摘要>` 形式的行渲染；读取会渲染页面标题、其句柄与 wikitext。

#### Token 影响

注册为每种 kind 增加三个工具定义，其大小随已配置 wiki 数量增长。每个结果都有上限：读取按 `maxReadBytes` 裁剪，列表按 `maxListItems` 裁剪，因此单次调用不会淹没对话。

#### KV Cache 影响

仅追加。工具定义位于请求前缀中，因此改变实例列表的设置变更会从首个变化的描述起重写前缀，并使之后的缓存片段失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是该提供方的当前约束。

- **只读。** 该提供方不发出编辑、移动、删除或上传请求，也不暴露相关 API。
- **私有 wiki 需要机器人账号。** 登录路径使用 Action API 的机器人密码流程；不支持交互式或双因素登录。
- **列表仅到分类层级。** `list` 返回某个分类的成员；未指定容器时返回该 wiki 的分类；没有反向链接或命名空间列举。
- **读取返回 wikitext 而非渲染后的 HTML。** 模板与嵌入不会展开。
- **没有页面历史或版本选择。** 读取始终返回当前版本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

客户端按会话保存 cookie jar，而这里的会话即一次操作；请求量大的 wiki 会受益于跨操作存活的会话，代价是凭据被持有更久。

</details>

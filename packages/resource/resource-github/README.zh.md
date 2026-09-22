---
description: "ctx.sources 的 GitHub source 提供方：在显式仓库授权列表内通过 Octokit REST 客户端检索代码并读取文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-github

[English](README.md) | 中文

## 概述

有了 `dsh-resource-github`，模型可以在固定的一组仓库中检索代码并读取文件。该提供方使用 `@octokit/rest` 而非手写请求，以个人访问令牌认证，令牌在每次操作时按名称从 `dsh-credentials` 解析，并拒绝 HTTP 重定向，因此令牌无法被转发到其他源。访问默认拒绝：实例声明它授权的仓库，检索会为每个已授权仓库附加一个 `repo:` 限定词，而指向该列表之外任何内容的命中或读取都会以 `SOURCE_NOT_FOUND` 失败。由于 GitHub 的代码检索限速为每分钟十次认证请求，该 kind 的限制说明会写明这一点，而 GitHub 不内联返回内容的路径会响亮失败而非降级。面向模型的工具位于 `dsh-tool-resource`。

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

先挂载 source 注册表，再挂载本提供方。每项授权是 `resource-github` 设置命名空间下的一个实例，实例 id 即模型传给工具的 `source` 参数。

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-github'
  config:
    maxReadBytes: 200000
    instances:
      platform:
        tokenRef: GITHUB_TOKEN
        repositories:
          - acme/platform
          - acme/shared-lib
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxReadBytes` | `200000` | 单次读取的字节上限；提供方裁剪完整文档并追加截断标记 |
| `maxListItems` | `50` | 单次列表的条目上限 |
| `instances.<id>.tokenRef` | 必需 | 保存令牌的凭据名，逐次操作通过 `ctx.credentials` 解析 |
| `instances.<id>.baseUrl` | `https://api.github.com` | REST API 基础地址；企业部署需设置，如 `https://github.example/api/v3` |
| `instances.<id>.repositories` | 必需 | `owner/name` 形式的仓库授权列表；不符合该形式的条目会被丢弃 |

当令牌引用是有效凭据名且当前能解析出非空值、API 基础地址可解析为 `http` 或 `https`、且至少一个授权条目通过校验时，该实例即视为已配置。未配置的实例不注册任何工具，并在发出任何请求之前以 `SOURCE_UNCONFIGURED` 使 `check` 失败。

### 已配置的 source 能回答什么

已配置的授权回答三种操作，面向模型的工具集由此派生。

- `search` 在已授权仓库范围内检索代码，并丢弃指向其他仓库的命中。
- `read` 返回单个文件的解码文本，并按读取上限裁剪。
- `list` 返回某个目录的条目；未指定容器时返回已授权的仓库。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方拥有 GitHub 协议与授权列表。工具 schema、渲染与呈现属于消费方。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、设置段、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `GitHubSourceProvider`：实例解析、授权列表与三种操作 |
| [`src/api.ts`](src/api.ts) | 本提供方使用的 REST 接口、其响应守卫与 Octokit 适配器 |
| [`src/types.ts`](src/types.ts) | 实例与已解析配置类型 |
| — | 不发布运行时 invariant 伴生包；该提供方不拥有可被独立观测推翻的关系。 |

### 默认拒绝的寻址

句柄 `owner/name` 表示仓库，`owner/name:path` 表示仓库内的内容。两部分在发出任何请求之前都会与授权列表核对，因此模型无法触及配置未声明的仓库，模型臆造的标识符也永远不会进入请求。检索会为每个已授权仓库携带一个 `repo:` 限定词，且命中在返回途中会再次过滤，因为 GitHub 可能返回限定词未声明的仓库。

### 重定向与凭据

Octokit 以 `redirect: 'error'` 构造，因此重定向响应会在触达目标之前使调用失败。令牌逐次操作解析，提供方从不缓存它。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级说明不够时，请阅读以下页面。

- [resource 包导览](../README.zh.md)——五包家族及各自角色。
- [dsh-resource](../resource/README.zh.md)——本提供方注册到的 seam。
- [dsh-tool-resource](../tool-resource/README.zh.md)——由本提供方派生的面向模型工具。
- [dsh-resource-mediawiki](../resource-mediawiki/README.zh.md)——wiki 提供方。
- [dsh-resource-mysql](../resource-mysql/README.zh.md)——只读数据库提供方。

-----

<a id="model-experience"></a>
## 模型体验

### 仓库 source 工具

#### 模型看到的内容

一个 `source_github_search`、一个 `source_github_read` 与一个 `source_github_list` 工具，各自携带该 kind 的限制说明——包括每分钟十次代码检索配额——并以已配置授权的 id 作为 `source` 参数说明。结果以 `- <标题> [<句柄>] — <摘要>` 形式的行渲染；读取会渲染文件路径、其句柄与解码后的文本。

#### Token 影响

注册为每种 kind 增加三个工具定义，其大小随已配置授权数量增长。每个结果都有上限：读取按 `maxReadBytes` 裁剪，列表按 `maxListItems` 裁剪，因此单次调用不会淹没对话。

#### KV Cache 影响

仅追加。工具定义位于请求前缀中，因此改变授权列表的设置变更会从首个变化的描述起重写前缀，并使之后的缓存片段失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是该提供方的当前约束。

- **只读。** 该提供方不创建 issue、评论、分支或提交，也不暴露相关 API。
- **代码检索有限速。** GitHub 每分钟允许十次认证代码检索请求；超出配额的调用会以 API 自身的错误文本失败，提供方不重试也不排队。
- **过大的文件无法读取。** GitHub 对约一兆字节以上的内容不返回内联内容，因此此类路径会以 `SOURCE_PROVIDER_ERROR` 失败，而不是返回残缺正文。
- **不能读取 issue、拉取请求或发布。** 该提供方只覆盖仓库内容。
- **没有跨仓库文件寻址。** 一次读取只指明一个已授权仓库，因此共享路径需要按仓库各读一次。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

提供方把 Octokit 包在窄接口之后，使测试无需真实令牌即可钉住请求构造与重定向策略；该适配器是两套类型系统之间唯一的转换点。

</details>

---
description: "面向模型的 source 工具：按已注册的 source kind 各派生一个 search、read 与 list 工具，来源是每个提供方声明的能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-resource

[English](README.md) | 中文

## 概述

有了 `dsh-tool-resource`，模型可以通过以所属 kind 命名的工具触达每一个已配置的远程 source：`source_mediawiki_search`、`source_github_read`、`source_mysql_list`，等等。该消费方从注册表当前保存的内容派生这套工具——只有当提供方声明了对应能力、实现了该方法、且至少有一个已配置实例时，某个 kind 才贡献一项操作——因此模型永远不会看到无法工作的工具，而不再被配置的 source 也不再可寻址，而不是每次调用都失败。每当某个 kind 变化时都会重新派生，这覆盖了设置编辑、提供方加入与提供方消失。每次工具调用都按调用当次解析实例，在这个 wire 边界校验模型参数，并按该 kind 的读取上限约束渲染输出。本包只注册工具；协议位于各提供方包中。

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

先挂载工具运行时、source 注册表与一个或多个提供方，再挂载本消费方。它注入 `tools` 与 `sources`，在两者都可用之前不注册任何内容。

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
- name: '@deepseek-ai/dsh-tool-resource'
  config:
    maxResults: 20
    timeoutMs: 30000
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxResults` | `20` | 单次检索调用可返回的命中上限；更大的 `limit` 参数会被拒绝 |
| `timeoutMs` | `30000` | 协作式工具调用预算（毫秒），附加到每个派生定义上 |

### 存在哪些工具

某个 kind 的工具集由其提供方机械地决定，因此下表就是完整规则。

| 工具 | 注册条件 |
|---|---|
| `source_<kind>_search` | `capabilities.search` 为真，且该 kind 至少有一个已配置实例 |
| `source_<kind>_read` | `capabilities.read` 为真，提供方实现了 `read`，且该 kind 至少有一个已配置实例 |
| `source_<kind>_list` | `capabilities.browse` 为真，提供方实现了 `list`，且该 kind 至少有一个已配置实例 |

### 参数与结果

每个工具都接受必需的 `source` 参数，用于指明某个已配置实例 id；描述中列出当前存在的 id，因此模型无需额外调用即可看到可选范围。`search` 还接受 `query` 与可选的 `limit`，`read` 接受此前结果返回的句柄，`list` 接受可选的容器句柄。结果会带回同一个句柄，因此模型可以把列表串到读取。渲染文本按该 kind 的 `maxReadBytes` 裁剪，并带上 seam 的截断标记。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

消费方拥有面向模型的词汇：工具名、参数校验、输出渲染、输出上限与呈现。它不拥有任何协议。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema 与 `tools`/`sources` 注入 |
| [`src/tools.ts`](src/tools.ts) | 工具派生、参数校验、输出渲染与上限、呈现，以及重新派生的 effect |
| — | 不发布运行时 invariant 伴生包；派生集合是调用方 fiber 上的 effect，销毁测试钉住了该关系。 |

### 为什么注册是有条件的

一个存在但无法工作的工具会在每次请求中消耗 token，并让模型不再信任这套工具。从声明的能力、已实现的方法与已配置实例派生工具集，能让每个已注册工具都可调用；而在 `sources/changed` 时重新派生，使这一点在设置编辑之后依然成立。重新派生是串行的：被更新的刷新取代的那次不注册任何内容，因此最后一次变更获胜，不会残留过期定义。

### 为什么在这里校验参数

工具参数是 wire 边界：它以 JSON 形式来自模型，而不是来自其他包的已定型值。因此消费方会检查句柄非空且为单行、检索 limit 是配置上限内的整数、且所指实例当前已配置。句柄正是在此处被 brand，这也是不透明句柄变成提供方可接受的 `SourceItemRef` 的地方。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级说明不够时，请阅读以下页面。

- [resource 包导览](../README.zh.md)——五包家族及各自角色。
- [dsh-resource](../resource/README.zh.md)——本消费方据以派生工具的注册表。
- [dsh-resource-mediawiki](../resource-mediawiki/README.zh.md)——wiki 提供方。
- [dsh-resource-github](../resource-github/README.zh.md)——代码仓库提供方。
- [dsh-resource-mysql](../resource-mysql/README.zh.md)——只读数据库提供方。

-----

<a id="model-experience"></a>
## 模型体验

### 派生出的 source 工具集

#### 模型看到的内容

对每个已配置的 kind，最多三个工具，其名称携带该 kind：`source_<kind>_search`、`source_<kind>_read` 与 `source_<kind>_list`。每个描述都会复述该 kind 自身的限制说明，并列出模型可作为 `source` 传入的实例 id。结果是渲染后的文本：检索或列表为 `- <标题> [<句柄>] — <摘要>` 形式的行，读取为条目标题、其句柄与内容。

#### Token 影响

注册为每个已配置 kind 增加三个工具定义，且每个定义的大小随已配置实例数量增长，因为这些 id 会列在其描述中。结果被约束两次：提供方按该 kind 的 `maxReadBytes` 裁剪，消费方也在同一上限内约束完整渲染文本（含表头）。

#### KV Cache 影响

仅追加，但有一个值得了解的例外：工具定义位于请求前缀中，因此改变实例列表或限制说明的设置变更会从首个变化的描述起重写前缀，并使之后的缓存片段失效。新增一个无关提供方时，若它改变了注册顺序，也会如此。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是该消费方的当前约束。

- **实例列表被写进每个描述。** 因此设置编辑改变的是请求前缀，而不只是模型可传入的参数。
- **没有分页。** 一次检索最多返回 `maxResults` 条命中，一次列表最多返回该 kind 的 `maxListItems` 条；模型通过收窄查询而非翻页来继续。
- **每次调用一个实例。** 一个工具只指明单个 `source`，因此模型一次只检索或读取一个 source，无法在一次调用中询问两种 kind。
- **没有面向客户端的结果元数据。** 呈现器只返回通用卡片标题，内容交给原始结果；更丰富的卡片需要本波次未定义的呈现元数据。
- **kind 集合是名称前缀，而非命名空间。** 工具名由 kind 构造，因此 kind 仅在后缀上不同的两个提供方都会出现，kind 很多的部署会有很多工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

重新派生监听 `sources/changed` 而非轮询；刷新计数器之所以存在，是因为在等待 `instances()` 时两次变更可能重叠，若没有它，较慢的那次刷新会覆盖更新的工具集。

</details>

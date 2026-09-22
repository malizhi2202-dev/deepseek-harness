---
description: "远程 source 能力 seam：ctx.sources 注册表、提供方实现的 source 词汇、类型化失败，以及每个提供方都施加的读取上限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-resource

[English](README.md) | 中文

## 概述

有了 `dsh-resource`，harness 获得一个统一的注册表，用于模型可以查阅的远程集合：wiki、代码仓库与数据库。本包是该 seam 的 Service Definition。它拥有 source 词汇（`SourceKind`、`SourceItemRef`、`SourceHit`、`SourceDocument`、`SourceCapabilities`）、`ctx.sources` 注册表、提供方抛出的类型化失败，以及把读取裁剪到声明字节上限的辅助函数。部署方挂载它一次，随后为每种 kind 挂载一个提供方包，提供方自行注册到 `ctx.sources`。每种 kind 声明自己能回答什么——全文检索、浏览、读取、读取字节上限、列表条目上限，以及面向模型的限制说明——因此消费方可以直接陈述这些限制，而不必让模型调用该 kind 并不具备的操作。面向模型的工具位于 `dsh-tool-resource`；提供方位于 `dsh-resource-mediawiki`、`dsh-resource-github` 与 `dsh-resource-mysql`。

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

先挂载注册表，再挂载部署方需要的提供方。注册表为每种 kind 保存一个提供方，除 `ctx.sources` 之外不发布其他服务。

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
```

### 提供方实现什么

提供方是唯一了解某种 kind 的协议、寻址与限制的代码。它自行注册，并在每次操作中接收自己解析出的配置。

| 成员 | 要求 | 含义 |
|---|---|---|
| `kind` | 必需 | 注册表键，也是由此派生的每个工具名的第一段 |
| `capabilities` | 必需 | 该 kind 能回答什么、读取字节上限、列表条目上限，以及面向模型的限制说明 |
| `instances()` | 必需 | 该 kind 设置声明的全部实例及其完整性；不打开任何连接 |
| `check(config)` | 必需 | 探测凭据与可达性；其拒绝文本即配置界面显示的最后错误 |
| `search(config, query, limit, signal)` | 必需 | 按 source 自身的相关度顺序返回命中 |
| `read(config, ref, signal)` | 可选 | 返回单个条目，并按 `capabilities.maxReadBytes` 裁剪 |
| `list(config, ref, signal)` | 可选 | 返回容器的子项；`ref` 为 `undefined` 时表示该 source 的根 |

省略 `read` 或 `list` 的 kind 不会为该操作注册任何工具。注册是调用方 fiber 上的 effect：销毁该 fiber 会移除提供方并发出 `sources/changed`，面向模型的工具正是借此察觉某个 kind 的出现、变更或消失。

### 注册表提供什么

| 调用 | 返回 |
|---|---|
| `ctx.sources.register(provider)` | 注销该提供方的 disposer |
| `ctx.sources.list()` | 按注册顺序排列的全部提供方 |
| `ctx.sources.get(kind)` | 一个提供方；该 kind 未注册时为 `undefined` |

kind 名称为小写并以字母开头，因为它会成为工具名的一段与设置命名空间的一段。注册非法 kind 会抛出 `SOURCE_PROVIDER_ERROR`；为同一 kind 注册第二个提供方会抛出 `SOURCE_DUPLICATE_PROVIDER`。

### 失败与上限

提供方抛出带 `code` 的 `SourceError`，消费方据 `code` 路由：实例设置缺少必需值时是 `SOURCE_UNCONFIGURED`，后端拒绝或返回不可用内容时是 `SOURCE_PROVIDER_ERROR`，句柄指向调用方不可见的内容时是 `SOURCE_NOT_FOUND`，kind 重复时是 `SOURCE_DUPLICATE_PROVIDER`，操作超出该 source 允许范围且未触达后端时是 `SOURCE_DENIED`。`truncateUtf8` 与 `boundDocumentContent` 会按字节上限裁剪取值并追加 `SOURCE_TRUNCATION_MARKER`，因此被裁剪的结果会明示这一点，而不会静默丢字。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

注册表刻意保持轻薄：它保存提供方、发布变更、拥有词汇。所有与协议相关的部分都留在提供方中。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | seam 词汇：kind、句柄、能力、命中、文档、配置、提供方接口与注册表接口 |
| [`src/index.ts`](src/index.ts) | `SourceRegistry` 服务：以 effect 形式注册、kind 名校验、查找，以及 `sources/changed` 事件 |
| [`src/error.ts`](src/error.ts) | `SourceError` 与五个稳定失败码 |
| [`src/bounds.ts`](src/bounds.ts) | `truncateUtf8`、`boundDocumentContent`，以及每个提供方都会追加的唯一截断标记 |
| — | 不发布运行时 invariant 伴生包；除自身映射表外，注册表不拥有可被独立观测推翻的关系，而该映射表由销毁测试钉住。 |

### 为什么能力是必需的

模型无法通过试一次来发现某种 kind 没有检索能力。把 `search`、`browse`、`read` 声明为布尔值，工具消费方就能精确派生某个 kind 实现的操作，并让其余操作保持未注册，因此模型永远不会看到无法工作的工具。`maxReadBytes`、`maxListItems` 与 `description` 随这些布尔值一同传递，因为派生出的工具描述必须陈述提供方所施加的限制。

### 为什么读取上限放在这里

每个提供方都在同一处声明上限裁剪读取并追加同一标记，因此无论结果来自哪种 kind，模型都能识别出被裁剪的结果。把唯一实现放在 seam 中，正是该保证能横跨三种互不相关的协议成立的原因。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级说明不够时，请阅读以下页面。

- [resource 包导览](../README.zh.md)——五包家族及各自角色。
- [dsh-tool-resource](../tool-resource/README.zh.md)——由这些提供方派生的面向模型工具。
- [dsh-resource-mediawiki](../resource-mediawiki/README.zh.md)——wiki 提供方。
- [dsh-resource-github](../resource-github/README.zh.md)——代码仓库提供方。
- [dsh-resource-mysql](../resource-mysql/README.zh.md)——只读数据库提供方。
- [resource 库设计](../../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md)——冻结的词汇，以及本波次记录的偏差。

-----

<a id="model-experience"></a>
## 模型体验

### 注册对模型不可见

#### 模型看到的内容

什么都没有。本包不注册任何工具、提示词段落或会话事件。模型最终看到的 source 相关内容，由 `dsh-tool-resource` 从该注册表保存的提供方派生而来。

#### Token 影响

零。挂载注册表不会增加提示词文本或工具定义；每一个模型可见字节都属于提供方声明的能力，以及渲染它们的消费方。

#### KV Cache 影响

无。注册表不贡献任何请求前缀，因此挂载它或注册提供方都不会改变已缓存的片段。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是该 seam 的当前约束，而不是某个提供方的延期特性。

- **source 没有地址域。** 路线图曾提议为每个 source 注册 `dsh-resource://<source>/` 地址；冻结设计给 `sources` 面板的页面类型不声明地址，因此本波次两者都未实现。此处的任何内容都无法按地址链接。
- **`instances()` 是对冻结注册表接口的增补。** 设计中的 `Sources` 类型只有 `register`、`list` 与 `get`，无法枚举工具描述必须列出的已配置实例。提供方接口新增了 `instances()`；注册表接口保留了设计中的三个调用。
- **注册表不调用任何提供方。** 它从不探测可达性，也不保存缓存，因此已配置但不可达的 source 会在使用它的操作上报告错误，而不是在注册时。
- **每个提供方一种 kind，且没有跨 kind 检索。** 调用方需指明 kind 与实例，因此模型一次只检索一个 source。
- **能力按 kind 固定，而非按实例。** 读取上限与列表上限来自该 kind 的设置段，因此同一 kind 的两个实例无法声明不同的上限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

注册表按插入顺序保存提供方，因为工具描述会按该顺序列出实例 id；调整映射表顺序会在没有任何行为变化的情况下重排模型可见文本。

</details>

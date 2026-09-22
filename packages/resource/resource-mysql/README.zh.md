---
description: "ctx.sources 的 MySQL source 提供方：在显式的库与表授权列表内进行只读结构与行访问，并在查询入口施加语句白名单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-mysql

[English](README.md) | 中文

## 概述

有了 `dsh-resource-mysql`，模型可以查看已授权库的结构并读取已授权的表，而没有任何写入路径。访问在两个层面默认拒绝：实例声明它授权的库与表，提供方的查询入口只接受 `SELECT`、`SHOW` 与 `DESCRIBE`，其余语句在打开会话之前即被拒绝。写入由分类拒绝，而不是指望服务器拒绝它：连接器还会在每个会话上设置 `SET SESSION TRANSACTION READ ONLY`，从不启用多语句，并且夹带在单个字符串中的第二条语句同样会被拒绝。语句中的每个标识符都来自配置自身的授权文本，因此模型臆造的句柄在任何 SQL 存在之前就被拒绝。行上限与字节上限约束每次结果。面向模型的工具位于 `dsh-tool-resource`。

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

先挂载 source 注册表，再挂载本提供方。每项授权是 `resource-mysql` 设置命名空间下的一个实例，实例 id 即模型传给工具的 `source` 参数。

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mysql'
  config:
    maxReadBytes: 200000
    instances:
      reporting:
        host: 127.0.0.1
        port: 3306
        user: dsh_reader
        passwordRef: MYSQL_READER_PASSWORD
        databases:
          - analytics
        tables:
          - analytics.daily_orders
        maxRows: 100
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxReadBytes` | `200000` | 单次读取的字节上限；提供方裁剪完整渲染结果并追加截断标记 |
| `maxListItems` | `50` | 单次列表的条目上限 |
| `instances.<id>.host` | `127.0.0.1` | 服务器主机 |
| `instances.<id>.port` | `3306` | 服务器端口 |
| `instances.<id>.user` | 必需 | 数据库账号，其自身应只持有读权限 |
| `instances.<id>.passwordRef` | 必需 | 保存密码的凭据名，逐次操作通过 `ctx.credentials` 解析 |
| `instances.<id>.databases` | 省略 | 已授权的库；服务器报告但不在该列表中的库保持不可见 |
| `instances.<id>.tables` | 必需 | 以 `database.table` 形式给出的已授权表；至少一个需通过校验 |
| `instances.<id>.maxRows` | `100` | 单次读取可返回的行数，超出即标记为已截断 |

当实例声明了用户、其凭据引用有效且当前能解析出非空值、且至少一个已授权表格式正确时，该实例即视为已配置。未配置的实例不注册任何工具，并在打开连接之前以 `SOURCE_UNCONFIGURED` 使 `check` 失败。

### 已配置的 source 能回答什么

已配置的授权回答三种操作，面向模型的工具集由此派生。

- `search` 匹配已授权的表名。该 kind 没有针对行内容的全文检索，其检索完全不发出语句。
- `read` 以制表符分隔的文本返回已授权表的行或其中一列，首行为表头。
- `list` 返回服务器报告的已授权库、某个库中已授权的表，或某张表的列。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方拥有它发出的 SQL 与授权列表。工具 schema、渲染与呈现属于消费方。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、设置段、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `MySqlSourceProvider`：实例解析、授权列表、三种操作与行/字节上限 |
| [`src/sql.ts`](src/sql.ts) | 语句白名单、只读查询入口、标识符引用与行渲染 |
| [`src/mysql2-connector.ts`](src/mysql2-connector.ts) | `mysql2` 连接：单语句、只读会话、行归一化 |
| [`src/types.ts`](src/types.ts) | 实例、配置、连接与会话类型 |
| — | 不发布运行时 invariant 伴生包；该提供方不拥有可被独立观测推翻的关系。 |

### 写入如何被拒绝

提供方发出的每条语句都经过同一个入口，该入口先做分类。入口接受以 `SELECT`、`SHOW` 或 `DESCRIBE` 开头的语句，拒绝第二条语句，并拒绝形如读取但实际写入或加锁的语句，例如 `INTO OUTFILE` 或 `FOR UPDATE`。被拒绝的语句抛出 `SOURCE_DENIED` 且永不抵达会话，测试用一个必须保持空的记录型会话证明了这一点。在更底层，会话本身是只读的，且多语句被禁用，因此即便分类出错也不会产生写入。

### 可见性如何默认拒绝

句柄形式为 `database`、`database.table` 或 `database.table.column`。提供方在构造任何语句之前先在配置的授权列表中查找该句柄，并且标识符文本取自授权条目而非句柄。服务器报告但配置未授权的库会从列表中丢弃，因此模型永远不会得知它的存在。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级说明不够时，请阅读以下页面。

- [resource 包导览](../README.zh.md)——五包家族及各自角色。
- [dsh-resource](../resource/README.zh.md)——本提供方注册到的 seam。
- [dsh-tool-resource](../tool-resource/README.zh.md)——由本提供方派生的面向模型工具。
- [dsh-resource-mediawiki](../resource-mediawiki/README.zh.md)——wiki 提供方。
- [dsh-resource-github](../resource-github/README.zh.md)——代码仓库提供方。

-----

<a id="model-experience"></a>
## 模型体验

### 数据库 source 工具

#### 模型看到的内容

一个 `source_mysql_search`、一个 `source_mysql_read` 与一个 `source_mysql_list` 工具，各自携带该 kind 的限制说明——包括只发出 `SELECT`、`SHOW` 与 `DESCRIBE`，且不存在任何写操作——并以已配置授权的 id 作为 `source` 参数说明。结果以 `- <标题> [<句柄>] — <摘要>` 形式的行渲染；读取会渲染表句柄，以及一行制表符分隔的表头与每行一行的数据，缺失值显示为 `NULL`。

#### Token 影响

注册为每种 kind 增加三个工具定义，其大小随已配置授权数量增长。每个结果都有上限：读取最多返回 `maxRows` 行，随后按 `maxReadBytes` 裁剪，列表按 `maxListItems` 裁剪，因此单次调用不会淹没对话。

#### KV Cache 影响

仅追加。工具定义位于请求前缀中，因此改变授权列表的设置变更会从首个变化的描述起重写前缀，并使之后的缓存片段失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是该提供方的当前约束。

- **只读。** 无法发出 `INSERT`、`UPDATE`、`DELETE` 或 DDL 语句；该提供方没有任何会发送它们的代码路径。
- **检索只匹配表名。** 没有针对行内容的全文检索，且检索不发出任何语句。
- **没有任意 SQL。** 模型无法连接表、聚合或按值过滤；一次读取只返回某张已授权表的投影，并受 `maxRows` 限制。
- **值以文本渲染。** 二进制值变为字节数，对象或数组变为其 JSON 文本，渲染器不认识的值变为占位符。
- **行上限按实例，字节上限按 kind。** `maxRows` 是实例配置，而 `maxReadBytes` 与 `maxListItems` 属于该 kind 的设置段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

连接器不固定任何默认库，因此每条语句都显式携带其 schema；这样即使账号的默认库与授权不同，已授权的表仍可寻址。

</details>

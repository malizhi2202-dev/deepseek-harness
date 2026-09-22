---
description: "远程 resource 家族的包导览：ctx.sources seam、其 wiki/代码/数据库提供方，以及面向模型的 source 工具。"
kind: "package-group"
---

# resource/ — 远程 resource 家族

[English](README.md) | 中文

## 概述

`resource/` 家族为 harness 提供模型可以查阅的远程 source：wiki、代码仓库与数据库。一个 seam（`ctx.sources`）拥有词汇、注册表与类型化失败；每种 kind 一个提供方包，拥有该 kind 的协议、寻址与限制；一个消费方派生面向模型的工具。五个包构成该家族：`resource/` seam、三个提供方，以及 `tool-resource/`——它为每个真正实现了操作的 kind 注册一个 `search`、一个 `read` 与一个 `list` 工具。每个提供方从自己的 `dsh-settings` 命名空间读取设置，并通过 `dsh-credentials` 按名称解析密钥，因此配置中不保存任何凭据值，也不会出现新的持久化域。该家族只拥有读取访问：没有任何提供方会写入其后端，且每种 kind 各自保有资源上限。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

五个包承担 resource 角色；每个提供方 README 拥有其 kind 的配置与限制。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`resource/`](resource/README.zh.md) | source 注册表：词汇、`ctx.sources`、类型化失败，以及每个提供方施加的读取上限 | `ctx.sources` |
| [`resource-mediawiki/`](resource-mediawiki/README.zh.md) | 检索、读取并列出 MediaWiki wiki 的页面 | 注册到 `ctx.sources` |
| [`resource-github/`](resource-github/README.zh.md) | 在已授权仓库内检索代码并读取文件 | 注册到 `ctx.sources` |
| [`resource-mysql/`](resource-mysql/README.zh.md) | 通过只读视图读取已授权的库、表与行 | 注册到 `ctx.sources` |
| [`tool-resource/`](tool-resource/README.zh.md) | 从已注册提供方派生面向模型的 `source_<kind>_<operation>` 工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先读该家族的子系统参考，再读消费方实现的工具契约，然后读这些提供方读取配置与密钥的服务。

- [Resource 库子系统](../../docs/subsystems/resource-library.zh.md)——source 词汇、`ctx.sources` 注册表语义、共享读取上限、失败码，以及 `sources` Remote 端点。
- [Tools 子系统](../../docs/subsystems/tools.zh.md)——source 工具实现的工具定义、schema DSL、注册与销毁规则，以及呈现词汇。
- [Settings 子系统](../../docs/subsystems/settings.zh.md)——各提供方读取其实例的命名空间段。
- [Credentials 子系统](../../docs/subsystems/credentials.zh.md)——各提供方逐次操作执行的凭据引用解析。
- [resource 库设计](../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md)——冻结的词汇、三种提供方 kind，以及本波次记录的偏差。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

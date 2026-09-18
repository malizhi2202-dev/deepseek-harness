---
description: "面向 dsh web 客户端的右侧栏 git 观察面板：把会话工作区所属仓库呈现为 HEAD 事实、分支列表、带泳道的有界提交历史和工作区改动。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-git

[English](README.md) | 中文

## 概述

右侧栏的 git 面板：挂载会话的工作区，观察为包含它的仓库。一个页面类型，从引导页进入，不声明地址，绝不自行打开——默认可见预算保持在任务与派生两个页签。面板绘制 HEAD 事实（分支或分离、跟踪、领先/落后、指向的提交）、本地分支列表、带泳道槽的有界提交历史、以及工作区条目与其两侧的改动；头部携带唯一控件"重新读取"，再次读取观察并整体替换页签持有的内容。不在仓库内时面板以一行说明，没有工作区目录的工作区也说明这一点。

**状态：有期限的临时物。** 该面板将在版本线迁移落地后被上游 git 插件替换，本包随之退役。

## 目录

- [注册了什么](#what-it-registers)
- [读取什么](#what-it-reads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

- **类型** — `ctx.sidebarRightTabs.register(...)`：kind `git`，id `@deepseek-ai/dsh-client-ui-sidebar-git`，`builtin` 档，`visibility: 'available'`，order 400，图标，无 patterns，一个引导条目（order 40，标题来自 `sidebarGit` 命名空间）打开该类型。
- **面板本体** — 该 id 名下的键控 `sidebar.right.pane.tab` 席位：面板。

`src/client/` 下七个源文件：`definition.ts`（类型）、`store.ts`（写集）、`face.ts`（读取及其 Remote 适配）、`history.ts`（纯折叠）、`GitBody.tsx`（绘制）、`locales.ts`（文案）、`index.ts`（装配）。

<a id="what-it-reads"></a>
## 读取什么

观察来自 `dsh-api-remotes` 装配的载体上的 `workspaceGit` Remote 命名空间，携带会话 id 与页签记录的生命周期信号——端点解析工作区根，面板从不指名目录。读取是一次取数而非订阅：面板本体每个页签挂载时取一次、重读手势再取，face 在新读取发起时退休仍在途的读取，属主信号中止时遗忘该页签的桶，迟到的结算因此什么都不写。工作区目录本身来自会话列表；没有目录的会话显示无工作区一行，且不发任何请求。

<a id="model-experience"></a>
## Model Experience

无。本包在浏览器中绘制仓库状态，不注册任何模型可见面。

#### KV Cache effect

无；面板不组装模型请求，不新增会话事件。

## Known Limitations and Deferred Work

- **只观察。** 面板中没有任何 checkout、commit、push、pull；一切操作按设计留在面板之外。
- **一次有界读取。** 历史深度、分支列表、工作区列表携带 seam 的唯一上限并各自带截断说明；没有翻页也没有订阅——新鲜度靠重读手势。
- **没有暂存视图或 diff。** 工作区展示每个条目的改动侧与类型，不展示 hunks；那属于替换本面板的上游 git 插件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：面板是最近一次已结算观察的纯绘制，没有可比对的双观察状态。

</details>

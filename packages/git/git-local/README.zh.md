---
description: "面向选型或调试本机仓库观察的部署方与维护者：ctx.git 的主机本地 provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-local

[English](README.md) | 中文

## 概述

`dsh-git-local` 在主机上实现 `ctx.git` 观察契约（[`dsh-git`](../git/README.zh.md)）：作为插件加载后，`ctx.git` 拥有真实的仓库读取。一次观察通过共享的无 shell 运行器（`runNativeCommand`）运行四条只读 git 命令——`rev-parse --show-toplevel` 找工作树，然后从仓库根运行 `status --porcelain=v2 --branch -z`、`for-each-ref`、有界的 `log -n`——因此快照携带的每个路径都是根相对路径，且 `--no-optional-locks` 让 `status` 不去拿机会式刷新会拿的索引锁。这里没有任何东西写仓库。工作区在本机文件系统上时选它。

**状态：有期限的临时物。** 该 provider 将在版本线迁移落地后被上游 git 插件替换，并随其服务的 seam 一起退役。

## 目录

- [如何使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 如何使用本包

组合需要本机 git 支撑的 `ctx.git` 时挂载本 provider。没有配置项：provider 读取每次调用所指定目录上 git 找到的任何内容，seam 的唯一上限（`MAX_OBSERVATION_ITEMS`，由 `dsh-git` 拥有）封顶快照携带的每个列表。

```yaml
- name: '@deepseek-ai/dsh-git-local'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

每个判定依据 git 的退出码而非 stderr：消息会本地化，退出码才是 git 稳定的机器词汇。工作树探测返回 128——不在任何仓库里、在裸仓库里、或仓库损坏到说不出工作树——就是 `absent` 回答，因为没有仓库把该目录包含为工作树。运行器没有工作目录选项，因此每条命令通过 git 自己的 `-C` 参数指名目录。被取消的读取以它自己的中止原因拒绝，而不是以 git 失败，因为停止是调用方的选择。`src/parse.ts` 持有三份机器可读输出的纯解析器；每份在其命令的文档化格式上完全，未文档化的记录形状会抛错——porcelain 中 seam 不读的头部（如 `# stash`）除外，它们被忽略，以便新增头部的更新版 git 保持可读。

<a id="model-experience"></a>
## Model Experience

无。该 provider 不注册工具、会话事件或请求输入；其输出只供面向用户的 Web 面板。

#### KV Cache effect

无；本包不组装、不塑形任何模型请求。

## Known Limitations and Deferred Work

- **一个 git，一台机器。** provider 调用 `PATH` 上的 `git`；没有它的主机回答 `GIT_UNAVAILABLE`，没有捆绑回退。
- **历史深度由 seam 封顶。** `log -n` 多读一条以精确报告截断，之后没有翻页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未发布运行时不变量 companion：provider 的回答在其测试套件里对照脚本化命令输出验证，而不是对照第二次实时观察。

</details>

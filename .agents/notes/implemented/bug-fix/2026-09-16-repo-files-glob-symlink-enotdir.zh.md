# Agent Note：守卫仓库文件 glob 发现，避免符号链接下行

Status: implemented

[English](2026-09-16-repo-files-glob-symlink-enotdir.md) | 中文

## Problem

`uniqueRepoFiles`（scripts/repo-files.ts）用 Node 的 `globSync` 展开仓库相对 glob 模式。一个 `**` 模式若是命中了指向文件的符号链接——例如 `snapshots/acp/image-compaction/system-prompt.expected.md -> ../../session/read-image/system-prompt.expected.md`——会让 `globSync` 试图把该符号链接当作目录读进去并抛出 `ENOTDIR`，从而让 `verify-md-wrap` 及其它共享该辅助函数的门禁一起崩溃。同一个真实文件本可通过其规范路径到达，预期行为是借 `realpathSync` 去重，但 glob 在去重之前就已失败。

## Decision

`uniqueRepoFiles` 给 `globSync` 传入一个 `exclude` 谓词：当路径是指向非目录的符号链接（`lstatSync(abs).isSymbolicLink() && !statSync(abs).isDirectory()`）时返回 true。这样就让 `**` 递归不再下行进入指向文件的符号链接，同时把指向目录的符号链接和普通文件留给 glob 处理；现有的 `realpathSync` 去重仍会把任意符号链接文件收敛到唯一的规范目标。

## Alternatives considered

**排除所有符号链接（`lstatSync(abs).isSymbolicLink()`）。** 更简单，但比故障更宽：它也会拒绝遍历指向目录的符号链接，而这个版本的 `globSync` 本就不跟随目录符号链接。更窄的谓词恰好只描述“下行进去是非法”的那一种情况。

**在 glob 外捕获 `ENOTDIR` 并跳过 offending 路径重试。** 绕开异常会让辅助函数耦合到某个具体的文件系统错误，而且还得知道该丢弃哪条路径；`exclude` 谓词才是拒绝遍历的受支持 API。

**用从不跟随符号链接的手写 `readdirSync` 遍历替换 `globSync`。** 代码更多，还重新实现了 glob 原本免费提供的语义；仅因一个遍历场景不划算。

## Consequences

`verify-md-wrap`、`verify-package-paths`、`verify-md-links`、`verify-doc-refs` 不再因 `**` 模式下的指向文件的符号链接而崩溃，并且仍把符号链接的真实目标恰好处理一次。`repo-files.spec.ts` 中的回归用例在 `**` 模式下构造一个指向文件的符号链接，断言只去重出指向规范文件的一条结果，另加一个守卫以保证 `exclude` 谓词不会漏掉普通文件。
# R2-2 ② 竞品与技术调研

仓库侧（只读）：
1. **DSH 没有 git 接缝**：`packages/*/*/src` 内无任何 git 工具注册；匹配 `rev-parse|git log|git status` 的只有提示词示例 `packages/shell/tool-bash/src/index.ts:251`、`tool-pwsh/src/index.ts:261`，以及外部编辑器启动项 `packages/host/open-in-app/src/catalog.ts:306,363`。git 事实今天只经第三方私有路由或 bash 到达，都不是 capability seam。
2. **`dsh-resource://` 是"当前值流"而非历史**：provider 契约 `packages/client/resources/src/client/contract.ts:73-92`「first frame is the current content and every later frame one change」；协议名册 `packages/client/ui-slots/src/index.ts:44`；唯一已发布协议是 `file`（`packages/api/workspace-files/src/client/types.ts:10-19`）。
3. **检查点**：`dsh-checkpoint-rewind@0.5.2` 记录 `{id, sessionId, cwd, seq, time, provider, kind, triggerTool, turn, step, files, bytes, ref, tree?, config, note?}`（`types.d.ts:8-35`），域 `checkpoints` v2；其 git provider 只**创建**游离快照对象（`git stash create`/`commit-tree`）并按显式路径恢复，**从不读提交历史**。
4. **会话 `seq` 是唯一可信序**：`packages/core/session/src/types.ts:456-458`（单调 seq + epoch ms time）。
5. **记忆是 profile 级**：`@memtensor/memos-local-plugin@2.0.16` 数据在 `$DSH_HOME/memos-plugin/data/memos.db`，行固定 `profileId: default`、无 per-workspace 作用域；`createdAt` 是"学到该事实的时刻"。

竞品：
6. **VS Code Timeline**：源可贡献 + 用户自选（"the built-in Git extension contributes a timeline source"、"choose which sources you'd like included"）—— [v1_44](https://code.visualstudio.com/updates/v1_44)；**IntelliJ Local History** 与 VCS 分栏且明说 "not a replacement for proper version control"、升级即清空、默认保留 5 个工作日 —— [Local History](https://www.jetbrains.com/help/idea/local-history.html)；**Claude Code checkpointing** 同样声明 "Not a replacement for version control"，另有 100 个快照／约 30 天上限且 bash/子代理/外部改动不可恢复 —— [checkpointing](https://code.claude.com/docs/en/checkpointing)；**Langfuse** 分列 inferred 与 declared 且不给置信度分数 —— [Agent Graphs](https://langfuse.com/docs/observability/features/agent-graphs)；**MemOS viewer** 保持分源视图与 provenance 列 —— [MemOS](https://github.com/MemTensor/MemOS)。

未联网验证：git-graph README 中关于 ZCode `GitBranchSwitcher` 的对标未在线复核。

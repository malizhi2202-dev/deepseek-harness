# R3-2 ② 调查证据（仓库与 npm registry 实测，2026-09-17）

**版本化**：`git tag -l` = 0；检出为浅克隆（存在 `.git/shallow`，历史提交数很少）；分支仅一个本地开发分支（HEAD 指向该分支的一条未推送提交）与 `master`（远端已推进，本地 `origin/master` ref 陈旧）。根 `package.json` = 0.1.3-alpha.2。树**已包含** `packages/client/ui-sidebar-right`，而该包 npm 首版是 0.1.5-alpha.1（2026-09-08T15:55Z）⇒ 树 ≈ 09-07～09-08 之间的 master 快照，**比自身版本号新**。**迁移 = fetch fork master 再 rebase 本地开发分支**，不是 pull/tag。

**格式**：树 `SESSION_FORMAT_VERSION=2`（`packages/core/session/src/types.ts:86`，主 agent 已复核）；0.1.3-alpha.2=2，0.1.5-alpha.1/rc.1/rc.2 与 0.1.6-alpha.1 全 = 3。迁移边：树只有 v0-to-v1、v1-to-v2；0.1.5-rc.1 为 v0-to-v1、v1-to-v2、v2-to-v3（向前读 v0/v1/v2 均支持）。SQLite：`SESSION_QUERY_SQLITE_SCHEMA_VERSION=8`、`STORAGE_SQLITE_SCHEMA_VERSION=1`，两线相同 ⇒ **0 个域变更**。规则出处：`2026-08-31-released-session-format-migrations.md:86`（generation 不移动/覆盖/删除）与 `:170`（保留旧代 ≠ 支持降级/回退）。一份本地会话库样本：一批 v0 与 v2 世代日志，覆盖多个项目目录。

**插件**（23 个声明 `@deepseek-ai` 依赖）：`^0.1.0-rc.6/7`（better-sidebar 0.13.0、outline 0.1.5、`@linxin666` 14 包、`@undeadsheep` 2 包）→ 两线皆 ✗；`>=0.1.0-rc.5 <0.2.0`（memos 2.0.16 与最新 2.0.19）→ 皆 ✗；`0.1.0-rc.6` 精确（checkpoint-rewind 0.5.2）→ 皆 ✗；`>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0`（checkpoint-rewind 0.6.9–0.6.11）→ **0.1.5-rc.1 ✓**；`^0.1.5-rc.1`（better-sidebar 0.19.0/0.19.1）→ rc.1/rc.2 ✓、0.1.6-alpha.1 ✗；dshmarket 1.47.0 仍只到 `^0.1.2-alpha.2` → ✗。**树内无加载期 peer 校验**（`packages/boot/`、`packages/host/` 无 semver/satisfies，主 agent 已复核），真正耦合是 `dsh.client.inject`：better-sidebar 0.19.1 需 `client-ui-sidebar-right`/`client-modules`、git-graph 0.3.23 需 `api-session-controller` —— **树里全部已存在**。核心包 157→163 只增不减。

**profile**：`cordis.patch.yml` 把若干插件置为 disabled、保留一条 insert；在用为若干第三方面板类插件。`package.json` 钉若干依赖与 bundles；pnpm `autoInstallPeers:false`、hoisted。`settings.yaml` 的新线解释差异：**未判定**。

**发布线**：dsh-session 0.1.3-alpha.2(09-07T12:57Z)→0.1.5-alpha.1(09-08T15:42Z)→0.1.5-rc.1(09-10T02:58Z)→0.1.5-rc.2(09-10T14:42Z)→0.1.6-alpha.1(09-15T03:09Z)；`dsh-client-ui-sidebar-right` 仅 5 版，自 0.1.5-alpha.1 起。树当前代码**无完全对应的发布版本**。

**主 agent 的独立复核（修正本子议题原计划的一步）**：`sessions` 与 `storages` 位于 **`DSH_HOME` 级**（`$DSH_HOME/sessions/` 下按项目路径命名的目录、`$DSH_HOME/storages/`），profile 目录只含 `node_modules` 与配置（`packages/boot/app-boot/src/profile.ts:5`）。⇒ **"新建独立 profile"只保护插件与组合接线，不隔离 v2→v3 日志迁移**；在副本上验证必须用**独立 `DSH_HOME`**。

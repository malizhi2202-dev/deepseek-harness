# 插件目标线兼容：已核实事实

分级沿用 `discovery/sidebar-asks-2026-09-17/README.md:22`：【复核】主 agent 直接跑命令或读文件确认；【子代理】子代理读代码确认（附 `file:line`）；【联网】外部抓取；【未验证】。

## A 声明层

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F1 | `DshManifest` 的成员是 `bundle?`、`profile?`、`client?`、`configTrees?`、`sessionFormatMigration?`、`moduleFallback?`（末者标 `@internal`，由启动器生成）。**没有 `engines`** | `packages/util/package-manifest/src/types.ts:8-24` | 【复核】 |
| F2 | 某第三方 Git 面板插件在自己的 `package.json` 里声明 `dsh.engines.dsh = ">=0.1.5-rc.1"`（另含 `dsh.bundle.patch` 与 `dsh.client.inject`）；而 `dsh.engines` 在**本仓全仓命中 0**（代码、docs、scripts、package.json 皆无） | registry 元数据实测；全仓检索 | 【复核】 |
| F3 | `dsh` 清单的类型包自述是「**Each reader owns JSON validation and resolved defaults**」⇒ 它是**共享词表**，不是会自我校验的权威 schema | `packages/util/package-manifest/src/types.ts:1-5` | 【复核】 |

## B 加载与执行层

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F4 | `dsh.client.inject` **确实被读**（解析、投影进 devDependencies、归一化），但它**不排序激活** | `packages/client/modules/src/index.ts:195`；`scripts/verify-package-dependencies.ts:487`；`scripts/verify-client-packages.ts:266`；`packages/client/ui-workspace/src/client/index.ts:54-61`；`packages/client/AGENTS.md:140` | 【复核】 |
| F5 | cordis 服务注入未满足时的语义是**静默挂起**，逐字「Unsatisfied \| stays PENDING, with no timeout」 | `packages/client/AGENTS.md:91` | 【复核】 |
| F6 | 同层已有一个 fail-loud 先例：profile 组合器对缺失 `dsh.bundle` 直接抛错；`dsh.sessionFormatMigration` 也由旁路生成器读取并在缺失时抛错 | `packages/boot/app-boot/src/profile.ts:793-795`、`:806-810`；`scripts/gen-session-format-catalog.ts:71-74` | 【复核】 |
| F7 | 仓库规则要求「Misconfiguration fails loud at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent」 | 根 `AGENTS.md:117` | 【复核】 |
| F8 | client 插件那一层**已经把每个 Loader 行解析到它自己的 `package.json`**（`locatePkgJson`，JSDoc 逐字「the nearest ancestor manifest declaring the name owns the module」），**但返回值可为 `undefined`** | `packages/client/modules/src/index.ts:780-791` | 【复核】 |
| F9 | profile 组合器只读 **bundle 层**的 `dsh.bundle.patch`；第三方 client 插件经 bundle 行 + 「bundle 的 package.json 依赖」+ profile `node_modules` 回退解析进入 | `packages/boot/app-boot/src/profile.ts:789-797`；`packages/client/AGENTS.md:139` | 【复核】 |

## C 静默与校验

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F10 | 清单类型包是**纯类型包、无运行时导出**⇒ 不存在清单校验器 | `packages/util/package-manifest/src/index.ts:1-13` | 【复核】 |
| F11 | `dsh.client` 的解析器**对畸形已知字段抛错、对未知字段静默丢弃**：返回值只由已知键（`platform`/`inject`/`external`/`immediately`）拼装 | `packages/client/modules/src/index.ts:185-208` | 【复核】 |

## D 既有可见面

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F12 | **存在只读插件状态投影**：`pluginInventory/list` 逐入口返回 entry id、模块说明符、有效启用状态与**根纤维阶段（含 `pending`）**，并**已有面向用户的设置页客户端** | `packages/host/plugin-inventory/README.md` 的 Summary；`packages/host/plugin-inventory/src/types.ts:7-8`、`:22`、`:42-43`；`packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx`；`packages/api/remotes/src/client/index.ts` | 【复核】 |
| F13 | 该投影的入口行只有四个字段（`entryId`/`moduleName`/`enabled`/`fiberPhase`），**不含未满足依赖明细**⇒ 挂起的**成因**不可见 | `packages/host/plugin-inventory/src/types.ts:16-24` | 【复核】 |
| F14 | 底层加载器**不暴露未满足注入名**（检索未满足/等待类标识符在依赖源码中命中 0）⇒ 成因可见性需要新的探测面 | 依赖源码全检索 | 【复核】 |

## E 版本线

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F15 | semver 预发布范围实测四组：`^0.1.2-rc.1` vs `0.1.3-alpha.2` = **false**；`^0.1.5-rc.1` vs `0.1.5-rc.2` = true；`^0.1.5-rc.1` vs `0.1.6-alpha.1` = **false**；`^0.1.5-rc.1` vs `0.1.5-alpha.1` = **false** | semver 7.7.4 实测 | 【复核】 |
| F16 | 本仓检出线是 `0.1.3-alpha.2`；公开线已推进到 `0.1.6-alpha.1` ⇒ **核心也可能比插件新** | `package.json:3`（复核）；公开线为外部事实 | 【复核】+【联网】 |

## F 安装与生态

| # | 事实 | 依据 | 分级 |
| --- | --- | --- | --- |
| F17 | 旧通道已被上游弃用（该插件自 `0.1.13` 起不再声明任何 `@deepseek-ai/*` 的 `peerDependencies`）；且**两条安装路径的 peer 自动安装设置不一致**：profile 与桌面项目管理器为 `false`，而仓库自身锁文件记录为 `true` | `packages/boot/app-boot/src/profile.ts:159`；`apps/desktop/src/project-manager.ts:106`；`pnpm-lock.yaml:4` | 【复核】 |
| F18 | 已有批量禁用先例（第三方面板插件因 API 过期被批量禁用），并以风险条目登记 | `discovery/sidebar-asks-2026-09-17/05-risks-and-gates.md:36` | 【复核】 |
| F19 | 本仓**没有市场实体**；唯一存在的插件状态面被设计为只读，自述「owns no cache, history, provenance model, event stream, or **mutation path**」 | 全仓检索；`packages/host/plugin-inventory/README.md` 的 Summary | 【复核】 |

## 事实带来的三处自我订正

1. 先前的表述「`DshManifest` 是权威 schema」**作废**，F3 是权威表述：它只是共享词表。
2. 先前说「`dsh.client.inject` 无人读取」**作废**，F4 是权威表述：它被读取，只是不排序激活。
3. 先前说「静默挂起 ⇒ 失败静默」**不完整**：F12 证明挂起状态在既有设置页可见；真正不可见的是**成因**（F13、F14）。

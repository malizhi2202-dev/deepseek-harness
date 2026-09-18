# N2 ⑤ 人工审核记录

- 审核时间：2026-09-17（`action-seam` 第 1 轮审核门）
- 审核原话（逐字）：「同意推荐的」
- 结果：**通过**。落地为：④ 采纳"两条规则"（位置：按钮属于锚定它事实的面板；可枚举/可审计：改状态动作要能被 `commands.list` 找到并落 `command/run`），**决定性变量 = 是否需要在本面板之外被枚举/审计**；⑤ 首发阶梯 **preset → turn → job**，且新增第二条客户端写路径需独立决策记录；⑥ 失败协议（三态 + 日志落点，禁止 falsy reply）与声明式可用性谓词**只约束新的用户动作面**，不改 `SessionFace.command` 的有意契约。
- **未决（本次未表态，按约定保留；已回填实施清单 §8，未回填前不得上线动作）**："必须落域事件"是门还是刹车（`goal/change` 无 actor 的反例今天会被放行）；停 job 是否进首发；job 动作放 body 还是 tab menu；subagent 自有 job 的排除是能力边界还是可见性缺口。
- 本流程不执行代码改动（仓库与 `~/.dsh` 零改动；侦察产物仅写 `/tmp/bmad-discovery/`）。

## 后续裁定（交接清单第 2 项闭项，2026-09-18）

负责人裁定（选项经只读备忘对照当前代码复核后呈报）：**动作登记为命令、命令面全量可见**——

- **归属沿用既有分层**：preset 级动作为 preset 行（plan/goal/compact 先例），宿主域动作（如停 job）为 host 行（`/permission` 先例：`packages/interaction/permission-presets/src/index.ts:252-274` ＋ `packages/client/ui-permission-presets/src/client/index.ts:161`）。
- **依据**：`CommandDefinition` 无可见性字段（`packages/interaction/commands/src/index.ts:60-74`）⇒ 注册即进 `commands.list`；「面板内-only」实为最贵选项（须先造可见性元数据＋宿主过滤＋客户端消费三处新面才能保持不可见）；「登记为命令」是唯一零新机制选项，同时满足可枚举/可审计两项裁定；纯读视口动作按裁定不注册 ⇒ 命令面增长天然有界。
- **门控缓做**：可见性门控按 Rule of Three 缓做，待 '/' 菜单条目实测膨胀再升级。
- **翻转条件**：状态类动作增长到 '/' 菜单实测不可用，或产品认定「点击的动作」与「打字的命令」是两种心智 ⇒ 升级为混合门控。

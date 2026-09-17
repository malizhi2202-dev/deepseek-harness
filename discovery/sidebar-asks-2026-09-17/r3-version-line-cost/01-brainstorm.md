# R3-2 ① 头脑风暴（迁移代价的 12 个轴，影响 × 不确定性）

1. 树与发布线的定位差 — 高 × 中
2. `SESSION_FORMAT_VERSION` 2→3 换代 — 高 × 低
3. SQLite 域 schema — 低 × 低
4. 插件 peer 声明 vs 运行时 inject — 高 × 中
5. 本地未提交改动与 fork 分叉（一批未提交改动 + 若干本地提交）— 高 × 低
6. 浅克隆 + 无 tag + 无 upstream remote — 高 × 低
7. ★ 多 profile 隔离（部署侧已存在多个 profile）— 中 × 低
8. ★ 降级不可用：新线一旦写 v3，旧线读不了 — 高 × 低
9. ★ 存量日志懒迁移（一批 v0 与 v2 世代日志）— 中 × 中
10. ★ dshmarket 自身最新版仍未声明 0.1.5 — 中 × 中
11. profile 依赖重装 + `.dsh-module-fallback` 重建 — 中 × 中
12. 上游节奏（0.1.6-alpha.1 已出，插件会再次落后）— 低 × 高

Top 5 决定项：本地自定义改动的 rebase 面；v2→v3 不可逆迁移 + 一批存量日志；插件在 0.1.5 线的运行时注入可用性；无 tag/无 upstream ⇒ 迁移=fetch fork master 再 rebase；profile 重装与 fallback 链接。

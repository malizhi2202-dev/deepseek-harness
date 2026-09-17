# R2-2 ③ 结论与建议

**结论：不能合成单流。形态＝分源泳道 + 用户显式勾选；V1 只做检查点时间线。**

1. 三源可共享的只有**显示轴**；每条目必须保留自己的源内序（检查点的 `seq`/`turn`/`step`），并标出 scope（repo / session+cwd / profile）。
2. **V1 范围**：只显示检查点 lane —— 读 `checkpoints` 记录（`time`/`kind`/`provider`/`turn`/`step`/`files`/`bytes`/`note`），以会话 `turn/step/seq` 为权威序；每行标 `scope=session+cwd`、`source=checkpoint(<kind>)`、`confidence=declared`；无可信时间的条目进「时间未知」桶；`copy` provider 行照样显示但标注"不可 git 对照"。
3. **V1 不显示**：git 提交历史（接缝不存在，只能靠 bash 或第三方私有路由，都不诚实）；memory 条目（profile 级、跨 workspace，无法归属到本会话）；任何跨源因果连线。
4. **必须拒绝**：写入仓库或工作区（含 `git add/commit/restore`）；改写 `memos.db` 或触发 capture；改写 session 日志或删除检查点；时间线成为 model-visible 输入却不落 session event；跨插件 runtime import；硬编码 locale 文案。
5. **界面必须写出免责**：「不替代版本控制、不覆盖 bash/子代理改动」（对齐 IntelliJ / Claude Code）。
6. **产品经理条件（补动作缺口）**：checkpoint-only 会被读成"功能没做"⇒ 同时提供一个**显式"创建检查点"入口动作**。
7. 承载建议：走 session 投影（模板 `packages/session/session-turn-outline/src/index.ts`），面板只读。

**未决**：git 历史读取应做新 capability seam 还是 bash 后处理；时间线落在 session projection 还是独立只读面板。

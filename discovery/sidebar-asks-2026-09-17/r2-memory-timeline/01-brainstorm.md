# R2-2 ① 头脑风暴

依据：负责人决策 3（三源合成一条「记忆时间线」）；F29（DSH 无 git capability seam）；F30（检查点与记忆的真实归属）；部署侧已装检查点、记忆与 git-graph 类第三方插件（禁用）。

14 个方向，Top 5：
1. ★ 以会话 `seq` 为权威序，墙上时钟仅作显示（三源在 scope、时间语义、排序权威上皆不同，唯一可共享的是显示轴）。
2. ★ 每行 scope 徽章（repo / session+cwd / profile）—— 防止跨作用域假因果，是诚实性的最低成本实现。
3. ★ 默认不合并，用户显式勾选源（VS Code Timeline 的成熟形态就是"源可贡献 + 用户可筛选"）。
4. ★ 声明/推断双标签（镜像 Langfuse 的 declared vs inferred）。
5. 单源 V1：只做检查点时间线（git 接缝根本不存在，先有可交付物）。

★ 其他：**「时间未知」桶**（无可信时间的条目下沉，禁止猜测排序）；矛盾并列视图（git commit 与检查点快照冲突时不仲裁）；记忆按 createdAt 区间挂到最近检查点并标 inferred。

明确否决：三源融成一条无标签流（抹平 scope 与时间语义＝信息上撒谎）；自动写入项目/仓库文件；自动改写或触发 memory capture；以 git 提交时间作排序权威（committer date 可被 rebase／时钟篡改）；client 面板跨插件 runtime import；时间线成为 model-visible 输入却不落 session event。

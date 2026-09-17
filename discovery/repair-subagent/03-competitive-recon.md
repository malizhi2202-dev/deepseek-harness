# 03 · 竞品与技术核查

方法：全部外部结论用 `web_fetch` 直连权威源并带逐字英文引文；`web_search` 在本环境不可用，故未做交叉检索。抓取失败或无法确认者集中在末尾「未验证清单」，**不用记忆补齐**。

## 一、逐对象要点（E 编号供正文引用）

| 编号 | 对象 | 一句话结论 | 关键逐字引文 |
| --- | --- | --- | --- |
| E1 | GitHub Actions re-run | 重跑是**人类动作**，门是仓库写权限；新 attempt 复用原 commit/ref 与**原触发者**的令牌 | 「Re-runs use the privileges of the actor who initially triggered the workflow, not the privileges of the actor who initiated the re-run.」；「A workflow run can be re-run a maximum of 50 times.」 |
| E2 | GitHub 防自批 | 最强的「发起者不得自批」先例 | 「users who initiate a deployment cannot approve the deployment job, even if they are a required reviewer. This ensures that deployments to protected environments are always reviewed by more than one person.」 |
| E3 | GitHub 自动化禁令 | 明令禁止让自动化创建或批准变更 | 「Allowing workflows, or any other automation, to create or approve pull requests could be a security risk if the pull request is merged without proper oversight.」 |
| E4 | GitLab 内联重试 | 「归因不可知」被做成具名一等枚举值 | `unknown_failure`：「Retry when the failure reason is unknown.」；上限「Defaults to 0 and can max be retried 2 times (3 times total).」 |
| E5 | GitLab 事后 Retry | 派生**新 job 实例**且归属反转 | 「A new job instance is created with a new job ID.」；「The new job associates with the user who initiated the retry, not the user who created the original pipeline.」 |
| E6 | Temporal | 永久失败要暴露而非重试；派生单元不共享局部状态 | 「Permanent failures, by definition, require you to make some change to your logic or your input. Therefore, it is better to surface them than to retry them.」；「a Parent Workflow Execution and a Child Workflow Execution do not share any local state.」 |
| E7 | Temporal 防风暴 | 单父派生有上限，且默认劝退 | 「a single Parent should not spawn more than 1,000 Child Workflow Executions.」；「When in doubt, use an Activity.」 |
| E8 | Airflow 回调 | 结构化 context，但官方明确警告它只是局部信息 | 「It's not recommended to rely on task instance variables in Dag callbacks except for human analysis, as they reflect only partial information about the Dag's state.」；「a timeout may be caused by a number of stalling tasks, but only one will eventually be selected for context.」 |
| E9 | Argo | 结构化归因字段 + 非幂等即禁用重试 | `lastRetry.exitCode` / `lastRetry.status` / `lastRetry.duration` / `lastRetry.message`；「Some pods may not be idempotent, and so a `retryStrategy` would not be suitable, but restarting the pod is safe.」 |
| E10 | Claude Code | hook 的权威来自确定性而非模型选择；子代理有独立权限 | 「certain actions always happen rather than relying on the LLM to choose to run them.」；「Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions.」 |
| E11 | OpenHands | 归因退化即停机，不是继续 | 「**Repeating Action-Error Cycles**: The same action repeatedly results in errors (3+ times)」→「can automatically halt execution」 |
| E12 | OpenAI Agents SDK | 派生闸门看不见参数；guardrail 不覆盖派生；不可安全检查即 fail closed | 「`is_enabled` is evaluated while the SDK prepares the available handoffs, before the model returns handoff arguments, so it cannot authorize values inside an argument-bearing handoff.」；「Tool input guardrails apply to function tools, not handoffs.」；「Callable approval rules fail closed when the SDK cannot safely inspect the arguments.」 |
| E13 | OpenAI Agents SDK | handoff 默认交出**整段历史** | 「When a handoff occurs, it's as though the new agent takes over the conversation, and gets to see the entire previous conversation history.」 |
| E14 | Devin | 子代理不继承父对话；沙箱不可用即拒绝启动 | 「it does not inherit the parent's conversation history」；「the CLI will refuse to start rather than running unsandboxed.」 |
| E15 | LangGraph | 重放被中断的节点，副作用必须幂等；分支**不回滚**原历史 | 「any code that ran before the `interrupt` will execute again.」；「`update_state` does **not** roll back a thread. It creates a new checkpoint that branches from the specified point. The original execution history remains intact.」 |
| E16 | AutoGen reflection | 修复者是第二个 agent；结构化上下文包 | 停机条件是 reviewer 输出的 `approval` 字段；上下文为结构化的 `CodeReviewTask`（任务 / 草稿 / 产物）而非全量 transcript |
| E17 | CrewAI | 修复是同一 agent 被 guardrail 退回重试；委派与人工门默认关 | 「the error is sent back to the agent, and the task is retried up to `guardrail_max_retries` times.」；`allow_delegation`「Default is False」 |
| E18 | OpenTelemetry Link | Link 表达关联而非父子，一对多场景建议不设 parent | 「Linked `SpanContext`s can be from the same or a different trace」；「It is recommended, however, to not set parent of the **Span** in this scenario」 |
| E19 | OpenTelemetry 错误记录 | 被重试或已处理的错误**不记录** ⇒ 重试成功会抹掉失败证据 | 「Errors that were retried or handled (allowing an operation to complete gracefully) SHOULD NOT be recorded on spans or metrics that describe this operation.」 |
| E20 | OpenTelemetry 状态 | 不可知是具名第三态，禁止默认成成功 | 「These values form a total order: `Ok > Error > Unset`.」；「Instrumentation Libraries SHOULD NOT set the status code to `Ok`, unless explicitly configured to do so.」 |
| E21 | Terraform | 审批点必须落在**同一份已保存的计划**上 | 「-out=FILE … you can later execute by passing the file to `terraform apply`」；「By default, the "apply" command automatically generates a new plan and prompts for you to approve it.」 |
| E22 | expand/contract | 破坏性变更拆三段，每段可单独回退 | 「breaking the change into three distinct phases: expand, migrate, and contract.」 |

## 二、三条对比轴

**A. 内联重试 vs 派生修复者。** 判据不是「错误多严重」，而是**失败是否改变了执行单元本身的前提**：Temporal 因确定性重放而不建议重试整个工作流（E6）；Argo 按失败发生阶段分流（E9）；GitHub 与 GitLab 都把「事后重跑」留给人，且 GitLab 的派生 job 会改归属（E5）。编码代理侧的判据是失败的归属方：格式/传输类错误内联重试并带固定上限，可被工具检验的失败由同会话的确定性闸门修（E10、E11），只有工作**可切分**时才派生。**没有任何系统声明「归因未知 ⇒ 派生新 agent」这条规则。**

**B. 上下文传递。** 主流给的是**结构化归因**而非原始日志：Argo 的 `lastRetry.*`、Airflow 的 context mapping、Temporal 的 input/output/attempts、AutoGen 的结构化任务对象、GitLab 的「same parameters and variables」。原始日志留在原 attempt 的 job log 里，**没有任何被引来源显示日志正文被转发进派生执行**。两条明确的残缺上下文警告：Airflow（E8）与 OpenTelemetry（E19）。**诚实结论：本次抓取范围内未找到任何「某系统因修复者只有残缺上下文而出问题」的公开事故记录**——这类证据通常只存在于官方文档之外。

**C. 人 vs 机器的触发权限。** 模型自主派生确实存在（E12、E13、E14、E16），加的闸是 schema/描述匹配、谓词（**看不到参数**）、turn 上限、迭代预算、未批准工具默认拒绝。人类触发侧的制度设计更强：`permissions` 未列即 `none`、分叉 PR 自动降为只读、**prevent self-review**（E2）。**最强的防自批先例来自 GitHub，而不是任何 agent 框架。**

## 三、对本议题的三条映射

1. **入口形状照抄仓库自身的不可伪造手势**（F3b、F3c），外部佐证是「谁触发」必须是可审计的一等字段（E1、E5 的 job `source` 枚举含 `unknown`）。
2. **上下文包照抄仓库自身的具名未知模板**（F8），外部同类做法见 E9、E16、E8、E4、E20、E21；这是**需要新增的约束**，不是照抄既有做法——委派载荷今天没有任何强制具名未知的要求（F6）。
3. **自动派生的风险**由外部最强警告（E3、E12）与仓库既有闸门共同约束；**必须保留原失败 run 的日志与状态**，不能照 E19 把失败证据处理掉。

## 四、未验证清单

1. `web_search` 不可用，全部结论基于单点直连，**未做交叉检索**。
2. GitLab 的 `retry:max` / `retry:when` 正文页在 `retry` 之前被截断，改用仓库内编辑器 schema 作来源，**未做二次来源验证**。
3. GitHub：是否存在非人类触发 re-run 的路径**未找到来源**；`workflow_run` 是否被官方定位为受限派生机制**未确认**。
4. Claude Code：子代理的嵌套/并发上限、失败 hook 的具体载荷**未确认**（页面截断）。
5. Codex CLI：失败 run 的恢复语义在文档中**不存在**——记为「未记载」，不是「未找到」。
6. Devin：API 索引中没有 retry 端点；文档整体偏薄，结论权重低。
7. OpenTelemetry：规范中**不存在** attempt 编号 / 重试计数 / 修复关系的命名——这是规范空白，不是抓取失败。
8. expand/contract 仅有 Fowler 单一来源；Terraform 的「未知值具名」未取得权威引文。
9. **轴 B 的核心追问无证据**：「有没有系统因为修复者只有残缺上下文而出问题」——未找到公开记录。这是「未联网验证到」，不等于「没有发生」。

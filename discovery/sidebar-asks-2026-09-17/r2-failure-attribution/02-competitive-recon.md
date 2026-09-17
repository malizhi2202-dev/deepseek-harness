# R2-3 ② 竞品与技术调研

1. **Temporal**：Service 只看顶层 `failure_info`，`cause` 链仅供人读 —— [application-failures](https://docs.temporal.io/encyclopedia/application-failures)。**更正第 1 轮**：`failure_info` 不是 `WorkflowExecutionInfo` 字段，只是 `Failure` 的 oneof（[message.proto](https://raw.githubusercontent.com/temporalio/api/master/temporal/api/failure/v1/message.proto)）；"仅为终止 workflow 设置"未验证。
2. **OTel：被重试或已处理的错误不得记到描述该 operation 的 span/metric** —— "Errors that were retried or handled (allowing an operation to complete gracefully) SHOULD NOT be recorded on spans or metrics that describe this operation."（[recording-errors.md](https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/general/recording-errors.md)，semconv v1.44.0）⇒ `llm/retry` 是可冷读**证据**，不是终态**权威**。
3. **OTel：`Ok > Error > Unset` 全序，且 `error.type` 成功时不得设置**（[api.md](https://raw.githubusercontent.com/open-telemetry/opentelemetry-specification/main/specification/trace/api.md)、[error.md](https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/registry/attributes/error.md)）⇒「未设 = 未知」合法且必需，不填 0。
4. **LangSmith**：`error` 与 `status` 并列，官方**未定义**"重试后成功"语义（[run-data-format](https://docs.langchain.com/langsmith/run-data-format)）⇒ 该语义是主流产品空白，DSH 若呈现须自建权威等级。
5. **Kubernetes**：`Unknown` 是一等状态且不得假设 —— "nothing should be assumed about Pods that have a given `phase` value."（[pod-lifecycle.md](https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/workloads/pods/pod-lifecycle.md)）⇒ 无缓存行的会话必须显示"未知"。
6. **Langfuse**：`level`/`statusMessage` 只挂 observation，trace 无 `level`（[observations.ts](https://raw.githubusercontent.com/langfuse/langfuse/main/web/src/features/public-api/types/observations.ts)）⇒ 错误在叶子归因、容器不归因，与 DSH「turn 级权威 + step 级证据」同构。

未联网验证：OTel 无"Unset ≠ Ok"字面表述（仅全序）；LangSmith 重试语义缺失属 absence of evidence；K8s 无"UI 不得推断"独立条文；`PendingActivityInfo.last_failure` 权威性无来源。

# Right Sidebar Capability Inventory: Discovery Loop Output

English | [中文](README.zh.md)

Date: 2026-09-17
Status: **approved by human review** (the step ⑤ review gate, 2026-09-17); the documents may land, the code is still unchanged.
Topic source: the right-sidebar requests the product owner (writing in Chinese) raised one by one in a session, plus one follow-up request.

## The request as originally worded (preserved verbatim, no wording changed)

1. 「右边栏除了文件 需要添加 / 任务观测 / 终端 / 成本观察 / 评估观察 / git检查和观察类似于Git Workbench git即为记忆 / 运行其他模型的插件 比如gpt5.6 claude-code的模型（因为pi转发目前运行报错）/ archiy / 先去dsh官方插件库查看有么有符合的 没有符合的插件自己开发」 — "Besides files, the right Sidebar needs to add: task observation / terminal / cost observation / evaluation observation / git inspection and observation similar to Git Workbench, where git is memory / plugins that run other models, such as gpt5.6 and claude-code models (pi forwarding currently reports an error) / archiy / first check the official dsh plugin registry for anything that fits, and develop the plugin yourself when nothing fits."
2. 「先在验证实例上验证 没问题了再从主实例确认」（同义更正版：「先在验证实例上验证 没问题了再重启主实例」；原话中的端口号分别指「重启主实例」与「在验证实例上」，此处统一以主实例/验证实例表述） — "Validate on the validation instance first; once that is fine, confirm on the main instance" (an equivalent corrected wording: "validate on the validation instance first; once that is fine, restart the main instance"; the ports named in the original wording mean "restart the main instance" and "on the validation instance" respectively, so both are stated here as main instance / validation instance).
3. 「任务观测评估 失败原因根因分析 之间的级联关系 / 任务图谱查看」 — "The cascading relationship between task observation, evaluation, and failure root-cause analysis / viewing the task graph."
4. 「/bmad-discovery-loop 审核下我提的这些1 是否合理 2 有啥补充 3 可否优化 不是一上来就写代码 头脑风暴 创意补充」 — "/bmad-discovery-loop, review these points I raised: 1 whether they make sense, 2 what to add, 3 what to improve; do not jump straight into writing code — brainstorm and add ideas."
5. Follow-up request: 「在加一个需求展示 展示代理之间树状关系 叫智能体派生面板」 — "Add one more requirement display that shows the tree relationship between agents, called the agent-derivation panel."
6. Choices already made in the session: the task graph = the subagent/task lineage graph; evaluation = show derived facts only; the main instance = do not restart it for now. The five decisions added by the step ⑤ review gate are in `03-decisions-and-plan.md`.

## Method and hard constraints

This directory is the output of a BMAD discovery loop (`bmad-discovery-loop`). The topic is first split into subtopics that rest on evidence, and each subtopic runs a five-step flow: ① brainstorm → ② competitive/technical research → ③ conclusion and recommendation → ④ expert-panel review → ⑤ human review gate.

- **Read-only throughout**: no source, config, test, or script in the repository or `$DSH_HOME` was modified, created, or deleted. The only writes are this directory (after approval) and `/tmp/bmad-discovery/` (process records).
- **No code**: this directory describes only conclusions, decisions, and execution order; it contains no implementation.
- **Evidence grading**: every fact names its source — 【复核】 (rechecked) confirmed by the main agent running the command or reading the file directly; 【子代理】 (subagent) confirmed by a subagent reading the code (with file:line, not re-run one by one); 【联网】 (web) competitor documentation, with its URL; 【未验证】 (unverified) marked explicitly.

## Conclusion summary (read these five first)

1. **The third-party plugin `dsh-better-sidebar` is installed but disabled**, so the core right Sidebar is the surface the owner actually uses, and `ui-sidebar-tasks` (task observation V1) is reachable in that real profile. Any argument that "the ecosystem already covers terminal/Git/background jobs" does not hold within the currently enabled set.
2. **The main instance needs no restart**: the running instance already dispatches new modules on request (it started before the last build, and the manifest still carries that row and can fetch it). When the validation instance runs as a child process of the main instance and shares `$DSH_HOME`, a restart kills it as well.
3. **The agent-derivation panel must reuse the existing derivation logic**: the lineage tree already exists in the Session header (a 336×560 overlay), and `flattenLineage` already lives inside `@deepseek-ai/dsh-api-session-controller`; the new panel's value comes from **building the tree from the full Session summaries (`byId`)**, not from redrawing the same lazy-loading tree.
4. **Cost and evaluation lack an entry point, not data**: `SessionListEntry.projectionValues` already carries `tokenUsage`/`sessionStats`/`contextPressure`/`contextBreakdown`/`turnOutline` and others; the only host gap is a whole-Session failure count (one projection unit, with no new session event and no format-version change).
5. **Two causalities are provable and one is not**: subagent lineage (parent → child) and the order of turns within one Session are provable; "task-level dependency (A failing blocks B)" is not provable while DSH has no dependency model, and drawing it as a dependency edge is fabrication.

## Document index

| File | Content |
| --- | --- |
| `01-verified-facts.md` | Verified facts (including three corrections of earlier judgments) with their evidence |
| `02-subissues.md` | The five-step flow records and conclusions for the six subtopics S1–S6 |
| `03-decisions-and-plan.md` | The five decisions, the execution order (Do now / Next / Later / frozen / dropped), the acceptance criteria, and the open decisions |
| `04-competitive-evidence.md` | The step ② competitive-research evidence (first-party documentation URLs) and the transferable/not-transferable verdicts |
| `05-risks-and-gates.md` | The risk list, the process corrections, and the gate requirements for implementation |

## Loop status (honest record)

| Subtopic | ①   | ②   | ③   | ④   | ⑤   |
| --- | --- | --- | --- | --- | --- |
| S1 task-observation form | done | done | done | done | passed |
| S2 core-built vs ecosystem already installed | done | done | done | done | passed |
| S3 availability of cost/evaluation data | done | done | done | done | passed |
| S4 where the three non-sidebar items belong | done | done | done | done | passed |
| S5 right-sidebar capacity and navigation | done | done | done | done | passed |
| S6 agent-derivation panel | done | partial (S6's step ① already carries the overlay/file-tree precedents and file:line evidence, so its research was not run separately) | this file and `02` | not run separately (the five decisions already cover its position) | passed (position settled, design details outstanding) |

Step ① of S6 self-reports one **falsifiable load-bearing argument**: only a tab type can own a guide entry (`SidebarRightTabDefinition.guide[].{order,title,description,icon}`), so the "agent-derivation panel" must be an independent kind, or else the owner's naming requirement cannot be discovered on the "+" page. If the product accepts it as a lens label only and needs no discoverable name, the cheaper reversible path opens again — this recommendation gets one adversarial test before implementation.

Candidate subtopics for the next round (their conclusions are not in this directory): the memory timeline (git + checkpoints + memos combined from three sources), the terminal (with its security boundary), other-model access (the CLI as a first-class LLM route), ownership of the `sessionOutcomes` aggregation, and the upstream repair status of git-graph.

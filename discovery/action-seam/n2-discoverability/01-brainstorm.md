# N2 ① 头脑风暴（动作的可发现性）

依据（只引 HEAD）：`ui-jobs/src/client/index.ts:3-4` 自述 "the plugin issues no RPC"、`JobListAction.tsx` 无 kill/stop、`job_kill` 只有模型工具（`packages/jobs/tool-jobs/src/index.ts:362`）⇒ **Web 端今天没有任何停止后台 job 的入口**。（`packages/client/ui-sidebar-tasks/` 为上一轮未跟踪产物，**不作先例引用**。）

15 个方向，Top 5：
1. ★ **面板按钮 = 命令装饰（decoration）**：身份唯一、自动落 `command/run`。已有两处成品先例：`/permission`（"the one write path a web client uses"，`permission-presets/src/index.ts:252-254`）与 plan mode（`plan/plan-mode/src/index.ts:223-228`）。
2. ★ **按钮属于锚定它事实的面板** —— 与既有架构决议一致（见 ③），不是新发明。
3. ★ **按钮不执行，只把命令行预填进 composer**，由人自己按 Enter（同时解决主体性与可解释性）。
4. **动作注册表作为新 client 服务**：一次注册、多处呈现（Eclipse 三分离），一处声明可投影到面板与命令面。
5. ★ **失败可读性协议**：新动作面禁止 falsy reply，必须给三态 + 日志入口。
**其他**：只允许 session-scoped 动作；从既有 `command/run` 长出"最近使用"；靠 `commands/change` 事件同步两种呈现；头部动作收进统一 overflow；加 gate「未落 command/run 的动作不得合入」；在右侧栏标签定义里声明 actions。

**否决**：「所有动作必须有 host command」（违背"事实在哪、行动在哪"，jobs 面板的 stop 会无家可归）；「取消全局作用域」（设置面与工作区本身就是全局的）；「用显式开关暴露未审计动作」（与「Model-visible ⟺ logged」直接冲突）。

# R2-B ④ 专家团评审

**判词**：6 同意 · 7 同意 · 8 同意。

- 第 6 条：冻结 `{matched:boolean}` 正确；`cancel()` 只回 `{accepted:true}` 确实把多态糊在一起，**必须先修**；outcome 原语值得收拢。**计数订正**：实测 `role="alert"` 为 **26 处 / 13 文件**（`packages/` 全树；其中 `packages/client/**` 内 20 处 / 11 文件 / 10 包），不是 21/11 —— 结论不变，断言按实测写。两条约束：原语不得成为绕过 locale 归属的第二条文案通道；形态必须是"渲染宿主已落盘的结果"，不得自造状态。
- 第 7 条：同意。`when` 由面板已持有的 props/`useSession`/投影派生，天然满足 `packages/client/AGENTS.md:36`；`enablement` 只是本地置灰，宿主在**做出决定的那次操作里**重新判定，正合 `packages/AGENTS.md` 的"在做出决定的操作里执行决定"。**暂不加 `availability` 线字段**（无消费者证据）。
- 第 8 条：同意。已验证 `execute` 仅在 parse 失败时返回 `undefined`，此时 `command/run` 尚未追加，指路日志就是假指令。**补强**：`runDetached` 把 `matched:false` 折成 `kind:'error'`，客户端在那一层尚无法区分 ① 与 ③ ⇒ 类型化结果要先贯穿。

**改变条件**：`SessionFace.command` 准入布尔若被证明是**模型可见**的，则不能冻结（结论会推翻）；若宿主为未准入补一条已落盘事件，则"未匹配"也可指路日志。

**分歧（本条较少）**：无结构性对立，仅"outcome 原语放 `ui-primitives` 还是各面板自持"未定；以及 `cancel()` 新返回值的兼容与迁移路径未定。

**验收口径（可机器验证）**：(a) 未匹配路径**不产生任何日志记录**且文案明说「没有这条命令、没有留下记录」；(b) 被拒路径携带 typed code 与 `details.reason`，外壳本地化、理由原样；(c) 执行失败路径可指回**那条**已落盘的 `command/done`；(d) `cancel()` 的判别结果能区分「已停止」与「本来就没在跑」；(e) `when`/`enablement` 的谓词只由面板已持有的事实派生，且宿主在做出决定的动作里重新判定；(f) 新增 outcome 原语不引入绕过 locale 归属的文案通道。

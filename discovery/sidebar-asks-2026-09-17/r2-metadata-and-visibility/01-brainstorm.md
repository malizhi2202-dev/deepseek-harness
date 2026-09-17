# R2-1 ① 头脑风暴

依据：F1（`tab-registry.ts:85-126` 无 icon/badge/order/pin）、F2（`:61-76` 只有 guide 带 order/title/icon）、F3（`shell/SidebarRight.tsx:156,309` 的 "+" 只开 guide；芯片 44–170px 溢出无菜单）、负责人决策 1 与 5、VS Code「Add an icon to every View」。

15 个方向，Top 5：
1. 定义加 `visibility?: 'default-on' | 'available' | 'hidden'`，缺省 `available` = 今日行为 —— 最小契约，直接承载负责人的默认可见决策。
2. 预算做成**消费方 Config**（`maxDefaultVisible` 默认 3 + 白名单）+ 注册期 fail-loud（沿用 `tab-registry.ts:243-247` 风格）—— 可机器判定，且不违反 "No hardcoded tunables in plugins"。
3. 新门 `verify-sidebar-right-tab-types`（落点同 `scripts/run-gates.ts`）—— 把 order/预算/icon/地址域变成 CI 断言。
4. `icon?`（default-on 必填）+ `badge?`（thunk，仿 `title` 契约）—— chip 要能在窄栏存活；JetBrains 用彩色 badge 而非换图标。
5. core 拥有分区声明面（`section?` 只引用 id）—— 唯一能同时做分组又不破坏已发布第三方的路径。

★ 负责人未提：guide 与可见性解耦（hidden 类型仍出现在 guide，对齐 VS Code hidden view 仍在 views 菜单）；窄栏缩写 + icon 取代纯省略。

明确否决：自由文本 `section`（不可校验、分组名漂移）；`order` 必填（破坏性）；用"不注册"表达 hidden（丢可发现性，且注册即 effect、注销连带撤 body）；芯片横向滚动（`dockkit.module.css:108-116` 注释已定：滚动容器会抢 press-and-move、把拖拽废掉）；预算超限静默降级（违反 fail-loud）；core 轮询内容算 badge（违反客户端分层）。

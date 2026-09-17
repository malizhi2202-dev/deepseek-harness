# N2 ② 竞品与技术调研（本次 web_fetch 取回）

**一处声明、多处呈现**：VS Code 的 commands / menus / keybindings 三贡献点，且 **`when`（可见）与 `enablement`（可用）分开**；面板**过滤**不可用项，右键菜单**置灰**显示 —— [contribution points](https://code.visualstudio.com/api/references/contribution-points)。Eclipse 把 command（身份）/ handler（实现）/ menuContribution（位置）三分离，**无 handler = 实质 disabled 但 UI 仍可渲染** —— [workbench commands](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/workbench_cmd.htm)。IntelliJ 的 Action 注册一次、投影到菜单/工具栏/Find Action，可用性靠 `update()` 重算 —— [action system](https://plugins.jetbrains.com/docs/intellij/action-system.html)。

**搜索面只索引已注册条目**：GNOME SearchProvider2 —— [gjs.guide](https://gjs.guide/extensions/topics/search-provider.html)；Windows App Actions —— [learn.microsoft.com](https://learn.microsoft.com/en-us/windows/ai/app-actions/)。

**审计面**：git reflog、Apple Unified Logging、GitHub audit log 的共同形态是"一条 append-only、含 actor+action+time、且能从 UI 到达的记录"，通知只做链接 —— [git-reflog](https://git-scm.com/docs/git-reflog)、[GitHub audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization)。

**静默失败是被禁止的**：不可用必须可见 —— 要么本地谓词过滤，要么置灰。苹果 HIG 让菜单项置灰而**菜单仍保持可打开** "so people can open it and learn about the commands it contains"（[HIG menus](https://developer.apple.com/design/human-interface-guidelines/menus)）；GNOME HIG 明说 "Make invalid buttons insensitive, rather than showing an error message when the user clicks them"；GTK 用 `set_sensitive`（[docs.gtk.org](https://docs.gtk.org/gtk4/method.Widget.set_sensitive.html)）。VS Code 对未知命令是 `Promise.reject(new Error("command '<id>' not found"))`（仅源码 `commandService.ts`，未见文档化承诺）。

「未联网验证」：Apple "responsible process" 的 TCC 表述；Jupyter 默认 Authorizer 的返回值；`draft-ietf-oauth-v2-1-13` 是过期草案。

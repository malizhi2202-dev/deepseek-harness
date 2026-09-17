# R2-1 ② 竞品与技术调研

1. VS Code 视图级声明可见性三态 `visible|hidden|collapsed`（默认 visible），hidden 仍可从 views 菜单发现并被用户取消隐藏 —— [viewsExtensionPoint.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts)、[Views UX](https://code.visualstudio.com/api/ux-guidelines/views)。
2. 面板级默认可见是**部署可配设置** `workbench.secondarySideBar.defaultVisibility`（枚举 hidden|visibleInWorkspace|visible|maximizedInWorkspace|maximized，默认 visibleInWorkspace）—— [workbench.contribution.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/browser/workbench.contribution.ts)、[Custom Layout](https://code.visualstudio.com/docs/configure/custom-layout)。
3. 排序/分组：core 拥有容器序列、容器拥有内部序；自定义容器 order=7+计数，Secondary Side Bar 再整体 +100 偏移；容器内 order 仅当同属一个扩展时才用；容器 hideIfEmpty。
4. 数量预算是**文档化 UX 规则而非代码常量**："3-5 is a comfortable max"、"Keep the number of Views to a minimum"；JetBrains 只给"几乎每个项目都会用到的基础功能"默认显示按钮 —— [Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars)、[Tool Window](https://plugins.jetbrains.com/docs/intellij/tool-window.html)。
5. 图标/badge：VS Code 要求每个 View 有 icon（可能被移到纯图标的 Activity Bar / Secondary Sidebar）；JetBrains 20×20/16×16 灰色单色 icon，内容变化时加彩色 badge、**不换图标**。
6. 溢出发现：VS Code 在容器多于一个 View 时给 `...` 按钮显示/隐藏各 View；JetBrains 在 stripe 用缩写（Pull Requests → PR）+ More tool windows 兜底。

未联网验证：chrome.sidePanel 按 tab 启用语义（抓取被截断）；JetBrains 程序化 badge API 未检索到。

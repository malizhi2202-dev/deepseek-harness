# Agent Note: 右侧栏 tab 类型的元数据与默认可见集

Status: implemented

[English](2026-09-17-sidebar-right-default-visible-set.md) | 中文

## 问题

右侧栏打开时只是一个装着引导页的格子，其他类型 —— 文件树、文件的文本、会话的任务 —— 都得先去引导页或 tab 条的添加控件里找，才能显出来。[tab 类型定义](2026-09-05-sidebar-tab-types-and-navigation.zh.md)只能声明一个类型看哪些地址，对栏本身什么也说不了：没有排位、没有字形、也没有办法说某个类型值得替用户打开。由此带来两个后果。

「一个会话先显示什么」在声明里没有落点，于是只能由 `ui-sidebar-right` 自己点名它要打开哪些 kind —— 一份写死别的包的类型的清单，恰恰是插件边界要把这类知识挡在停靠面之外的东西，而且某个 kind 一改名它就漂了。另一方面，一个类型认领的地址是它身份的唯一表述，所以没有任何东西阻止一个新 kind 去认领另一个 kind 的 `dsh-resource://` 域的一部分，或者认领好几个。

## 决定

`SidebarRightTabDefinition` 增加三个可选字段，栏要打开什么由这些字段推出，而不是由一份清单决定：

```ts ignore-check
interface SidebarRightTabDefinition {
  // …id, kind, patterns, priority, canOpen, title, guide
  readonly icon?: ComponentType<IconProps>          // the glyph the type picker draws for this type
  readonly order?: number                           // rank among the page types; core 0–999, outside 1000+
  readonly visibility?: SidebarRightTabVisibility    // 'default-on' | 'available' (default) | 'hidden'
}
```

`order` 是类型选择器列出的依据，也是新停靠面打开其默认可见 tab 的依据。`visibility` 说明在用户开口之前该类型想要占多少栏：`default-on` 让每个新停靠面打开它的页面，`available` 让选择器列出它、只在用户开口时才打开，`hidden` 让它不出现在选择器里，而它的引导页入口框与 `openTab` 仍可到达。`icon` 画在选择器里该类型的那一行上。

### 默认可见集

`ctx.sidebarRightTabs.defaultTabs()` 给出所有 `visibility` 为 `default-on` 的已注册页面类型，按 `order` 排序，形如 `{ kind, contentId, title }` —— 与 store 原先给引导页用的种子结构相同（`contract/seed.ts`）。`ui-sidebar-right` 的 store 接收一个 `SurfaceSeed`（`{ title, tabs }`）并通过 `createSurface` 读取它，因此每个会话的停靠面都会重新读取该集合：在某个会话打开之前注册的类型会被种入该会话。

这些 tab 在初始状态内部、按顺序排在引导页之后，并聚焦第一个。因此它们不在已记录的序列里：回退止步于会话诞生时的样子，关掉一个默认可见 tab 也不会被随后的 settle 撤销。另一种做法——把它们作为普通的、被记录下来的打开动作种入——会让撤销把用户关掉的 tab 重新打开，也会让序列的头几条因没有任何用户动作解释的原因而因会话而异。

### 预算

最多 `MAX_DEFAULT_VISIBLE_TABS`（3）个类型可以声明 `default-on`，这个数字只有一处：`packages/client/ui-sidebar-right/src/client/contract/visibility.ts`，与 order 分段放在一起（`DEFAULT_ORDER` 100 是「用户必须自己打开的类型」能占的第一个位置，`DEFAULT_ON_ORDER_MAX` 99 是默认可见分段里的最后一个位置，`THIRD_PARTY_ORDER_MIN` 1000 是产品之外类型的起点）。有两个消费者读取这个常量：注册表在某次 `default-on` 声明会越过预算时于注册处抛错并报出该预算，`verify-sidebar-right-tab-types` 则在评审中拒绝同一份声明。门禁从该模块的源码里读出这些数字，而不是导入它们，因为 `scripts/` 属于 Host 程序而契约住在 Client 包里；该模块没有任何运行时导入，使这次读取只是一次普通的常量扫描。

注册表还在同一处拒绝另外两种组合，而不是少开几个 tab 却仍声称按声明执行：`default-on` 却声明了 `patterns` 的类型（查看器按需解析地址，没有自己的页面可开），以及 `default-on` 却没有 `icon` 的类型（用户没有主动要的 tab 必须仍然可辨认）。被 extension 接管的 kind 只计一次，因为预算是关于栏的陈述，不是关于注册次数的。

### tab 条的类型选择器

停靠面没有自动打开的类型仍然可达：面板的 chrome 带一个类型选择器，它的行是已注册的页面类型，按 `order` 升序，带上各自声明的 `icon`，选中即对按钮所在的格子调用 `openTab(kind, { paneId })`。它略去引导页（tab 条自己的添加控件负责打开它）与所有 `hidden` 类型。它只列页面类型——查看器靠解析地址打开，所以一份按 kind 的菜单对它无话可说。

### 新 kind 的准入

一个 kind 的准入只有一个条件：它恰好独占一个 `dsh-resource://<type>/` 地址域，且不认领别的域。页面类型豁免，因为它按 kind 打开、根本不认领地址；内置的 `guide`、`files`、`tasks` 正是因此不声明 `patterns`。这条规则是本次变更新立的——此前没有任何代码执行它，也没有任何已发布定义依赖它的例外。`verify-sidebar-right-tab-types` 对每一份已发布定义执行它，连同预算、order 分段、显式且互不相同的 order、每个 kind 只有一份定义，以及各项 `default-on` 规则。

## 考虑过的替代方案

**在 `ui-sidebar-right` 里写死默认集。** 用一个 `kinds` 数组或 `isDefaultVisible(kind)` 辅助函数点名新停靠面要打开的类型也能用，而且不需要新字段。否决：它把别的包的 kind 名字放进停靠面包，增加一个类型要改两个包，而且类型自己无法表达意图。`visibility` 把产品决定留在声明里，把机制留在停靠面里。

**用注册顺序作为默认集。** 打开最先注册的 N 个页面类型完全不需要元数据。否决：注册顺序是激活顺序，取决于 loader、profile 与 HMR，而不是产品想让用户先看到什么。

**只加 `defaultVisible?: boolean` 标志、不设预算。** 这是能表达「自己打开这个」的最小字段。否决：没有什么能阻止三个 extension 打开六个 tab，而故障会表现为一栏塞满，而不是加载期报错。预算让越界的注册在它发生的地方就失败。

**把预算做成 `Config` 字段、在设置界面里编辑。** 考虑过，因为部署方可能想要不同的上限。这里是推迟而非否决：目前没有消费者要它，而设置界面还得为此拥有由此产生的按用户差异；在出现消费者之前，只有一处定义的常量才是诚实的现状。包 README 把这一限制记为当前状态。

**用允许 `default-on` 的 kind 白名单。** 作为限制集合的手段考虑过。否决：白名单正是本决定要移除的那份写死清单，而预算已经把集合限制住了。

**在同一轮里加 `badge` 与 `section` 字段。** 两者都在桌上：每类型一个 `badge` thunk，以及选择器行上方的一条 `section` 分组。按「三的法则」推迟——badge 需要一个实时计数，而没有任何界面在要它；四个页面类型也不足以让一个菜单多出第二条分组轴。以后再加只是可选字段，不会改动任何已发布定义。

**把元数据放在引导页入口上而不是定义上。** 引导页入口本来就带 `order` 与可选的 `icon`。否决：入口描述的是引导页画出的那个框，不是类型在栏里的地位。一个类型可以既要排位和字形、又不要入口，而 `hidden` 恰恰是两者不一致的情形。

## 后果

- 「一个会话先显示什么」现在是提供它的那个类型的属性；`ui-sidebar-right` 除自己的引导页之外不再点名任何 kind，第五个页面类型自己声明它该在哪儿。
- 每份已发布定义都显式给出 `order`，且两份定义不得共用同一个，因此选择器的次序是一个决定，而不是排序的并列打破规则。
- 预算是固定的产品上限。部署方无法提高它，这一点被记为限制而不是留着不说。
- 撤销语义保持诚实：会话诞生时带着的东西不是用户做的，所以它不在序列里，而 store 的 seed（`SurfaceSeed`）是停靠面拿到它的唯一通路。
- 门禁从源码读取声明，而不是相信一次运行时注册，因此一份变得不可读的定义——算出来的 `kind`、返回变量——会在读其他定义的同一次检查里失败。这一耦合的代价，是换来一个不必启动浏览器就能列出名册的门禁。

## 测试

`ui-sidebar-right` 的注册表规格覆盖 `defaultTabs()` 的排序与标题、空集、页面类型与 `icon` 两项拒绝、预算及其越界与 kind 被接管的两种情形，以及注销释放预算；store 规格覆盖种入的初始布局、按停靠面读取 seed，以及种入的 tab 无法被回退走、关掉后也不会被重新种入；座席规格驱动真实插件图把某个 `default-on` 类型种入在它注册之后才打开的会话，并驱动选择器的行、字形、hidden 与查看器排除、排序、选中与关闭行为。`scripts/verify-sidebar-right-tab-types.spec.ts` 证明每条规则都会拒绝一份非法声明，且已发布名册通过。Web 套件随这个表面一起改动：`sidebar-right.e2e.ts` 断言被种入的 tab 条、表面聚焦的那个 tab、选择器的行，以及被清空的格子仍只重新种入引导页；`details-session-lifecycle.e2e.ts`、`navigation-panes.e2e.ts` 与 `seeded-history.e2e.ts` 把多出来的这个 tab 计入数量；录制的 `snapshots/web/details-session-lifecycle/sidebar.expected.md` 在每个检查点都多了一条 `Tasks`。全部无需密钥。

## 暂缓

- 由部署方选择的默认可见预算，以及任何为它而设的设置界面。
- 定义上的 `badge` thunk 与 `section` 分组，以及各自需要的选择器界面。
- 类型选择器之外的字形：tab chip 只画标题。
- 第二个声明 `default-on` 的产品页面类型；预算还留着两个位置。

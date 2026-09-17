# 插件目标线兼容：② 竞品与技术调研

方法：`web_search` 在本环境不可用，全部结论经 `web_fetch` 直连权威源；大页面改抓源码原文。取回日期 **2026-09-17**。外部分级一律【联网】。

**来源层级说明（重要）**：主调研员亲自直取的 URL 约 12 条；另有约 38 条由它**自己派出的 5 个子代理自报**。本文件对两者不加区分地标【联网】，但下表「取回」列标注了来源层级。**主 agent 只对其中一条做过直连尝试（结果被截断，未自核）**⇒ 本文件所有外部引文**均未经主 agent 独立复核**。

## 一、偏离声明

1. `bmad-deep-recon` 默认要求建 run folder / `brief.md` / `digests/` / `research.md` / `.memlog.md`；本轮禁写盘，故不建任何文件。
2. 未做并行搜索扇出（`web_search` 不可用），改为逐条直连。
3. 未落盘任何产物；技能要求的统计脚本未执行，第六节为人工清点。
4. 抓取正文里的第三方产品示例模型名在引用中省略。

## 二、核心对照表（10 个生态 16 行）

| # | 对象 | 字段 | 强制程度 | 执行阶段 | 宿主比声明更新时 | 取回 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | VS Code | `engines.vscode`（必填，不得为通配） | **强制** | 安装（选兼容版本，选不到即拒） | 允许；限制只能写精确版本 | 主调研员 |
| 2 | VS Code | `extensionDependencies` | **强制** | **激活** | 不适用 | 其子代理 |
| 3 | Obsidian | `minAppVersion`（必填） | **强制** | 安装（查 versions.json 回退到兼容旧版） | 未找到来源 | 主调研员 |
| 4 | npm | `engines` | **默认仅建议**（只警告） | 安装（`engine-strict=true` 才拒） | 默认警告；严格则拒（`--force` 可越） | 主调研员 |
| 5 | Firefox | `strict_min_version` | 声明即强制 | 安装或运行 | 允许 | 其子代理 |
| 6 | Firefox | `strict_max_version` | 声明即强制，默认通配不检查 | 安装或运行 | 设了上限则拒绝 | 其子代理 |
| 7 | Chrome | `minimum_chrome_version` | **强制** | 商店发布/安装 + **静默停更** | 允许（**无上限字段，已确认缺席**） | 其子代理 |
| 8 | WordPress | `Requires at least` / `Requires PHP` | **强制** | **激活** | 允许（最小语义） | 其子代理 |
| 9 | WordPress | `Tested up to`（readme 字段，非插件头） | **仅声明** | 完全不执行 | 不适用 | 其子代理 |
| 10 | Docker API | 版本协商 | **运行时协商** | 握手 | 降级到共同版本 | 其子代理 |
| 11 | Cargo | `rust-version` | **强制**（编译报错，可跳过） | 编译 | 允许 | 主调研员 |
| 12 | Cargo | `resolver.incompatible-rust-versions` | 可选回退，新版 edition 默认 | 依赖解析 | 倾向选与较旧工具链兼容的依赖 | 其子代理 |
| 13 | Python | `Requires-Python` | **强制**（安装器解析约束，可跳过） | 安装/解析 | 取决于说明符，上限可表达且被强制 | 主调研员 |
| 14 | Grafana | `dependencies.grafanaDependency`（必填） | **强制** | 发布校验 + 安装版本解析 | 未找到来源 | 其子代理 |
| 15 | Neovim | API 等级元数据 | **仅声明**（元数据） | 无（能力探测） | 允许（扩展可选，弃用保留） | 其子代理 |
| 16 | Composer | `config.platform` | **仅声明**（伪造平台） | 解析/安装 | 允许 | 其子代理 |

## 三、关键逐字引文

| 编号 | 引文 | 出处 |
| --- | --- | --- |
| E1 | 「`engines` \| Y \| ... Cannot be `*`.」 | VS Code 扩展清单参考 |
| E2 | 「You can use the `engines.vscode` property to ensure the extension only gets installed for clients that contain the API you depend on.」 | VS Code 发布文档 |
| E3 | 「A value of `1.8.0` (without caret) means that your extension is compatible only with VS Code `1.8.0`.」「`^1.8.0` means ... `1.8.0` and onwards」 | 同上 |
| E4 | 「Can't install '{0}' extension because it is not compatible with the current version of {1} (version {2}).」 | VS Code 源码（安装期拒绝的文案） |
| E5 | 「If your `manifest.json` requires a version of Obsidian that's higher than the running app, your `versions.json` will be consulted to find the latest version of your plugin that is compatible.」 | 插件目录仓库 |
| E6 | 「Unless the user has set the `engine-strict` config flag, this field is advisory only and will only produce warnings when your package is installed as a dependency.」 | npm 文档 |
| E7 | 「npm will stubbornly refuse to install (or even consider installing) any package that claims to not be compatible with the current Node.js version.」「This can be overridden by setting the `--force` flag.」 | npm 配置文档 |
| E8 | 严格模式开关「Default: false」；历史上 v6 的同类项「This feature was removed in npm 3.0.0」 | npm 文档 |
| E9 | 最小版本不满足时「the extension is not installed or not run」；上限「Defaults to `"*"`, which disables checking for a maximum version.」并注「most extensions omit `strict_max_version`」 | MDN |
| E10 | 「the Chrome Web Store will show a "Not compatible" message in place of the install button」；「Existing users of your extension will not receive updates ... **This happens silently** so you should exercise caution」 | Chrome 开发者文档 |
| E11 | 「The lowest WordPress version that the plugin will work on.」；强制只见于核心源码的激活路径（「Test for WordPress version and PHP version compatibility.」）；「Since WordPress 5.8 plugin readme files are not parsed for requirements.」 | WordPress 插件头文档 + 核心源码 |
| E12 | 「it negotiates the highest version of the API supported by both the client and daemon, downgrading to an older version of the API if necessary.」；失败时返回 HTTP 400；「compatibility is "best effort"」 | Docker 引擎 API 文档 |
| E13 | 「When your package is compiled on an unsupported toolchain, Cargo will report that as an error to the user.」「A user can opt-in ... with the `--ignore-rust-version` flag.」「The Rust version must be a bare version number ...; **it cannot include semver operators**」 | Cargo 文档 |
| E14 | 「Installation tools may look at this when picking which version of a project to install.」；pip 的拒绝文案「requires a different Python」；`--ignore-requires-python` | Python 打包规范 + pip 文档 |
| E15 | 「Required Grafana version for this plugin. Validated using node-semver.」 | Grafana 插件 schema |
| E16 | 「Any such extensions are OPTIONAL: old clients may ignore them.」「Clients can ... call `nvim_get_api_info()`」 | Neovim 文档 |

## 四、三条结论

**结论 1｜强制程度由「谁承担错误安装的代价」决定，不是成熟度。** 宿主自己完成解析/安装/激活的一律强制：扩展宿主在**安装期**拒绝、编译器在**编译期**报错、内容系统在**激活期**校验。仅声明的四种成因是：① 字段是质量声明而非硬需求（「已测试到」这类非阻塞信号）；② 消费者是第三方目录而非执行宿主；③ 兼容性是 best-effort 可降级（改为**运行时协商**）；④ 宿主无法预知目标且越权代价高（默认只警告 + 严格开关 + 逃生门）。

**结论 2｜上限字段少见有机制原因，不是疏忽。** 宿主默认向前兼容是策略（明文）；有的生态上限默认通配即**关闭检查**；有的把上限交由版本范围本身表达，因此不需要独立字段；有的**结构上无法写上限**（不接受版本操作符）。另有若干生态**确认没有**上限字段。

**结论 3｜「装错版本」的行业解法不是拒绝，而是回退到兼容版本。** 一个宿主用「先找与当前宿主兼容的插件版本、选不到才拒」；另一个用一份版本映射表找「最新的、与当前宿主兼容的插件版本」。⇒ **判定点天然在市场/安装侧**，不在宿主加载期。协商路线适用的前提是：接口向后兼容 + 双方独立演进 + 旧客户端必须能与新宿主通信 + 存在共同子集 + 可降级为尽力而为。

## 五、可转移到本议题的做法（只给建议，不写代码）

**声明层**：① 宿主版本字段做成必需、禁止通配（先例 E1、E2）；② 写清**范围语义**而非只写最小值（E3）；③ 把「已测试」与「需满足」拆成两个字段，前者非阻塞（E9 的反面、表格第 9 行）。

**安装层**：④ **不满足时优先回退到兼容旧版本而非直接失败**（E4、E5）——直接对应本议题「装错版本线」；⑤ 强制开关要有默认值与逃生门（E7、E8）；⑥ 避免**静默停更**（E10 的自我警示）。

**激活层**：⑦ 运行时能力不足就在激活点拒绝并报错；⑧ 让「依赖未满足」以**显式错误**浮出而非沉默挂起（表格第 2 行、E12）——**与本仓的静默挂起正相反**（属迁移类比，不是逐字先例）；⑨ 配显式退出开关。

**诊断层**：⑩ 兼容矩阵供安装器与诊断共用（E5、E15）；⑪ **提供能力探测而非只比版本号**（E16）——对「服务可用性」尤其对症；⑫ 保留一条非阻塞「已测试到」信号。

## 六、撤回声明（4 条，照录）

1. 原预设「Obsidian 不满足即拒绝安装/启用」——取回来源只记载查版本映射表回退选版本，用户可见的拒绝行为无记载，撤回并改为「强制字段 + 安装期版本回退」。
2. 原打算把 Firefox 上限字段的存在理由写成「防未来破坏兼容」——无任何来源给理由，撤回并入未验证。
3. 更正：WordPress 头文档只给字段定义，**强制只见于核心源码**。
4. 原预期「VS Code 的依赖字段在安装层强制」——源码显示它在**激活层**以激活错误浮现，撤回。

## 七、未验证清单

**未找到来源（不能断言文档中不存在）**：Obsidian 的用户可见画面与变更历史；Grafana 宿主更新时的行为与加载期拒绝；Firefox 上限字段的理由；WordPress 的确切拒绝文案；PyPI 上传期是否拒绝该类字段；Docker 低于最低版本的确切错误串；若干 schema/CHANGELOG 条目的默认值。

**已确认缺席（本轮抓取范围内）**：Chrome 无任何最大版本键；Obsidian 清单无最大版本字段；Grafana 无独立最大版本字段；MDN 无旧式非严格形态（且该形态已废弃）；npm 无发布期校验措辞；Cargo 发布子命令无跳过开关；Python 打包指南的相关小节已不存在；WordPress 头文档无「已测试到」；Neovim 无「能力探测优于版本检查」的明文。

## 八、来源清点

来源主体 12 个（微软、Obsidian、npm、Mozilla/MDN、Google Chrome、WordPress、Docker、Rust/Cargo、Python/PyPA/pip、Grafana、Neovim、Composer）；成功取回 URL 约 50 条（主调研员直取约 12 条，其 5 个子代理自报约 38 条）；逐字英文引文约 70 条；落盘产物：**无**。

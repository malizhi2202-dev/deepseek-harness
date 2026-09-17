# R2-1 ③ 结论与建议

**结论：V1 走最小集，且纯增量、无数据迁移。**

1. 定义增 `visibility?`（缺省 `available` = 今日行为）与 `icon?`（声明 default-on 的类型必填）；`order?` 只用于 **core 段唯一性**校验（core 0–999、第三方自 1000）。
2. **缓做**：`badge?` thunk、`section?` + 新核心分区注册面 —— 按 Rule of Three，目前只有一个 guide 引用方，等第三个 owner 再抽象（架构师条件）。
3. 预算 = 消费方 Config（`maxDefaultVisible` + 白名单），负责人决策写在 bundle `cordis.yml`；**且必须能在设置界面改**（产品经理条件），否则它不是用户的选择。
4. 新门 `verify-sidebar-right-tab-types` 断言五条：每 kind 至多一个 id、core 段 order 唯一、default-on 数量 ≤ 预算且 ⊆ 白名单、default-on 必有 icon、新 kind 必须拥有 `dsh-resource://<kind>/` 地址域（准入判据）。
5. 发现路径两步走：先在芯片裁切处加溢出菜单，再把 "+" 从"只开 guide"升级为 type picker（guide 居首）；两者只调既有 `openTab`，契约不变。

**义务与代价**：预算数字"3"与 0–999/1000+ 分段**缺证据**，需先量现网 chip 数与实际类型数再定，并指定签字人（分析师条件）。

**明确否决**：见 ①（自由文本 section、order 必填、用不注册表达 hidden、芯片横向滚动、预算静默降级、core 轮询算 badge）。

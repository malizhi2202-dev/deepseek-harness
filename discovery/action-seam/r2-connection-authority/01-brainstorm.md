# R2-A ① 头脑风暴（连接层权威契约与破缺条件）

15 个方向，Top 5：
1. **load 时断言逃生门未静默开启**，否则拒启/响亮告警 —— 唯一能把静默降级变成 fail-loud 的位置。
2. ★ **把 env 逃生门换成第二个显式开关**（如 `--web-allow-unauthenticated`），单个环境变量无法静默关掉认证。
3. loopback 绑定时 `trustedHosts` 非空即拒启（**本轮被证据推翻**，见 03：那些授权在 loopback 下本来就惰性）。
4. ★ **把启动 URL 行同屏声明为凭据**："这一行 URL 就是凭据"，因为它就是 token 兑换入口。
5. ★ **写一份安全姿态文档**：到达 ≠ 身份 + 断链条件表（最低成本让契约诚实，不改代码）。

★ 其他：boot 时断言 home 0700 / 凭据文件 0600；cookie 重签发时落一条会话事件；Web UI 头部显示 authority 徽标（绝不叫"用户"）；`trustedHosts` 改为 per-profile；同一 authority 上第二个不同密钥的进程即拒启；UI 内给"清除站点数据"的登出指引；401/403 文案分叉；`--trusted-host` 与 loopback 绑定同时出现时至少告警；会话级 cookie 供"重启即吊销"。

**明确否决**：加认证层/用户账号（第 1 轮已定，且 cookie 本就等价于全部工具权限）；per-session 授权（无 principal 可依据）；按 TCP peer 判权（`2026-08-24-browser-token-authentication.md:31` 已否决）；TLS/反代/转发头配置（无消费者）；每次重启轮换密钥（会破坏浏览器重连）；把 `trustedHosts` 做成插件内可调（违反"安全不变量固定"）。

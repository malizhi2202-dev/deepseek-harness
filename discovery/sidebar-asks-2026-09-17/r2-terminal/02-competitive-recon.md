# R2-4 ② 竞品与技术调研

1. **浏览器终端的默认姿态就是只读**：ttyd `-W, --writable  Allow clients to write to the TTY (readonly by default)` —— [tsl0922/ttyd](https://github.com/tsl0922/ttyd)；GoTTY 的 `--permit-write` 标 "(BE CAREFUL)" 且默认关，原文 "accepting input from remote clients is dangerous for most commands" —— [sorenisanerd/gotty](https://github.com/sorenisanerd/gotty)。
2. **未鉴权暴露 web 终端＝交出整机**：code-server 原文 "**Never** expose code-server directly to the internet without some form of authentication and encryption, otherwise someone can take over your machine via the terminal." —— [code-server guide](https://coder.com/docs/code-server/guide)。
3. **纯浏览器形态被官方判定不够**：VS Code for the Web 把需要运行时/终端的用户引导去桌面版、Codespaces 或 Remote-Tunnels，并自述 "runs entirely in your web browser's sandbox and offers a very limited execution environment" —— [vscode-web](https://code.visualstudio.com/docs/remote/vscode-web)。
4. **成熟产品走隧道而非开端口**：VS Code Server 经 `code` CLI 隧道接入，且"an instance of the server is designed to be accessed by a single user" —— [vscode-server](https://code.visualstudio.com/docs/remote/vscode-server)。
5. **PTY 暴露有官方警告**：node-pty README Security 一节 "All processes launched from node-pty will launch at the same permission level of the parent process… we recommend launching the pty inside a container" —— [microsoft/node-pty](https://github.com/microsoft/node-pty)。
6. **WebSocket 面有 OWASP 级指引**：握手须用显式 allowlist 校验 Origin（CSWSH，CWE-1385）；Service Tunneling Risks；"传统 HTTP 日志只记录 upgrade 请求、丢失全部消息流量" —— [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)。
7. **社区侧无现货**：本次插件检索返回 "No matching plugins found"。

未联网验证：其他插件索引未查；JupyterLab / Coder workspace agent 终端内部实现未查。

仓库侧（本次复核）：`tool-terminal` **在任何 bundle / 任何 agent preset 中都未挂载**；`terminal-bash` 只出现在 `packages/bundle/sdk-minimal/cordis.patch.yml`、`presets/minimal/agent.cordis.yml` 与一个 e2b 测试夹具；web-app 默认 preset 是 `standard`（只挂一次性 `tool-bash`）。**并且绑定为回环时局域网不可达**，故"局域网可达"这一威胁不成立，残余风险是"同机其他本地用户"。

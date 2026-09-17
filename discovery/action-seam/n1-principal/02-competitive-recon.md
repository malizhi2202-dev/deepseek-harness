# N1 ② 竞品与技术调研（本次 web_fetch 取回）

六种"UI 动作的主体与授权"模型：
- **polkit**：主体是显式传入的 Subject（进程/session/bus-name），**从不从调用方推断**；检查在 polkitd；官方指南明确"不要打断 console 用户" —— [polkit Authority 接口](https://polkit.pages.freedesktop.org/polkit/eggdbus-interface-org.freedesktop.PolicyKit1.Authority.html)、[polkit apps](https://polkit.pages.freedesktop.org/polkit/polkit-apps.html)。
- **macOS TCC**：主体是**代码**（Designated Requirement）；用户手势由 OS 代为消费；本地网络监听"no permission required" —— [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)、[sandbox 文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)、[TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。
- **OAuth**：有资源所有者时 `sub` = 资源所有者；无（client credentials）时 `sub` = 客户端本身，即"为自己行动时它自己就是主体" —— [RFC 9068 §2.2.2](https://www.rfc-editor.org/rfc/rfc9068.txt)、[RFC 6749 §1.1/1.3](https://www.rfc-editor.org/rfc/rfc6749.txt)。
- **对象能力（ocap）**：**没有主体**，权威 = 你已持有的引用 —— [Capability Myths Demolished](https://web.archive.org/web/20240123083030/http://www.erights.org/elib/capability/duals/myths.html)。
- **loopback 先例**：Docker 靠 socket 属主/组，且明说"组不是对抗同用户恶意代码的边界"（[docker docs](https://docs.docker.com/engine/install/linux-postinstall/)）；Jupyter 加 token 是因为端口可能被他人或转发到达（[jupyter security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)）。
- **VS Code**：主体是"用户，一次性"（Workspace Trust）；`executeCommand` 与面板点击走**同一 handler、没有 origin 参数**；要建模"是不是人触发的"时用的是调用上的布尔开关 —— [command guide](https://code.visualstudio.com/api/extension-guides/command)、[API 参考](https://code.visualstudio.com/api/references/vscode-api)。

**结论：六者无一为"人在自己已经掌控的 UI 里触发的动作"发明用户主体。** 它们要么把主体定义为代码/进程/引用（polkit、TCC、ocap），要么干脆承认"提交者即主体"（OAuth client credentials、VS Code 的 UI 用户）。

「未联网验证」：Apple "responsible process" 的 TCC 概念表述；TCC 对硬件资源区分"用户发起/后台"；loopback 豁免本地网络隐私的明文条款；Capability Myths 的 PDF 原文（仅 Wayback HTML 可取）。

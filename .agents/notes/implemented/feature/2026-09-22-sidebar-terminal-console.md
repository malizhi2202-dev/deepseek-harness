# Agent Note: A Shell Console in the Right Sidebar

Status: implemented

English | [中文](2026-09-22-sidebar-terminal-console.zh.md)

## Problem

The right Sidebar could show a session's tasks, files, derivations, and repository, but the person watching an agent work had no way to run a command themselves. Every shell in the process belonged to the model: the `bash` tool and its persistent siblings hold `ctx.terminals` in an entry-local realm mounted per agent preset, and reaching them from the browser would mean routing a person's keystrokes through the model's approval and transcript channel, which is exactly the coupling that makes the model-facing tool the wrong carrier.

## Decision

The capability enters as a new host-plane seam, `dsh-api-terminal-console` (the `terminalConsole` Remote namespace), and a new right-Sidebar tab type, `dsh-client-ui-sidebar-terminal`.

**It is a console seam over the PTY capability, not a second PTY owner.** `ctx.terminals` still spawns, sandbox-confines, bounds the scrollback, and reaps every shell; the console adds only what a browser needs on top of a seam built for tool calls: a server-minted shell identity, a network-surface gate, and a bounded output stream. Owning a PTY directly was refused because it would bypass `terminal-bash`'s `ensureSandboxModeFence`, the check that keeps a shell inside the session's sandbox mode.

**The console's PTY substrate is its own registry.** Agent presets mount their `terminals` group with `isolate: { terminals: true }`, so the console cannot reuse it even if it wanted to. The web-app bundle therefore mounts a second `pty` + `terminal-bash` pair under `backendType: console-shell`. No model-facing tool names that backend type, so no tool call can address a console shell, and no console shell shares a registry with a model's.

Five decisions inside are worth stating.

**Authority is minted, not accepted.** Every `@Remote` method takes `agent: Agent`, which the Gateway resolves from the wire's Session identity, and the console keeps its own per-session shell identity (`console-1`, …) in a map keyed by that Agent. A request resolving to session B that carries session A's shell id therefore finds no such shell and is refused as `terminal-console/unknown-shell`; the PTY session id never crosses the wire at all. The console's added guarantee is exactly that shell identity is server-minted and per-Agent — the session id itself is the repository's existing wire addressing mechanism, not something this seam strengthened.

**Refusal is the default on a reachable surface.** The Gateway's `HostConnectionService` keeps `trustedHosts` private and a Remote method never sees request facts, so a per-request reachability check is impossible at this layer; the gate is therefore configuration (`acceptReachableSurface`, default `false`) and the composition states the deployment fact. The web-app row sets it from `ctx.webRuntime.trustedHosts.length === 0`, so a loopback-only install serves the console and an install that added an authority must accept it explicitly. A refusal arrives as `terminal-console/refused`, and the panel draws the reason with no mint controls rather than a control that cannot work.

**Output is a logical Remote stream, polled at the source.** The brief expected SSE; `/api/remote.mux` is the carrier the browser already owns, reconnects through, and multiplexes, so a second transport for this panel would duplicate generation and backpressure handling for no gain. The generator polls `ctx.terminals.read({offset: 0})` — the newest bounded page — and folds successive pages with `advanceConsoleOutput`, which yields an append while the new page still starts with everything already sent and a whole-window replacement otherwise, because the PTY bounds drop retained text from the head. The first frame of every generation is marked `replace: true`, which is what makes a reconnected consumer replace instead of duplicate.

**Bounds are per owner and per frame.** `maxShellsPerOwner` (default 2) caps live shells with an in-flight reservation so concurrent mints cannot race past it, `maxFrameLines` bounds one poll, the backend bounds the retained scrollback, and every path that can end a shell — an exit frame, a close, the owner's disposal, the service's teardown — kills and drops it. Nothing is written to the session log: the byte stream is not a session event, and a `write` reports acceptance rather than a command's result.

**The panel draws text, not a terminal.** `@xterm/xterm` is refused for a mechanical reason before a stylistic one: the dynamic client bundle's CSS virtual-id plugin cannot resolve a bare `@xterm/xterm/css/xterm.css`, so a terminal emulator would arrive without its stylesheet. The panel draws bounded sanitized text, line-oriented, with no colors, no cursor addressing, and no alternate screen, and its copy says so. The shell's output lives in the tab's store rather than a client object layer because this panel is its only consumer, following the `ui-sidebar-git` precedent; a second view would be the reason to publish it.

The tab type is `available`, never default-on, at order 500 — a shell is something the person asks for, and the always-on seats stay with the surfaces that answer questions about the session.

## Alternatives considered

**Reusing the model's `ctx.terminals` registry.** It is entry-local to the agent preset's isolated group: the browser cannot reach it, and reaching it would put a person's shell in the model's registry, where a tool call could address it.

**Owning a PTY directly in the console package.** It would skip `terminal-bash`'s sandbox-mode fence and duplicate spawn, sandbox, scrollback, and teardown behavior that the PTY capability already owns.

**Server-Sent Events for output.** A second transport beside `/api/remote.mux` would need its own reconnect, generation, and backpressure handling for one panel.

**A per-request loopback check.** Remote methods receive no request facts and `HostConnectionService.trustedHosts` is private, so the check has no home at this layer; a configuration switch on the composition's own deployment fact is honest about where the decision is made.

**`@xterm/xterm` for rendering.** The client bundle's CSS virtual-id plugin cannot resolve its stylesheet entry, so it was refused rather than shipped unstyled.

**A session event for the byte stream.** It would put terminal output into the transcript the model reads, making the person's shell a model-visible input and contradicting the decision that this is the person's channel.

## Consequences

The console is reachable exactly where a composition mounted a `ctx.terminals` registry with a backend for `backendType`, and refused everywhere else as `terminal-console/unavailable`; a deployment that changes `backendType` must change it in both the backend row and the console row.

A shell that outruns the retained window receives whole-window replacements rather than appends, so the panel's cost per poll is bounded and its bandwidth is not: that is the price of reconnect correctness without a second stream protocol.

Long-running commands hold the PTY's single send slot, so further writes are refused as `terminal-console/busy` until the command settles or the shell is closed; human preemption of a running command is deferred, and `close` is the escape hatch.

There is no resize: the PTY seam fixes rows and columns at spawn and exposes no resize, so the panel offers no size control instead of an always-unsupported one.

Nothing is persisted. Reloading the page loses the text on screen and re-lists only what the session still holds, which is the same property that keeps the byte stream out of the session log.

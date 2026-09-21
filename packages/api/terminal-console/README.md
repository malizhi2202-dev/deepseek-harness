---
description: "The terminalConsole Remote namespace: the browser's shell console over the host PTY registry, for client consumers and host-composition maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-terminal-console

English | [中文](README.zh.md)

## Summary

`dsh-api-terminal-console` owns the `terminalConsole` Remote namespace: `open`, `list`, `write`, `close`, and the `output` stream, which together let the Web right sidebar run a shell in the session's workspace. The service is a **console seam over the PTY capability**, not a second PTY owner: `ctx.terminals` still spawns, confines, bounds, and reaps every shell, and this package adds only what a browser needs on top of it — a server-minted shell identity, a network-surface gate, and a bounded output stream.

Authority is the whole point of the seam. Every method takes `agent: Agent`, which the Gateway resolves from the Session identity on the wire, and a shell's identity is minted here and stored per session. A request that resolves to another session therefore finds no such shell, and the PTY session id never crosses the wire at all. The console appends nothing to the session log, and no typed byte reaches a model request: this is the person's channel, not the model's.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Client code calls the namespace through the Remote carrier the `dsh-api-remotes` client assembly already mounts; no plugin loads this package in the browser directly. `open` mints a shell, `list` reports the caller's live shells, `write` delivers one line-oriented input, `close` ends a shell, and `output` is a logical Remote stream of sanitized text frames ending in one exit frame.

A host composition mounts this endpoint beside a `ctx.terminals` registry that has a backend registered for `backendType`. The web application mounts its own PTY rows for that reason: the `minimal` preset's registry lives in an entry-local realm the browser cannot reach, and reusing it would hand the model's own shells to a panel.

## Understand the implementation

`src/types.ts` is wire vocabulary only, including the six declared error codes. `src/output-window.ts` is the fold that turns two successive bounded scrollback pages into one frame: an append when the new page still begins with everything already sent, and a whole-page replacement otherwise, because the backend's byte and line bounds can drop retained text from the head. Both branches are exact; neither guesses at a gap. `src/index.ts` is the service.

Three decisions there are worth naming. First, the PTY seam has no push stream, so `output` is a poll over `ctx.terminals.read` with `offset: 0` — the newest page — delivered as a logical Remote stream, which is the push and reconnect surface the browser carrier already owns. Second, `write` reports acceptance, never a command's result: it returns as soon as the shell took the input, and the output stream reports what happened. Third, `acceptReachableSurface` is the security default. A loopback listener is not isolated per local user and a `trustedHosts` authority is a reachability declaration rather than an authentication layer, so the console is refused until a composition states that it accepts a surface another device could reach.

<a id="model-experience"></a>
## Model Experience

None, as the namespace serves a browser panel over the PTY registry and registers no tool, prompt section, or session event.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **No full terminal emulation.** Output is sanitized text: no colors, no cursor addressing, no alternate screen, and no TUI. The panel says so rather than implying a terminal.
- **No resize.** The PTY seam fixes rows and columns at spawn; there is no `resize` method to expose, so the panel omits one instead of shipping an always-unsupported call.
- **Line-oriented writes with one exclusive send.** A long-running command holds the send slot until the PTY seam's readiness timeout, so further writes are refused as `terminal-console/busy` until it settles or the shell is closed. Human preemption of a running command is deferred.
- **A poll, not a push.** Frame latency is bounded below by `pollIntervalMs`, and a shell that outruns the retained window receives whole-window replacements rather than appends.
- **Refused on a reachable surface by default.** An install that adds a `trustedHosts` authority must set `acceptReachableSurface` deliberately, or the panel shows the refusal with no mint controls.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the service owns one relation — a shell id resolves only against the session that minted it — and its own suite denies a foreign session through `write`, `close`, and `output` rather than asserting service presence.

The PTY substrate is covered by `dsh-terminal` and `dsh-terminal-bash`. This package's suite drives the console over a registry double that keeps the real seam's owner scoping, newest-relative paging, and exclusive-send rule.

</details>

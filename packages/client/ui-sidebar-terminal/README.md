---
description: "The right Sidebar's terminal tab type: the person's own shell console, driven over the terminalConsole Remote namespace, for Web users and client-plugin maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-terminal

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar-terminal` registers `terminal` as a right-Sidebar tab type: an available page that mints a shell in the session's workspace and draws what it prints. It is the browser half of the console seam — the Host half is `dsh-api-terminal-console` — and it holds no PTY knowledge of its own: every shell is minted, bounded, and reaped server-side, and this panel only lists what the server reports, streams its text, and writes the lines the person types.

Two lines of its copy are the panel's honesty rather than chrome. The console is sanitized text, not a terminal: no colors, no cursor control, no full-screen programs. And it belongs to the person, not to the model: nothing here enters the session log, and nothing here becomes a model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the right Sidebar's guide page and pick **Terminal**, or open `terminal` from the type picker. The panel connects, mints one shell when the session holds none, and shows its text. **New terminal** mints another, the chips switch between them, **Close** ends the one on screen, and the input row submits one line at a time. A shell that exits keeps its final text on screen with the exit noted; a shell that is gone is dropped from the bar.

The type is `available`, never `default-on`: a shell is something the person asks for, and the right Sidebar's always-on seats belong to the surfaces that answer questions about the session. Its `order` of 500 follows the files, textpreview, and git pages.

An install that serves a surface a network can reach refuses the console, and the panel says so instead of offering controls that cannot work. The switch and its reasoning belong to `dsh-api-terminal-console`; this panel only draws the refusal.

## Understand the implementation

The file split is the layering: what the type IS (`definition.ts`), what it keeps (`store.ts`), how it drives the console (`face.ts`), what it draws (`TerminalBody.tsx`), what it says (`locales.ts`), and `index.ts`, which only wires them together.

The store keeps each tab's shells, the one on screen, and the text each has produced. It lives here rather than in a client object layer because this panel is its only consumer: a second view would be the reason to publish it, and there is none. What it holds is bounded by the server's frame bound, since every frame is either an append the seam sized or a whole-window replacement.

The face is where the console's contract is spent. `output` is consumed as a supervised logical stream, so a dropped carrier reconnects without the panel noticing, and the server marks the first frame of every generation as a replacement — a reconnected generation therefore replaces the view instead of appending a window the panel already holds. The tab's own signal ends the streams it opened, so a closed tab leaves no subscription behind. A refusal is drawn as its own state; a per-shell failure is drawn beside that shell; and every write is one submitted line, because the input row is the whole gesture.

## Model Experience

None, as the panel drives a Remote namespace owned by the person and registers no tool, prompt section, or session event.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **Sanitized text, not a terminal.** The panel draws pre-wrapped text: no colors, no cursor addressing, and no full-screen programs. It says so in the console rather than implying otherwise.
- **No resize.** The PTY seam fixes rows and columns at spawn and exposes no resize, so the panel has no size control to offer; the browser's own text wrapping is what the person sees.
- **One line at a time, one send at a time.** The input row submits a single line and is disabled while a write is in flight, because the seam accepts one exclusive send per shell. Pasting several lines is deferred.
- **Shells are not restorable.** The panel re-lists what the session holds when it opens; a shell minted in an earlier tab record is still there only while the session is. There is no reattach-to-a-named-shell gesture.
- **No transcript.** Nothing the console prints is persisted anywhere, so closing the tab or reloading the page loses the text on screen. That is the same decision that keeps the byte stream out of the session log.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the panel owns no cross-plugin relationship, and the one authority rule it depends on — a shell id resolves only against the session that minted it — is enforced and denied in `dsh-api-terminal-console`'s own suite.

The panel's suite mounts the body over a real store instance and a scripted console, drives frames, exits, carrier rejections, and unary answers by hand, and asserts what the reader sees and what reaches the namespace.

</details>

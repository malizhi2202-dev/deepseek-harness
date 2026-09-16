---
description: "Package map for the Tuitui (推推) IM bridge into DSH agent sessions."
kind: "package-group"
---

# tuitui/ — Tuitui IM chat driving DSH agent sessions

English | [中文](README.zh.md)

## Summary

The Tuitui family connects one Tuitui (推推) robot to DeepSeek Harness. Chat messages become agent turns; replies stream back through the Tuitui HTTP send API, and an interactive file-tree card exposes the workspace. The transport seam keeps the wire client behind an injectable interface so tests run without the real robot.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tuitui/`](tuitui/README.md) | WebSocket + HTTP transport, per-chat agent sessions, and the `/tree` workbench | — (function plugin, injects `agents` / `agentPresets` / `permissionPresets`) |

<a id="dev-note"></a>
## Dev Note

None.
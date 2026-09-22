---
description: "Package map for the application's Remote layer: typed Client-to-Host capability calls, results, and forwarded events, for users and maintainers navigating the group."
kind: "package-group"
---

# api/ — Remote API layers

English | [中文](README.zh.md)

## Summary

The `api/` group provides the application's Remote layer: a Client environment can call the business capabilities running on the Host — manage goals, run commands, list the plugin inventory, discover file and session references — as typed method calls, and receive the results or forwarded Host events. `remotes` decides which capabilities are exposed and how each call reaches the right session's agent; `gateway` carries the calls and their results between Client and Host. The stack runs over the application's shared Connection; streaming session data is deliberately outside it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The packages below provide the Remote layer; the package READMEs own the exhaustive contracts.

| Package | Role | ctx key |
|---|---|---|
| [`remotes/`](remotes/README.md) | Chooses which Host capabilities and events the Client can consume. | — |
| [`gateway/`](gateway/README.md) | Carries typed unary calls, multiplexed streams, and forwarded Host events. | `ctx.typertGateway` / `ctx.remote` |
| [`session-controller/`](session-controller/README.md) | Owns Session commands, history streams, live control state, and Agent/Session identity policy. | `ctx.sessionController` / `ctx.remote.session` |
| [`settings-controller/`](settings-controller/README.md) | Owns the configuration-surface reads and writes over the settings-domain seams. | `ctx.settingsController`, `ctx.credentialsController` / `ctx.remote.settings`, `ctx.remote.credentials` |
| [`workspace-controller/`](workspace-controller/README.md) | Owns Workspace mutations and the complete Client Workspace projection. | `ctx.workspaceController` / `ctx.remote.workspace` |
| [`workspace-files/`](workspace-files/README.md) | Owns bounded workspace file access — `stat`, paged `read`, `list`, and the agent-write `changes` feed — and the Client `file` resource provider over it. | `ctx.workspaceFiles` / `ctx.remote.workspaceFiles` |
| [`workspace-git/`](workspace-git/README.md) | Owns the bounded read of the repository containing the session workspace, for the Web git panel. | `ctx.workspaceGit` / `ctx.remote.workspaceGit` |
| [`workspace-automation/`](workspace-automation/README.md) | Owns the `workspace` Remote namespace's automation-ledger read: `automationLedger(workspaceId)` projects the automation runtime's run ledger for one workspace. | `ctx.workspaceAutomationLedger` / `ctx.remote.workspace` |
| [`terminal-console/`](terminal-console/README.md) | Owns the browser-facing shell console over the host PTY registry: server-minted shell identity, the network-surface gate, and a bounded output stream. | `ctx.terminalConsole` / `ctx.remote.terminalConsole` |
| [`channels/`](channels/README.md) | Owns the `channels` Remote namespace: `status` reads every registered channel, `probe` tests one channel's credentials by building a client, and `enable`/`disable` move one binding. | `ctx.channels` / `ctx.remote.channels` |
| [`sources/`](sources/README.md) | Owns the `sources` Remote namespace: `status` reports every remote-resource instance this Host serves, and `probe` tests one instance against the settings and credentials its provider resolved. | `ctx.sourcesPanel` / `ctx.remote.sources` |

Remote calls run Client → Host over the application's shared Connection. API Gateway owns Remote transport, while the controller packages own Session, configuration-surface, and Workspace behavior. Feature packages register exact Connection Fetch routes for responses that do not fit Remote invocation, such as streamed downloads.

-----

<a id="related-documentation"></a>
## Related documentation

Start with the API Gateway reference to see the Remote model end to end, then the Typert subsystem page for the shared definitions and Connection for the physical carrier.

- [API Gateway reference](../../docs/api-gateway.md) — the current-state reference for the Typert API Gateway: programming model, generation pipeline, and runtime invocation.
- [Typert subsystem reference](../../docs/subsystems/typert.md) — the public contracts shared by protocol, Gateway, and consumer assemblies.
- [Connection](../client/connection/README.md) — the RPC carrier, `/api` trust fence, and response envelopes behind every Remote call.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

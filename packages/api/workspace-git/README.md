---
description: "The workspaceGit Remote namespace for client consumers reading the session workspace's repository, and for maintainers of the host endpoint."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-git

English | [中文](README.zh.md)

## Summary

`dsh-api-workspace-git` owns the `workspaceGit` Remote namespace: one method, `observe`, that reads the git repository containing the calling session's workspace root and answers the seam's bounded snapshot. The host endpoint resolves the workspace root from the session through the sandbox policy, so the client never names a directory; the seam's failures cross the wire as two declared codes — `workspace-git/unavailable` when git cannot be run on the host, `workspace-git/failed` when an observation that ran failed — and "not a repository" is not an error but the `absent` answer. Loading the package's client-side generated remote (`workspaceGitRemote`) into `ctx.remote.$mount` makes `ctx.remote.workspaceGit.observe` callable in the browser.

**Status: a bounded-lifetime temporary artifact.** The namespace serves only the in-tree git panel and is replaced by an upstream git plugin once the version-line migration lands.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Client code calls the namespace through the Remote carrier the `dsh-api-remotes` client assembly already mounts; no plugin loads this package in the browser directly. A call passes the session id and an optional cancellation signal, and receives the observation as a Remote result — a failed call rejects with a `RemoteError` carrying one of the two declared codes.

Host compositions that want the endpoint mount the package beside a `ctx.git` provider (such as `dsh-git-local`); the endpoint injects both `git` and `sandboxPolicy`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` re-exports the seam's vocabulary from [`dsh-git`](../../git/git/README.md) rather than restating it, so the wire type and the host's answer are one declaration; it also declares the two error codes in the protocol's details map. `src/index.ts` is the endpoint: a `TypertRemoteService` whose single `@Remote observe` resolves the workspace root and delegates to `ctx.git`, mapping seam failures to the declared codes by the stable `code` field — never by class identity, because the `GitError` class belongs to whichever `dsh-git` instance the provider loaded. The namespace carries the observation as a direct Remote method, not a resource: a resource is a current-value stream, and the bounded history this panel draws is not addressable state.

<a id="model-experience"></a>
## Model Experience

None, as the namespace is a client-facing read registering no tool, session event, or request input.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **Read-only.** The namespace exposes `observe` only; repository mutation belongs to the upstream git plugin that replaces it.
- **One session, one repository.** The endpoint observes the calling session's workspace root; there is no cross-session or workspace-wide view.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the endpoint is a thin delegation whose mapping is pinned by its own suite against a scripted seam.

</details>

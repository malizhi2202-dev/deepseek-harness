---
description: "The ctx.git observation service contract for deployments choosing or mounting a repository observer and developers implementing one."
kind: "package-reference"
---

# @deepseek-ai/dsh-git

English | [中文](README.zh.md)

## Summary

`dsh-git` defines the `ctx.git` repository observation service: one bounded, read-only read of the repository that contains a working directory — its HEAD state, local branches, bounded commit history, and worktree changes — or the explicit answer that no repository contains it. The seam observes; it never mutates: there is no checkout, commit, push, or pull anywhere in its vocabulary. A composition mounts one provider (such as `dsh-git-local`) that registers the service; this package is the abstract contract, not a loadable plugin. Nothing here reaches a model: the vocabulary is drawn by the Web client's git panel, and no session event, resource claim, or request input names it.

**Status: a bounded-lifetime temporary artifact.** The in-tree panel this seam feeds is replaced by an upstream git plugin once the version-line migration lands; the seam and its consumers are retired with it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

You rarely load `dsh-git` directly: you mount a provider that registers as `ctx.git`, then call `observe` from a consumer. The one method takes a working directory and the caller's cancellation signal, and answers one discriminated value: `absent` when no repository contains the directory as a work tree (including a bare repository, or one too broken to name its work tree), or `repository` carrying the snapshot. Failure vocabulary is two stable codes on `GitError` — `GIT_UNAVAILABLE` when git itself could not be run, `GIT_COMMAND_FAILED` when a command that ran failed past those two — and discrimination is by the `code` field, never by class identity.

### The one bound

`MAX_OBSERVATION_ITEMS` (200) caps the snapshot's history depth, branch list, and worktree entry list together — one safety constant, the `MAX_LINEAGE_DEPTH` precedent from `ui-sidebar-agents` — so a very large repository can never be pulled without limit. Each list carries its own `*Truncated` flag, so a cut is visible as a cut.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` holds the whole vocabulary (the `GitError` class follows the `FsError` precedent); `src/index.ts` declares the abstract `GitObserver` service and the bound. The observation is a current-value read, not a subscription: the caller asks and receives one answer, and freshness is the caller's reload gesture. That is also why the seam is not a resource: a resource is a current-value stream, and the bounded history this panel shows is not addressable state.

<a id="model-experience"></a>
## Model Experience

None, as the seam registers no tool, session event, resource, or request input; its one consumer is the user-facing Web panel.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **Read-only by design.** No write operation will be added on this seam; repository mutation belongs to the upstream git plugin that replaces it.
- **One bounded read, not a subscription.** The panel re-reads on its reload gesture; there is no file-watcher or push notification.
- **Local work tree only.** Remote-tracking facts appear only as far as `git status` reports them locally; there is no network fetch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: independent observations of the same repository are not compared anywhere, so the ownership rule for `./invariant` does not apply.

</details>

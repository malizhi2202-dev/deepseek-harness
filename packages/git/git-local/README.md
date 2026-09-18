---
description: "The host-local provider for ctx.git for deployments and maintainers choosing or debugging repository observation on this machine."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-local

English | [中文](README.zh.md)

## Summary

`dsh-git-local` implements the `ctx.git` observation contract ([`dsh-git`](../git/README.md)) on the host machine: loading it as a plugin populates `ctx.git` with real repository reads. One observation runs four read-only git commands through the shared no-shell runner (`runNativeCommand`) — `rev-parse --show-toplevel` to find the work tree, then `status --porcelain=v2 --branch -z`, `for-each-ref`, and a bounded `log -n` from the root — so every path the snapshot carries is root-relative, and `--no-optional-locks` keeps `status` from taking the index lock an opportunistic refresh would take. Nothing here writes to the repository. Choose it when the workspace lives on this machine's filesystem.

**Status: a bounded-lifetime temporary artifact.** This provider is replaced by an upstream git plugin once the version-line migration lands, and is retired with the seam it serves.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider when a composition needs `ctx.git` backed by the machine's own git. There is no configuration: the provider reads whatever git finds from the directory each call names, and the seam's single bound (`MAX_OBSERVATION_ITEMS`, owned by `dsh-git`) caps every list the snapshot carries.

```yaml
- name: '@deepseek-ai/dsh-git-local'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Every classification rides git's exit code, not its stderr: the messages are localized, while the codes are git's stable machine vocabulary. Exit 128 from the toplevel probe — outside any repository, inside a bare one, or a repository too broken to name its work tree — is the `absent` answer, because no repository contains the directory as a work tree. The runner has no working-directory option, so each command names its directory through git's own `-C` argument. A cancelled read rejects with its own abort reason rather than a git failure, because the caller chose to stop. `src/parse.ts` holds the pure parsers for the three machine-readable outputs; each is total over its command's documented format and throws on an undocumented record shape, except the porcelain headers the seam does not read (such as `# stash`), which are ignored so a newer git adding one stays readable.

<a id="model-experience"></a>
## Model Experience

None, as the provider registers no tool, session event, or request input; its output feeds the user-facing Web panel only.

#### KV Cache effect

None; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **One git, one machine.** The provider shells out to the `git` on `PATH`; a host without it answers `GIT_UNAVAILABLE`, and there is no bundled fallback.
- **History depth capped by the seam.** `log -n` reads one commit past the bound to report truncation exactly, and no paging follows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the provider's answers are checked against scripted command output in its own suites, not against a second live observation.

</details>

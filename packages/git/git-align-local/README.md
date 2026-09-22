---
description: "The host-local ctx.gitAlign provider for deployments aligning repositories on the machine running the harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-align-local

English | [中文](README.zh.md)

## Summary

`dsh-git-align-local` is the host-local provider for `ctx.gitAlign`. It runs the machine's own git through the shared no-shell runner, so no operation ever builds a shell string. Every command is bounded by a configurable timeout, because the runner has no timeout and no output cap of its own, and every read uses a compact machine-readable form (`--numstat -z`, `--name-only -z`, count-free listings) that never carries a full patch.

Conflict probing prefers `git merge-tree --write-tree`, which builds the merged tree in the object database without touching the work tree, and falls back to an isolated `git worktree` when that command refuses its flags. The choice is made by running the command and reading its exit status, never by inferring a capability from a version number.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider where a repository is aligned on this machine. Its configuration has one field, `commandTimeoutMs` (default 60000, minimum 1000): the bound one git command may run before it is aborted.

`probe` never modifies the target: the merge-tree path only writes objects, and the fallback path creates its scratch worktree under the `worktreeRoot` the caller supplies, then removes and prunes it. A probe that cannot remove its scratch tree reports failure rather than a conflict list, so a stale registration cannot be mistaken for an answer.

`commit` contains exactly the supplied paths. Because `git commit -- <paths>` refuses a path git does not know yet, a new file is first recorded with `git add --intent-to-add`; that records the path only, stages no content, and names no path outside the set. If the commit then fails, the provider rolls the index entry back and reports whether the rollback succeeded.

`ignoredPaths` runs `git check-ignore` with `core.quotePath=false` and reduces its output to the paths the caller named, because `check-ignore -z` is meaningful only together with `--stdin`, which a no-shell runner cannot provide.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/parse.ts` holds the pure decoders — exit-status extraction, the numstat, merge-tree, NUL-separated, and newline-separated readers, the conflict-list bound, and the commit-path guard. `src/index.ts` holds `LocalGitAligner`, which builds argv, composes the caller's signal with its own timeout, and classifies what came back. The process boundary is injectable through `internals.run` for tests; production uses `runNativeCommand`.

The provider is the provider role of the `ctx.gitAlign` seam; the abstract contract lives in `dsh-git-align`.

<a id="model-experience"></a>
## Model Experience

### No model-visible surface

#### What the model sees

None. The provider registers `ctx.gitAlign` and nothing else: no tool, prompt section, or session event, and its answers reach only the consumer's ledger.

#### Token effect

None. No command output is rendered into a model request; the provider returns decoded facts to its caller.

#### KV Cache effect

None. Nothing here contributes a request prefix, a message, or a tool schema.

## Known Limitations and Deferred Work

- **One git, one machine.** The provider runs the `git` on `PATH`; a host without it answers `git-unavailable`, and there is no bundled fallback.
- **A fetch that would prompt is bounded, not answered.** Credential prompting cannot be disabled through this runner, so an interactive fetch is aborted by `commandTimeoutMs` and recorded as a failed fetch rather than hanging the run.
- **Newline-separated ignore output.** `check-ignore -z` needs `--stdin`, which the no-shell runner cannot provide, so a path git quotes or wraps is dropped instead of reported.
- **Intent-to-add is an index entry.** A refusal after a facts read can leave an intent-to-add entry for an attributed path; `commit` rolls its own entry back when the commit fails, and nothing else writes the index.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the provider's answers are checked against scripted command output and against a live repository in its own suites, not against a second live observation.

</details>

# Agent Note: Guard repo-file glob discovery against symlink descent

Status: implemented

English | [中文](2026-09-16-repo-files-glob-symlink-enotdir.zh.md)

## Problem

`uniqueRepoFiles` (scripts/repo-files.ts) expands repository-relative glob patterns with Node's `globSync`. A `**` pattern that reaches a symlink to a file — such as `snapshots/acp/image-compaction/system-prompt.expected.md -> ../../session/read-image/system-prompt.expected.md` — makes `globSync` try to read inside that symlink as a directory and raise `ENOTDIR`, crashing `verify-md-wrap` and any other gate that shares the helper. The same real file is reachable through its canonical path, so the intended behavior is to deduplicate through `realpathSync`, but the glob fails before deduplication runs.

## Decision

`uniqueRepoFiles` passes an `exclude` predicate to `globSync` that returns true for a path that is a symlink resolving to a non-directory (`lstatSync(abs).isSymbolicLink() && !statSync(abs).isDirectory()`). This stops `**` recursion from descending into a symlink to a file while leaving symlinks to directories and regular files to the glob, and the existing `realpathSync` deduplication still collapses any symlinked file to its one canonical target.

## Alternatives considered

**Exclude every symlink (`lstatSync(abs).isSymbolicLink()`).** Simpler, but broader than the failure: it would also refuse traversal of a symlink to a directory, which this version of `globSync` does not follow anyway. The narrower predicate states exactly the case that is invalid to descend into.

**Catch `ENOTDIR` around the glob and retry without the offending path.** Working around the exception couples the helper to one filesystem error and would still need to know which path to drop; the `exclude` predicate is the supported API for refusing traversal.

**Replace `globSync` with a manual `readdirSync` walk that never follows symlinks.** More code and re-implements glob semantics the helper gets for free; not justified by one traversal case.

## Consequences

`verify-md-wrap`, `verify-package-paths`, `verify-md-links`, and `verify-doc-refs` no longer crash on a symlink-to-file under a `**` pattern, and still process the symlink's real target exactly once. A `repo-files.spec.ts` regression case builds a symlink-to-file under a `**` pattern and asserts one deduplicated entry pointing at the canonical file, plus a guard that regular files are not dropped by the exclude predicate.

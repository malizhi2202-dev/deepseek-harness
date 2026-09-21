# Agent Note: Editing a Workspace File from the Right Sidebar

Status: implemented

English | [中文](2026-09-21-sidebar-file-editing.zh.md)

## Problem

The right Sidebar's text tab showed a workspace file and nothing else. A user who spotted a wrong line while reading had to leave the harness, find the file on disk, and edit it there — while the harness was already showing the exact text, the exact path, and the exact Session whose workspace root resolves it. The read half of that loop existed; the write half did not.

Adding one raises a question the read half never had to answer: two writers now touch the same file. An Agent writing the file while the user is typing must not have its work silently deleted, and the user's typed text must not be silently deleted either.

## Decision

The write enters as one method on the namespace that already owns the file ([`dsh-api-workspace-files`](../../../../packages/api/workspace-files/README.md)), and the existing viewer ([`dsh-client-ui-sidebar-textpreview`](../../../../packages/client/ui-sidebar-textpreview/README.md)) grows an edit mode. No new tab kind, no new package.

**`workspaceFiles.write(path, content, expectedVersion)` is the one mutation.** It replaces the file's whole text and returns the written file's `WorkspaceFileStat`, so the caller learns the new version without a second `stat`. `expectedVersion` is the `version` the caller read — normally the one a page or a `stat` carried — and it is the entire concurrency story: the service compares it against a fresh `stat` and refuses with a new `workspace-file/stale-version` code when they differ, and hands the same value to the backend's atomic replace, which re-checks it inside the write. A caller therefore never mints a version; it echoes one it was given, and a version the service manufactured for the caller would defeat the guard it exists to provide. The Client renders that one code as "the file changed on disk, so your edit was not saved" and offers a reload beside it.

**The save does not go through `fs/write-intent` or `fs/edit-intent`.** Those waterfalls and the read-before-edit policy they feed are dispatched by the Agent's own filesystem tools, not by the provider or by any service, and the policy derives its owner from an execution context this path does not have. Its documented answer for an actor with no recorded observation of the file is `createIfAbsent`, which the provider refuses for an existing file — so routing a human save through the waterfall would make every overwrite impossible, not safer. The explicit `expectedVersion` argument is the seam for a caller that is not a tool, and it enforces the same fact the policy derives from a present observation at that version, in the same atomic section. The save is fenced by the addressed Session's sandbox policy, which the service passes with the write, so a Session that may not write its workspace cannot save either.

**Nothing is emitted after the write.** `fs/observed` is the Agent Session's read record; recording a human save would let the Agent overwrite a file it never read, and would raise the saver's own change bar against their own write.

**Editing is offered only for a file the viewer holds whole.** The editor writes the whole file back, so a file read in several pages has lines the viewer never loaded and a save of the pages it did hold would delete them. The viewer refuses that file — and a file still being read, and one whose read failed — with a sentence naming the reason, rather than completing the read on demand: the alternative makes the edit button's meaning depend on an asynchronous read that may itself fail, and the refusal is one state instead of a second flow.

**The trailing newline is reconstructed, not guessed.** A page joins its lines with `\n` and drops the last line's terminator, so page text alone cannot tell `a` from `a\n`. The store keeps the byte size the Host reported for the file and compares it with the page text's own UTF-8 length: equal means nothing was dropped, unequal means one newline goes back. `TextEncoder` measures it because `Buffer` does not exist in the browser. A Host that reports no size leaves the text as read, which is the honest degradation.

**A refusal keeps the reader's text.** The draft — baseline, current text, and the version it was read at — lives in the tab's store bucket, so the editor survives the store's re-renders and the failure path has somewhere to leave the text untouched. A save is disabled while it is in flight and when nothing changed from the baseline, so a no-op save is not offered rather than issued and ignored. Reload drops the draft along with the pages, because the pages it brings back are a different version and the draft's save would be refused anyway.

## Alternatives considered

**Editing a page or a line range instead of the whole file.** A partial write needs a patch vocabulary on the wire (offset, length, expected content) and a merge story when the range moved; the whole-file replace needs one version and one string. The paged read exists to bound memory on large files, and an edit scope of "one file the viewer already holds whole" keeps that bound honest: the viewer never holds more than the Host's page cap, and the write is capped by the same `maxBytes`.

**Auto-loading the remaining pages when the user clicks Edit.** It makes the button work on every file, at the cost of a second asynchronous flow inside the edit gesture — a progress state, a failure state, and a decision about what the button does when the load fails. The refusal is one render and one sentence.

**Optimistic concurrency by `mtime` or size.** Both are coarser than the backend's version token and both are already the same value's inputs; the service would be re-deriving a token the filesystem seam publishes.

**Routing the save through the Agent's write tool or its waterfalls.** Covered above: the policy's contract for a non-tool actor makes it unusable for an overwrite, and reaching for a fabricated Session actor would be working around a gate rather than through it.

**A new tab kind for the editor.** The tab system keys content identity to the address, and an editor for the same file is the same content in a different mode. A second kind would give one file two tabs that disagree about its text.

## Consequences

The Sidebar can now close the loop it opened: read a file, fix a line, save it, and see the result without leaving the harness. The failure modes are all visible rather than silent — a stale version, an oversized write, a file too partial to edit, a Session that may not write — and each one says what happened while keeping the user's text.

Three limits are recorded in the package READMEs rather than solved here: the write is whole-file only (no patch, append, or range write), a file read in several pages cannot be edited at all, and closing a tab with a draft discards it without asking. Each is a real gap a future change can close, and none of them can lose data that was already on disk.

The version guard is the file's own `FsVersion`, so nothing new is stored: the write is the same guarded replace the Agent's tools perform, reached through the seam a non-tool caller has. Any later mutation this service grows should reuse it rather than inventing a second concurrency token.

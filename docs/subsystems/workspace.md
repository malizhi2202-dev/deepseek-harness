# Workspaces

English | [中文](workspace.zh.md)

A workspace is the persistent record of a directory the user works in: a stable id over a canonical path, a display title, and the ordered account of sessions that belong to it. The subsystem is host-side, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). Its registry package is [`dsh-workspace`](../../packages/workspace/workspace) (`ctx.workspaceRegistry`), which stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Three further packages act on a workspace's checkout: [`dsh-git-align`](../../packages/git/git-align) declares the alignment service `ctx.gitAlign`, [`dsh-git-align-local`](../../packages/git/git-align-local) provides it with the machine's own git, and [`dsh-workspace-automation`](../../packages/workspace/workspace-automation) runs one timer per workspace that aligns the branch and commits one turn's attributable work, reading through `ctx.git` and summarizing through `ctx.workSummary`. No operation in either service writes to a remote, so pushing a commit stays a human decision. Design records: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md); alignment and automatic commit: [per-workspace git alignment and automatic commit](../../.agents/notes/implemented/architecture/2026-09-22-workspace-git-alignment-and-automatic-commit.md).

Sources: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts), [`packages/git/git-align/src/types.ts`](../../packages/git/git-align/src/types.ts), [`packages/workspace/workspace-automation/src/types.ts`](../../packages/workspace/workspace-automation/src/types.ts), [`packages/api/workspace-automation/src/types.ts`](../../packages/api/workspace-automation/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon.

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd — but membership requires both: an id on the account and a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one workspace. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` requires a fully qualified path, canonicalizes it, rejects a nonexistent path (the original `ENOENT`) or a non-directory, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? defaultWorkspaceTitle(path)` prepended to the durable registry order (different canonical paths may share a display title, and a path with no final segment uses its root spelling). `get(id)` and the ordered `list()` are synchronous cache reads; `resolveByPath(path)` applies the same fully qualified realpath canon without creating. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, and persisted logs are never touched, so those sessions become Ungrouped ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway resolves a new session's cwd from the chosen workspace's `path` (falling back to an explicit or default cwd), creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`.

## Repository alignment: `ctx.gitAlign`

`ctx.gitAlign` is the write-capable service for a repository work tree, beside the read-only `ctx.git` observation service that the [Cordis API](#ctxgit--gitobserver-abstract-seam) section carries. [`dsh-git-align`](../../packages/git/git-align) declares the operations a scheduled alignment run needs, and [`dsh-git-align-local`](../../packages/git/git-align-local) implements them with the machine's own git through the shared no-shell runner. Three operations are absent by construction: there is no push, no rebase, and no history rewrite, and no operation takes a remote destination. `resolve` turns observed coordinates into an `AlignSpec`, splitting the tracked branch's short spelling once so no later operation re-derives it.

```ts type-equiv
/**
 * Raw coordinates of one alignment target, as the consumer observed them.
 *
 * `upstream` is git's short spelling of the tracked branch (`origin/main`); the
 * provider splits it into a remote and a ref name in {@link AlignSpec}.
 */
interface AlignRequest {
  /** Absolute directory of the repository work tree; travels as git's own `-C` argument. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling, such as `origin/main`. */
  readonly upstream: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}
```

```ts type-equiv
/**
 * One resolved alignment target: the request plus the remote and ref name a
 * fetch names, derived once by the provider so no operation re-derives them.
 */
interface AlignSpec {
  /** Absolute directory of the repository work tree. */
  readonly root: string
  /** The checked-out branch's short name observed at run start. */
  readonly branch: string
  /** The tracked branch's short spelling. */
  readonly upstream: string
  /** Remote the upstream ref lives on. */
  readonly remote: string
  /** Ref name the fetch asks that remote for. */
  readonly refspec: string
  /** Full object id HEAD pointed at when the run started. */
  readonly expectedHeadOid: string
}
```

Every other operation answers a discriminated value instead of throwing for an expected git failure, because the consumer records the answer in a durable ledger and never retries it inline. `fetch` answers `fetched` or a failure; `probe` answers `clean`, a bounded conflict report, or a failure, and must not modify the target work tree, its index, or its refs; `changeFacts` and `ignoredPaths` answer facts or a failure; and `pushedToRemote` answers whether any remote-tracking ref already contains a commit. A caller cancellation is not a git outcome: it rejects with the caller's own abort reason.

```ts type-equiv
/** One bounded git failure: a code, plus a diagnostic that carries no repository content. */
interface GitAlignFailure {
  /** Which bound or boundary produced the failure. */
  readonly code: GitAlignFailureCode
  /** Short diagnostic naming the git command and its own exit status. */
  readonly detail: string
}
```

Failure discrimination is by `code` and never by class identity. `timeout` means the provider's own bound ended the command, `git-unavailable` means the process never ran, and `command-failed` means a command ran and exited non-zero.

```ts type-equiv
/**
 * The answer to one alignment write.
 *
 * The aligned case carries no object id: the consumer re-observes HEAD through
 * `ctx.git` after every write, and that observation is the single authority for
 * what HEAD became.
 */
type ApplyResult =
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'merge-failed'; readonly failure: GitAlignFailure }
  | { readonly kind: 'merge-failed-dirty'; readonly failure: GitAlignFailure }
```

`merge-failed-dirty` means the attempt's own merge could not be rolled back, so the work tree is left for a human rather than reported as a clean refusal. Alignment reaches the upstream by fast-forward or merge only, according to the requested strategy.

```ts type-equiv
/**
 * The answer to one commit attempt. The created commit's identity is read from
 * the post-write HEAD observation the consumer performs regardless, so this
 * answer states only that a commit landed.
 */
type CommitResult =
  | { readonly kind: 'committed' }
  | {
    readonly kind: 'failed'
    readonly failure: GitAlignFailure
    /** Whether the index mutation this attempt made was rolled back. */
    readonly indexRestored: boolean
  }
```

`commit` contains exactly the paths it is given, and an empty path set is refused rather than interpreted, because a pathless git commit would commit the whole index. A new path is recorded in the index before the commit so git accepts it, and a failed commit reports whether that index entry was rolled back.

## Scheduled automation: `ctx.workspaceAutomation`

[`dsh-workspace-automation`](../../packages/workspace/workspace-automation) owns one timer per workspace and two jobs on it. The alignment job observes, decides, fetches, re-observes, probes, and then either reports what it found or advances the branch. The commit job runs at a closed turn boundary: it derives the paths that turn's own tool calls proved they wrote, screens their bounded prefixes for credentials, summarizes them through `ctx.workSummary`, and creates one commit. Both jobs reach git through `ctx.gitAlign` for writes and `ctx.git` for reads, and neither spawns a process.

Each run is one transaction: acquire a stored lease, act, record exactly one ledger entry with a closed outcome, release the lease, and re-arm the timer. The lease is stored rather than held in memory, so a second process reading the same domain sees it, and a run that finds it held records `skipped-locked` and touches nothing. The timer stores its next run as an absolute instant rather than an interval start, because the stored state is the only thing a restarted process can read; backoff, conflict cooldown, and the normal interval all write that one field. A workspace is suspended after the configured number of consecutive failures, and a non-failure outcome clears the backoff and the cooldown.

Attribution is proven rather than inferred: a path counts as this turn's work only when the turn holds a `tool/call` for a writing tool whose arguments name the path and a matching `tool/result` reporting no error. A missing result, a failed result, and a call from another turn are all excluded, so a file a shell command wrote is never attributed, and a path an earlier uncommitted turn also wrote is refused as ambiguous rather than committed twice.

```ts type-equiv
/**
 * The closed outcome of one run. `no-op` and `refused` are correct answers, not
 * failures; only `failed` and `suspended` advance the failure backoff.
 */
type AutomationOutcome =
  | { readonly kind: 'no-op'; readonly reason: NoOpReason }
  | { readonly kind: 'aligned'; readonly strategy: AlignStrategy }
  | { readonly kind: 'committed'; readonly sessionId: string; readonly turn: number }
  | { readonly kind: 'conflicted'; readonly paths: readonly string[]; readonly total: number }
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly paths: readonly string[] }
  | { readonly kind: 'ambiguous-attribution'; readonly paths: readonly string[] }
  | { readonly kind: 'skipped-locked' }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly reason: FailureReason; readonly detail: string }
  | { readonly kind: 'suspended'; readonly reason: string }
```

A `no-op` names why the run correctly did nothing — the branch was up to date, no repository or upstream was found, the mode observes only, a downstream verifier already covers the advance, there were no attributable paths, or the work was already committed. A `refused` names why the run declined to act: a detached HEAD, a dirty work tree under the configured policy, a candidate matching a credential shape, a colocated version-control workspace, more paths than one commit may carry, an unattributable remainder, or an unreadable path. A `superseded` run observed HEAD move between its own reads and wrote nothing.

```ts type-equiv
/** What one created commit was, and how a human withdraws it. */
interface CommitReport {
  /** Created commit id. */
  readonly oid: string
  /** Parent commit id. */
  readonly parentOid: string
  /** Paths the commit contains, and no others. */
  readonly paths: readonly string[]
  /** Accepted subject line. */
  readonly subject: string
  /** Accepted body lines, empty when the message has none. */
  readonly body: readonly string[]
  /** Whether a provider or the mechanical fallback supplied the message. */
  readonly summarySource: string
  /** Every summary consultation note. */
  readonly summaryNotes: readonly string[]
  /** Bytes the credential screen read. */
  readonly scanBytes: number
  /** Whether no remote-tracking ref contains the commit yet. */
  readonly withdrawable: boolean
  /** Withdrawal command that keeps the changes staged. */
  readonly softReset: string
  /** Withdrawal command that keeps the changes in the work tree only. */
  readonly mixedReset: string
}
```

Withdrawal is non-destructive: the two recorded reset commands keep the commit's content, and no `--hard` form is reported. A commit carries the `Dsh-Unit: <sessionId>/<turn>` trailer `ctx.workSummary` reserved, so a human who later pushes it can attribute it to the work unit that produced it.

```ts type-equiv
/** One retained run record; the ledger is the authoritative record. */
interface RunRecord {
  /** Stable record id. */
  readonly id: string
  /** Job this run belonged to. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** Closed outcome. */
  readonly outcome: AutomationOutcome
  /** HEAD recorded before the first write of the run, when observed. */
  readonly expectedHeadOid: string | null
  /** Upstream commit id the run observed. */
  readonly observedUpstreamOid: string | null
  /** Baseline before the run. */
  readonly baselineBefore: string | null
  /** Baseline after the run. */
  readonly baselineAfter: string | null
  /** The commit this run created, when it created one. */
  readonly commit: CommitReport | null
}
```

The runtime's durable state is one `workspace_automation` storage-domain record per workspace, `AutomationStateRecord`: the aligned baseline's upstream and local commit ids and its branch, the last run's finish time and outcome, the consecutive-failure count, the earliest instant the next run may act, the suspension reason, the lease's owner and expiry, the last committed turn per session, the paths the last commit job left uncommitted, and the retained runs. The record is the authority; the ledger is a bounded view of it.

## The automation ledger: `ctx.workspaceAutomationLedger`

[`dsh-api-workspace-automation`](../../packages/api/workspace-automation) projects one workspace's stored ledger to a client over the `workspace` Remote namespace as `automationLedger`; its README owns the projection's bounds and known limitations. It owns no fact of its own: every value is copied from a stored run record, from the stored state, or from a run's commit record. A workspace the runtime stores nothing for is a normal answer rather than an error, because the timer may never have run there. The run bound and the path bound are validated configuration, and the ledger's own counts travel beside each bounded list so a truncated list is never mistaken for the whole.

```ts type-equiv
/** One retained run, answering the four questions the design requires of every run. */
interface AutomationRunView {
  /** The ledger record's id. */
  readonly id: string
  /** Which job ran. */
  readonly job: AutomationJob
  /** What asked for the run. */
  readonly trigger: RunTrigger
  /** Run start, ISO-8601. */
  readonly startedAt: string
  /** Run end, ISO-8601. */
  readonly finishedAt: string
  /** What the run compared. */
  readonly comparison: AutomationComparison
  /** What the run did, or why it did not act. */
  readonly outcome: AutomationRunOutcome
  /** What happens next. */
  readonly nextStep: AutomationNextStep
  /** The commit the run created; present only when it created one. */
  readonly commit?: AutomationCommitView
}
```

A run view answers the four questions a reader has about it: what it compared, what it did or why it did not act, where a conflict is, and what happens next. `nextStep` is one tag per outcome, so the next move is readable without knowing the run's internals.

```ts type-equiv
/**
 * One ledger read. A workspace the runtime stores nothing for is a normal
 * answer rather than an error: the timer may never have run there.
 */
type AutomationLedgerView =
  | { readonly kind: 'unrecorded'; readonly workspaceId: WorkspaceId }
  | ({ readonly kind: 'recorded' } & AutomationRecordedView)
```

## Consumers

[`dsh-api-workspace-controller`](../../packages/api/workspace-controller) serves workspace CRUD to GUI clients over `ctx.workspaceRegistry`, [`dsh-api-workspace-git`](../../packages/api/workspace-git) serves the bounded repository read of `ctx.workspaceGit`, and [`dsh-api-session-controller`](../../packages/api/session-controller) performs the create-session-then-attach flow above. [dsh-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxgit--gitobserver-abstract-seam"></a>

### `ctx.git` — `GitObserver` (abstract seam)

Abstract git observation service. Subclass, implement observe, and load the subclass as a plugin — it registers as `ctx.git` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- observe resolves `absent` for a directory outside any git work tree; that is an answer, not a failure.
- Every list in the snapshot is cut to MAX_OBSERVATION_ITEMS with its truncated flag set when the bound dropped entries.
- `signal` aborts the read; an aborted read rejects with the abort reason.
- Nothing in the implementation writes to the repository.

```ts cordis-catalog
/**
 * Observe the git repository that contains one working directory.
 * @param cwd - the directory to observe from; the repository's work-tree root
 *   is whatever git reports for it, not necessarily the directory itself.
 * @param signal - caller cancellation.
 * @returns the repository's bounded snapshot, or `absent` outside any work tree.
 */
abstract observe(cwd: string, signal: AbortSignal): Promise<GitObservation>
```

Source: [`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)

<a id="ctxgitalign--gitaligner-abstract-seam"></a>

### `ctx.gitAlign` — `GitAligner` (abstract seam)

Abstract git alignment service. Subclass it, implement every operation, and load the subclass as a plugin — it registers as `ctx.gitAlign` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Every operation resolves a classified value for an expected git failure; only a caller cancellation rejects, with the abort reason.
- A cancelled call must not leave a merge in progress in the work tree.
- probe never modifies the target work tree, its index, or its refs.
- commit contains exactly the supplied paths and no others.
- Nothing in the implementation pushes, rebases, or rewrites history.

```ts cordis-catalog
/**
 * Resolve one raw request into the target every operation uses.
 *
 * The split of `upstream` into a remote and a ref name happens once, here, so
 * no operation re-derives it and a request that cannot be split fails before
 * any command runs.
 * @param request - the coordinates observed by the consumer.
 * @returns the resolved target.
 * @throws {GitAlignRequestError} when the tracked branch has no `remote/ref` spelling.
 */
abstract resolve(request: AlignRequest): AlignSpec

/**
 * Fetch the target's upstream ref from its remote — the seam's only network operation.
 * @param spec - the resolved target.
 * @param signal - caller cancellation, which must bound the fetch.
 * @returns the classified fetch answer.
 */
abstract fetch(spec: AlignSpec, signal: AbortSignal): Promise<FetchResult>

/**
 * Report whether the upstream merges into HEAD cleanly, without touching the
 * target work tree, its index, or its refs.
 * @param spec - the resolved target.
 * @param request - scratch-tree location and the conflict-list bound.
 * @param signal - caller cancellation.
 * @returns the classified probe answer.
 */
abstract probe(spec: AlignSpec, request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult>

/**
 * Align HEAD to the upstream using the requested strategy, or roll the
 * attempt back and report it.
 * @param spec - the resolved target.
 * @param strategy - how the attempt reaches the upstream revision.
 * @param signal - caller cancellation.
 * @returns the classified write answer.
 */
abstract apply(spec: AlignSpec, strategy: AlignStrategy, signal: AbortSignal): Promise<ApplyResult>

/**
 * Read diff facts for exactly one path set, relative to HEAD.
 * @param spec - the resolved target.
 * @param paths - repository-relative paths, already bounded by the consumer.
 * @param signal - caller cancellation.
 * @returns the classified facts answer.
 */
abstract changeFacts( spec: AlignSpec, paths: readonly string[], signal: AbortSignal, ): Promise<ChangeFactsResult>

/**
 * Report which of the given paths git's own ignore rules match.
 * @param spec - the resolved target.
 * @param paths - repository-relative paths, already bounded by the consumer.
 * @param signal - caller cancellation.
 * @returns the classified ignore answer.
 */
abstract ignoredPaths( spec: AlignSpec, paths: readonly string[], signal: AbortSignal, ): Promise<IgnoreResult>

/**
 * Create one commit containing exactly the supplied paths.
 * @param spec - the resolved target.
 * @param request - the path set, the message, and whether repository hooks run.
 * @param signal - caller cancellation.
 * @returns the classified commit answer.
 */
abstract commit(spec: AlignSpec, request: CommitRequest, signal: AbortSignal): Promise<CommitResult>

/**
 * Report whether any remote-tracking ref already contains one commit — the
 * fact that decides whether a created commit can still be withdrawn.
 * @param spec - the resolved target.
 * @param oid - full object id of the commit to test.
 * @param signal - caller cancellation.
 * @returns the classified answer.
 */
abstract pushedToRemote(spec: AlignSpec, oid: string, signal: AbortSignal): Promise<PushedResult>
```

Source: [`packages/git/git-align/src/index.ts`](../../packages/git/git-align/src/index.ts)

<a id="ctxworkspaceautomation--workspaceautomationruntime"></a>

### `ctx.workspaceAutomation` — `WorkspaceAutomationRuntime`

The workspace automation runtime. One instance owns every workspace's timer, its durable state, and the two jobs.

```ts cordis-catalog
/**
 * The read-only projection of one workspace's automation state.
 * @param workspaceId - workspace to report.
 * @returns the report, or `undefined` when no state is stored yet.
 */
report(workspaceId: string): WorkspaceAutomationReport | undefined

/**
 * Clear a workspace's suspension and re-arm its timer.
 * @param workspaceId - workspace to resume.
 * @returns `true` when the workspace was suspended.
 */
async resume(workspaceId: string): Promise<boolean>

/**
 * Run the alignment job once for one workspace.
 * @param workspaceId - workspace to align.
 * @param trigger - what asked for the run.
 * @returns the recorded run.
 */
async runAlign(workspaceId: string, trigger: RunTrigger = 'due'): Promise<RunRecord>

/**
 * Run the commit job once for one work unit.
 * @param workspaceId - workspace the session belongs to.
 * @param session - the session whose work unit ended.
 * @param turn - the turn number that closed the work unit.
 * @returns the recorded run.
 */
async runCommit(workspaceId: string, session: Session, turn: number): Promise<RunRecord>
```

Types: [Session](session.md)

Source: [`packages/workspace/workspace-automation/src/index.ts`](../../packages/workspace/workspace-automation/src/index.ts)

<a id="ctxworkspaceautomationledger--workspaceautomationledger"></a>

### `ctx.workspaceAutomationLedger` — `WorkspaceAutomationLedger`

Host Remote service projecting one workspace's automation ledger.

```ts cordis-catalog
/**
 * Read one workspace's automation ledger.
 *
 * A workspace the runtime holds no state for answers `unrecorded` rather than
 * failing: a workspace whose timer has never run is a normal reading, and the
 * panel says so instead of showing an empty ledger.
 * @param workspaceId - the workspace whose ledger is read.
 * @returns the recorded state with its bounded runs, or `unrecorded`.
 */
@Remote automationLedger(workspaceId: WorkspaceId): AutomationLedgerView
```

Source: [`packages/api/workspace-automation/src/index.ts`](../../packages/api/workspace-automation/src/index.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspacefiles--workspacefiles"></a>

### `ctx.workspaceFiles` — `WorkspaceFiles`

Host Remote service over the composed filesystem, confined to one workspace.

```ts cordis-catalog
/**
 * Read one page of lines from a UTF-8 text file inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the line window; omitted fields take the page defaults.
 * @param signal - caller cancellation.
 * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
 */
@Remote async read(agent: Agent, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>

/**
 * Read one byte window of a regular file inside the Agent's workspace: raw
 * bytes, no text decoding and no binary rejection.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the byte window; omitted fields take the window defaults.
 * @param signal - caller cancellation.
 * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
 */
@Remote async readBytes(agent: Agent, path: string, range: WorkspaceByteRange, signal: AbortSignal): Promise<WorkspaceFileBytes>

/**
 * Report one regular file's identity, version, and size without its content.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the file's absolute path, current version, and byte size.
 */
@Remote async stat(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>

/**
 * Replace one regular file's complete text inside the Agent's workspace.
 *
 * The write is guarded by the version the caller read: a file that no longer
 * carries it fails with `workspace-file/stale-version` and keeps its content.
 * The guard is applied twice on purpose — once against the stat this method
 * takes, so the common conflict is decided before any content is written, and
 * once by the backend's atomic write at that same version, so a change
 * landing in between is refused rather than clobbered.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param content - the complete new file text.
 * @param expectedVersion - the `version` the caller's read reported.
 * @param signal - caller cancellation.
 * @returns the written file's absolute path, new version, and byte size.
 */
@Remote async write( agent: Agent, path: string, content: string, expectedVersion: string, signal: AbortSignal, ): Promise<WorkspaceFileStat>

/**
 * List the direct children of one directory inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the directory's children in the backend's stable name order, bounded by the entry cap.
 */
@Remote async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

/**
 * Stream every `fs/observed` observation of a file inside the Agent's
 * workspace. Only Agent filesystem operations report here; the OS is not
 * watched.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - generation cancellation.
 * @returns `ready` once the Host observation queue is active and the workspace
 *   root is resolved, then queued and live observations in emission order.
 */
@Remote({ mode: 'stream' }) changes(agent: Agent, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
```

Types: [Agent](core.md)

Source: [`packages/api/workspace-files/src/index.ts`](../../packages/api/workspace-files/src/index.ts)

<a id="ctxworkspacegit--workspacegit"></a>

### `ctx.workspaceGit` — `WorkspaceGit`

Host Remote service reading one workspace's repository state through `ctx.git`.

```ts cordis-catalog
/**
 * Observe the repository that contains the Agent's workspace root.
 *
 * The observation is one bounded read, not a subscription: a consumer asks
 * again when it wants a fresher answer, and aborting the call abandons the
 * read without leaving any state behind.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - caller cancellation.
 * @returns the repository's bounded snapshot, or `absent` when the workspace
 *   root is not inside a git work tree.
 */
@Remote async observe(agent: Agent, signal: AbortSignal): Promise<GitObservation>
```

Types: [Agent](core.md)

Source: [`packages/api/workspace-git/src/index.ts`](../../packages/api/workspace-git/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The fully qualified
 * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
 * non-directory path rejects. Repeated calls for the same canonical path
 * return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in a fully qualified path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in a fully qualified spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->

/**
 * The workspace automation runtime: one timer per workspace, two jobs, and the
 * durable ledger that records what every run did.
 *
 * The timer only decides *when* to look; staleness decides whether anything
 * happens. The align job compares the workspace against the commit id it last
 * aligned to, and the commit job commits exactly the paths one work unit was
 * proven to have written.
 *
 * Nothing here pushes. The commit job stops at a local commit, reports how a
 * human withdraws it, and records whether a remote already contains it.
 *
 * @module @deepseek-ai/dsh-workspace-automation
 */

import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { GitObservation } from '@deepseek-ai/dsh-git'
import type { AlignSpec, GitAlignFailure } from '@deepseek-ai/dsh-git-align'
import type Schema from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { WorkPathFact } from '@deepseek-ai/dsh-work-summary'
import { attributablePaths } from './attribution.ts'
import {
  ambiguousPaths,
  clearedBackoff,
  conflictCooldown,
  countsAsFailure,
  describeOutcome,
  failureBackoff,
  leaseIsHeld,
  nextRunDelayMs,
  retainLedger,
  scanForSecrets,
  stagingDecision,
  undoReport,
  alignmentDecision,
  type ScannableFile,
} from './decision.ts'
import {
  Config,
  resolveAutomationPolicy,
  resolveWorkspacePolicy,
  type AutomationMode,
  type AutomationPolicy,
  type WorkspaceOverride,
} from './config.ts'
import {
  INITIAL_AUTOMATION_STATE,
  workspaceAutomationDomainSpec,
  type StoredAutomationState,
} from './spec.ts'
import type {
  AutomationJob,
  AutomationOutcome,
  CommitReport,
  RunRecord,
  RunTrigger,
  WorkspaceRef,
} from './types.ts'

export * from './config.ts'
export * from './decision.ts'
export * from './attribution.ts'
export * from './spec.ts'
export type * from './types.ts'

/** A cancellable timer handle. */
export interface TimerHandle {
  /** Cancel the pending timer. */
  cancel(): void
}

/** The validated configuration one runtime instance receives, with every default applied. */
interface ResolvedConfig extends Config {
  readonly workspaces: Record<string, WorkspaceOverride>
}

/** Test seams replacing the clock, the jitter source, the workspace list, and the timer. */
export interface AutomationInternals {
  /** Current time in epoch milliseconds. */
  now?: () => number
  /** Jitter fraction in `[0, 1)`. */
  random?: () => number
  /** The workspaces the runtime timers cover. */
  workspaces?: () => readonly WorkspaceRef[]
  /** Arm one timer. */
  schedule?: (run: () => void, delayMs: number) => TimerHandle
}

/** The read-only projection of one workspace's automation state. */
export interface WorkspaceAutomationReport {
  /** Workspace id. */
  readonly workspaceId: string
  /** Whether the timer runs for this workspace. */
  readonly enabled: boolean
  /** Observation or alignment. */
  readonly mode: AutomationMode
  /** Why the workspace is suspended, or `null`. */
  readonly suspendedReason: string | null
  /** Consecutive failures. */
  readonly consecutiveFailures: number
  /** Earliest time the next run may act, ISO-8601. */
  readonly nextEarliestRunAt: string | null
  /** Upstream commit id the workspace is aligned to. */
  readonly baselineUpstreamOid: string | null
  /** When the last run finished, ISO-8601. */
  readonly lastRunAt: string | null
  /** The last run's outcome. */
  readonly lastOutcome: string | null
  /** Paths the last commit run left uncommitted, newest last. */
  readonly uncommittedPaths: readonly string[]
  /** Retained run records, newest last. */
  readonly ledger: readonly RunRecord[]
}

/** What one run records beyond its outcome. */
interface RunPatch {
  readonly expectedHeadOid?: string | null
  readonly observedUpstreamOid?: string | null
  readonly baselineUpstreamOid?: string | null
  readonly baselineLocalOid?: string | null
  readonly baselineBranch?: string | null
  readonly commit?: CommitReport | null
  readonly uncommittedPaths?: readonly string[]
  readonly commitWatermarks?: Record<string, number>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceAutomation: WorkspaceAutomationRuntime
  }
}

/** The service name this runtime registers under. */
const SERVICE = 'workspaceAutomation'

/**
 * The workspace automation runtime. One instance owns every workspace's timer,
 * its durable state, and the two jobs.
 */
export class WorkspaceAutomationRuntime extends Service {
  static inject = ['storageDomain', 'git', 'gitAlign', 'workSummary', 'fs']
  /** The class carries the schema, not a module export: the Loader reads this one. */
  static Config: Schema<Config> = Config

  /** Test seams; production uses the clock, `Math.random`, the registry, and `setTimeout`. */
  internals: AutomationInternals = {}

  private readonly basePolicy: AutomationPolicy
  private readonly overrides: Readonly<Record<string, WorkspaceOverride>>
  private readonly timers = new Map<string, TimerHandle>()
  private table?: KvTable<string, StoredAutomationState>
  private sequence = 0

  /**
   * @param ctx - the owning context.
   * @param config - the declared automation policy.
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, SERVICE)
    this.basePolicy = resolveAutomationPolicy(config)
    this.overrides = config.workspaces
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceAutomationDomainSpec)
    this.ctx.effect(() => () => domain.close(), `${SERVICE}.domainClose`)
    this.table = domain.table('workspaces')
    this.ctx.effect(() => () => { this.clearTimers() }, `${SERVICE}.timers`)
    this.ctx.on('session/event', (session: Session, event: SessionEvent) => { this.onSessionEvent(session, event) })
    this.ctx.on('domain/changed', (change: { readonly domain: string }) => {
      if (change.domain === 'workspace') this.rearmAll()
    })
    this.validateOverrides()
    this.rearmAll()
  }

  /**
   * The read-only projection of one workspace's automation state.
   * @param workspaceId - workspace to report.
   * @returns the report, or `undefined` when no state is stored yet.
   */
  report(workspaceId: string): WorkspaceAutomationReport | undefined {
    const stored = this.table?.get(workspaceId)
    if (stored === undefined) return undefined
    const policy = this.policyFor(workspaceId)
    return {
      workspaceId,
      enabled: policy.enabled,
      mode: policy.mode,
      suspendedReason: stored.suspendedReason,
      consecutiveFailures: stored.consecutiveFailures,
      nextEarliestRunAt: stored.nextEarliestRunAt,
      baselineUpstreamOid: stored.baselineUpstreamOid,
      lastRunAt: stored.lastRunAt,
      lastOutcome: stored.lastOutcome,
      uncommittedPaths: stored.uncommittedPaths,
      ledger: stored.ledger,
    }
  }

  /**
   * Clear a workspace's suspension and re-arm its timer.
   * @param workspaceId - workspace to resume.
   * @returns `true` when the workspace was suspended.
   */
  async resume(workspaceId: string): Promise<boolean> {
    const state = this.stateOf(workspaceId)
    if (state.suspendedReason === null) return false
    await this.save(workspaceId, {
      ...state,
      suspendedReason: null,
      consecutiveFailures: 0,
      nextEarliestRunAt: null,
    })
    this.rearm(workspaceId)
    return true
  }

  /**
   * Run the alignment job once for one workspace.
   * @param workspaceId - workspace to align.
   * @param trigger - what asked for the run.
   * @returns the recorded run.
   */
  async runAlign(workspaceId: string, trigger: RunTrigger = 'due'): Promise<RunRecord> {
    const startedAt = this.iso()
    const policy = this.policyFor(workspaceId)
    const state = this.stateOf(workspaceId)
    if (leaseIsHeld(state, this.now())) return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'skipped-locked' })
    const workspace = this.workspaces().find(candidate => candidate.id === workspaceId)
    if (workspace === undefined) {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'no-op', reason: 'no-repository' })
    }
    await this.acquireLease(workspaceId, policy)
    const signal = AbortSignal.timeout(policy.runTimeoutMs)
    const before = state.baselineUpstreamOid
    let observation: GitObservation
    try {
      observation = await this.ctx.git.observe(workspace.path, signal)
    } catch (error: unknown) {
      return await this.fail(workspaceId, 'align', trigger, startedAt, 'observe', error, { baselineUpstreamOid: before })
    }
    if (observation.kind === 'absent') {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'no-op', reason: 'no-repository' }, { baselineUpstreamOid: before })
    }
    if (await this.colocatedVcs(observation.root, signal)) {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'refused', reason: 'colocated-vcs', paths: [] }, { baselineUpstreamOid: before })
    }
    const head = observation.head
    const decision = alignmentDecision({
      repository: true,
      detached: head.branch === undefined,
      hasUpstream: head.upstream !== undefined,
      ahead: head.ahead ?? 0,
      behind: head.behind ?? 0,
    }, policy, observation.worktree.length > 0)
    if (decision.kind !== 'proceed' && decision.kind !== 'probe-only') {
      return await this.finish(workspaceId, 'align', trigger, startedAt, decision, {
        baselineUpstreamOid: before,
        expectedHeadOid: head.oid ?? null,
      })
    }
    const expectedHeadOid = head.oid
    if (expectedHeadOid === undefined || head.branch === undefined || head.upstream === undefined) {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'no-op', reason: 'up-to-date' }, { baselineUpstreamOid: before })
    }
    let spec: AlignSpec
    try {
      spec = this.ctx.gitAlign.resolve({
        root: observation.root,
        branch: head.branch,
        upstream: head.upstream,
        expectedHeadOid,
      })
    } catch (error: unknown) {
      return await this.fail(workspaceId, 'align', trigger, startedAt, 'resolve', error, { baselineUpstreamOid: before, expectedHeadOid })
    }
    const fetched = await this.ctx.gitAlign.fetch(spec, signal)
    if (fetched.kind === 'failed') {
      return await this.failGit(workspaceId, 'align', trigger, startedAt, 'fetch', fetched.failure, { baselineUpstreamOid: before, expectedHeadOid })
    }
    const afterFetch = await this.reobserve(workspace.path, signal)
    if (afterFetch === undefined) {
      return await this.fail(workspaceId, 'align', trigger, startedAt, 'observe', 're-observation failed', { baselineUpstreamOid: before, expectedHeadOid })
    }
    if (afterFetch.head.oid !== expectedHeadOid) {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'superseded' }, { baselineUpstreamOid: before, expectedHeadOid })
    }
    const upstreamOid = afterFetch.head.oid
    const probe = await this.ctx.gitAlign.probe(spec, {
      worktreeRoot: policy.worktreeRoot as string,
      scratchName: workspaceId,
      maxConflictPaths: policy.maxConflictPaths,
    }, signal)
    if (probe.kind === 'failed') {
      return await this.failGit(workspaceId, 'align', trigger, startedAt, 'probe', probe.failure, { baselineUpstreamOid: before, expectedHeadOid })
    }
    if (probe.kind === 'conflicted') {
      return await this.finish(workspaceId, 'align', trigger, startedAt, {
        kind: 'conflicted',
        paths: probe.conflicts.paths,
        total: probe.conflicts.total,
      }, { baselineUpstreamOid: before, expectedHeadOid })
    }
    if (decision.kind === 'probe-only') {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'no-op', reason: 'observe-only' }, { baselineUpstreamOid: before, expectedHeadOid })
    }
    const applied = await this.ctx.gitAlign.apply(spec, decision.strategy, signal)
    if (applied.kind === 'merge-failed-dirty') {
      return await this.failGit(workspaceId, 'align', trigger, startedAt, 'merge-dirty', applied.failure, { baselineUpstreamOid: before, expectedHeadOid })
    }
    if (applied.kind === 'merge-failed') {
      return await this.failGit(workspaceId, 'align', trigger, startedAt, 'merge', applied.failure, { baselineUpstreamOid: before, expectedHeadOid })
    }
    const settled = await this.reobserve(workspace.path, signal)
    if (settled === undefined || (settled.head.behind ?? 1) !== 0) {
      return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'superseded' }, { baselineUpstreamOid: before, expectedHeadOid })
    }
    return await this.finish(workspaceId, 'align', trigger, startedAt, { kind: 'aligned', strategy: decision.strategy }, {
      expectedHeadOid,
      observedUpstreamOid: upstreamOid,
      baselineUpstreamOid: upstreamOid,
      baselineLocalOid: settled.head.oid ?? null,
      baselineBranch: settled.head.branch ?? head.branch,
    })
  }

  /**
   * Run the commit job once for one work unit.
   * @param workspaceId - workspace the session belongs to.
   * @param session - the session whose work unit ended.
   * @param turn - the turn number that closed the work unit.
   * @returns the recorded run.
   */
  async runCommit(workspaceId: string, session: Session, turn: number): Promise<RunRecord> {
    const startedAt = this.iso()
    const policy = this.policyFor(workspaceId)
    const state = this.stateOf(workspaceId)
    if (!policy.commit.enabled) return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'observe-only' })
    if (leaseIsHeld(state, this.now())) return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'skipped-locked' })
    const workspace = this.workspaces().find(candidate => candidate.id === workspaceId)
    if (workspace === undefined) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'no-repository' })
    }
    await this.acquireLease(workspaceId, policy)
    const signal = AbortSignal.timeout(policy.runTimeoutMs)
    let observation: GitObservation
    try {
      observation = await this.ctx.git.observe(workspace.path, signal)
    } catch (error: unknown) {
      return await this.fail(workspaceId, 'commit', 'turn-end', startedAt, 'observe', error, {})
    }
    if (observation.kind === 'absent') {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'no-repository' })
    }
    if (await this.colocatedVcs(observation.root, signal)) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'refused', reason: 'colocated-vcs', paths: [] })
    }
    if (observation.head.branch === undefined) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'refused', reason: 'detached-head', paths: [] })
    }
    if (observation.head.upstream === undefined) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'no-upstream' })
    }
    const spec = this.ctx.gitAlign.resolve({
      root: observation.root,
      branch: observation.head.branch,
      upstream: observation.head.upstream,
      expectedHeadOid: observation.head.oid ?? '',
    })
    const events = session.snapshotEvents()
    const target = attributablePaths(events, turn, workspace.path, observation.root)
    if (target.paths.length === 0) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'no-attributable-paths' })
    }
    const earlier = this.earlierUncommittedPaths(state, session.id, turn, workspace.path, observation.root, events)
    const ambiguous = ambiguousPaths(target.paths, earlier)
    if (ambiguous.length > 0) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'ambiguous-attribution', paths: ambiguous })
    }
    const facts = await this.ctx.gitAlign.changeFacts(spec, target.paths, signal)
    if (facts.kind === 'failed') {
      return await this.failGit(workspaceId, 'commit', 'turn-end', startedAt, 'commit', facts.failure, {})
    }
    const staged = stagingDecision(facts.facts.files.map(fact => fact.path), policy.commit.maxPathsPerCommit)
    if (staged.kind === 'refused') {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'refused', reason: staged.reason, paths: staged.paths })
    }
    const ignored = await this.ctx.gitAlign.ignoredPaths(spec, staged.paths, signal)
    if (ignored.kind === 'failed') {
      return await this.failGit(workspaceId, 'commit', 'turn-end', startedAt, 'commit', ignored.failure, {})
    }
    const ignoredSet = new Set(ignored.ignored)
    const committable = staged.paths.filter(path => !ignoredSet.has(path))
    if (committable.length === 0) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'no-op', reason: 'no-attributable-paths' })
    }
    const scannable = await this.readForScan(observation.root, committable, policy, signal)
    if (scannable === undefined) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'refused', reason: 'unreadable-path', paths: committable })
    }
    const scan = scanForSecrets(scannable, policy.commit.secretPatterns, policy.commit.maxScanBytes)
    if (scan.hits.length > 0) {
      return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'refused', reason: 'secrets', paths: scan.hits })
    }
    const committableSet = new Set(committable)
    const pathFacts: WorkPathFact[] = facts.facts.files
      .filter(fact => committableSet.has(fact.path))
      .map(fact => ({ path: fact.path, insertions: fact.insertions, deletions: fact.deletions, binary: fact.binary }))
    const summary = await this.ctx.workSummary.generate({
      workspaceId,
      sessionId: session.id,
      turn,
      endReason: 'turn-end',
      paths: pathFacts,
    })
    const message = [
      summary.message.subject,
      ...(summary.message.body.length === 0 ? [] : ['', ...summary.message.body]),
      '',
      summary.message.trailer,
    ].join('\n')
    const committed = await this.ctx.gitAlign.commit(spec, {
      paths: committable,
      message,
      runHooks: policy.commit.runHooks,
    }, signal)
    if (committed.kind === 'failed') {
      return await this.failGit(workspaceId, 'commit', 'turn-end', startedAt, 'commit', committed.failure, {})
    }
    const settled = await this.reobserve(workspace.path, signal)
    if (settled === undefined || settled.head.oid === observation.head.oid) {
      return await this.fail(workspaceId, 'commit', 'turn-end', startedAt, 'commit', 'HEAD did not advance after the commit', {})
    }
    const oid = settled.head.oid as string
    const parentOid = observation.head.oid ?? ''
    const pushed = await this.ctx.gitAlign.pushedToRemote(spec, oid, signal)
    const withdrawable = pushed.kind === 'checked' ? !pushed.pushed : false
    const undo = undoReport(parentOid, withdrawable)
    const report: CommitReport = {
      oid,
      parentOid,
      paths: committable,
      subject: summary.message.subject,
      body: summary.message.body,
      summarySource: summary.source,
      summaryNotes: summary.notes,
      scanBytes: scan.bytes,
      ...undo,
    }
    const remainder = observation.worktree
      .map(entry => entry.path)
      .filter(path => !committable.includes(path))
    return await this.finish(workspaceId, 'commit', 'turn-end', startedAt, { kind: 'committed', sessionId: session.id, turn }, {
      expectedHeadOid: observation.head.oid ?? null,
      commit: report,
      uncommittedPaths: remainder,
      commitWatermarks: { ...state.commitWatermarks, [session.id]: turn },
    })
  }

  /**
   * Whether the repository root carries a colocated Jujutsu workspace.
   * @param root - the repository work-tree root.
   * @param signal - the run's abort signal.
   * @returns true when `.jj` exists, and also when the check cannot be answered.
   */
  private async colocatedVcs(root: string, signal: AbortSignal): Promise<boolean> {
    try {
      const fs: FileSystem = this.ctx.fs
      const target = await fs.resolve(join(root, '.jj'), { signal })
      return await fs.stat(target, signal) !== undefined
    } catch (error: unknown) {
      // Only an unusable path reaches here; refusing is the safe direction, so the run stops.
      this.ctx.logger.warn(`workspace-automation: colocated-VCS check for "${root}" failed: ${String(error)}`)
      return true
    }
  }

  /** Read every committable path's bounded prefix for the credential screen. */
  private async readForScan(
    root: string,
    paths: readonly string[],
    policy: AutomationPolicy,
    signal: AbortSignal,
  ): Promise<ScannableFile[] | undefined> {
    const decoder = new TextDecoder()
    const files: ScannableFile[] = []
    for (const path of paths) {
      try {
        const fs: FileSystem = this.ctx.fs
        const target = await fs.resolve(join(root, path), { signal })
        files.push({ path, text: decoder.decode(await fs.readBytes(target, signal, policy.commit.maxScanBytes)) })
      } catch (error: unknown) {
        this.ctx.logger.warn(`workspace-automation: cannot read "${path}" for the credential screen: ${String(error)}`)
        return undefined
      }
    }
    return files
  }

  /** The attributed paths of every uncommitted turn before `turn` in one session. */
  private earlierUncommittedPaths(
    state: StoredAutomationState,
    sessionId: string,
    turn: number,
    workspacePath: string,
    repoRoot: string,
    events: readonly SessionEvent[],
  ): readonly string[] {
    const watermark = state.commitWatermarks[sessionId] ?? 0
    const turns = new Set<number>()
    for (const event of events) {
      if (event.type !== 'turn/end') continue
      if (event.data.turn > watermark && event.data.turn < turn) turns.add(event.data.turn)
    }
    const paths: string[] = []
    for (const candidate of turns) {
      for (const path of attributablePaths(events, candidate, workspacePath, repoRoot).paths) {
        if (!paths.includes(path)) paths.push(path)
      }
    }
    return paths
  }

  /** Re-observe one workspace, answering `undefined` instead of throwing. */
  private async reobserve(path: string, signal: AbortSignal): Promise<Extract<GitObservation, { kind: 'repository' }> | undefined> {
    try {
      const observation = await this.ctx.git.observe(path, signal)
      return observation.kind === 'repository' ? observation : undefined
    } catch (error: unknown) {
      this.ctx.logger.warn(`workspace-automation: re-observation of "${path}" failed: ${String(error)}`)
      return undefined
    }
  }

  /** Record one classified git failure as a failed run. */
  private async failGit(
    workspaceId: string,
    job: AutomationJob,
    trigger: RunTrigger,
    startedAt: string,
    reason: 'fetch' | 'probe' | 'merge' | 'merge-dirty' | 'commit',
    failure: GitAlignFailure,
    patch: RunPatch,
  ): Promise<RunRecord> {
    return await this.finish(workspaceId, job, trigger, startedAt, {
      kind: 'failed',
      reason,
      detail: `${failure.code}: ${failure.detail}`,
    }, patch)
  }

  /** Record one thrown failure as a failed run. */
  private async fail(
    workspaceId: string,
    job: AutomationJob,
    trigger: RunTrigger,
    startedAt: string,
    reason: 'observe' | 'resolve' | 'commit',
    error: unknown,
    patch: RunPatch,
  ): Promise<RunRecord> {
    const detail = error instanceof Error ? error.message : String(error)
    return await this.finish(workspaceId, job, trigger, startedAt, { kind: 'failed', reason, detail }, patch)
  }

  /** Publish one run record and the state it implies. */
  private async finish(
    workspaceId: string,
    job: AutomationJob,
    trigger: RunTrigger,
    startedAt: string,
    outcome: AutomationOutcome,
    patch: RunPatch = {},
  ): Promise<RunRecord> {
    const now = this.now()
    const policy = this.policyFor(workspaceId)
    const state = this.stateOf(workspaceId)
    const record: RunRecord = {
      id: `${startedAt}#${++this.sequence}`,
      job,
      trigger,
      startedAt,
      finishedAt: new Date(now).toISOString(),
      outcome,
      expectedHeadOid: patch.expectedHeadOid ?? null,
      observedUpstreamOid: patch.observedUpstreamOid ?? null,
      baselineBefore: state.baselineUpstreamOid,
      baselineAfter: patch.baselineUpstreamOid ?? state.baselineUpstreamOid,
      commit: patch.commit ?? null,
    }
    const backoff = countsAsFailure(outcome)
      ? failureBackoff(state, policy, now)
      : clearedBackoff(outcome.kind === 'conflicted' ? conflictCooldown(policy, now) : null)
    await this.save(workspaceId, {
      ...state,
      ...patch,
      baselineUpstreamOid: patch.baselineUpstreamOid ?? state.baselineUpstreamOid,
      baselineLocalOid: patch.baselineLocalOid ?? state.baselineLocalOid,
      baselineBranch: patch.baselineBranch ?? state.baselineBranch,
      lastRunAt: record.finishedAt,
      lastOutcome: describeOutcome(outcome),
      ...backoff,
      leaseOwner: null,
      leaseUntil: null,
      uncommittedPaths: [...(patch.uncommittedPaths ?? state.uncommittedPaths)],
      commitWatermarks: { ...(patch.commitWatermarks ?? state.commitWatermarks) },
      ledger: [...retainLedger(state.ledger, record, policy.ledgerEntries)],
    })
    this.rearm(workspaceId)
    return record
  }

  /** Take the workspace's run lease before the first write of a run. */
  private async acquireLease(workspaceId: string, policy: AutomationPolicy): Promise<void> {
    const state = this.stateOf(workspaceId)
    await this.save(workspaceId, {
      ...state,
      leaseOwner: `${SERVICE}:${workspaceId}`,
      leaseUntil: new Date(this.now() + policy.leaseMs).toISOString(),
    })
  }

  /** React to one session event; a closed turn boundary schedules the commit job. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'turn/end') return
    const workspace = this.workspaces().find(candidate => candidate.sessionIds.includes(session.id))
    if (workspace === undefined) return
    void this.runCommit(workspace.id, session, event.data.turn).catch((error: unknown) => {
      this.ctx.logger.warn(`workspace-automation: commit job for "${workspace.id}" rejected: ${String(error)}`)
    })
  }

  /** Arm the timer of every workspace the runtime covers. */
  private rearmAll(): void {
    this.clearTimers()
    for (const workspace of this.workspaces()) this.rearm(workspace.id)
  }

  /** Arm one workspace's timer for its next due run. */
  private rearm(workspaceId: string): void {
    const existing = this.timers.get(workspaceId)
    if (existing !== undefined) {
      existing.cancel()
      this.timers.delete(workspaceId)
    }
    const delay = nextRunDelayMs(this.policyFor(workspaceId), this.stateOf(workspaceId), this.now(), this.random)
    if (delay === undefined) return
    this.timers.set(workspaceId, this.schedule(() => {
      this.timers.delete(workspaceId)
      void this.runAlign(workspaceId, 'due').catch((error: unknown) => {
        this.ctx.logger.warn(`workspace-automation: alignment run for "${workspaceId}" rejected: ${String(error)}`)
      })
    }, delay))
  }

  /** Cancel every armed timer. */
  private clearTimers(): void {
    for (const timer of this.timers.values()) timer.cancel()
    this.timers.clear()
  }

  /** Reject overrides that name no registered workspace. */
  private validateOverrides(): void {
    const known = new Set(this.workspaces().map(workspace => workspace.id))
    for (const workspaceId of Object.keys(this.overrides)) {
      if (!known.has(workspaceId)) {
        throw new Error(`workspace-automation: workspaces override names unregistered workspace "${workspaceId}"`)
      }
      resolveWorkspacePolicy(this.basePolicy, this.overrides[workspaceId])
    }
  }

  /** The policy one workspace runs under. */
  private policyFor(workspaceId: string): AutomationPolicy {
    return resolveWorkspacePolicy(this.basePolicy, this.overrides[workspaceId])
  }

  /** The stored state, or the initial state when nothing is stored. */
  private stateOf(workspaceId: string): StoredAutomationState {
    return this.table?.get(workspaceId) ?? INITIAL_AUTOMATION_STATE
  }

  /** Persist one workspace's state. */
  private async save(workspaceId: string, state: StoredAutomationState): Promise<void> {
    await this.requireTable().put(workspaceId, state)
  }

  /** The domain table; absent only before initialization completed. */
  private requireTable(): KvTable<string, StoredAutomationState> {
    /* v8 ignore next 2 -- `table` is assigned by the initializer before any run can reach this. */
    if (this.table === undefined) throw new Error('workspace-automation: the domain table is not open')
    return this.table
  }

  /** The workspaces the timers cover. */
  private workspaces(): readonly WorkspaceRef[] {
    if (this.internals.workspaces !== undefined) return this.internals.workspaces()
    const registry: WorkspaceRegistry | undefined = this.ctx.get('workspaceRegistry')
    if (registry === undefined) throw new Error('workspace-automation: ctx.workspaceRegistry is not mounted')
    return registry.list().map(workspace => ({
      id: workspace.id,
      path: workspace.path,
      sessionIds: workspace.sessionIds,
    }))
  }

  /** Current time in epoch milliseconds. */
  private now(): number {
    return (this.internals.now ?? Date.now)()
  }

  /** Current time as ISO-8601. */
  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  /** Jitter fraction in `[0, 1)`. */
  private random = (): number => (this.internals.random ?? Math.random)()

  /** Arm one timer through the configured scheduler. */
  private schedule = (run: () => void, delayMs: number): TimerHandle => {
    if (this.internals.schedule !== undefined) return this.internals.schedule(run, delayMs)
    const handle = setTimeout(run, delayMs)
    handle.unref()
    return { cancel: () => { clearTimeout(handle) } }
  }
}

export default WorkspaceAutomationRuntime

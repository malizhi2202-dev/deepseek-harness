import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { GitHeadState, GitObservation, GitWorktreeEntry } from '@deepseek-ai/dsh-git'
import type { ApplyResult, ChangeFactsResult, CommitResult, FetchResult, IgnoreResult, ProbeResult, PushedResult } from '@deepseek-ai/dsh-git-align'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import WorkSummaryService from '@deepseek-ai/dsh-work-summary'
import WorkspaceAutomationRuntime from '@deepseek-ai/dsh-workspace-automation'
import type { AutomationInternals, Config, TimerHandle, WorkspaceRef } from '@deepseek-ai/dsh-workspace-automation'
import { INITIAL_AUTOMATION_STATE, workspaceAutomationDomainSpec } from '@deepseek-ai/dsh-workspace-automation'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** The seams the next mounted runtime instance starts with. */
let nextInternals: AutomationInternals = {}

/** A runtime subclass whose test seams exist before cordis runs its initializer. */
class ScriptedRuntime extends WorkspaceAutomationRuntime {
  override internals: AutomationInternals = nextInternals
}

const ROOT = '/work/repo'
const WORKSPACE: WorkspaceRef = { id: 'ws-1', path: ROOT, sessionIds: ['sess-1'] }

/** One armed timer recorded by the manual scheduler. */
interface Armed {
  run: () => void
  delayMs: number
  cancelled: boolean
}

/** Everything one scripted provider composition answers. */
interface Script {
  readonly observations: GitObservation[]
  observeError?: Error
  observeErrorAfter?: number
  workspacesFailsAfter?: number
  resolveError?: Error
  fetch?: FetchResult
  probe?: ProbeResult
  apply?: ApplyResult
  facts?: ChangeFactsResult
  ignored?: IgnoreResult
  commit?: CommitResult
  pushed?: PushedResult
  readonly calls: string[]
}

/** Build one repository observation. */
function snapshot(options: {
  oid?: string
  branch?: string | null
  upstream?: string | null
  ahead?: number
  behind?: number
  worktree?: string[]
  omit?: readonly ('oid' | 'branch' | 'upstream' | 'ahead' | 'behind')[]
} = {}): GitObservation {
  const omit = options.omit ?? []
  const branch = options.branch === undefined ? 'main' : options.branch
  const upstream = options.upstream === undefined ? 'origin/main' : options.upstream
  const worktree: GitWorktreeEntry[] = (options.worktree ?? []).map(path => ({ kind: 'untracked', path }))
  const head: GitHeadState = {
    ...(omit.includes('oid') ? {} : { oid: options.oid ?? 'head-1' }),
    ...(branch === null || omit.includes('branch') ? {} : { branch }),
    ...(upstream === null || omit.includes('upstream') ? {} : { upstream }),
    ...(omit.includes('ahead') ? {} : { ahead: options.ahead ?? 0 }),
    ...(omit.includes('behind') ? {} : { behind: options.behind ?? 3 }),
  }
  return {
    kind: 'repository',
    root: ROOT,
    head,
    branches: [],
    branchesTruncated: false,
    history: [],
    historyTruncated: false,
    worktree,
    worktreeTruncated: false,
  }
}

/** One `tool/call` event. */
function call(turn: number, callId: string, name: string, args: unknown): SessionEvent {
  return {
    type: 'tool/call',
    data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) },
  } as unknown as SessionEvent
}

/** One successful `tool/result` event. */
function result(callId: string): SessionEvent {
  return {
    type: 'tool/result',
    data: { turn: 1, step: 1, message: { content: [{ toolCallId: callId, isError: false }] } },
  } as unknown as SessionEvent
}

/** One `turn/end` event. */
function turnEnd(turn: number): SessionEvent {
  return { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as unknown as SessionEvent
}

/** A session whose log is exactly the supplied events. */
function fakeSession(id: string, events: readonly SessionEvent[]): Session {
  return { id, snapshotEvents: () => events } as unknown as Session
}

interface HarnessOptions {
  config?: Config
  workspaces?: WorkspaceRef[]
  observations?: GitObservation[]
  observeError?: Error
  observeErrorAfter?: number
  workspacesFailsAfter?: number
  resolveError?: Error
  fetch?: FetchResult
  probe?: ProbeResult
  apply?: ApplyResult
  facts?: ChangeFactsResult
  ignored?: IgnoreResult
  commit?: CommitResult
  pushed?: PushedResult
  colocatedJj?: boolean
  statFails?: boolean
  files?: Record<string, string>
  proposal?: { subject: string; body: string[] }
  readFails?: boolean
  now?: number
  registry?: 'absent'
  manual?: boolean
}

/** Boot the runtime over a real domain facility and scripted git providers. */
async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)

  const script: Script = {
    observations: options.observations ?? [snapshot()],
    calls: [],
    ...(options.observeError === undefined ? {} : { observeError: options.observeError }),
    ...(options.resolveError === undefined ? {} : { resolveError: options.resolveError }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.apply === undefined ? {} : { apply: options.apply }),
    ...(options.facts === undefined ? {} : { facts: options.facts }),
    ...(options.ignored === undefined ? {} : { ignored: options.ignored }),
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...(options.pushed === undefined ? {} : { pushed: options.pushed }),
  }
  let observed = 0
  ctx.provide('git', {
    observe: async (): Promise<GitObservation> => {
      script.calls.push('observe')
      if (script.observeError !== undefined && observed >= (options.observeErrorAfter ?? 0)) throw script.observeError
      const index = Math.min(observed, script.observations.length - 1)
      observed += 1
      return script.observations[index] as GitObservation
    },
  } as never)
  ctx.provide('gitAlign', {
    resolve: (request: unknown) => {
      script.calls.push('resolve')
      if (script.resolveError !== undefined) throw script.resolveError
      return { ...(request as object), remote: 'origin', refspec: 'main' }
    },
    fetch: async () => {
      script.calls.push('fetch')
      return script.fetch ?? { kind: 'fetched' }
    },
    probe: async () => {
      script.calls.push('probe')
      return script.probe ?? { kind: 'clean' }
    },
    apply: async () => {
      script.calls.push('apply')
      return script.apply ?? { kind: 'aligned', strategy: 'ff-only' }
    },
    changeFacts: async () => {
      script.calls.push('changeFacts')
      return script.facts ?? { kind: 'facts', facts: { files: [], insertions: 0, deletions: 0 } }
    },
    ignoredPaths: async () => {
      script.calls.push('ignoredPaths')
      return script.ignored ?? { kind: 'checked', ignored: [] }
    },
    commit: async () => {
      script.calls.push('commit')
      return script.commit ?? { kind: 'committed' }
    },
    pushedToRemote: async () => {
      script.calls.push('pushedToRemote')
      return script.pushed ?? { kind: 'checked', pushed: false }
    },
  } as never)
  const files = options.files ?? {}
  ctx.provide('fs', {
    resolve: async (path: string) => ({ path }),
    stat: async () => {
      if (options.statFails === true) throw new Error('unusable path')
      return options.colocatedJj === true ? { kind: 'directory' } : undefined
    },
    readBytes: async (target: { path: string }) => {
      if (options.readFails === true) throw new Error('unreadable')
      return new TextEncoder().encode(files[target.path] ?? '')
    },
  } as never)
  await ctx.plugin(WorkSummaryService, {})
  if (options.proposal !== undefined) {
    const summary = ctx.get('workSummary')
    if (summary === undefined) throw new Error('work-summary did not register ctx.workSummary')
    summary.register({
      id: 'scripted',
      generate: async () => ({ kind: 'proposed', proposal: options.proposal as { subject: string; body: string[] } }),
    })
  }

  const armed: Armed[] = []
  const internals: AutomationInternals = {
    now: () => options.now ?? Date.parse('2026-01-01T00:00:00.000Z'),
    random: () => 0.5,
  }
  let listed = 0
  if (options.registry !== 'absent') {
    internals.workspaces = () => {
      listed += 1
      if (options.workspacesFailsAfter !== undefined && listed > options.workspacesFailsAfter) {
        throw new Error('the workspace registry is unavailable')
      }
      return options.workspaces ?? [WORKSPACE]
    }
  }
  if (options.manual !== false) {
    internals.schedule = (run: () => void, delayMs: number): TimerHandle => {
      const entry: Armed = { run, delayMs, cancelled: false }
      armed.push(entry)
      return { cancel: () => { entry.cancelled = true } }
    }
  }
  nextInternals = internals
  const fiber = await ctx.plugin(ScriptedRuntime, options.config ?? {})
  const runtime = ctx.get('workspaceAutomation')
  if (runtime === undefined) throw new Error('the runtime did not register')
  return { ctx, fiber, runtime, script, armed, facility }
}

/** Seed one workspace's stored state directly through the open domain. */
async function seed(facility: DomainFacility, workspaceId: string, state: Partial<typeof INITIAL_AUTOMATION_STATE>): Promise<void> {
  const domain = facility.get(workspaceAutomationDomainSpec.name)
  if (domain === undefined) throw new Error('the automation domain is not open')
  await domain.table('workspaces').put(workspaceId, { ...INITIAL_AUTOMATION_STATE, ...state })
}

const cleanAlignConfig: Config = { enabled: true, mode: 'align', worktreeRoot: '/scratch', intervalSeconds: 600 }
const mergeAlignConfig: Config = { enabled: true, mode: 'align', worktreeRoot: '/scratch', intervalSeconds: 600, alignStrategy: 'merge' }
const suspendAfterTwoConfig: Config = { enabled: true, mode: 'align', worktreeRoot: '/scratch', intervalSeconds: 600, backoffSuspendAfter: 2, backoffBaseSeconds: 60 }
const suspendAfterOneConfig: Config = { enabled: true, mode: 'align', worktreeRoot: '/scratch', intervalSeconds: 600, backoffSuspendAfter: 1 }
const unknownWorkspaceConfig: Config = { enabled: true, mode: 'align', worktreeRoot: '/scratch', intervalSeconds: 600, workspaces: { 'ws-missing': { enabled: true } } }

let fibers: { dispose(): Promise<void> }[] = []
afterEach(async () => {
  for (const fiber of fibers) await fiber.dispose()
  fibers = []
})

describe('WorkspaceAutomationRuntime', () => {
  it('reports nothing before the first run', async () => {
    const { ctx, runtime } = await harness()
    expect(runtime.report('ws-1')).toBe(undefined)
    expect(await runtime.resume('ws-1')).toBe(false)
    void ctx
  })

  it('records a baseline and ledger entry for an alignment run', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observations: [snapshot(), snapshot(), snapshot({ oid: 'head-2', behind: 0 })] })
    await runtime.runAlign('ws-1')
    const report = runtime.report('ws-1')
    expect(report?.lastOutcome).toBe('aligned:ff-only')
    expect(report?.baselineUpstreamOid).toBe('head-1')
    expect(report?.ledger).toHaveLength(1)
    expect(report?.ledger[0]?.outcome).toEqual({ kind: 'aligned', strategy: 'ff-only' })
  })
})

describe('runAlign', () => {
  it('reports a workspace the runtime does not cover', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig })
    expect((await runtime.runAlign('ws-other')).outcome).toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('records a failed observation', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observeError: new Error('git unavailable') })
    const record = await runtime.runAlign('ws-1')
    expect(record.outcome).toEqual({ kind: 'failed', reason: 'observe', detail: 'git unavailable' })
  })

  it('reports a directory outside any repository', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observations: [{ kind: 'absent' }] })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('refuses a detached HEAD', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observations: [snapshot({ branch: null })] })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'refused', reason: 'detached-head', paths: [] })
  })

  it('reports a branch with no upstream', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observations: [snapshot({ upstream: null })] })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'no-upstream' })
  })

  it('refuses a repository carrying a colocated Jujutsu workspace', async () => {
    const { runtime, script } = await harness({ config: cleanAlignConfig, colocatedJj: true })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'refused', reason: 'colocated-vcs', paths: [] })
    expect(script.calls).toEqual(['observe'])
  })

  it('refuses when the colocated-workspace check cannot be answered', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, statFails: true })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'refused', reason: 'colocated-vcs', paths: [] })
  })

  it('reports an up-to-date branch without fetching', async () => {
    const { runtime, script } = await harness({ config: cleanAlignConfig, observations: [snapshot({ behind: 0 })] })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'up-to-date' })
    expect(script.calls).toEqual(['observe'])
  })

  it('records a null expected commit id when an up-to-date head carries none', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot({ behind: 0, omit: ['oid'] })],
    })
    const record = await runtime.runAlign('ws-1')
    expect(record.outcome).toEqual({ kind: 'no-op', reason: 'up-to-date' })
    expect(record.expectedHeadOid).toBe(null)
  })

  it('defaults the tracking counts when the observation omits them', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot({ omit: ['ahead', 'behind'] })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'up-to-date' })
  })

  it('stops when a behind head carries no commit id to align from', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot({ omit: ['oid'] })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'up-to-date' })
  })

  it('records a failed target resolution', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, resolveError: new Error('no remote/ref spelling') })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'resolve', detail: 'no remote/ref spelling' })
  })

  it('records a failed fetch', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      fetch: { kind: 'failed', failure: { code: 'timeout', detail: 'git fetch timed out' } },
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'fetch', detail: 'timeout: git fetch timed out' })
  })

  it('records a failed re-observation when git itself throws', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observeError: new Error('git disappeared'),
      observeErrorAfter: 1,
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'observe', detail: 're-observation failed' })
  })

  it('records a failed re-observation', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot(), { kind: 'absent' }],
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'observe', detail: 're-observation failed' })
  })

  it('aborts without retrying when another writer moved HEAD', async () => {
    const { runtime, script } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot(), snapshot({ oid: 'moved' })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'superseded' })
    expect(script.calls).toEqual(['observe', 'resolve', 'fetch', 'observe'])
  })

  it('records a failed conflict probe', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      probe: { kind: 'failed', failure: { code: 'git-unavailable', detail: 'no git' } },
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'probe', detail: 'git-unavailable: no git' })
  })

  it('reports conflicts as a terminal outcome', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      probe: { kind: 'conflicted', conflicts: { paths: ['a.ts'], total: 4 } },
    })
    const record = await runtime.runAlign('ws-1')
    expect(record.outcome).toEqual({ kind: 'conflicted', paths: ['a.ts'], total: 4 })
    expect(runtime.report('ws-1')?.nextEarliestRunAt).toBe('2026-01-01T01:00:00.000Z')
  })

  it('probes but does not write in observe mode', async () => {
    const { runtime, script } = await harness({ config: { enabled: true, intervalSeconds: 600 } })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'no-op', reason: 'observe-only' })
    expect(script.calls).toEqual(['observe', 'resolve', 'fetch', 'observe', 'probe'])
  })

  it('refuses a dirty work tree under the refuse policy', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig, observations: [snapshot({ worktree: ['dirty.ts'] })] })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'refused', reason: 'dirty', paths: [] })
  })

  it('records a merge that could not be rolled back', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      apply: { kind: 'merge-failed-dirty', failure: { code: 'command-failed', detail: 'merge --abort exited 1' } },
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'merge-dirty', detail: 'command-failed: merge --abort exited 1' })
  })

  it('records a failed merge', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      apply: { kind: 'merge-failed', failure: { code: 'command-failed', detail: 'merge exited 1' } },
    })
    expect((await runtime.runAlign('ws-1')).outcome)
      .toEqual({ kind: 'failed', reason: 'merge', detail: 'command-failed: merge exited 1' })
  })

  it('reports a superseded write when the tree did not settle on the upstream', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot(), snapshot({ behind: 1 })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'superseded' })
  })

  it('reports a superseded write when the re-observation omits the tracking counts', async () => {
    const blind = snapshot()
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [blind, snapshot({ omit: ['behind'] })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'superseded' })
  })

  it('records null baselines when the settled head omits its commit id and branch', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot(), snapshot(), snapshot({ behind: 0, omit: ['oid', 'branch'] })],
    })
    const record = await runtime.runAlign('ws-1')
    expect(record.outcome).toEqual({ kind: 'aligned', strategy: 'ff-only' })
    expect(record.baselineAfter).toBe('head-1')
  })

  it('reports a superseded write when the tree cannot be re-observed', async () => {
    const { runtime } = await harness({
      config: cleanAlignConfig,
      observations: [snapshot(), snapshot({ oid: 'head-1' }), { kind: 'absent' }],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'superseded' })
  })

  it('applies the merge strategy when the deployment chose it', async () => {
    const { runtime, script } = await harness({
      config: mergeAlignConfig,
      observations: [snapshot(), snapshot(), snapshot({ oid: 'head-2', behind: 0 })],
    })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'aligned', strategy: 'merge' })
    expect(script.calls).toContain('apply')
  })

  it('skips a run while another writer holds the lease', async () => {
    const { runtime, facility, script } = await harness({ config: cleanAlignConfig })
    await seed(facility, 'ws-1', { leaseOwner: 'other', leaseUntil: '2026-01-01T00:10:00.000Z' })
    expect((await runtime.runAlign('ws-1')).outcome).toEqual({ kind: 'skipped-locked' })
    expect(script.calls).toEqual([])
  })
})

describe('failure handling', () => {
  it('backs off, then suspends the workspace at the threshold', async () => {
    const config: Config = suspendAfterTwoConfig
    const { runtime } = await harness({ config, observeError: new Error('boom') })
    await runtime.runAlign('ws-1')
    expect(runtime.report('ws-1')?.consecutiveFailures).toBe(1)
    expect(runtime.report('ws-1')?.nextEarliestRunAt).toBe('2026-01-01T00:01:00.000Z')
    await runtime.runAlign('ws-1')
    expect(runtime.report('ws-1')?.suspendedReason).toBe('2 consecutive failures; resume the workspace to retry')
  })

  it('clears the failure count after a successful run', async () => {
    const { runtime } = await harness({ config: cleanAlignConfig })
    await runtime.runAlign('ws-1')
    expect(runtime.report('ws-1')?.consecutiveFailures).toBe(0)
  })

  it('resumes a suspended workspace and reports a workspace that was not suspended', async () => {
    const config: Config = suspendAfterOneConfig
    const { runtime } = await harness({ config, observeError: new Error('boom') })
    await runtime.runAlign('ws-1')
    expect(runtime.report('ws-1')?.suspendedReason).not.toBe(null)
    expect(await runtime.resume('ws-1')).toBe(true)
    expect(runtime.report('ws-1')?.suspendedReason).toBe(null)
    expect(await runtime.resume('ws-1')).toBe(false)
  })
})

describe('timers', () => {
  it('arms one timer per covered workspace with the jittered interval', async () => {
    const { armed } = await harness({ config: cleanAlignConfig, workspaces: [WORKSPACE] })
    expect(armed).toHaveLength(1)
    expect(armed[0]?.delayMs).toBe(600_000)
    armed[0]?.run()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(armed[0]?.cancelled).toBe(false)
  })

  it('arms nothing while the runtime is disabled', async () => {
    const { armed } = await harness({ config: { enabled: false } })
    expect(armed).toEqual([])
  })

  it('re-arms when the workspace domain changes and ignores other domains', async () => {
    const { ctx, armed } = await harness({ config: cleanAlignConfig })
    armed.length = 0
    ctx.emit('domain/changed', { domain: 'workspace_automation', table: 'workspaces', key: 'ws-1', operation: 'put', value: {} })
    expect(armed).toEqual([])
    ctx.emit('domain/changed', { domain: 'workspace', table: 'workspaces', key: 'ws-1', operation: 'put', value: {} })
    expect(armed).toHaveLength(1)
  })

  it('cancels every timer when the fiber is disposed', async () => {
    const { fiber, armed } = await harness({ config: cleanAlignConfig })
    expect(armed).toHaveLength(1)
    await fiber.dispose()
    expect(armed[0]?.cancelled).toBe(true)
  })

  it('logs a rejected scheduled run instead of failing the timer', async () => {
    const { ctx, armed } = await harness({ config: cleanAlignConfig, workspacesFailsAfter: 2 })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    armed[0]?.run()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alignment run for "ws-1" rejected'))
  })

  it('arms real unref-ed timers through the default scheduler', async () => {
    const { runtime, fiber } = await harness({ config: cleanAlignConfig, manual: false })
    expect(runtime.report('ws-1')).toBe(undefined)
    await fiber.dispose()
  })

  it('rejects an override naming an unregistered workspace', async () => {
    await expect(harness({ config: unknownWorkspaceConfig }))
      .rejects.toThrow('names unregistered workspace "ws-missing"')
  })

  it('rejects an override that turns on align mode without a deployment worktree root', async () => {
    await expect(harness({ config: { enabled: true, workspaces: { 'ws-1': { mode: 'align' } } } }))
      .rejects.toThrow('worktreeRoot is required')
  })

  it('reads the workspace list from the registry when no seam is installed', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('git', { observe: async () => ({ kind: 'absent' }) } as never)
    ctx.provide('gitAlign', {} as never)
    ctx.provide('fs', {} as never)
    ctx.provide('workspaceRegistry', { list: () => [WORKSPACE] } as never)
    await ctx.plugin(WorkSummaryService, {})
    await ctx.plugin(WorkspaceAutomationRuntime, { enabled: true, intervalSeconds: 600 })
    const runtime = ctx.get('workspaceAutomation')
    expect(runtime?.report('ws-1')).toBe(undefined)
    expect((await runtime?.runAlign('ws-1'))?.outcome).toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('skips a commit run while another writer holds the lease', async () => {
    const { runtime, facility } = await harness({ config: { enabled: true, commit: { enabled: true } } })
    await seed(facility, 'ws-1', { leaseOwner: 'other', leaseUntil: '2026-01-01T00:10:00.000Z' })
    expect((await runtime.runCommit('ws-1', fakeSession('sess-1', []), 2)).outcome).toEqual({ kind: 'skipped-locked' })
  })
})

describe('runCommit', () => {
  const commitConfig: Config = {
    enabled: true,
    mode: 'align',
    worktreeRoot: '/scratch',
    commit: { enabled: true },
  }
  const events = [call(2, 'c1', 'write', { file_path: 'src/a.ts' }), result('c1'), turnEnd(2)]
  const session = (): Session => fakeSession('sess-1', events)

  it('does nothing while the commit job is disabled', async () => {
    const { runtime } = await harness({ config: { enabled: true } })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'observe-only' })
  })

  it('reports a workspace the runtime does not cover', async () => {
    const { runtime } = await harness({ config: commitConfig })
    expect((await runtime.runCommit('ws-other', session(), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('records a failed observation', async () => {
    const { runtime } = await harness({ config: commitConfig, observeError: new Error('git unavailable') })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'failed', reason: 'observe', detail: 'git unavailable' })
  })

  it('reports a directory outside any repository', async () => {
    const { runtime } = await harness({ config: commitConfig, observations: [{ kind: 'absent' }] })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'no-repository' })
  })

  it('refuses a detached HEAD', async () => {
    const { runtime } = await harness({ config: commitConfig, observations: [snapshot({ branch: null })] })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'detached-head', paths: [] })
  })

  it('refuses to commit in a repository carrying a colocated Jujutsu workspace', async () => {
    const { runtime, script } = await harness({ config: commitConfig, colocatedJj: true })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'colocated-vcs', paths: [] })
    expect(script.calls).toEqual(['observe'])
  })

  it('reports a branch with no upstream', async () => {
    const { runtime } = await harness({ config: commitConfig, observations: [snapshot({ upstream: null })] })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'no-upstream' })
  })

  it('reports a turn that wrote nothing attributable', async () => {
    const { runtime } = await harness({ config: commitConfig })
    expect((await runtime.runCommit('ws-1', fakeSession('sess-1', []), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'no-attributable-paths' })
  })

  it('refuses paths an earlier uncommitted work unit also wrote', async () => {
    const shared = [
      call(1, 'c0', 'write', { file_path: 'src/a.ts' }),
      result('c0'),
      turnEnd(1),
      call(2, 'c1', 'write', { file_path: 'src/a.ts' }),
      result('c1'),
      turnEnd(2),
      call(3, 'c2', 'write', { file_path: 'src/a.ts' }),
      result('c2'),
      turnEnd(3),
    ]
    const { runtime } = await harness({ config: commitConfig })
    expect((await runtime.runCommit('ws-1', fakeSession('sess-1', shared), 3)).outcome)
      .toEqual({ kind: 'ambiguous-attribution', paths: ['src/a.ts'] })
  })

  it('records a failed diff-facts read', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'failed', failure: { code: 'command-failed', detail: 'diff exited 1' } },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'failed', reason: 'commit', detail: 'command-failed: diff exited 1' })
  })

  it('reports no attributable paths when nothing differs from HEAD', async () => {
    const { runtime } = await harness({ config: commitConfig })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'unattributable-remainder', paths: [] })
  })

  it('refuses a staging set past the bound', async () => {
    const { runtime } = await harness({
      config: { enabled: true, mode: 'align', worktreeRoot: '/scratch', commit: { enabled: true, maxPathsPerCommit: 1 } },
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }, { path: 'src/b.ts', insertions: 1, deletions: 0, binary: false }], insertions: 2, deletions: 0 } },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'too-many-paths', paths: ['src/a.ts'] })
  })

  it('records a failed ignore check', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      ignored: { kind: 'failed', failure: { code: 'command-failed', detail: 'check-ignore exited 1' } },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'failed', reason: 'commit', detail: 'command-failed: check-ignore exited 1' })
  })

  it('reports no attributable paths when git ignores every candidate', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      ignored: { kind: 'checked', ignored: ['src/a.ts'] },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'no-op', reason: 'no-attributable-paths' })
  })

  it('refuses when a candidate cannot be read for the credential screen', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      readFails: true,
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'unreadable-path', paths: ['src/a.ts'] })
  })

  it('refuses a candidate that carries a declared credential shape', async () => {
    const { runtime, script } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      files: { [`${ROOT}/src/a.ts`]: 'const key = "sk-abcdefghijklmnop"' },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'refused', reason: 'secrets', paths: ['src/a.ts'] })
    expect(script.calls).not.toContain('commit')
  })

  it('records a failed commit', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      commit: { kind: 'failed', failure: { code: 'command-failed', detail: 'commit exited 1' }, indexRestored: true },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'failed', reason: 'commit', detail: 'command-failed: commit exited 1' })
  })

  it('records a commit whose HEAD did not advance', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).outcome)
      .toEqual({ kind: 'failed', reason: 'commit', detail: 'HEAD did not advance after the commit' })
  })

  it('records a commit with its withdrawal report and watermark', async () => {
    const { runtime, ctx } = await harness({
      config: commitConfig,
      observations: [snapshot({ worktree: ['notes.md', 'src/a.ts'] }), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 3, deletions: 1, binary: false }], insertions: 3, deletions: 1 } },
      files: { [`${ROOT}/src/a.ts`]: 'const a = 1' },
    })
    const record = await runtime.runCommit('ws-1', session(), 2)
    expect(record.outcome).toEqual({ kind: 'committed', sessionId: 'sess-1', turn: 2 })
    expect(record.commit).toMatchObject({
      oid: 'commit-1',
      parentOid: 'head-1',
      paths: ['src/a.ts'],
      summarySource: 'mechanical',
      withdrawable: true,
      softReset: 'git reset --soft head-1',
      mixedReset: 'git reset --mixed head-1',
    })
    expect(record.commit?.subject).toBe('chore(src): update 1 file(s), +3/-1')
    expect(runtime.report('ws-1')?.uncommittedPaths).toEqual(['notes.md'])
    expect(runtime.report('ws-1')?.ledger).toHaveLength(1)
    void ctx
  })

  it('records a commit whose observation omitted the commit id', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      observations: [snapshot({ omit: ['oid'] }), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
    })
    const record = await runtime.runCommit('ws-1', session(), 2)
    expect(record.outcome).toEqual({ kind: 'committed', sessionId: 'sess-1', turn: 2 })
    expect(record.expectedHeadOid).toBe(null)
    expect(record.commit?.parentOid).toBe('')
  })

  it('records a provider-written message with its body', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      observations: [snapshot(), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      proposal: { subject: 'feat(git): align the work tree', body: ['Aligns on the timer.', 'Keeps the remote untouched.'] },
    })
    const record = await runtime.runCommit('ws-1', session(), 2)
    expect(record.commit?.summarySource).toBe('provider')
    expect(record.commit?.subject).toBe('feat(git): align the work tree')
    expect(record.commit?.body).toEqual(['Aligns on the timer.', 'Keeps the remote untouched.'])
  })

  it('records a provider message that carries no body', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      observations: [snapshot(), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      proposal: { subject: 'chore(git): refresh the checkout', body: [] },
    })
    const record = await runtime.runCommit('ws-1', session(), 2)
    expect(record.commit?.summarySource).toBe('provider')
    expect(record.commit?.body).toEqual([])
  })

  it('reports a commit a remote already contains as no longer withdrawable', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      observations: [snapshot(), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      pushed: { kind: 'checked', pushed: true },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).commit?.withdrawable).toBe(false)
  })

  it('treats an unanswerable push check as not withdrawable', async () => {
    const { runtime } = await harness({
      config: commitConfig,
      observations: [snapshot(), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
      pushed: { kind: 'failed', failure: { code: 'git-unavailable', detail: 'no git' } },
    })
    expect((await runtime.runCommit('ws-1', session(), 2)).commit?.withdrawable).toBe(false)
  })

  it('logs a rejected commit job instead of failing the event listener', async () => {
    const { ctx } = await harness({ config: commitConfig, workspacesFailsAfter: 3 })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.emit('session/event', session(), turnEnd(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('commit job for "ws-1" rejected'))
  })

  it('runs the commit job from a turn boundary the session emits', async () => {
    const { ctx, runtime } = await harness({
      config: commitConfig,
      observations: [snapshot(), snapshot({ oid: 'commit-1' })],
      facts: { kind: 'facts', facts: { files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 } },
    })
    ctx.emit('session/event', session(), turnEnd(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runtime.report('ws-1')?.lastOutcome).toBe('committed:sess-1/2')
  })

  it('ignores a turn boundary from a session no workspace owns', async () => {
    const { ctx, runtime } = await harness({ config: commitConfig })
    ctx.emit('session/event', fakeSession('sess-other', []), turnEnd(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runtime.report('ws-1')).toBe(undefined)
  })

  it('ignores a session event that is not a turn boundary', async () => {
    const { ctx, runtime } = await harness({ config: commitConfig })
    ctx.emit('session/event', session(), events[0] as SessionEvent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runtime.report('ws-1')).toBe(undefined)
  })
})

describe('workspace registry seam', () => {
  it('fails loud when neither the seam nor the registry is available', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('git', { observe: async () => ({ kind: 'absent' }) } as never)
    ctx.provide('gitAlign', {} as never)
    ctx.provide('fs', {} as never)
    await ctx.plugin(WorkSummaryService, {})
    await expect(ctx.plugin(WorkspaceAutomationRuntime, { enabled: true }))
      .rejects.toThrow('ctx.workspaceRegistry is not mounted')
  })
})

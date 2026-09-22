/**
 * Real-composition suite for the workspace automation runtime. It boots a
 * test-only `cordis.yml` through the Loader with the real plugin behind every
 * injected service, then asserts what one run leaves behind: a row in the
 * `workspace_automation` ledger and the git state itself.
 *
 * The scripted LLM adapter is the only substitution, because the summarization
 * model is the one external, nondeterministic dependency. Storage, the
 * workspace registry, session persistence, git observation, git alignment, and
 * the filesystem are the production plugins.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalGitAligner from '@deepseek-ai/dsh-git-align-local'
import LocalGitObserver from '@deepseek-ai/dsh-git-local'
import LlmRuntime, { LlmAdapter, ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as storageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkSummaryService from '@deepseek-ai/dsh-work-summary'
import * as workSummaryLlmPlugin from '@deepseek-ai/dsh-work-summary-llm'
import WorkspaceAutomationRuntime from '@deepseek-ai/dsh-workspace-automation'
import type { RunRecord } from '@deepseek-ai/dsh-workspace-automation'

const exec = promisify(execFile)

/** The one model reply the scripted adapter returns; the commit subject must match it. */
const SUMMARY_SUBJECT = 'docs: record the loader composition note'

/** Bound on the wait for the commit job's durable ledger row. */
const COMMIT_SETTLE_MS = 30_000

/** Temp directories and contexts this suite created; both are released after each test. */
const owned: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  while (owned.length > 0) await rm(owned.pop() as string, { recursive: true, force: true })
})

/** A fresh directory this suite owns. */
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  owned.push(dir)
  return dir
}

/** Run git in a directory and answer its stdout. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout
}

/** Give a repository the fixed commit identity every fixture commit uses. */
async function initIdentity(cwd: string): Promise<void> {
  await git(cwd, 'config', 'user.email', 'probe@invalid')
  await git(cwd, 'config', 'user.name', 'probe')
  // A host-level signing requirement is not part of what this suite composes.
  await git(cwd, 'config', 'commit.gpgsign', 'false')
}

/** Scripted summarization model: one fixed proposal and no network. */
class ScriptedSummaryAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: SUMMARY_SUBJECT }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** One booted composition: the context, the services it provides, and its repository. */
interface Composition {
  readonly ctx: Context
  readonly runtime: WorkspaceAutomationRuntime
  readonly registry: WorkspaceRegistry
  readonly adapter: ScriptedSummaryAdapter
  readonly work: string
  /** The json backend's root, where the `workspace_automation` unit is persisted. */
  readonly storageRoot: string
  /** The bare origin's `main` object id after the fixture advanced it. */
  readonly originMain: string
}

/**
 * Build one work repository whose bare origin already advanced by one commit.
 * @param root - directory this suite owns that holds every fixture directory.
 * @returns the work tree and the origin revision the alignment must reach.
 */
async function repositoryFixture(root: string): Promise<{ work: string; originMain: string }> {
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  const other = join(root, 'other')
  await mkdir(origin, { recursive: true })
  await mkdir(work, { recursive: true })
  await git(origin, 'init', '--bare')
  await git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  await git(work, 'init')
  await git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  await initIdentity(work)
  await writeFile(join(work, 'shared.txt'), 'base\n')
  await git(work, 'add', '-A')
  await git(work, 'commit', '-m', 'init')
  await git(work, 'remote', 'add', 'origin', origin)
  await git(work, 'push', '-u', 'origin', 'main')

  await exec('git', ['clone', origin, other])
  await initIdentity(other)
  await writeFile(join(other, 'shared.txt'), 'base\nremote\n')
  await git(other, 'add', '-A')
  await git(other, 'commit', '-m', 'advance origin')
  await git(other, 'push', 'origin', 'main')
  // The runtime decides from the remote-tracking ref it can already see, so the
  // fixture fetches the advance without merging it: HEAD stays one commit
  // behind `origin/main`, which is the staleness the alignment job acts on.
  await git(work, 'fetch', 'origin')
  return { work, originMain: (await git(origin, 'rev-parse', 'main')).trim() }
}

/**
 * Boot the declared plugin graph through the Loader over a fresh repository.
 * @returns the running composition, owned by this suite until teardown.
 */
async function compose(): Promise<Composition> {
  const root = await freshDir('dsh-workspace-automation-')
  const storageRoot = join(root, 'storage')
  const sessionsRoot = join(root, 'sessions')
  const probeRoot = join(root, 'probe')
  await mkdir(sessionsRoot, { recursive: true })
  await mkdir(probeRoot, { recursive: true })
  const { work, originMain } = await repositoryFixture(root)

  const configPath = join(root, 'cordis.yml')
  // The entry-level `inject` is the one ordering edge this graph needs: the
  // runtime reads `ctx.workspaceRegistry` inside its own initializer without
  // declaring it, so a Loader that starts both entries concurrently fails the
  // runtime's load with "ctx.workspaceRegistry is not mounted" unless the
  // registry's fiber is already active.
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: '${storageRoot}'`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    "    backend: 'json'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: '${sessionsRoot}'`,
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    "- name: '@deepseek-ai/dsh-git-local'",
    "- name: '@deepseek-ai/dsh-git-align-local'",
    "- name: '@deepseek-ai/dsh-work-summary'",
    "- name: '@deepseek-ai/dsh-work-summary-llm'",
    '  config:',
    "    provider: 'loader-route'",
    "    model: 'loader-model'",
    "- name: '@deepseek-ai/dsh-workspace-automation'",
    '  inject: [workspaceRegistry]',
    '  config:',
    '    enabled: true',
    "    mode: 'align'",
    '    intervalSeconds: 300',
    '    jitterRatio: 0',
    `    worktreeRoot: '${probeRoot}'`,
    '    commit:',
    '      enabled: true',
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', storageJsonPlugin],
    ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-git-local', LocalGitObserver],
    ['@deepseek-ai/dsh-git-align-local', LocalGitAligner],
    ['@deepseek-ai/dsh-work-summary', WorkSummaryService],
    ['@deepseek-ai/dsh-work-summary-llm', workSummaryLlmPlugin],
    ['@deepseek-ai/dsh-workspace-automation', WorkspaceAutomationRuntime],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  if (unloaded.length > 0) throw new Error(`the Loader left plugins unloaded: ${unloaded.join(', ')}`)

  const runtime = ctx.get('workspaceAutomation')
  const registry = ctx.get('workspaceRegistry')
  if (runtime === undefined || registry === undefined) {
    throw new Error('the composition did not provide ctx.workspaceAutomation and ctx.workspaceRegistry')
  }
  const adapter = new ScriptedSummaryAdapter()
  ctx.llm.registerAdapter(['loader-route'], adapter)
  return { ctx, runtime, registry, adapter, work, storageRoot, originMain }
}

/**
 * The ledger row one workspace's state carries in the persisted json unit.
 *
 * `runtime.report()` reads the domain's in-memory snapshot; this reads the
 * medium the composition declared, so the assertion is about durability rather
 * than about a return value.
 * @param storageRoot - the json backend's root directory.
 * @param workspaceId - workspace whose stored state is read.
 * @returns the persisted run records.
 */
async function persistedLedger(storageRoot: string, workspaceId: string): Promise<readonly unknown[]> {
  const document = JSON.parse(await readFile(join(storageRoot, 'workspace_automation.json'), 'utf8')) as {
    tables: { workspaces: Record<string, { ledger: readonly unknown[] } | undefined> }
  }
  return document.tables.workspaces[workspaceId]?.ledger ?? []
}

/**
 * The first recorded run of one job, awaited until the durable ledger carries it.
 *
 * The commit job is dispatched from the runtime's session event listener
 * without a returned promise, so the durable ledger row is its only completion
 * signal; the run itself is deterministic and the wait is bounded.
 * @param runtime - the running automation runtime.
 * @param workspaceId - workspace whose ledger is read.
 * @param job - the job to wait for.
 * @returns the recorded run.
 */
async function awaitRun(
  runtime: WorkspaceAutomationRuntime,
  workspaceId: string,
  job: RunRecord['job'],
): Promise<RunRecord> {
  const deadline = Date.now() + COMMIT_SETTLE_MS
  for (;;) {
    const record = runtime.report(workspaceId)?.ledger.find(candidate => candidate.job === job)
    if (record !== undefined) return record
    if (Date.now() >= deadline) {
      const observed = JSON.stringify(runtime.report(workspaceId)?.ledger ?? [])
      throw new Error(`the ${job} job recorded no ledger row within ${COMMIT_SETTLE_MS}ms; ledger: ${observed}`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('workspace-automation Loader composition', () => {
  it('records a real alignment run in the durable ledger and advances the work tree', async () => {
    const composition = await compose()
    const workspace = await composition.registry.create(composition.work)

    await composition.runtime.runAlign(workspace.id)

    const report = composition.runtime.report(workspace.id)
    expect(report?.ledger.map(record => record.outcome)).toEqual([{ kind: 'aligned', strategy: 'ff-only' }])
    expect(report?.ledger[0]).toMatchObject({ job: 'align', trigger: 'due' })
    expect(await persistedLedger(composition.storageRoot, workspace.id)).toMatchObject([
      { job: 'align', outcome: { kind: 'aligned', strategy: 'ff-only' } },
    ])
    expect((await git(composition.work, 'rev-parse', 'HEAD')).trim()).toBe(composition.originMain)
    expect(await readFile(join(composition.work, 'shared.txt'), 'utf8')).toBe('base\nremote\n')
  })

  it('commits the paths one closed turn was proven to have written', async () => {
    const composition = await compose()
    const workspace = await composition.registry.create(composition.work)
    const relative = 'notes/loader-note.txt'
    await mkdir(join(composition.work, 'notes'), { recursive: true })
    await writeFile(join(composition.work, relative), 'composed through the Loader\n')

    const session = composition.ctx.sessions.create(SessionId('loader-commit'), {
      meta: { cwd: workspace.path },
    })
    await workspace.attachSession(session.id)
    const callId = ToolCallId('loader-write-1')
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'write',
      arguments: JSON.stringify({ file_path: join(workspace.path, relative) }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'wrote the note' }], isError: false }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const record = await awaitRun(composition.runtime, workspace.id, 'commit')

    expect(record.outcome).toEqual({ kind: 'committed', sessionId: session.id, turn: 1 })
    expect(record.commit?.paths).toEqual([relative])
    expect((await git(composition.work, 'log', '-1', '--format=%s')).trim()).toBe(SUMMARY_SUBJECT)
    expect(await git(composition.work, 'log', '-1', '--format=%B')).toContain(`Dsh-Unit: ${session.id}/1`)
    expect((await git(composition.work, 'show', '--name-only', '--format=', 'HEAD')).trim()).toBe(relative)
    // The subject above already proves the model was consulted; this pins the
    // route the cordis.yml declared to the provider.
    expect(composition.adapter.requests[0]).toMatchObject({ provider: 'loader-route', model: 'loader-model' })
  })
})

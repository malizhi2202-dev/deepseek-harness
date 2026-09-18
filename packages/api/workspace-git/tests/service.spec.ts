/**
 * Tests for the `workspaceGit` Remote service: the session's workspace root is
 * what gets observed, git seam failures cross the wire as their declared codes,
 * and cancellation reaches the seam.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { LocalGitObserver } from '@deepseek-ai/dsh-git-local'
import WorkspaceGit from '../src/index.ts'

const exec = promisify(execFile)

/** The Agent shape the service reads: only its session reaches the policy. */
const agent = { id: 'a-test', session: { id: 's-test' } } as unknown as Agent

/** Temp directories this suite created; removed in `afterEach`. */
const owned: string[] = []

afterEach(async () => {
  while (owned.length > 0) await rm(owned.pop() as string, { recursive: true, force: true })
})

/** One temp workspace, the git provider, and the endpoint over both. */
async function openWorkspace(): Promise<{
  workspace: string
  provider: LocalGitObserver
  endpoint: WorkspaceGit
  readonly dispose: () => Promise<void>
}> {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-workspace-git-'))
  owned.push(workspace)
  const ctx = new Context()
  const providerFiber = await ctx.plugin(LocalGitObserver)
  // The policy is the service's only source for the workspace root, so the
  // fake supplies exactly that and nothing else.
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } as never)
  const provider = ctx.get('git')
  if (provider === undefined) throw new Error('LocalGitObserver did not register as ctx.git')
  // The mounted plugin is the LocalGitObserver by construction here; the seam
  // type is what `ctx.get` answers, so the test reaches its own class through
  // one documented cast.
  const local = provider as LocalGitObserver
  // Constructed directly, as the workspace-files harness does: mounting the
  // class as a plugin would wait on the gateway's `typert` service, which a
  // bare test Context does not carry.
  const endpoint = new WorkspaceGit(ctx)
  return {
    workspace,
    provider: local,
    endpoint,
    dispose: async () => {
      await providerFiber.dispose()
    },
  }
}

/** Run git in a directory, quietly. */
async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec('git', args, { cwd })
}

describe('WorkspaceGit.observe', () => {
  it('answers absent for a workspace outside any repository', async () => {
    const { endpoint, dispose } = await openWorkspace()
    expect(await endpoint.observe(agent, new AbortController().signal)).toEqual({ kind: 'absent' })
    await dispose()
  })

  it('observes the repository containing the session workspace root', async () => {
    const { workspace, endpoint, dispose } = await openWorkspace()
    await git(workspace, 'init')
    await git(workspace, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    await git(workspace, 'config', 'user.email', 'probe@invalid')
    await git(workspace, 'config', 'user.name', 'probe')
    await writeFile(join(workspace, 'a.txt'), 'one\n')
    await git(workspace, 'add', 'a.txt')
    await git(workspace, 'commit', '-m', 'first')
    const answer = await endpoint.observe(agent, new AbortController().signal)
    expect(answer).toMatchObject({
      kind: 'repository',
      root: workspace,
      head: { branch: 'main' },
      history: [{ subject: 'first' }],
    })
    await dispose()
  })

  it('carries a git that cannot be run across the wire as the declared unavailable code', async () => {
    const { endpoint, provider, dispose } = await openWorkspace()
    provider.internals.run = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    }
    try {
      await endpoint.observe(agent, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      const failure = remoteErrorOf(error)
      if (failure === undefined) throw new Error('expected a RemoteError')
      expect(failure.code).toBe('workspace-git/unavailable')
    }
    await dispose()
  })

  it('carries a command failure across the wire as the declared failed code', async () => {
    const { endpoint, provider, dispose } = await openWorkspace()
    provider.internals.run = async (_command, args) => {
      if (args.join(' ').includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      throw Object.assign(new Error('Command failed: git status'), { code: 128, stderr: 'fatal: bad object HEAD\n' })
    }
    try {
      await endpoint.observe(agent, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      const failure = remoteErrorOf(error)
      if (failure === undefined) throw new Error('expected a RemoteError')
      expect(failure.code).toBe('workspace-git/failed')
    }
    await dispose()
  })

  it('carries a seam failure the git vocabulary does not classify as the failed code', async () => {
    const { endpoint, provider, dispose } = await openWorkspace()
    provider.observe = async () => {
      throw new Error('seam exploded')
    }
    try {
      await endpoint.observe(agent, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      const failure = remoteErrorOf(error)
      if (failure === undefined) throw new Error('expected a RemoteError')
      expect(failure.code).toBe('workspace-git/failed')
      expect(failure.message).toBe('seam exploded')
    }
    await dispose()
  })

  it('carries a seam failure that is not an Error as the failed code, naming it', async () => {
    const { endpoint, provider, dispose } = await openWorkspace()
    provider.observe = async () => {
      throw 'seam exploded'
    }
    try {
      await endpoint.observe(agent, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      const failure = remoteErrorOf(error)
      if (failure === undefined) throw new Error('expected a RemoteError')
      expect(failure.code).toBe('workspace-git/failed')
      expect(failure.message).toBe('seam exploded')
    }
    await dispose()
  })

  it('passes cancellation through to the seam', async () => {
    const { endpoint, provider, dispose } = await openWorkspace()
    let observedSignal: AbortSignal | undefined
    provider.internals.run = async (_command, _args, signal) => {
      observedSignal = signal
      await new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason as Error)
          return
        }
        signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
      })
      throw new Error('unreachable')
    }
    const controller = new AbortController()
    const pending = endpoint.observe(agent, controller.signal)
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
    expect(observedSignal?.aborted).toBe(true)
    await dispose()
  })
})

/**
 * Tests for the local git observation service: the scripted-runner contract
 * (absent answer, failure classification, truncation flags) and the live
 * repository reads (branch facts, history, worktree entries) over a temp
 * repository this suite creates and owns.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitError, MAX_OBSERVATION_ITEMS } from '@deepseek-ai/dsh-git'
import { LocalGitObserver } from '../src/index.ts'

const exec = promisify(execFile)

/** Temp directories this suite created; removed in `afterEach`. */
const owned: string[] = []

afterEach(async () => {
  while (owned.length > 0) await rm(owned.pop() as string, { recursive: true, force: true })
})

/** A fresh empty directory this suite owns. */
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  owned.push(dir)
  return dir
}

/** Run git in a directory, quietly. */
async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec('git', args, { cwd })
}

/** Create a repository on a named initial branch, portably across git versions. */
async function initRepo(cwd: string, branch: string): Promise<void> {
  await git(cwd, 'init')
  await git(cwd, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  await git(cwd, 'config', 'user.email', 'probe@invalid')
  await git(cwd, 'config', 'user.name', 'probe')
}

/** A mounted LocalGitObserver on a fresh context, with the fiber to dispose. */
async function mount(): Promise<{ fiber: { dispose(): Promise<void> }; service: LocalGitObserver }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalGitObserver)
  const service = ctx.get('git')
  if (service === undefined) throw new Error('LocalGitObserver did not register as ctx.git')
  // The mounted plugin is the LocalGitObserver by construction here; the seam
  // type is what `ctx.get` answers, so the test reaches its own class through
  // one documented cast.
  return { fiber, service: service as LocalGitObserver }
}

describe('LocalGitObserver against scripted git output', () => {
  it('answers absent for a directory that does not exist', async () => {
    const { fiber, service } = await mount()
    const answer = await service.observe(join(await freshDir('dsh-git-none-'), 'missing'), new AbortController().signal)
    expect(answer).toEqual({ kind: 'absent' })
    await fiber.dispose()
  })

  it('answers absent for the exit code git gives outside any work tree, whatever the message language', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-absent-')
    service.internals.run = async () => {
      throw Object.assign(new Error('Command failed: git rev-parse --show-toplevel'), { code: 128, stderr: 'fatal: 不是 git 仓库（或者任何父目录）：.git\n' })
    }
    expect(await service.observe(dir, new AbortController().signal)).toEqual({ kind: 'absent' })
    await fiber.dispose()
  })

  it('classifies a git that cannot be run as unavailable', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-missing-')
    service.internals.run = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    }
    await expect(service.observe(dir, new AbortController().signal)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' })
    await fiber.dispose()
  })

  it('classifies a command that ran and failed as command-failed', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-broken-')
    service.internals.run = async (_command, args) => {
      if (args.join(' ').includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      throw Object.assign(new Error('Command failed: git status'), { code: 128, stderr: 'fatal: bad object HEAD\n' })
    }
    await expect(service.observe(dir, new AbortController().signal)).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' })
    await fiber.dispose()
  })

  it('reads a repository from the scripted output of all three commands', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-scripted-')
    const N = '\0'
    const calls: string[][] = []
    service.internals.run = async (_command, args) => {
      calls.push([...args])
      const argv = args.join(' ')
      if (argv.includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      if (argv.includes('status')) {
        return {
          stdout: `# branch.oid 868919447ee24b11c2ae361450fbe8cbbcf2596a${N}# branch.head main${N}1 .M N... 100644 100644 100644 h h a.txt${N}`,
          stderr: '',
        }
      }
      if (argv.includes('for-each-ref')) {
        return { stdout: 'main\x1f868919447ee24b11c2ae361450fbe8cbbcf2596a\x1e\n', stderr: '' }
      }
      return { stdout: '868919447ee24b11c2ae361450fbe8cbbcf2596a\x1fp\x1fprobe\x1f2026-09-18T13:20:05+08:00\x1fsecond\x1e\n', stderr: '' }
    }
    const answer = await service.observe(dir, new AbortController().signal)
    expect(answer).toEqual({
      kind: 'repository',
      root: '/work/repo',
      head: { oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a', branch: 'main' },
      branches: [{ name: 'main', tip: '868919447ee24b11c2ae361450fbe8cbbcf2596a' }],
      branchesTruncated: false,
      history: [{
        oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a',
        parents: ['p'],
        author: 'probe',
        authoredAt: '2026-09-18T13:20:05+08:00',
        subject: 'second',
      }],
      historyTruncated: false,
      worktree: [{ kind: 'changed', path: 'a.txt', unstaged: 'modified' }],
      worktreeTruncated: false,
    })
    // Every command after the toplevel probe names the repository root.
    expect(calls[1]?.[3]).toBe('status')
    expect(calls[1]?.[2]).toBe('/work/repo')
    await fiber.dispose()
  })

  it('skips the history read for an unborn branch', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-unborn-')
    const N = '\0'
    const asked: string[] = []
    service.internals.run = async (_command, args) => {
      asked.push(args.join(' '))
      const argv = args.join(' ')
      if (argv.includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      if (argv.includes('status')) return { stdout: `# branch.oid (initial)${N}# branch.head main${N}`, stderr: '' }
      return { stdout: '', stderr: '' }
    }
    const answer = await service.observe(dir, new AbortController().signal)
    expect(answer).toMatchObject({
      kind: 'repository',
      head: { branch: 'main' },
      history: [],
      historyTruncated: false,
    })
    expect(asked.some(argv => argv.includes('log'))).toBe(false)
    await fiber.dispose()
  })

  it('flags truncation exactly when a list crosses the bound', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-truncated-')
    const N = '\0'
    const oid = '8'.repeat(40)
    service.internals.run = async (_command, args) => {
      const argv = args.join(' ')
      if (argv.includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      if (argv.includes('status')) {
        const entries = Array.from({ length: MAX_OBSERVATION_ITEMS + 1 }, (_, i) => `? file-${i}.txt${N}`).join('')
        return { stdout: `# branch.oid ${oid}${N}# branch.head main${N}${entries}`, stderr: '' }
      }
      if (argv.includes('for-each-ref')) return { stdout: '', stderr: '' }
      // One commit past the bound, as the `-n` over-read asks for.
      const commits = Array.from({ length: MAX_OBSERVATION_ITEMS + 1 }, () => `${oid}\x1f\x1f\x1fprobe\x1f2026-09-18T13:20:05+08:00\x1fsubject\x1e`).join('')
      return { stdout: commits, stderr: '' }
    }
    const answer = await service.observe(dir, new AbortController().signal)
    if (answer.kind !== 'repository') throw new Error('scripted repository answer expected')
    expect(answer.worktree).toHaveLength(MAX_OBSERVATION_ITEMS)
    expect(answer.worktreeTruncated).toBe(true)
    expect(answer.history).toHaveLength(MAX_OBSERVATION_ITEMS)
    expect(answer.historyTruncated).toBe(true)
    await fiber.dispose()
  })
})

describe('LocalGitObserver against a live repository', () => {
  it('passes a caller cancellation through as itself, not a git failure', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-cancel-')
    service.internals.run = async (_command, args, signal) => {
      if (args.join(' ').includes('rev-parse')) return { stdout: '/work/repo\n', stderr: '' }
      return await new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('caller cancelled'))
          return
        }
        signal.addEventListener('abort', () => { reject(new Error('caller cancelled')) }, { once: true })
      })
    }
    const controller = new AbortController()
    const pending = service.observe(dir, controller.signal)
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
    await fiber.dispose()
  })

  it('classifies a runner that throws a non-Error as unavailable, naming it', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-noterror-')
    const thrown: unknown = 'git vanished'
    service.internals.run = async () => {
      throw thrown
    }
    try {
      await service.observe(dir, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      const failure = error as { code?: unknown; message?: unknown }
      expect(failure.code).toBe('GIT_UNAVAILABLE')
      expect(String(failure.message)).toContain('git vanished')
    }
    await fiber.dispose()
  })

  it('observes branches, history, and worktree state it created itself', async () => {
    const { fiber, service } = await mount()
    const root = await freshDir('dsh-git-live-')
    await initRepo(root, 'main')
    await writeFile(join(root, 'a.txt'), 'one\n')
    await git(root, 'add', 'a.txt')
    await git(root, 'commit', '-m', 'first')
    await writeFile(join(root, 'b.txt'), 'two\n')
    await git(root, 'add', 'b.txt')
    await git(root, 'commit', '-m', 'second')
    await writeFile(join(root, 'a.txt'), 'one changed\n')
    await writeFile(join(root, 'untracked.txt'), 'new\n')
    await git(root, 'checkout', '-b', 'feature')
    const answer = await service.observe(root, new AbortController().signal)
    if (answer.kind !== 'repository') throw new Error(`live repository answer expected, got ${answer.kind}`)
    expect(answer.root).toBe(root)
    expect(answer.head.branch).toBe('feature')
    expect(answer.head.oid).toMatch(/^[0-9a-f]{40}$/)
    expect(answer.branches.map(branch => branch.name)).toEqual(['feature', 'main'])
    expect(answer.history.map(commit => commit.subject)).toEqual(['second', 'first'])
    expect(answer.history.every(commit => commit.author === 'probe')).toBe(true)
    expect(answer.worktree).toEqual([
      { kind: 'changed', path: 'a.txt', unstaged: 'modified' },
      { kind: 'untracked', path: 'untracked.txt' },
    ])
    await fiber.dispose()
  })

  it('answers absent outside any repository', async () => {
    const { fiber, service } = await mount()
    const outside = await freshDir('dsh-git-outside-')
    expect(await service.observe(outside, new AbortController().signal)).toEqual({ kind: 'absent' })
    await fiber.dispose()
  })

  it('observes a subdirectory as its whole repository', async () => {
    const { fiber, service } = await mount()
    const root = await freshDir('dsh-git-subdir-')
    await initRepo(root, 'main')
    await writeFile(join(root, 'a.txt'), 'one\n')
    await git(root, 'add', 'a.txt')
    await git(root, 'commit', '-m', 'first')
    const answer = await service.observe(join(root, '.'), new AbortController().signal)
    expect(answer.kind).toBe('repository')
    await fiber.dispose()
  })
})

describe('GitError through the provider', () => {
  it('reaches the caller with the seam vocabulary', async () => {
    const { fiber, service } = await mount()
    const dir = await freshDir('dsh-git-error-')
    service.internals.run = async () => {
      throw Object.assign(new Error('Command failed'), { code: 'ENOENT' })
    }
    try {
      await service.observe(dir, new AbortController().signal)
      throw new Error('expected the observation to fail')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GitError)
    }
    await fiber.dispose()
  })
})

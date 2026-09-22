/**
 * Live-repository suite for the local git alignment provider. It drives the
 * real `runNativeCommand` boundary against a temp repository and a temp bare
 * origin this suite owns, so the argv the provider builds is observed rather
 * than described: the "never push" acceptance criterion is checked by recording
 * every argv and asserting the bare origin's branch never moves.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalGitAligner } from '@deepseek-ai/dsh-git-align-local'
import type { AlignSpec } from '@deepseek-ai/dsh-git-align'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

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

/** Run git in a directory and answer its stdout. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout
}

/** Create a repository on a named initial branch, portably across git versions. */
async function initRepo(cwd: string, branch: string): Promise<void> {
  await git(cwd, 'init')
  await git(cwd, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  await git(cwd, 'config', 'user.email', 'probe@invalid')
  await git(cwd, 'config', 'user.name', 'probe')
}

/** Commit every change in a directory under a fixed identity. */
async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-m', message)
}

/** Mount the provider; `record` wraps the production runner to observe argv. */
async function mount(record?: string[][]): Promise<{ aligner: LocalGitAligner; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalGitAligner)
  const aligner = ctx.get('gitAlign')
  if (!(aligner instanceof LocalGitAligner)) throw new Error('provider did not register as ctx.gitAlign')
  if (record !== undefined) {
    const runner: NativeCommandRunner = (command, args, signal) => {
      record.push([...args])
      return runNativeCommand(command, args, signal)
    }
    aligner.internals = { run: runner }
  }
  return { aligner, dispose: () => fiber.dispose() }
}

/** One repository with a bare origin that has already advanced by one commit. */
interface Fixture {
  readonly work: string
  readonly origin: string
  readonly spec: AlignSpec
  /** The origin's `main` object id at fixture time. */
  readonly originMain: string
}

/**
 * Build a work repository tracking a bare origin.
 * @param aligner - the mounted provider used to resolve the target.
 * @param advance - whether the origin also receives one commit the work tree lacks.
 * @returns the fixture's directories, resolved target, and origin revision.
 */
async function fixture(aligner: LocalGitAligner, advance = true): Promise<Fixture> {
  const origin = await freshDir('dsh-align-origin-')
  await git(origin, 'init', '--bare')
  await git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  const work = await freshDir('dsh-align-work-')
  await initRepo(work, 'main')
  await writeFile(join(work, 'shared.txt'), 'base\n')
  await writeFile(join(work, 'local.txt'), 'local\n')
  await commitAll(work, 'init')
  await git(work, 'remote', 'add', 'origin', origin)
  await git(work, 'push', '-u', 'origin', 'main')

  if (advance) {
    const other = await freshDir('dsh-align-other-')
    await exec('git', ['clone', origin, other])
    await git(other, 'config', 'user.email', 'probe@invalid')
    await git(other, 'config', 'user.name', 'probe')
    await writeFile(join(other, 'shared.txt'), 'base\nremote\n')
    await commitAll(other, 'advance origin')
    await git(other, 'push', 'origin', 'main')
  }

  return {
    work,
    origin,
    originMain: (await git(origin, 'rev-parse', 'main')).trim(),
    spec: aligner.resolve({
      root: work,
      branch: 'main',
      upstream: 'origin/main',
      expectedHeadOid: (await git(work, 'rev-parse', 'HEAD')).trim(),
    }),
  }
}

describe('LocalGitAligner against a live repository', () => {
  it('fetches, probes clean, and fast-forwards the work tree', async () => {
    const seen: string[][] = []
    const { aligner, dispose } = await mount(seen)
    const { work, spec } = await fixture(aligner)
    const signal = new AbortController().signal

    await expect(aligner.fetch(spec, signal)).resolves.toEqual({ kind: 'fetched' })
    await expect(aligner.probe(spec, { worktreeRoot: join(work, '..'), scratchName: 'probe-clean', maxConflictPaths: 10 }, signal))
      .resolves.toEqual({ kind: 'clean' })
    await expect(aligner.apply(spec, 'ff-only', signal)).resolves.toEqual({ kind: 'aligned', strategy: 'ff-only' })
    expect((await git(work, 'rev-parse', 'HEAD')).trim()).toBe((await git(work, 'rev-parse', 'origin/main')).trim())

    // The scratch tree the probe created is gone, so the work tree is clean.
    expect((await git(work, 'status', '--porcelain')).trim()).toBe('')
    expect(await git(work, 'worktree', 'list')).not.toContain('probe-clean')
    await dispose()
  }, 30_000)

  it('reports the conflicting paths a divergent upstream produces', async () => {
    const { aligner, dispose } = await mount()
    const { work, spec } = await fixture(aligner)
    await writeFile(join(work, 'shared.txt'), 'base\nwork side\n')
    await commitAll(work, 'work side')

    await expect(aligner.fetch(spec, new AbortController().signal)).resolves.toEqual({ kind: 'fetched' })
    const probe = await aligner.probe(
      spec,
      { worktreeRoot: join(work, '..'), scratchName: 'probe-conflict', maxConflictPaths: 10 },
      new AbortController().signal,
    )
    expect(probe).toEqual({ kind: 'conflicted', conflicts: { paths: ['shared.txt'], total: 1 } })
    // A probe never enters a merge in the target work tree.
    expect((await git(work, 'status', '--porcelain')).trim()).toBe('')
    expect((await git(work, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').catch(() => '')).trim()).toBe('')
    await dispose()
  }, 30_000)

  it('commits exactly the attributable path and leaves every other change alone', async () => {
    const seen: string[][] = []
    const { aligner, dispose } = await mount(seen)
    const { work, origin, spec } = await fixture(aligner, false)
    const signal = new AbortController().signal
    await writeFile(join(work, 'attributed.txt'), 'written by the work unit\n')
    await writeFile(join(work, 'local.txt'), 'a human half-finished edit\n')
    const before = (await git(origin, 'rev-parse', 'main')).trim()

    const facts = await aligner.changeFacts(spec, ['attributed.txt'], signal)
    expect(facts).toEqual({
      kind: 'facts',
      facts: {
        files: [{ path: 'attributed.txt', insertions: 1, deletions: 0, binary: false }],
        insertions: 1,
        deletions: 0,
      },
    })
    await expect(aligner.commit(
      spec,
      { paths: ['attributed.txt'], message: 'feat(work): add attributed file', runHooks: true },
      signal,
    )).resolves.toEqual({ kind: 'committed' })

    expect((await git(work, 'show', '--name-only', '--format=', 'HEAD')).trim()).toBe('attributed.txt')
    const status = await git(work, 'status', '--porcelain')
    expect(status).toContain('M local.txt')
    expect(status).not.toContain('attributed.txt')

    // The acceptance criterion: a commit is a local object, and nothing this
    // provider can do reaches the remote.
    expect((await git(origin, 'rev-parse', 'main')).trim()).toBe(before)
    expect(seen.flat().some(argument => argument === 'push')).toBe(false)
    expect(seen.some(argv => argv.includes('rebase'))).toBe(false)

    const oid = (await git(work, 'rev-parse', 'HEAD')).trim()
    await expect(aligner.pushedToRemote(spec, oid, signal)).resolves.toEqual({ kind: 'checked', pushed: false })
    await git(work, 'push', 'origin', 'main')
    await expect(aligner.pushedToRemote(spec, oid, signal)).resolves.toEqual({ kind: 'checked', pushed: true })
    await dispose()
  }, 30_000)

  it('reads ignore rules and diff facts for an empty path set without running git', async () => {
    const { aligner, dispose } = await mount()
    const { work, spec } = await fixture(aligner)
    const signal = new AbortController().signal
    await expect(aligner.changeFacts(spec, [], signal))
      .resolves.toEqual({ kind: 'facts', facts: { files: [], insertions: 0, deletions: 0 } })
    await expect(aligner.ignoredPaths(spec, [], signal)).resolves.toEqual({ kind: 'checked', ignored: [] })
    await expect(aligner.ignoredPaths(spec, ['shared.txt'], signal)).resolves.toEqual({ kind: 'checked', ignored: [] })
    await writeFile(join(work, '.gitignore'), 'ignored.log\n')
    await expect(aligner.ignoredPaths(spec, ['ignored.log', 'shared.txt'], signal))
      .resolves.toEqual({ kind: 'checked', ignored: ['ignored.log'] })
    await dispose()
  }, 30_000)

  it('uses the production runner when no test hook is installed', async () => {
    const { aligner, dispose } = await mount()
    const { spec } = await fixture(aligner)
    await expect(aligner.pushedToRemote(spec, spec.expectedHeadOid, new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', pushed: true })
    await dispose()
  }, 30_000)
})

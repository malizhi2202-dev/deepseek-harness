import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitAlignRequestError } from '@deepseek-ai/dsh-git-align'
import type { AlignRequest, AlignSpec } from '@deepseek-ai/dsh-git-align'
import { LocalGitAligner } from '@deepseek-ai/dsh-git-align-local'
import type { Config } from '@deepseek-ai/dsh-git-align-local'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** One scripted command answer. */
interface Step {
  /** Stdout the command prints on success. */
  readonly stdout?: string
  /** The rejection the command raises instead of succeeding. */
  readonly fail?: unknown
}

/** A command that ran and exited non-zero, in the runner's rejection form. */
function exited(code: number, stdout = ''): Error {
  return Object.assign(new Error(`git exited ${code}`), { code, stdout, stderr: '' })
}

/** Mount the provider over a scripted process boundary. */
async function mount(steps: readonly Step[], config: Config = {}): Promise<{
  aligner: LocalGitAligner
  seen: string[][]
  dispose: () => Promise<void>
}> {
  const seen: string[][] = []
  let index = 0
  const run: NativeCommandRunner = async (_command, args) => {
    seen.push([...args])
    const step = steps[index]
    index += 1
    if (step === undefined) throw new Error(`unexpected command: ${args.join(' ')}`)
    if (step.fail !== undefined) throw step.fail
    return { stdout: step.stdout ?? '', stderr: '' }
  }
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalGitAligner, config)
  const aligner = ctx.get('gitAlign')
  if (!(aligner instanceof LocalGitAligner)) throw new Error('provider did not register as ctx.gitAlign')
  aligner.internals = { run }
  return { aligner, seen, dispose: () => fiber.dispose() }
}

const request: AlignRequest = {
  root: '/work/repo',
  branch: 'main',
  upstream: 'origin/main',
  expectedHeadOid: 'a'.repeat(40),
}

/** The resolved target every operation test uses. */
function spec(aligner: LocalGitAligner): AlignSpec {
  return aligner.resolve(request)
}

describe('LocalGitAligner configuration', () => {
  it('defaults its command bound when constructed without configuration', () => {
    const aligner = new LocalGitAligner(new Context())
    expect(aligner).toBeInstanceOf(LocalGitAligner)
  })

  it('accepts a configured command bound', async () => {
    const { aligner, dispose } = await mount([], { commandTimeoutMs: 5000 })
    expect(aligner).toBeInstanceOf(LocalGitAligner)
    await dispose()
  })

  it('fails loud on a bound below the fixed floor', () => {
    expect(() => new LocalGitAligner(new Context(), { commandTimeoutMs: 500 }))
      .toThrow(/commandTimeoutMs must be an integer of at least 1000/)
  })
})

describe('LocalGitAligner.resolve', () => {
  it('splits a remote-tracking branch into remote and ref name', async () => {
    const { aligner } = await mount([])
    expect(aligner.resolve(request)).toEqual({
      root: '/work/repo',
      branch: 'main',
      upstream: 'origin/main',
      remote: 'origin',
      refspec: 'main',
      expectedHeadOid: 'a'.repeat(40),
    })
    expect(aligner.resolve({ ...request, upstream: 'origin/feature/deep' })).toMatchObject({
      remote: 'origin',
      refspec: 'feature/deep',
    })
  })

  it.each(['main', '/main', 'origin/'])('rejects the unresolvable upstream %j', async (upstream) => {
    const { aligner } = await mount([])
    expect(() => aligner.resolve({ ...request, upstream })).toThrow(GitAlignRequestError)
  })
})

describe('LocalGitAligner.fetch', () => {
  it('fetches the upstream into its remote-tracking ref', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }])
    await expect(aligner.fetch(spec(aligner), new AbortController().signal)).resolves.toEqual({ kind: 'fetched' })
    expect(seen[0]).toEqual([
      '--no-optional-locks', '-C', '/work/repo',
      'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main',
    ])
  })

  it('classifies a failed fetch', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.fetch(spec(aligner), new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git fetch exited 128' },
    })
  })
})

describe('LocalGitAligner.probe', () => {
  const probeRequest = { worktreeRoot: '/scratch', scratchName: 'ws-1', maxConflictPaths: 2 }

  it('reports a clean probe from merge-tree', async () => {
    const { aligner, seen } = await mount([{ stdout: `${'c'.repeat(40)}\n` }])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal))
      .resolves.toEqual({ kind: 'clean' })
    expect(seen[0]?.slice(3)).toEqual(['merge-tree', '--write-tree', '--name-only', 'origin/main', 'HEAD'])
  })

  it('reports bounded conflicts from merge-tree', async () => {
    const { aligner } = await mount([{ fail: exited(1, `${'c'.repeat(40)}\na.ts\nb.ts\nc.ts\n`) }])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'conflicted',
      conflicts: { paths: ['a.ts', 'b.ts'], total: 3 },
    })
  })

  it('classifies a merge-tree failure that is neither conflicts nor an unsupported flag', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git merge-tree exited 128' },
    })
  })

  it('falls back to an isolated worktree when merge-tree refuses its flags', async () => {
    const { aligner, seen } = await mount([
      { fail: exited(129) },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
    ])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal))
      .resolves.toEqual({ kind: 'clean' })
    expect(seen[1]?.slice(3)).toEqual(['worktree', 'add', '--detach', '/scratch/ws-1', 'HEAD'])
    expect(seen[2]?.slice(3)).toEqual(['merge', '--no-commit', '--no-ff', 'origin/main'])
    expect(seen[3]?.slice(3)).toEqual(['worktree', 'remove', '--force', '/scratch/ws-1'])
    expect(seen[4]?.slice(3)).toEqual(['worktree', 'prune'])
  })

  it('reports conflicts found in the isolated worktree', async () => {
    const { aligner } = await mount([
      { fail: exited(129) },
      { stdout: '' },
      { fail: exited(1) },
      { stdout: 'a.ts\0b.ts\0c.ts\0' },
      { stdout: '' },
      { stdout: '' },
    ])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'conflicted',
      conflicts: { paths: ['a.ts', 'b.ts'], total: 3 },
    })
  })

  it('treats a failed merge with no unmerged entry as a plain failure', async () => {
    const { aligner } = await mount([
      { fail: exited(129) },
      { stdout: '' },
      { fail: exited(1) },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
    ])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git merge exited 1' },
    })
  })

  it('classifies a failed unmerged listing', async () => {
    const { aligner } = await mount([
      { fail: exited(129) },
      { stdout: '' },
      { fail: exited(1) },
      { fail: exited(128) },
      { stdout: '' },
      { stdout: '' },
    ])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git diff exited 128' },
    })
  })

  it('classifies a scratch worktree that could not be created', async () => {
    const { aligner } = await mount([{ fail: exited(129) }, { fail: exited(128) }])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git worktree add exited 128' },
    })
  })

  it('reports failure when the scratch worktree could not be removed', async () => {
    const { aligner } = await mount([
      { fail: exited(129) },
      { stdout: '' },
      { stdout: '' },
      { fail: exited(128) },
    ])
    await expect(aligner.probe(spec(aligner), probeRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'the probe scratch worktree could not be removed' },
    })
  })
})

describe('LocalGitAligner.apply', () => {
  it('aligns with a fast-forward', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }])
    await expect(aligner.apply(spec(aligner), 'ff-only', new AbortController().signal))
      .resolves.toEqual({ kind: 'aligned', strategy: 'ff-only' })
    expect(seen[0]?.slice(3)).toEqual(['merge', '--ff-only', 'origin/main'])
  })

  it('aligns with a merge-forward', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }])
    await expect(aligner.apply(spec(aligner), 'merge', new AbortController().signal))
      .resolves.toEqual({ kind: 'aligned', strategy: 'merge' })
    expect(seen[0]?.slice(3)).toEqual(['merge', '--no-ff', '--no-edit', 'origin/main'])
  })

  it('reports a merge that never started', async () => {
    const { aligner } = await mount([{ fail: exited(1) }, { fail: exited(1) }])
    await expect(aligner.apply(spec(aligner), 'merge', new AbortController().signal)).resolves.toEqual({
      kind: 'merge-failed',
      failure: { code: 'command-failed', detail: 'git merge exited 1' },
    })
  })

  it('rolls back the merge it started', async () => {
    const { aligner, seen } = await mount([{ fail: exited(1) }, { stdout: 'MERGE_HEAD\n' }, { stdout: '' }])
    await expect(aligner.apply(spec(aligner), 'merge', new AbortController().signal)).resolves.toEqual({
      kind: 'merge-failed',
      failure: { code: 'command-failed', detail: 'git merge exited 1' },
    })
    expect(seen[2]?.slice(3)).toEqual(['merge', '--abort'])
  })

  it('reports a merge it could not roll back', async () => {
    const { aligner } = await mount([{ fail: exited(1) }, { stdout: 'MERGE_HEAD\n' }, { fail: exited(128) }])
    await expect(aligner.apply(spec(aligner), 'merge', new AbortController().signal)).resolves.toEqual({
      kind: 'merge-failed-dirty',
      failure: { code: 'command-failed', detail: 'git merge --abort exited 128' },
    })
  })
})

describe('LocalGitAligner.changeFacts', () => {
  it('answers empty facts for an empty path set without running git', async () => {
    const { aligner, seen } = await mount([])
    await expect(aligner.changeFacts(spec(aligner), [], new AbortController().signal)).resolves.toEqual({
      kind: 'facts',
      facts: { files: [], insertions: 0, deletions: 0 },
    })
    expect(seen).toEqual([])
  })

  it('reads facts after recording intent-to-add for the same paths', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }, { stdout: '3\t1\tsrc/a.ts\0-\t-\tlogo.png\0' }])
    await expect(aligner.changeFacts(spec(aligner), ['src/a.ts', 'logo.png'], new AbortController().signal))
      .resolves.toEqual({
        kind: 'facts',
        facts: {
          files: [
            { path: 'src/a.ts', insertions: 3, deletions: 1, binary: false },
            { path: 'logo.png', insertions: 0, deletions: 0, binary: true },
          ],
          insertions: 3,
          deletions: 1,
        },
      })
    expect(seen[0]?.slice(3)).toEqual(['add', '--intent-to-add', '--', 'src/a.ts', 'logo.png'])
    expect(seen[1]?.slice(3)).toEqual(['diff', 'HEAD', '--numstat', '-z', '--no-renames', '--', 'src/a.ts', 'logo.png'])
  })

  it('classifies a failed intent-to-add', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.changeFacts(spec(aligner), ['src/a.ts'], new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git add exited 128' },
    })
  })

  it('classifies a failed diff read', async () => {
    const { aligner } = await mount([{ stdout: '' }, { fail: exited(128) }])
    await expect(aligner.changeFacts(spec(aligner), ['src/a.ts'], new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git diff exited 128' },
    })
  })

  it('classifies an undocumented diff record', async () => {
    const { aligner } = await mount([{ stdout: '' }, { stdout: 'broken\0' }])
    await expect(aligner.changeFacts(spec(aligner), ['src/a.ts'], new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'unparsable numstat record: "broken"' },
    })
  })
})

describe('LocalGitAligner.ignoredPaths', () => {
  it('answers nothing ignored for an empty path set without running git', async () => {
    const { aligner, seen } = await mount([])
    await expect(aligner.ignoredPaths(spec(aligner), [], new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', ignored: [] })
    expect(seen).toEqual([])
  })

  it('reads the ignored subset', async () => {
    const { aligner, seen } = await mount([{ stdout: '.env\n' }])
    await expect(aligner.ignoredPaths(spec(aligner), ['.env', 'src/a.ts'], new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', ignored: ['.env'] })
    expect(seen[0]?.slice(3)).toEqual(['-c', 'core.quotePath=false', 'check-ignore', '--', '.env', 'src/a.ts'])
  })

  it('reports only paths the caller named, dropping any other line git printed', async () => {
    const { aligner } = await mount([{ stdout: 'build/output.js\n"quoted\\nname"\n' }])
    await expect(aligner.ignoredPaths(spec(aligner), ['build/output.js', 'src/a.ts'], new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', ignored: ['build/output.js'] })
  })

  it('treats exit 1 as "nothing is ignored"', async () => {
    const { aligner } = await mount([{ fail: exited(1) }])
    await expect(aligner.ignoredPaths(spec(aligner), ['src/a.ts'], new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', ignored: [] })
  })

  it('classifies any other ignore-check failure', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.ignoredPaths(spec(aligner), ['src/a.ts'], new AbortController().signal))
      .resolves.toEqual({
        kind: 'failed',
        failure: { code: 'command-failed', detail: 'git check-ignore exited 128' },
      })
  })
})

describe('LocalGitAligner.commit', () => {
  it('commits exactly the supplied paths and runs repository hooks by default', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }, { stdout: '' }])
    await expect(aligner.commit(
      spec(aligner),
      { paths: ['src/a.ts'], message: 'feat(cli): add flag', runHooks: true },
      new AbortController().signal,
    )).resolves.toEqual({ kind: 'committed' })
    expect(seen[0]?.slice(3)).toEqual(['add', '--intent-to-add', '--', 'src/a.ts'])
    expect(seen[1]?.slice(3)).toEqual(['commit', '-m', 'feat(cli): add flag', '--', 'src/a.ts'])
  })

  it('passes --no-verify only when hooks are disabled', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }, { stdout: '' }])
    await aligner.commit(
      spec(aligner),
      { paths: ['src/a.ts'], message: 'chore: tidy', runHooks: false },
      new AbortController().signal,
    )
    expect(seen[1]?.slice(3)).toEqual(['commit', '-m', 'chore: tidy', '--no-verify', '--', 'src/a.ts'])
  })

  it('refuses an empty path set before running any command', async () => {
    const { aligner, seen } = await mount([])
    await expect(aligner.commit(
      spec(aligner),
      { paths: [], message: 'chore: nothing', runHooks: true },
      new AbortController().signal,
    )).rejects.toThrow(GitAlignRequestError)
    expect(seen).toEqual([])
  })

  it('classifies a failed intent-to-add as a commit failure', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.commit(
      spec(aligner),
      { paths: ['src/a.ts'], message: 'chore: tidy', runHooks: true },
      new AbortController().signal,
    )).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git add exited 128' },
      indexRestored: true,
    })
  })

  it('restores the index when the commit fails', async () => {
    const { aligner, seen } = await mount([{ stdout: '' }, { fail: exited(1) }, { stdout: '' }])
    await expect(aligner.commit(
      spec(aligner),
      { paths: ['src/a.ts'], message: 'chore: tidy', runHooks: true },
      new AbortController().signal,
    )).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git commit exited 1' },
      indexRestored: true,
    })
    expect(seen[2]?.slice(3)).toEqual(['reset', '-q', '--', 'src/a.ts'])
  })

  it('reports an index it could not restore', async () => {
    const { aligner } = await mount([{ stdout: '' }, { fail: exited(1) }, { fail: exited(128) }])
    await expect(aligner.commit(
      spec(aligner),
      { paths: ['src/a.ts'], message: 'chore: tidy', runHooks: true },
      new AbortController().signal,
    )).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'command-failed', detail: 'git commit exited 1' },
      indexRestored: false,
    })
  })
})

describe('LocalGitAligner.pushedToRemote', () => {
  it('answers pushed when a remote-tracking ref contains the commit', async () => {
    const { aligner, seen } = await mount([{ stdout: 'refs/remotes/origin/main\n' }])
    await expect(aligner.pushedToRemote(spec(aligner), 'a'.repeat(40), new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', pushed: true })
    expect(seen[0]?.slice(3)).toEqual([
      'for-each-ref', '--format=%(refname)', `--contains=${'a'.repeat(40)}`, 'refs/remotes/',
    ])
  })

  it('answers not pushed when no remote-tracking ref contains it', async () => {
    const { aligner } = await mount([{ stdout: '\n' }])
    await expect(aligner.pushedToRemote(spec(aligner), 'a'.repeat(40), new AbortController().signal))
      .resolves.toEqual({ kind: 'checked', pushed: false })
  })

  it('classifies a failed containment read', async () => {
    const { aligner } = await mount([{ fail: exited(128) }])
    await expect(aligner.pushedToRemote(spec(aligner), 'a'.repeat(40), new AbortController().signal))
      .resolves.toEqual({
        kind: 'failed',
        failure: { code: 'command-failed', detail: 'git for-each-ref exited 128' },
      })
  })
})

describe('LocalGitAligner command boundary', () => {
  it('classifies a runner that never reached git', async () => {
    const { aligner } = await mount([{ fail: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }])
    await expect(aligner.fetch(spec(aligner), new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: {
        code: 'git-unavailable',
        detail: "git could not be run for 'fetch': spawn git ENOENT",
      },
    })
  })

  it('rejects with the caller reason instead of a git failure', async () => {
    const { aligner } = await mount([{ fail: new Error('runner observed the abort') }])
    const controller = new AbortController()
    const reason = new Error('caller stopped the run')
    controller.abort(reason)
    await expect(aligner.fetch(spec(aligner), controller.signal)).rejects.toBe(reason)
  })

  it('bounds a command that never returns', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalGitAligner, { commandTimeoutMs: 1000 })
    const aligner = ctx.get('gitAlign')
    if (!(aligner instanceof LocalGitAligner)) throw new Error('provider did not register as ctx.gitAlign')
    aligner.internals = {
      run: async (_command, _args, signal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        throw new Error('killed by the bound')
      },
    }
    await expect(aligner.fetch(spec(aligner), new AbortController().signal)).resolves.toEqual({
      kind: 'failed',
      failure: { code: 'timeout', detail: 'git fetch exceeded 1000ms' },
    })
    await fiber.dispose()
  }, 10_000)
})

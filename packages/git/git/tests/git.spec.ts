import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitError, GitObserver, MAX_OBSERVATION_ITEMS } from '@deepseek-ai/dsh-git'
import type { GitObservation } from '@deepseek-ai/dsh-git'

/** One scripted observer, mounted the way a provider would mount. */
async function mountObserver(answer: (cwd: string) => Promise<GitObservation>): Promise<{
  ctx: Context
  fiber: { dispose(): Promise<void> }
  observer: GitObserver
}> {
  class Scripted extends GitObserver {
    override observe = answer
  }
  const ctx = new Context()
  const fiber = await ctx.plugin(Scripted)
  const observer = ctx.get('git')
  if (observer === undefined) throw new Error('scripted observer did not register as ctx.git')
  return { ctx, fiber, observer }
}

describe('GitObserver', () => {
  it('registers as the git service when a subclass is mounted', async () => {
    const { observer } = await mountObserver(async () => ({ kind: 'absent' }))
    expect(observer).toBeInstanceOf(GitObserver)
  })

  it('delegates observe to the subclass implementation', async () => {
    const { observer } = await mountObserver(async cwd => ({
      kind: 'repository',
      root: cwd,
      head: { branch: 'main', oid: 'a'.repeat(40) },
      branches: [],
      branchesTruncated: false,
      history: [],
      historyTruncated: false,
      worktree: [],
      worktreeTruncated: false,
    }))
    const answer = await observer.observe('/work/repo', new AbortController().signal)
    expect(answer).toMatchObject({ kind: 'repository', root: '/work/repo' })
  })

  it('disposes with its fiber', async () => {
    const { fiber } = await mountObserver(async () => ({ kind: 'absent' }))
    await fiber.dispose()
  })
})

describe('MAX_OBSERVATION_ITEMS', () => {
  it('is a positive safe integer', () => {
    expect(Number.isSafeInteger(MAX_OBSERVATION_ITEMS)).toBe(true)
    expect(MAX_OBSERVATION_ITEMS).toBeGreaterThan(0)
  })
})

describe('GitError', () => {
  it('carries its code and chains its cause', () => {
    const cause = new Error('spawn failed')
    const error = new GitError('git is missing', 'GIT_UNAVAILABLE', { cause })
    expect(error).toBeInstanceOf(GitError)
    expect(error.code).toBe('GIT_UNAVAILABLE')
    expect(error.message).toBe('git is missing')
    expect(error.cause).toBe(cause)
  })
})

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitAligner, GitAlignRequestError } from '@deepseek-ai/dsh-git-align'
import type { AlignRequest, AlignSpec } from '@deepseek-ai/dsh-git-align'

/** The operations this spec does not script; reaching one is a test defect, not a supported path. */
const unscripted = (): never => {
  throw new Error('this spec scripts only resolve()')
}

/** One scripted subclass, mounted the way a provider mounts. */
async function mountAligner(resolve?: (request: AlignRequest) => AlignSpec): Promise<{
  ctx: Context
  fiber: { dispose(): Promise<void> }
  aligner: GitAligner
}> {
  class Scripted extends GitAligner {
    override resolve = resolve ?? ((request: AlignRequest): AlignSpec => ({
      ...request,
      remote: 'origin',
      refspec: 'main',
    }))
    override fetch = unscripted
    override probe = unscripted
    override apply = unscripted
    override changeFacts = unscripted
    override ignoredPaths = unscripted
    override commit = unscripted
    override pushedToRemote = unscripted
  }
  const ctx = new Context()
  const fiber = await ctx.plugin(Scripted)
  const aligner = ctx.get('gitAlign')
  if (aligner === undefined) throw new Error('scripted aligner did not register as ctx.gitAlign')
  return { ctx, fiber, aligner }
}

const request: AlignRequest = {
  root: '/work/repo',
  branch: 'main',
  upstream: 'origin/main',
  expectedHeadOid: 'a'.repeat(40),
}

describe('GitAligner', () => {
  it('registers as the gitAlign service when a subclass is mounted', async () => {
    const { aligner } = await mountAligner()
    expect(aligner).toBeInstanceOf(GitAligner)
  })

  it('delegates resolve to the subclass implementation', async () => {
    const { aligner } = await mountAligner()
    expect(aligner.resolve(request)).toMatchObject({ remote: 'origin', refspec: 'main' })
  })

  it('disposes with its fiber', async () => {
    const { fiber } = await mountAligner()
    await fiber.dispose()
  })
})

describe('GitAlignRequestError', () => {
  it('carries its message and a stable code', () => {
    const error = new GitAlignRequestError('upstream is not a remote/ref spelling')
    expect(error.name).toBe('GitAlignRequestError')
    expect(error.code).toBe('command-failed')
    expect(error.message).toBe('upstream is not a remote/ref spelling')
    expect(error).toBeInstanceOf(Error)
  })
})

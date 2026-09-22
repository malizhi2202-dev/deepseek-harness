import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkSummaryService, { resolveMessagePolicy } from '@deepseek-ai/dsh-work-summary'
import type { WorkSummaryProvider, WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'

const request: WorkSummaryRequest = {
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  turn: 3,
  endReason: 'stop',
  paths: [{ path: 'src/a.ts', insertions: 2, deletions: 1, binary: false }],
}

/** Mount the service the way a composition does and expose its context. */
async function mount(config = {}): Promise<{ ctx: Context; service: WorkSummaryService }> {
  const ctx = new Context()
  await ctx.plugin(WorkSummaryService, config)
  const service = ctx.get('workSummary')
  if (service === undefined) throw new Error('work-summary did not register as ctx.workSummary')
  return { ctx, service }
}

/** One provider that answers a fixed result. */
function provider(id: string, result: Awaited<ReturnType<WorkSummaryProvider['generate']>>): WorkSummaryProvider {
  return { id, generate: async () => result }
}

describe('WorkSummaryService', () => {
  it('registers as the workSummary service when mounted', async () => {
    const { service } = await mount()
    expect(service).toBeInstanceOf(WorkSummaryService)
  })

  it('falls back to the mechanical message when no provider is registered', async () => {
    const { service } = await mount()
    const result = await service.generate(request)
    expect(result.source).toBe('mechanical')
    expect(result.proposalRejected).toBe(false)
    expect(result.notes).toEqual([])
    expect(result.message.subject).toBe('chore(src): update 1 file(s), +2/-1')
  })

  it('accepts a valid provider proposal', async () => {
    const { service } = await mount()
    service.register(provider('p1', { kind: 'proposed', proposal: { subject: 'feat(ui): add it', body: ['why'] } }))
    const result = await service.generate(request)
    expect(result.source).toBe('provider')
    expect(result.message.subject).toBe('feat(ui): add it')
    expect(result.notes).toEqual([])
  })

  it('records a decline and continues to the next provider', async () => {
    const { service } = await mount()
    service.register(provider('p1', { kind: 'declined', reason: 'no diff' }))
    service.register(provider('p2', { kind: 'proposed', proposal: { subject: 'fix: it', body: [] } }))
    const result = await service.generate(request)
    expect(result.source).toBe('provider')
    expect(result.notes).toEqual(['p1: declined (no diff)'])
  })

  it('records a throwing provider and continues', async () => {
    const { service } = await mount()
    service.register({ id: 'boom', generate: async () => { throw new Error('upstream refused') } })
    service.register(provider('p2', { kind: 'proposed', proposal: { subject: 'fix: it', body: [] } }))
    const result = await service.generate(request)
    expect(result.source).toBe('provider')
    expect(result.notes).toEqual(['boom: Error: upstream refused'])
  })

  it('rejects an unusable proposal, reports it, and keeps consulting', async () => {
    const { service } = await mount()
    service.register(provider('p1', { kind: 'proposed', proposal: { subject: 'wip: nope', body: [] } }))
    service.register(provider('p2', { kind: 'proposed', proposal: { subject: 'chore: ok', body: [] } }))
    const result = await service.generate(request)
    expect(result.source).toBe('provider')
    expect(result.proposalRejected).toBe(true)
    expect(result.notes).toEqual(['p1: proposal rejected (unknown-type)'])
  })

  it('reports a rejected proposal when the fallback is used', async () => {
    const { service } = await mount()
    service.register(provider('p1', { kind: 'proposed', proposal: { subject: 'nope', body: [] } }))
    const result = await service.generate(request)
    expect(result.source).toBe('mechanical')
    expect(result.proposalRejected).toBe(true)
    expect(result.notes).toEqual(['p1: proposal rejected (malformed-subject)'])
  })

  it('removes a provider when its registration is disposed', async () => {
    const { service } = await mount()
    const dispose = service.register(provider('p1', { kind: 'proposed', proposal: { subject: 'fix: it', body: [] } }))
    expect((await service.generate(request)).source).toBe('provider')
    dispose()
    expect((await service.generate(request)).source).toBe('mechanical')
  })

  it('tolerates disposing the same registration twice', async () => {
    const { service } = await mount()
    const dispose = service.register(provider('p1', { kind: 'declined', reason: 'x' }))
    dispose()
    dispose()
    expect((await service.generate(request)).source).toBe('mechanical')
  })

  it('rejects a misconfigured vocabulary at mount', async () => {
    await expect(mount({ fallbackType: 'wip' })).rejects.toThrow('is not one of commitTypes')
  })

  it('resolves the declared configuration through the exported resolver', () => {
    expect(resolveMessagePolicy({ commitTypes: ['a'], fallbackType: 'a', trailerName: 'X' })).toMatchObject({
      commitTypes: ['a'],
      fallbackType: 'a',
      trailerName: 'X',
    })
  })
})

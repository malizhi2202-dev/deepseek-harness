import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import WorkSummaryService from '@deepseek-ai/dsh-work-summary'
import type { WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'
import { apply, generateWithLlm, resolveLlmConfig, WORK_SUMMARY_LLM_PROVIDER } from '@deepseek-ai/dsh-work-summary-llm'
import type { ResolvedConfig } from '@deepseek-ai/dsh-work-summary-llm'

/** One adapter that replays a fixed stream and records what it was asked. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: readonly StreamChunk[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield * this.script
  }
}

const REQUEST: WorkSummaryRequest = {
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  turn: 4,
  endReason: 'completed',
  paths: [{ path: 'src/a.ts', insertions: 2, deletions: 1, binary: false }],
}

const CONFIG: ResolvedConfig = {
  provider: 'route',
  model: 'model',
  maxOutputTokens: 64,
  timeoutMs: 1_000,
  maxInputBytes: 4_096,
  maxBodyLines: 3,
}

/** A stream that stops normally after emitting the given text. */
function stopWith(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Mount the LLM runtime with one scripted adapter. */
async function withScript(script: readonly StreamChunk[]): Promise<{ ctx: Context; adapter: RecordingAdapter }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new RecordingAdapter(script)
  ctx.llm.registerAdapter(['route'], adapter)
  return { ctx, adapter }
}

describe('resolveLlmConfig', () => {
  it('resolves the documented defaults', () => {
    expect(resolveLlmConfig({ provider: 'p', model: 'm' })).toEqual({
      provider: 'p',
      model: 'm',
      maxOutputTokens: 512,
      timeoutMs: 20_000,
      maxInputBytes: 16_384,
      maxBodyLines: 20,
    })
  })

  it('rejects an empty provider or model', () => {
    expect(() => resolveLlmConfig({ provider: ' ', model: 'm' })).toThrow('provider must not be empty')
    expect(() => resolveLlmConfig({ provider: 'p', model: ' ' })).toThrow('model must not be empty')
  })

  it('rejects a non-positive generation bound', () => {
    expect(() => resolveLlmConfig({ provider: 'p', model: 'm', timeoutMs: 0 })).toThrow('timeoutMs must be positive')
  })
})

describe('generateWithLlm', () => {
  it('sends the framed work unit on the configured route and returns the proposal', async () => {
    const { ctx, adapter } = await withScript(stopWith('feat(ui): add the panel\n\nbecause it was missing'))
    const result = await generateWithLlm(ctx, CONFIG, REQUEST)
    expect(result).toEqual({
      kind: 'proposed',
      proposal: { subject: 'feat(ui): add the panel', body: ['because it was missing'] },
    })
    const sent = adapter.requests[0]
    expect(sent?.provider).toBe('route')
    expect(sent?.model).toBe('model')
    expect(sent?.maxTokens).toBe(64)
    expect(sent?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(sent?.messages)).toContain('src/a.ts')
    expect(sent?.system).toContain('conventional-commit')
  })

  it('declines a work unit with no paths without calling the model', async () => {
    const { ctx, adapter } = await withScript(stopWith('feat: x'))
    const result = await generateWithLlm(ctx, CONFIG, { ...REQUEST, paths: [] })
    expect(result).toEqual({ kind: 'declined', reason: 'no paths' })
    expect(adapter.requests).toEqual([])
  })

  it('declines when the framed work unit exceeds the input byte budget', async () => {
    const { ctx, adapter } = await withScript(stopWith('feat: x'))
    const result = await generateWithLlm(ctx, { ...CONFIG, maxInputBytes: 10 }, REQUEST)
    expect(result).toEqual({ kind: 'declined', reason: 'input exceeds maxInputBytes 10' })
    expect(adapter.requests).toEqual([])
  })

  it('declines a generation that did not stop normally', async () => {
    const { ctx } = await withScript([{ type: 'finish', reason: { kind: 'max-tokens' } }])
    expect(await generateWithLlm(ctx, CONFIG, REQUEST)).toEqual({ kind: 'declined', reason: 'finish max-tokens' })
  })

  it('declines a reply that carries no subject', async () => {
    const { ctx } = await withScript(stopWith('   \n  '))
    expect(await generateWithLlm(ctx, CONFIG, REQUEST)).toEqual({ kind: 'declined', reason: 'empty reply' })
  })

  it('declines a reply made only of tool calls', async () => {
    const { ctx } = await withScript([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), name: 'read_file', argumentsDelta: '{}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(await generateWithLlm(ctx, CONFIG, REQUEST)).toEqual({ kind: 'declined', reason: 'empty reply' })
  })
})

describe('apply', () => {
  it('registers the provider so a valid proposal reaches the service', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkSummaryService, {})
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new RecordingAdapter(stopWith('fix(core): correct the guard')))
    apply(ctx, { provider: 'route', model: 'model' })
    const result = await ctx.workSummary.generate(REQUEST)
    expect(result.source).toBe('provider')
    expect(result.message.subject).toBe('fix(core): correct the guard')
  })

  it('falls back to the mechanical message when the provider declines', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkSummaryService, {})
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new RecordingAdapter(stopWith('not a conventional header')))
    apply(ctx, { provider: 'route', model: 'model' })
    const result = await ctx.workSummary.generate(REQUEST)
    expect(result.source).toBe('mechanical')
    expect(result.proposalRejected).toBe(true)
    expect(result.notes).toEqual([`${WORK_SUMMARY_LLM_PROVIDER}: proposal rejected (malformed-subject)`])
  })

  it('rejects a misconfigured route at load', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkSummaryService, {})
    expect(() => { apply(ctx, { provider: '', model: 'model' }) }).toThrow('provider must not be empty')
  })
})

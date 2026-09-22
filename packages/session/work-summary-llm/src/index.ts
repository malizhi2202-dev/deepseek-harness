/**
 * Model-backed work-summary provider: it asks the configured LLM to write one
 * commit message for the work unit's diff facts and registers the answer with
 * `ctx.workSummary`, which validates it against the deployment's vocabulary and
 * falls back to the mechanical message when this provider declines.
 *
 * The call declares no session and no purpose: the summary is a workspace-level
 * record, not part of any conversation, so the exact request is retained by the
 * consumer's ledger rather than the session log.
 *
 * @module @deepseek-ai/dsh-work-summary-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { frameRequest, parseProposal, systemPrompt } from './prompt.ts'
import type { WorkSummaryProviderResult, WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'

export * from './prompt.ts'

/** Plugin name used by the Loader and diagnostics. */
export const name = 'work-summary-llm'

/** The provider registry and the LLM capability this plugin needs. */
export const inject = ['workSummary', 'llm']

/** Stable provider id this plugin registers under. */
export const WORK_SUMMARY_LLM_PROVIDER = 'work-summary-llm'

/** Plugin configuration: the model route and the bounds of one generation. */
export interface Config {
  /** LLM provider id the summary request is routed to. */
  provider: string
  /** Model id the summary request is routed to. */
  model: string
  /** Output-token cap for one generation. */
  maxOutputTokens?: number
  /** End-to-end deadline for one generation in milliseconds. */
  timeoutMs?: number
  /** Maximum bytes of the framed work unit sent to the model. */
  maxInputBytes?: number
  /** Maximum body lines the reply may contribute. */
  maxBodyLines?: number
}

/** Validated configuration schema; a missing route fails at load. */
export const Config: Schema<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  maxOutputTokens: z.natural().min(1).default(512),
  timeoutMs: z.natural().min(1).default(20_000),
  maxInputBytes: z.natural().min(1).default(16_384),
  maxBodyLines: z.natural().min(1).default(20),
})

/** The configuration one generation runs under, with every default resolved. */
export interface ResolvedConfig {
  readonly provider: string
  readonly model: string
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly maxInputBytes: number
  readonly maxBodyLines: number
}

/**
 * Resolve the declared configuration and reject a self-contained misconfiguration.
 * @param config - the declared configuration.
 * @returns the resolved generation policy.
 */
export function resolveLlmConfig(config: Config): ResolvedConfig {
  if (config.provider.trim().length === 0) throw new Error('work-summary-llm: provider must not be empty')
  if (config.model.trim().length === 0) throw new Error('work-summary-llm: model must not be empty')
  const resolved: ResolvedConfig = {
    provider: config.provider,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens ?? 512,
    timeoutMs: config.timeoutMs ?? 20_000,
    maxInputBytes: config.maxInputBytes ?? 16_384,
    maxBodyLines: config.maxBodyLines ?? 20,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (key !== 'provider' && key !== 'model' && value <= 0) {
      throw new Error(`work-summary-llm: ${key} must be positive`)
    }
  }
  return resolved
}

/**
 * Register the model-backed provider on the work-summary service.
 * @param ctx - context exposing the work-summary and LLM services.
 * @param config - the declared model route and generation bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveLlmConfig(config)
  ctx.workSummary.register({
    id: WORK_SUMMARY_LLM_PROVIDER,
    generate: async (request: WorkSummaryRequest): Promise<WorkSummaryProviderResult> =>
      await generateWithLlm(ctx, resolved, request),
  })
}

/**
 * Generate one commit message through the configured model.
 *
 * A work unit with no paths is declined before any request is made, and a reply
 * that does not reduce to a subject is declined rather than repaired. Every
 * failure to produce a usable proposal is a decline, so the service's
 * mechanical fallback owns the outcome.
 * @param ctx - context exposing the LLM service.
 * @param config - the resolved generation policy.
 * @param request - the work unit's identity and diff facts.
 * @returns the proposal, or the reason this provider declined.
 */
export async function generateWithLlm(
  ctx: Context,
  config: ResolvedConfig,
  request: WorkSummaryRequest,
): Promise<WorkSummaryProviderResult> {
  if (request.paths.length === 0) return { kind: 'declined', reason: 'no paths' }
  const framed = frameRequest(request)
  if (Buffer.byteLength(framed, 'utf8') > config.maxInputBytes) {
    return { kind: 'declined', reason: `input exceeds maxInputBytes ${config.maxInputBytes}` }
  }
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: 'dsh-work-summary-llm' },
  })]
  const options: GenerateOptions = {
    provider: config.provider,
    model: config.model,
    messages,
    system: systemPrompt(),
    maxTokens: config.maxOutputTokens,
    signal: AbortSignal.timeout(config.timeoutMs),
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  if (assembler.finish.kind !== 'stop') return { kind: 'declined', reason: `finish ${assembler.finish.kind}` }
  const text = assembler.blocks()
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const proposal = parseProposal(text, config.maxBodyLines)
  if (proposal === undefined) return { kind: 'declined', reason: 'empty reply' }
  return { kind: 'proposed', proposal }
}

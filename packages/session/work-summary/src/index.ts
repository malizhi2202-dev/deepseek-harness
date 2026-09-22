/**
 * The work-summary capability seam: `ctx.workSummary` turns one work unit's diff
 * facts into the commit message that work unit is committed with.
 *
 * Providers propose a message; this service validates every proposal against the
 * deployment's declared commit vocabulary and bounds, and falls back to a
 * message built from the diff facts alone. The fallback is the reason the seam
 * is usable with no provider mounted at all, and it is also what runs when a
 * provider declines, throws, or proposes something unusable.
 *
 * @module @deepseek-ai/dsh-work-summary
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { mechanicalMessage, validateProposal, type MessagePolicy } from './summary.ts'
import type {
  WorkSummaryProvider,
  WorkSummaryProviderResult,
  WorkSummaryRequest,
  WorkSummaryResult,
} from './types.ts'

export type * from './types.ts'
export * from './summary.ts'

/** Conventional-commit types the default vocabulary accepts. */
export const DEFAULT_COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'] as const

/** Plugin configuration: the message vocabulary and the bounds a message is built under. */
export interface Config {
  /** Conventional-commit types an accepted provider subject may declare. */
  commitTypes?: string[]
  /** Whether a provider proposal may declare a breaking change. */
  allowBreaking?: boolean
  /** Type the mechanical fallback declares; must be one of `commitTypes`. */
  fallbackType?: string
  /** Maximum UTF-8 bytes of a subject line. */
  maxSubjectBytes?: number
  /** Maximum body lines, excluding the trailer. */
  maxBodyLines?: number
  /** Maximum UTF-8 bytes of the complete rendered message. */
  maxMessageBytes?: number
  /** Trailer key marking a commit as produced by one work unit. */
  trailerName?: string
}

/** Validated configuration schema; out-of-range values fail at load. */
export const Config: Schema<Config> = z.object({
  commitTypes: z.array(z.string()).default([...DEFAULT_COMMIT_TYPES]),
  allowBreaking: z.boolean().default(false),
  fallbackType: z.string().default('chore'),
  maxSubjectBytes: z.natural().min(1).default(72),
  maxBodyLines: z.natural().default(50),
  maxMessageBytes: z.natural().min(1).default(4096),
  trailerName: z.string().default('Dsh-Unit'),
})

/**
 * Resolve the declared configuration into the policy every message is built and
 * validated under. A self-contained misconfiguration rejects here, at load.
 * @param config - the declared configuration.
 * @returns the resolved message policy.
 */
export function resolveMessagePolicy(config: Config): MessagePolicy {
  const commitTypes = config.commitTypes ?? [...DEFAULT_COMMIT_TYPES]
  const fallbackType = config.fallbackType ?? 'chore'
  const trailerName = config.trailerName ?? 'Dsh-Unit'
  if (commitTypes.length === 0) throw new Error('work-summary: commitTypes must not be empty')
  if (commitTypes.some(type => !/^[a-z][a-z0-9]*$/.test(type))) {
    throw new Error('work-summary: every commitTypes entry must be a lowercase conventional-commit type')
  }
  if (!commitTypes.includes(fallbackType)) {
    throw new Error(`work-summary: fallbackType "${fallbackType}" is not one of commitTypes`)
  }
  if (trailerName.trim().length === 0 || /[\r\n:]/.test(trailerName)) {
    throw new Error('work-summary: trailerName must be a non-empty single-line trailer key')
  }
  return {
    commitTypes,
    allowBreaking: config.allowBreaking ?? false,
    fallbackType,
    maxSubjectBytes: config.maxSubjectBytes ?? 72,
    maxBodyLines: config.maxBodyLines ?? 50,
    maxMessageBytes: config.maxMessageBytes ?? 4096,
    trailerName,
  }
}

/**
 * The work-summary service. Providers register here; consumers call
 * {@link generate} and never choose a provider themselves.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    workSummary: WorkSummaryService
  }
}

/**
 * The work-summary service: consults registered providers in registration order
 * and falls back to a mechanical message assembled from the path facts.
 */
export class WorkSummaryService extends Service {
  private readonly providers: WorkSummaryProvider[] = []
  private readonly policy: MessagePolicy

  /**
   * @param ctx - the owning context.
   * @param config - the declared message vocabulary and bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workSummary')
    this.policy = resolveMessagePolicy(config)
  }

  /**
   * Register one summary provider. Consultation follows registration order, so a
   * deployment that mounts several gets the first one that proposes.
   * @param provider - the provider to consult.
   * @returns the disposer that removes it.
   */
  register(provider: WorkSummaryProvider): () => void {
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  /**
   * Produce the commit message for one work unit.
   *
   * Every registered provider is consulted in order until one proposes a
   * message that validates. A provider that throws, declines, or proposes an
   * unusable message is recorded in `notes` and consultation continues; when no
   * proposal is accepted the mechanical fallback is built from the diff facts.
   * @param request - the work unit's identity and path facts.
   * @returns the accepted message, its source, and every consultation note.
   */
  async generate(request: WorkSummaryRequest): Promise<WorkSummaryResult> {
    const notes: string[] = []
    let proposalRejected = false
    for (const provider of [...this.providers]) {
      let result: WorkSummaryProviderResult
      try {
        result = await provider.generate(request)
      } catch (error: unknown) {
        notes.push(`${provider.id}: ${String(error)}`)
        continue
      }
      if (result.kind === 'declined') {
        notes.push(`${provider.id}: declined (${result.reason})`)
        continue
      }
      const verdict = validateProposal(result.proposal, request, this.policy)
      if (verdict.kind === 'accepted') {
        return { message: verdict.message, source: 'provider', proposalRejected, notes }
      }
      proposalRejected = true
      notes.push(`${provider.id}: proposal rejected (${verdict.reason})`)
    }
    return {
      message: mechanicalMessage(request, this.policy),
      source: 'mechanical',
      proposalRejected,
      notes,
    }
  }
}

export default WorkSummaryService

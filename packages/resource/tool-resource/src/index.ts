/**
 * Model-facing source tools over `ctx.sources`: one `source_<kind>_search`, one
 * `source_<kind>_read`, and one `source_<kind>_list` tool per registered kind.
 *
 * This package owns the Consumer role of the source capability seam. It owns
 * schemas, argument validation, rendered-output bounds, and presentation, never
 * a provider's protocol, and it registers a tool only while that kind's provider
 * declares the capability, implements the method, and has at least one
 * configured instance.
 *
 * @module @deepseek-ai/dsh-tool-resource
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-resource'
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_MAX_RESULTS, DEFAULT_TOOL_TIMEOUT_MS, applySourceTools } from './tools.ts'

export {
  DEFAULT_MAX_RESULTS,
  DEFAULT_TOOL_TIMEOUT_MS,
  applySourceTools,
  buildSourceTools,
  formatListOutput,
  formatReadOutput,
  formatSearchOutput,
  parseSourceListArgs,
  parseSourceRef,
  parseSourceSearchArgs,
  resolveSourceConfig,
  sourceToolName,
} from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-resource'

/** Services required by the source tool suite. */
export const inject = ['tools', 'sources']

/** Plugin config: the search result bound and the cooperative tool-call budget. */
export interface Config {
  /** Upper bound on hits one search tool call returns. Defaults to 20. */
  maxResults?: number
  /** Cooperative timeout budget (ms) for every source tool. Defaults to 30000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
})

/**
 * Register the source tools and keep them in step with the registered kinds.
 * Every registration is an effect on this fiber, so disposing the plugin removes
 * the tools and stops the re-derivation listener.
 * @param ctx - context whose `tools` and `sources` services the suite uses.
 * @param config - the composition entry; schemastery has filled every default.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as Required<Config>
  applySourceTools(ctx, resolved.maxResults, resolved.timeoutMs)
}

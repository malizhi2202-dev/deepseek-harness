/**
 * GitHub provider plugin: registers the `github` source kind on `ctx.sources`
 * and declares its `resource-github` settings namespace.
 *
 * It contributes to the source seam without owning the service. The model-facing
 * consumer (`@deepseek-ai/dsh-tool-resource`) registers the tools; this package
 * owns the REST calls, the repository grant list, and the limits.
 *
 * @module @deepseek-ai/dsh-resource-github
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-resource'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  GITHUB_DEFAULT_BASE_URL,
  GITHUB_SETTINGS_NAMESPACE,
  GITHUB_KIND,
  GitHubSourceProvider,
} from './provider.ts'
import type { GitHubResolvedConfig } from './provider.ts'
import type { GitHubInstance } from './types.ts'

export {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  GITHUB_DEFAULT_BASE_URL,
  GITHUB_SETTINGS_NAMESPACE,
  GitHubSourceProvider,
  parseGitHubHandle,
} from './provider.ts'

export { GITHUB_KIND }
export type { GitHubResolvedConfig, GitHubSourceProviderOptions } from './provider.ts'
export {
  OctokitGitHubApi,
  createGitHubApi,
  readAuthenticatedLogin,
  readCodeSearchHits,
  readContent,
  readDirectoryEntries,
} from './api.ts'
export type {
  GitHubApi,
  GitHubCodeHit,
  GitHubContent,
  GitHubContentEntry,
  OctokitLike,
} from './api.ts'
export type { GitHubInstance, GitHubSourceConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'resource-github'

/** The source seam this provider registers into. */
export const inject = ['sources']

/** Plugin config: the kind's read cap and its configured sources. */
export interface Config {
  /** Cap on one read, in bytes. Defaults to 200000. */
  maxReadBytes?: number
  /** Cap on one listing, in items. Defaults to 50. */
  maxListItems?: number
  /** Configured sources, keyed by instance id. */
  instances?: Record<string, GitHubInstance>
}

export const Config: z<Config> = z.object({
  maxReadBytes: z.number().step(1).min(1).default(DEFAULT_MAX_READ_BYTES),
  maxListItems: z.number().step(1).min(1).default(DEFAULT_MAX_LIST_ITEMS),
  instances: z.dict(z.object({
    // Only the credential's name enters configuration; the token value is
    // resolved per operation and never stored here.
    tokenRef: z.string().role('credential-ref'),
    baseUrl: z.string().default(GITHUB_DEFAULT_BASE_URL),
    repositories: z.array(z.string()).default([]),
  })).default({}),
})

/**
 * Register the GitHub source provider. While a settings service is mounted the
 * kind's namespace is the authoritative configuration; without one the
 * composition entry is, so the provider still works from `cordis.yml` alone.
 * @param ctx - context whose `sources` registry receives the provider.
 * @param config - the composition entry, used as the settings base layer.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, GITHUB_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // Instances and the read cap are read per operation, so a committed change
      // needs no re-registration here; the model-facing consumer re-derives the
      // tools it registers for this kind when it learns the kind changed.
      onChange: () => {
        ctx.emit('sources/changed', GITHUB_KIND)
      },
    })
  })
  ctx.sources.register(new GitHubSourceProvider({
    config: () => current() as GitHubResolvedConfig,
    resolveCredential: async ref => (await ctx.get('credentials')?.resolve(ref))?.value,
  }))
}

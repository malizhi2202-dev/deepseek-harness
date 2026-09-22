/**
 * MediaWiki provider plugin: registers the `mediawiki` source kind on
 * `ctx.sources` and declares its `resource-mediawiki` settings namespace.
 *
 * It contributes to the source seam without owning the service. The model-facing
 * consumer (`@deepseek-ai/dsh-tool-resource`) registers the tools; this package
 * owns the wiki wire protocol, the per-instance configuration, and the limits.
 *
 * @module @deepseek-ai/dsh-resource-mediawiki
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-resource'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  MEDIAWIKI_SETTINGS_NAMESPACE,
  MEDIAWIKI_KIND,
  MediaWikiSourceProvider,
} from './provider.ts'
import type { MediaWikiResolvedConfig } from './provider.ts'
import type { MediaWikiInstance } from './types.ts'

export {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  MEDIAWIKI_SETTINGS_NAMESPACE,
  MediaWikiSourceProvider,
} from './provider.ts'

export { MEDIAWIKI_KIND }
export type { MediaWikiResolvedConfig, MediaWikiSourceProviderOptions } from './provider.ts'
export { MediaWikiClient, defaultMediaWikiFetch } from './client.ts'
export type { MediaWikiClientOptions, MediaWikiFetch, MediaWikiRequest, MediaWikiResponse } from './client.ts'
export type { MediaWikiInstance, MediaWikiSourceConfig } from './types.ts'
export {
  readApiError,
  readLoginResult,
  readPage,
  readSearchEntries,
  readSitename,
  readTitleList,
  readToken,
} from './wire.ts'
export type {
  MediaWikiApiError,
  MediaWikiLoginResult,
  MediaWikiPage,
  MediaWikiSearchEntry,
} from './wire.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'resource-mediawiki'

/** The source seam this provider registers into. */
export const inject = ['sources']

/** Plugin config: the kind's read cap and its configured wikis. */
export interface Config {
  /** Cap on one read, in bytes. Defaults to 200000. */
  maxReadBytes?: number
  /** Cap on one listing, in items. Defaults to 50. */
  maxListItems?: number
  /** Configured wikis, keyed by instance id. */
  instances?: Record<string, MediaWikiInstance>
}

export const Config: z<Config> = z.object({
  maxReadBytes: z.number().step(1).min(1).default(DEFAULT_MAX_READ_BYTES),
  maxListItems: z.number().step(1).min(1).default(DEFAULT_MAX_LIST_ITEMS),
  instances: z.dict(z.object({
    baseUrl: z.string().required(),
    username: z.string(),
    // The secret itself has no field here: only the name of the credential that
    // holds it enters configuration, and the value is resolved per operation.
    passwordRef: z.string().role('credential-ref'),
  })).default({}),
})

/**
 * Register the MediaWiki source provider. While a settings service is mounted
 * the kind's namespace is the authoritative configuration; without one the
 * composition entry is, so the provider still works from `cordis.yml` alone.
 * @param ctx - context whose `sources` registry receives the provider.
 * @param config - the composition entry, used as the settings base layer.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, MEDIAWIKI_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // Instances and the read cap are read per operation, so a committed change
      // needs no re-registration here; the model-facing consumer re-derives the
      // tools it registers for this kind when it learns the kind changed.
      onChange: () => {
        ctx.emit('sources/changed', MEDIAWIKI_KIND)
      },
    })
  })
  ctx.sources.register(new MediaWikiSourceProvider({
    config: () => current() as MediaWikiResolvedConfig,
    resolveCredential: async ref => (await ctx.get('credentials')?.resolve(ref))?.value,
  }))
}

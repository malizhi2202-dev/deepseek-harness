/**
 * MySQL provider plugin: registers the `mysql` source kind on `ctx.sources` and
 * declares its `resource-mysql` settings namespace.
 *
 * It contributes to the source seam without owning the service. The model-facing
 * consumer (`@deepseek-ai/dsh-tool-resource`) registers the tools; this package
 * owns the connection, the statement whitelist, the grant list, and the limits.
 *
 * @module @deepseek-ai/dsh-resource-mysql
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-resource'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_ROWS,
  DEFAULT_MYSQL_HOST,
  DEFAULT_MYSQL_PORT,
  MYSQL_SETTINGS_NAMESPACE,
  MYSQL_KIND,
  MySqlSourceProvider,
} from './provider.ts'
import type { MySqlResolvedConfig } from './provider.ts'
import type { MySqlInstance } from './types.ts'

export {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_ROWS,
  DEFAULT_MYSQL_HOST,
  DEFAULT_MYSQL_PORT,
  MYSQL_SETTINGS_NAMESPACE,
  MySqlSourceProvider,
} from './provider.ts'

export { MYSQL_KIND }
export type { MySqlResolvedConfig, MySqlSourceProviderOptions } from './provider.ts'
export { SESSION_READ_ONLY_STATEMENT, createMySqlConnector } from './mysql2-connector.ts'
export type { MySql2Connection, MySql2Driver } from './mysql2-connector.ts'
export {
  asRow,
  assertReadOnlyStatement,
  firstStringValue,
  parseMySqlHandle,
  quoteIdentifier,
  readColumn,
  renderRows,
  runReadOnlyStatement,
} from './sql.ts'
export type { MySqlHandle, MySqlRow } from './sql.ts'
export type { MySqlConnectionOptions, MySqlConnector, MySqlInstance, MySqlSession, MySqlSourceConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'resource-mysql'

/** The source seam this provider registers into. */
export const inject = ['sources']

/** Plugin config: the kind's read cap and its configured sources. */
export interface Config {
  /** Cap on one read, in bytes. Defaults to 200000. */
  maxReadBytes?: number
  /** Cap on one listing, in items. Defaults to 50. */
  maxListItems?: number
  /** Configured sources, keyed by instance id. */
  instances?: Record<string, MySqlInstance>
}

export const Config: z<Config> = z.object({
  maxReadBytes: z.number().step(1).min(1).default(DEFAULT_MAX_READ_BYTES),
  maxListItems: z.number().step(1).min(1).default(DEFAULT_MAX_LIST_ITEMS),
  instances: z.dict(z.object({
    host: z.string().default(DEFAULT_MYSQL_HOST),
    port: z.number().step(1).min(1).default(DEFAULT_MYSQL_PORT),
    user: z.string().required(),
    // Only the credential's name enters configuration; the password value is
    // resolved per operation and never stored here.
    passwordRef: z.string().role('credential-ref'),
    // Both grant lists are default-deny: a name the configuration does not
    // carry is invisible to every operation.
    databases: z.array(z.string()).default([]),
    tables: z.array(z.string()).default([]),
    maxRows: z.number().step(1).min(1).default(DEFAULT_MAX_ROWS),
  })).default({}),
})

/**
 * Register the MySQL source provider. While a settings service is mounted the
 * kind's namespace is the authoritative configuration; without one the
 * composition entry is, so the provider still works from `cordis.yml` alone.
 * @param ctx - context whose `sources` registry receives the provider.
 * @param config - the composition entry, used as the settings base layer.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, MYSQL_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // Instances, grants, and the caps are read per operation, so a committed
      // change needs no re-registration here; the model-facing consumer
      // re-derives the tools it registers for this kind when it learns the kind
      // changed.
      onChange: () => {
        ctx.emit('sources/changed', MYSQL_KIND)
      },
    })
  })
  ctx.sources.register(new MySqlSourceProvider({
    config: () => current() as MySqlResolvedConfig,
    resolveCredential: async ref => (await ctx.get('credentials')?.resolve(ref))?.value,
  }))
}

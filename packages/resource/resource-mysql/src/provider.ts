/**
 * `MySqlSourceProvider`: the MySQL kind of `ctx.sources`. It exposes a read-only,
 * restricted, bounded view: only the databases and tables the configuration
 * grants are visible, only `SELECT`, `SHOW`, and `DESCRIBE` statements are ever
 * issued, and every statement passes through the whitelist entry in `./sql.ts`
 * before the driver sees it. No write operation exists on this kind.
 *
 * @module @deepseek-ai/dsh-resource-mysql/provider
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import {
  SOURCE_NOT_FOUND,
  SOURCE_PROVIDER_ERROR,
  SOURCE_UNCONFIGURED,
  SourceError,
  boundDocumentContent,
} from '@deepseek-ai/dsh-resource'
import type {
  SourceCapabilities,
  SourceDescription,
  SourceDocument,
  SourceHit,
  SourceItemRef,
  SourceProvider,
} from '@deepseek-ai/dsh-resource'
import { createMySqlConnector } from './mysql2-connector.ts'
import {
  asRow,
  firstStringValue,
  parseMySqlHandle,
  quoteIdentifier,
  readColumn,
  renderRows,
  runReadOnlyStatement,
} from './sql.ts'
import type { MySqlRow } from './sql.ts'
import type { MySqlConnector, MySqlInstance, MySqlSession, MySqlSourceConfig } from './types.ts'

/** The kind this provider implements. */
export const MYSQL_KIND = 'mysql'

/** This kind's settings namespace. */
export const MYSQL_SETTINGS_NAMESPACE = 'resource-mysql'

/** Default cap on one read, in bytes. */
export const DEFAULT_MAX_READ_BYTES = 200_000

/** Default cap on one listing, in items. */
export const DEFAULT_MAX_LIST_ITEMS = 50

/** Default cap on the rows one read returns. */
export const DEFAULT_MAX_ROWS = 100

/** Default database host. */
export const DEFAULT_MYSQL_HOST = '127.0.0.1'

/** Default database port. */
export const DEFAULT_MYSQL_PORT = 3306

/** The MySQL values every operation reads, after the settings schema resolved them. */
export interface MySqlResolvedConfig {
  /** Cap on one read, in bytes. */
  readonly maxReadBytes: number
  /** Cap on one listing, in items. */
  readonly maxListItems: number
  /** Configured sources, keyed by instance id. */
  readonly instances: Readonly<Record<string, MySqlInstance>>
}

/** Collaborators the provider reads on every operation. */
export interface MySqlSourceProviderOptions {
  /** The kind's currently resolved settings. */
  readonly config: () => MySqlResolvedConfig
  /** Resolve one credential reference to its current value; `undefined` while unset. */
  readonly resolveCredential: (ref: CredentialRef) => Promise<string | undefined>
  /** The connector to open sessions with; defaults to the `mysql2`-backed one. */
  readonly connector?: MySqlConnector
}

/** A trimmed value, or `undefined` for a blank one. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}

/** Keep the rows the driver reported that are plain records. */
function records(rows: readonly unknown[]): MySqlRow[] {
  const kept: MySqlRow[] = []
  for (const row of rows) {
    const record = asRow(row)
    if (record !== undefined) kept.push(record)
  }
  return kept
}

/**
 * The granted tables of one database, by table name. Every grant entry is a
 * `database.table` pair, so the prefix is the whole test.
 */
function grantedTableNames(config: MySqlSourceConfig, database: string): Set<string> {
  const prefix = `${database}.`
  const names = new Set<string>()
  for (const entry of config.tables) {
    if (entry.startsWith(prefix)) names.add(entry.slice(prefix.length))
  }
  return names
}

/** One MySQL source's provider. */
export class MySqlSourceProvider implements SourceProvider<MySqlSourceConfig> {
  readonly kind = MYSQL_KIND

  /**
   * @param options - resolved settings, credential resolution, and the connector.
   */
  constructor(private readonly options: MySqlSourceProviderOptions) {}

  /**
   * What this kind answers. The read cap comes from the current settings.
   * @returns the kind's capabilities and its model-facing limits statement.
   */
  get capabilities(): SourceCapabilities {
    const { maxReadBytes, maxListItems } = this.options.config()
    return {
      search: true,
      browse: true,
      read: true,
      maxReadBytes,
      maxListItems,
      description: `A read-only, restricted, bounded view of a MySQL database. Only the databases and tables this source's configuration grants are visible; every other name reads as not found. search matches granted table names only and never searches row contents; list returns the granted databases, or one database's granted tables; read returns a granted table's rows, at most the configured row limit and cut to ${String(maxReadBytes)} bytes with a truncation marker. This source issues only SELECT, SHOW, and DESCRIBE statements and has no write operation.`,
    }
  }

  /**
   * Resolve every declared source, reporting whether it is usable. A source is
   * unconfigured when it names no account, its password reference is not a
   * credential name, that credential currently resolves to nothing, or its
   * configuration grants no table to read.
   * @returns the declared sources, configured or not.
   */
  async instances(): Promise<readonly MySqlSourceConfig[]> {
    const configs: MySqlSourceConfig[] = []
    for (const [id, instance] of Object.entries(this.options.config().instances)) {
      const passwordRefName = nonEmpty(instance.passwordRef)
      const passwordRef = passwordRefName !== undefined && isCredentialRefName(passwordRefName)
        ? (passwordRefName as CredentialRef)
        : undefined
      const password = passwordRef === undefined ? undefined : await this.options.resolveCredential(passwordRef)
      const tables = (instance.tables ?? []).filter((entry) => {
        const handle = parseMySqlHandle(entry)
        return handle?.table !== undefined && handle.column === undefined
      })
      configs.push({
        ref: { kind: MYSQL_KIND, id },
        configured: nonEmpty(instance.user) !== undefined
          && passwordRef !== undefined
          && password !== undefined
          && password.length > 0
          && tables.length > 0,
        host: instance.host ?? DEFAULT_MYSQL_HOST,
        port: instance.port ?? DEFAULT_MYSQL_PORT,
        user: instance.user ?? '',
        ...passwordRef === undefined ? {} : { passwordRef },
        databases: instance.databases ?? [],
        tables,
        maxRows: instance.maxRows ?? DEFAULT_MAX_ROWS,
      })
    }
    return configs
  }

  /**
   * Probe the connection and report the server version.
   * @param config - the source to probe.
   * @returns the server version and the address it answered from.
   */
  async check(config: MySqlSourceConfig): Promise<SourceDescription> {
    this.assertConfigured(config)
    return await this.withSession(config, undefined, async (session) => {
      const rows = records(await runReadOnlyStatement(session, 'SELECT VERSION() AS version'))
      const version = rows.map(firstStringValue).find(value => value !== undefined)
      if (version === undefined) {
        throw new SourceError('MySQL returned no server version', SOURCE_PROVIDER_ERROR)
      }
      return { label: version, detail: `${config.host}:${String(config.port)}` }
    })
  }

  /**
   * Match the granted table names. This kind has no full-text search over row
   * contents, and its search issues no statement at all.
   * @param config - the source to search.
   * @param query - the text to match against granted table names.
   * @param limit - upper bound on returned hits.
   * @param signal - caller cancellation.
   * @returns the matching granted tables.
   */
  search(
    config: MySqlSourceConfig,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<SourceHit[]> {
    // The work is synchronous, but every failure of this method must reach the
    // caller as a rejection, as it does for the other kinds.
    return Promise.resolve().then(() => {
      this.assertConfigured(config)
      signal.throwIfAborted()
      const needle = query.trim().toLowerCase()
      if (limit < 1 || needle.length === 0) return []
      return config.tables
        .filter(table => table.toLowerCase().includes(needle))
        .slice(0, limit)
        .map(table => ({
          ref: brandString<SourceItemRef>(table),
          title: table,
          summary: 'granted table',
        }))
    })
  }

  /**
   * List the granted databases, one database's granted tables, or one table's
   * columns. The server's own listing is intersected with the grant list, so a
   * name the configuration does not grant stays invisible even when the server
   * reports it.
   * @param config - the source to list.
   * @param ref - a database or table handle, or `undefined` for the granted databases.
   * @param signal - caller cancellation.
   * @returns the visible entries, bounded by the instance's listing cap.
   */
  async list(config: MySqlSourceConfig, ref: SourceItemRef | undefined, signal: AbortSignal): Promise<SourceHit[]> {
    this.assertConfigured(config)
    const limit = this.options.config().maxListItems
    if (ref === undefined) {
      const granted = new Set(config.databases)
      return await this.withSession(config, signal, async (session) => {
        const rows = records(await runReadOnlyStatement(session, 'SHOW DATABASES'))
        const visible: SourceHit[] = []
        for (const name of rows.map(firstStringValue)) {
          if (name === undefined || !granted.has(name) || visible.length >= limit) continue
          visible.push({ ref: brandString<SourceItemRef>(name), title: name, summary: 'database' })
        }
        return visible
      })
    }
    const handle = parseMySqlHandle(ref)
    if (handle === undefined) {
      throw new SourceError(`MySQL has no granted handle "${ref}"`, SOURCE_NOT_FOUND)
    }
    if (handle.table === undefined) {
      const database = this.grantedDatabase(config, handle.database)
      const granted = grantedTableNames(config, database)
      return await this.withSession(config, signal, async (session) => {
        const rows = records(await runReadOnlyStatement(session, `SHOW TABLES FROM ${quoteIdentifier(database)}`))
        const visible: SourceHit[] = []
        for (const name of rows.map(firstStringValue)) {
          if (name === undefined || !granted.has(name) || visible.length >= limit) continue
          visible.push({
            ref: brandString<SourceItemRef>(`${database}.${name}`),
            title: `${database}.${name}`,
            summary: 'table',
          })
        }
        return visible
      })
    }
    const table = this.grantedTable(config, handle.database, handle.table)
    return await this.withSession(config, signal, async (session) => {
      const described = await this.describe(session, table.database, table.table)
      return described.slice(0, limit).map(column => ({
        ref: brandString<SourceItemRef>(`${table.database}.${table.table}.${column.name}`),
        title: column.name,
        summary: column.type,
      }))
    })
  }

  /**
   * Read one granted table's rows, or one column of it, bounded by the instance's
   * row limit and the kind's read cap.
   * @param config - the source to read from.
   * @param ref - a `database.table` or `database.table.column` handle.
   * @param signal - caller cancellation.
   * @returns the bounded document.
   */
  async read(config: MySqlSourceConfig, ref: SourceItemRef, signal: AbortSignal): Promise<SourceDocument> {
    this.assertConfigured(config)
    const handle = parseMySqlHandle(ref)
    if (handle === undefined || handle.table === undefined) {
      throw new SourceError(`MySQL has no granted handle "${ref}"`, SOURCE_NOT_FOUND)
    }
    const table = this.grantedTable(config, handle.database, handle.table)
    return await this.withSession(config, signal, async (session) => {
      const described = await this.describe(session, table.database, table.table)
      const selected = handle.column === undefined
        ? described
        : described.filter(column => column.name === handle.column)
      if (selected.length === 0) {
        throw new SourceError(`MySQL table "${table.database}.${table.table}" has no column "${String(handle.column)}"`, SOURCE_NOT_FOUND)
      }
      const projection = selected.map(column => quoteIdentifier(column.name)).join(', ')
      const rows = records(await runReadOnlyStatement(
        session,
        `SELECT ${projection} FROM ${quoteIdentifier(table.database)}.${quoteIdentifier(table.table)} LIMIT ${String(config.maxRows + 1)}`,
      ))
      // One row past the limit is requested so an over-limit result is reported
      // as cut rather than shown as the whole table.
      const overflow = rows.length > config.maxRows
      const rendered = renderRows(selected.map(column => column.name), overflow ? rows.slice(0, config.maxRows) : rows)
      const text = overflow ? `${rendered}\n[truncated: more than ${String(config.maxRows)} rows]` : rendered
      const bounded = boundDocumentContent(text, this.options.config().maxReadBytes)
      return {
        ref,
        title: `${table.database}.${table.table}`,
        content: bounded.content,
        truncated: bounded.truncated || overflow,
      }
    })
  }

  /** Refuse an instance whose settings are incomplete before any connection opens. */
  private assertConfigured(config: MySqlSourceConfig): void {
    if (!config.configured) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" is not configured`, SOURCE_UNCONFIGURED)
    }
  }

  /** Admit one database name only when the configuration grants it. */
  private grantedDatabase(config: MySqlSourceConfig, database: string): string {
    if (!config.databases.includes(database)) {
      throw new SourceError(`MySQL has no granted database "${database}"`, SOURCE_NOT_FOUND)
    }
    return database
  }

  /**
   * Admit one table only when the configuration grants it. The granted entry's
   * own text is what later statements interpolate, so no identifier in a
   * statement ever came from a caller's handle.
   */
  private grantedTable(config: MySqlSourceConfig, database: string, table: string): { database: string; table: string } {
    const granted = config.tables.find(entry => entry === `${database}.${table}`)
    if (granted === undefined) {
      throw new SourceError(`MySQL has no granted table "${database}.${table}"`, SOURCE_NOT_FOUND)
    }
    return { database, table }
  }

  /** Describe one granted table's columns through the structural read. */
  private async describe(session: MySqlSession, database: string, table: string): Promise<{ name: string; type: string }[]> {
    const rows = records(await runReadOnlyStatement(
      session,
      `DESCRIBE ${quoteIdentifier(database)}.${quoteIdentifier(table)}`,
    ))
    const columns: { name: string; type: string }[] = []
    for (const row of rows) {
      const column = readColumn(row)
      if (column !== undefined) columns.push(column)
    }
    if (columns.length === 0) {
      throw new SourceError(`MySQL reports no columns for "${database}.${table}"`, SOURCE_PROVIDER_ERROR)
    }
    return columns
  }

  /**
   * Open one session for a single operation with the password resolved now, run
   * the operation, and close the session. Nothing outlives the operation, so a
   * changed credential reaches the next one.
   */
  private async withSession<T>(
    config: MySqlSourceConfig,
    signal: AbortSignal | undefined,
    run: (session: MySqlSession) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted()
    const password = config.passwordRef === undefined ? undefined : await this.options.resolveCredential(config.passwordRef)
    if (password === undefined || password.length === 0) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" has no password`, SOURCE_UNCONFIGURED)
    }
    const connector = this.options.connector ?? createMySqlConnector()
    const session = await connector.connect({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
    })
    try {
      return await run(session)
    } finally {
      await session.end()
    }
  }
}

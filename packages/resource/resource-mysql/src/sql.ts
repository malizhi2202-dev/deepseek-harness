/**
 * The MySQL statement whitelist and the query entry that applies it, plus the
 * handle parsing and row narrowing the provider builds on.
 *
 * {@link runReadOnlyStatement} is the single entry every statement the provider
 * issues passes through, and it classifies the statement before the driver sees
 * it. A statement that is not a read is refused there, so neither a direct
 * caller nor an alternate code path can reach the server with one.
 *
 * @module @deepseek-ai/dsh-resource-mysql/sql
 */

import { SOURCE_DENIED, SourceError } from '@deepseek-ai/dsh-resource'
import type { MySqlSession } from './types.ts'

/** Statements this provider issues: the read, the two structural reads, and nothing else. */
const ALLOWED_STATEMENT = /^(select|show|describe)\b/iu

/** Read-shaped statements that still write or lock, refused on top of the keyword whitelist. */
const FORBIDDEN_CLAUSE = /\binto\s+(outfile|dumpfile)\b|\bfor\s+update\b|\block\s+in\s+share\s+mode\b/iu

/** One driver row, after narrowing. */
export type MySqlRow = Readonly<Record<string, unknown>>

/** One parsed MySQL handle: a database, a table, or a table's column. */
export interface MySqlHandle {
  /** The database name. */
  readonly database: string
  /** The table name, absent for a database handle. */
  readonly table?: string
  /** The column name, absent for a database or table handle. */
  readonly column?: string
}

/**
 * Classify one statement, refusing everything that is not a read.
 *
 * The rule is a keyword whitelist, not a keyword blacklist: `SELECT`, `SHOW`,
 * and `DESCRIBE` are the only accepted openers, so an unlisted verb
 * (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `GRANT`, `CALL`,
 * `SET`, `LOAD`, `WITH`, `EXPLAIN`, and anything else) is refused by default. A
 * second statement and the read-shaped writes `SELECT ... INTO OUTFILE`,
 * `SELECT ... INTO DUMPFILE`, and `SELECT ... FOR UPDATE` are refused as well.
 *
 * @param statement - the statement about to be sent.
 * @throws {SourceError} `SOURCE_DENIED` when the statement is not an accepted read.
 */
export function assertReadOnlyStatement(statement: string): void {
  const trimmed = statement.trim().replace(/;$/u, '').trim()
  if (trimmed.length === 0) {
    throw new SourceError('the statement is empty', SOURCE_DENIED)
  }
  if (trimmed.includes(';')) {
    throw new SourceError('the statement carries more than one statement', SOURCE_DENIED)
  }
  if (!ALLOWED_STATEMENT.test(trimmed)) {
    const separator = trimmed.search(/\s/u)
    const verb = separator === -1 ? trimmed : trimmed.slice(0, separator)
    throw new SourceError(
      `only SELECT, SHOW, and DESCRIBE statements are issued by this source; "${verb}" is refused`,
      SOURCE_DENIED,
    )
  }
  if (FORBIDDEN_CLAUSE.test(trimmed)) {
    throw new SourceError('the statement is a read that writes or locks, and is refused', SOURCE_DENIED)
  }
}

/**
 * The provider's query entry: classify one statement and send it, in that order.
 * A refused statement never reaches the session, so the driver cannot receive a
 * statement this source does not permit.
 *
 * @param session - the open session.
 * @param statement - the statement to classify and send.
 * @param values - bound parameters.
 * @returns the raw rows the driver reported.
 * @throws {SourceError} `SOURCE_DENIED` before any call to `session.query`.
 */
export async function runReadOnlyStatement(
  session: MySqlSession,
  statement: string,
  values: readonly unknown[] = [],
): Promise<readonly unknown[]> {
  assertReadOnlyStatement(statement)
  return session.query(statement, values)
}

/**
 * Quote one identifier for interpolation into a statement. The provider only
 * ever quotes names it took from its own configuration, and this doubles any
 * backtick so a configured name cannot close the quoted identifier.
 *
 * @param identifier - the identifier to quote.
 * @returns the backtick-quoted identifier.
 */
export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

/**
 * Split one MySQL handle into its parts.
 * @param ref - a handle of the form `database`, `database.table`, or `database.table.column`.
 * @returns the parts, or `undefined` when the handle is malformed.
 */
export function parseMySqlHandle(ref: string): MySqlHandle | undefined {
  const parts = ref.split('.')
  if (parts.length > 3 || parts.some(part => part.length === 0)) return undefined
  // The checks above guarantee a first part, so the tuple view is exact.
  const [database, table, column] = parts as [string, string?, string?]
  return {
    database,
    ...table === undefined ? {} : { table },
    ...column === undefined ? {} : { column },
  }
}

/**
 * Narrow one driver row into a plain record.
 * @param value - one row as the driver reported it.
 * @returns the row, or `undefined` for a value that is not a plain record.
 */
export function asRow(value: unknown): MySqlRow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as MySqlRow
}

/**
 * Read the first string value of one row. `SHOW DATABASES` and `SHOW TABLES`
 * name their column after the database, so the position is the stable part.
 * @param row - the narrowed row.
 * @returns the first string value, or `undefined` when the row carries none.
 */
export function firstStringValue(row: MySqlRow): string | undefined {
  for (const value of Object.values(row)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Read one `DESCRIBE` row's column name and type.
 * @param row - the narrowed row.
 * @returns the column name and type, or `undefined` when the row names no column.
 */
export function readColumn(row: MySqlRow): { name: string; type: string } | undefined {
  const name = row['Field']
  if (typeof name !== 'string' || name.length === 0) return undefined
  const type = row['Type']
  return { name, type: typeof type === 'string' ? type : '' }
}

/**
 * Render one result set as tab-separated text: a header of column names, then
 * one line per row.
 * @param columns - the column names, in order.
 * @param rows - the narrowed rows.
 * @returns the rendered table.
 */
export function renderRows(columns: readonly string[], rows: readonly MySqlRow[]): string {
  const lines = [columns.join('\t')]
  for (const row of rows) {
    lines.push(columns.map(column => renderValue(row[column])).join('\t'))
  }
  return lines.join('\n')
}

/** Render one cell without inventing structure the driver did not report. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `<binary ${String(value.length)} bytes>`
  if (typeof value === 'object') return JSON.stringify(value)
  return '<unsupported value>'
}

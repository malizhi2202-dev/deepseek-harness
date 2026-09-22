/**
 * The `mysql2`-backed connector. It is a transport: it opens one connection,
 * puts it in read-only session mode, and forwards already-classified statements.
 * Statement classification lives in {@link runReadOnlyStatement}, which the
 * provider calls before any statement reaches this module.
 *
 * The connection is opened with `multipleStatements` disabled and with
 * `transaction_read_only` set for the session, so the server refuses a write
 * even if a statement ever reached it past the whitelist. Both are fixed
 * properties of the connection, not configuration: a deployment cannot weaken
 * them from `cordis.yml`.
 *
 * @module @deepseek-ai/dsh-resource-mysql/mysql2-connector
 */

import mysql from 'mysql2/promise'
import type { MySqlConnectionOptions, MySqlConnector, MySqlSession } from './types.ts'

/** The statement that puts one connection's session into read-only mode. */
export const SESSION_READ_ONLY_STATEMENT = 'SET SESSION TRANSACTION READ ONLY'

/** One connection's narrow `mysql2` surface. */
export interface MySql2Connection {
  /**
   * Send one statement.
   * @param statement - the statement text.
   * @param values - bound parameters.
   * @returns the driver's raw result, `[rows, fields]` for a row-returning statement.
   */
  query(statement: string, values: readonly unknown[]): Promise<unknown>
  /** Close the connection. */
  end(): Promise<void>
}

/** The `mysql2` surface this connector uses. */
export interface MySql2Driver {
  /**
   * Open one connection.
   * @param options - `mysql2` connection options.
   * @returns the open connection.
   */
  createConnection(options: Record<string, unknown>): Promise<MySql2Connection>
}

/** The rows of a `mysql2` result, or an empty list for a result that carries none. */
function rowsOf(result: unknown): readonly unknown[] {
  if (!Array.isArray(result)) return []
  const rows: unknown = result[0]
  return Array.isArray(rows) ? rows : []
}

/**
 * Build the `mysql2`-backed connector.
 *
 * The default driver is `mysql2`'s promise API behind this module's narrow
 * structural view: `mysql2` types its connection options and its `query`
 * overloads per call site, which no single structural signature expresses.
 *
 * @param driver - the driver to use; defaults to `mysql2`'s promise API.
 * @returns the connector the provider opens sessions with.
 */
export function createMySqlConnector(driver: MySql2Driver = mysql as unknown as MySql2Driver): MySqlConnector {
  return {
    async connect(options: MySqlConnectionOptions): Promise<MySqlSession> {
      const connection = await driver.createConnection({
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        // A statement string carrying a second statement is never accepted by
        // this provider; disabling the driver's own splitting keeps that true
        // even if one ever were.
        multipleStatements: false,
        // No database is pinned: every statement qualifies its identifiers, so
        // the connection cannot silently change which schema a name resolves in.
        supportBigNumbers: true,
      })
      await connection.query(SESSION_READ_ONLY_STATEMENT, [])
      return {
        query: async (statement, values) => rowsOf(await connection.query(statement, values)),
        end: () => connection.end(),
      }
    },
  }
}

/**
 * Instance vocabulary for the MySQL source kind. A MySQL source is one read-only
 * connection plus the exact databases and tables it may expose; everything the
 * configuration does not name is invisible, so a model never sees a schema the
 * operator did not grant.
 *
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-resource-mysql/types
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SourceConfig } from '@deepseek-ai/dsh-resource'

/** One configured MySQL source, as the settings schema declares it. */
export interface MySqlInstance {
  /** Database host; defaults to `127.0.0.1`. */
  readonly host?: string
  /** Database port; defaults to 3306. */
  readonly port?: number
  /** Account used for every connection; it must be a read-only account on the server. */
  readonly user?: string
  /** Credential reference holding the account's password. */
  readonly passwordRef?: string
  /** Databases this source exposes, by exact name; an unlisted database is invisible. */
  readonly databases?: string[]
  /** Tables this source exposes, as `database.table`; an unlisted table is invisible. */
  readonly tables?: string[]
  /** Upper bound on the rows one read returns. */
  readonly maxRows?: number
}

/** One MySQL source as the provider serves it: the address plus the values every operation reads. */
export interface MySqlSourceConfig extends SourceConfig {
  /** Database host. */
  readonly host: string
  /** Database port. */
  readonly port: number
  /** Account used for every connection. */
  readonly user: string
  /** Credential reference holding the account's password. */
  readonly passwordRef?: CredentialRef
  /** Databases this source exposes, by exact name. */
  readonly databases: readonly string[]
  /** Tables this source exposes, as `database.table`. */
  readonly tables: readonly string[]
  /** Upper bound on the rows one read returns. */
  readonly maxRows: number
}

/** Connection values the connector receives. */
export interface MySqlConnectionOptions {
  /** Database host. */
  readonly host: string
  /** Database port. */
  readonly port: number
  /** Account name. */
  readonly user: string
  /** Account password, resolved for this connection only. */
  readonly password: string
}

/**
 * One open connection's narrow driver surface. A session performs no statement
 * classification of its own: {@link runReadOnlyStatement} is the entry that
 * decides, and every statement the provider issues passes through it.
 */
export interface MySqlSession {
  /**
   * Send one already-classified statement.
   * @param statement - the statement text.
   * @param values - bound parameters; no identifier or statement text is interpolated here.
   * @returns the raw rows the driver reported.
   */
  query(statement: string, values: readonly unknown[]): Promise<readonly unknown[]>
  /** Close the connection. */
  end(): Promise<void>
}

/** The connection factory the provider uses; a test substitutes a stub. */
export interface MySqlConnector {
  /**
   * Open one connection and put it in read-only session mode.
   * @param options - resolved connection values.
   * @returns the open session.
   */
  connect(options: MySqlConnectionOptions): Promise<MySqlSession>
}

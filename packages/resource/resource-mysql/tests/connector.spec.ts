import { describe, expect, it } from 'vitest'
import { SESSION_READ_ONLY_STATEMENT, createMySqlConnector } from '@deepseek-ai/dsh-resource-mysql'
import type { MySql2Connection, MySql2Driver } from '@deepseek-ai/dsh-resource-mysql'

/** A stub driver that records its calls and answers from a handler. */
function makeDriver(
  handler: (statement: string) => unknown = () => [[], []],
): { driver: MySql2Driver; options: Record<string, unknown>[]; statements: string[]; ended: number } {
  const options: Record<string, unknown>[] = []
  const statements: string[] = []
  const state = { ended: 0 }
  const connection: MySql2Connection = {
    query: (statement) => {
      statements.push(statement)
      return Promise.resolve(handler(statement))
    },
    end: () => {
      state.ended += 1
      return Promise.resolve()
    },
  }
  return {
    options,
    statements,
    get ended() {
      return state.ended
    },
    driver: {
      createConnection: (received) => {
        options.push(received)
        return Promise.resolve(connection)
      },
    },
  }
}

const CONNECTION = { host: 'db.test', port: 3306, user: 'reader', password: 'secret' }

describe('createMySqlConnector', () => {
  it('opens a read-only, single-statement connection and closes it on demand', async () => {
    const bench = makeDriver(() => [[{ Database: 'shop' }], []])
    const session = await createMySqlConnector(bench.driver).connect(CONNECTION)

    expect(bench.options).toEqual([{
      host: 'db.test',
      port: 3306,
      user: 'reader',
      password: 'secret',
      multipleStatements: false,
      supportBigNumbers: true,
    }])
    // The session's own read-only mode is set before the caller's first
    // statement, so the server refuses a write even if one ever arrived.
    expect(bench.statements).toEqual([SESSION_READ_ONLY_STATEMENT])
    await expect(session.query('SELECT 1', [])).resolves.toEqual([{ Database: 'shop' }])
    await session.end()
    expect(bench.ended).toBe(1)
  })

  it('reports no rows for a result that carries none', async () => {
    const bench = makeDriver(() => 'not a result set')
    const session = await createMySqlConnector(bench.driver).connect(CONNECTION)
    await expect(session.query('SELECT 1', [])).resolves.toEqual([])

    const malformed = makeDriver(() => ['not rows', []])
    const other = await createMySqlConnector(malformed.driver).connect(CONNECTION)
    await expect(other.query('SELECT 1', [])).resolves.toEqual([])
  })

  it('uses the mysql2 promise driver when none is injected', () => {
    // The default driver is a thin adapter over `mysql2/promise`; constructing
    // the connector must not open a connection.
    const connector = createMySqlConnector()
    expect(typeof connector.connect).toBe('function')
  })
})

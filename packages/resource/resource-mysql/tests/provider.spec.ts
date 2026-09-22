import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SourceItemRef } from '@deepseek-ai/dsh-resource'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_ROWS,
  DEFAULT_MYSQL_HOST,
  DEFAULT_MYSQL_PORT,
  MYSQL_KIND,
  MySqlSourceProvider,
} from '@deepseek-ai/dsh-resource-mysql'
import type {
  MySqlConnectionOptions,
  MySqlConnector,
  MySqlInstance,
  MySqlResolvedConfig,
  MySqlSourceConfig,
} from '@deepseek-ai/dsh-resource-mysql'

/** One statement the provider issued. */
interface IssuedStatement {
  readonly statement: string
  readonly values: readonly unknown[]
}

/** A stub connector that records every statement and answers from a handler. */
function makeConnector(handler: (statement: string) => readonly unknown[]): {
  connector: MySqlConnector
  statements: IssuedStatement[]
  options: MySqlConnectionOptions[]
  closed: () => number
} {
  const statements: IssuedStatement[] = []
  const options: MySqlConnectionOptions[] = []
  let closed = 0
  return {
    statements,
    options,
    closed: () => closed,
    connector: {
      connect: (received) => {
        options.push(received)
        return Promise.resolve({
          query: (statement, values) => {
            statements.push({ statement, values })
            return Promise.resolve(handler(statement))
          },
          end: () => {
            closed += 1
            return Promise.resolve()
          },
        })
      },
    },
  }
}

/** A provider over fixed settings, a stub connector, and fixed credential values. */
function makeProvider(options: {
  instances: Record<string, MySqlInstance>
  connector: MySqlConnector
  maxReadBytes?: number
  maxListItems?: number
  credentials?: Record<string, string>
}): MySqlSourceProvider {
  const config: MySqlResolvedConfig = {
    maxReadBytes: options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    maxListItems: options.maxListItems ?? DEFAULT_MAX_LIST_ITEMS,
    instances: options.instances,
  }
  return new MySqlSourceProvider({
    config: () => config,
    resolveCredential: (ref: CredentialRef) => Promise.resolve(options.credentials?.[ref]),
    connector: options.connector,
  })
}

const GRANTED: MySqlInstance = {
  host: 'db.test',
  user: 'reader',
  passwordRef: 'mysql_password',
  databases: ['shop'],
  tables: ['shop.orders', 'shop.customers'],
}
const CREDENTIALS = { mysql_password: 'secret' }
const SIGNAL = new AbortController().signal

/** One configured source as `instances()` reports it. */
async function configured(provider: MySqlSourceProvider, id = 'main'): Promise<MySqlSourceConfig> {
  const found = (await provider.instances()).find(instance => instance.ref.id === id)
  if (found === undefined) throw new Error(`no instance ${id}`)
  return found
}

/** The statements a listing or a read issues, in order. */
function statementsOf(bench: { statements: IssuedStatement[] }): string[] {
  return bench.statements.map(issued => issued.statement)
}

describe('MySqlSourceProvider capabilities', () => {
  it('states the read-only view and the current limits', () => {
    const provider = makeProvider({ instances: {}, connector: makeConnector(() => []).connector, maxReadBytes: 555, maxListItems: 4 })
    expect(provider.kind).toBe(MYSQL_KIND)
    expect(provider.capabilities).toMatchObject({ search: true, browse: true, read: true, maxReadBytes: 555, maxListItems: 4 })
    expect(provider.capabilities.description).toContain('SELECT, SHOW, and DESCRIBE')
    expect(provider.capabilities.description).toContain('no write operation')
    expect(provider.capabilities.description).toContain('555 bytes')
  })
})

describe('MySqlSourceProvider.instances', () => {
  it('reports a fully granted source as configured, with its defaults filled', async () => {
    const provider = makeProvider({
      instances: { main: { user: 'reader', passwordRef: 'mysql_password', databases: ['shop'], tables: ['shop.orders'] } },
      connector: makeConnector(() => []).connector,
      credentials: CREDENTIALS,
    })
    expect(await provider.instances()).toEqual([{
      ref: { kind: MYSQL_KIND, id: 'main' },
      configured: true,
      host: DEFAULT_MYSQL_HOST,
      port: DEFAULT_MYSQL_PORT,
      user: 'reader',
      passwordRef: 'mysql_password',
      databases: ['shop'],
      tables: ['shop.orders'],
      maxRows: DEFAULT_MAX_ROWS,
    }])
  })

  it('reports an unusable source as unconfigured', async () => {
    const cases: Record<string, MySqlInstance>[] = [
      { main: { passwordRef: 'mysql_password', tables: ['shop.orders'] } },
      { main: { user: 'reader', tables: ['shop.orders'] } },
      { main: { user: 'reader', passwordRef: 'not a name', tables: ['shop.orders'] } },
      { main: { user: 'reader', passwordRef: 'mysql_password' } },
      { main: { user: 'reader', passwordRef: 'mysql_password', tables: ['shop.orders.column'] } },
      { main: { user: 'reader', passwordRef: 'mysql_password', tables: ['not a handle'] } },
    ]
    for (const instances of cases) {
      const provider = makeProvider({ instances, connector: makeConnector(() => []).connector, credentials: CREDENTIALS })
      expect((await provider.instances())[0]?.configured).toBe(false)
    }
    const blank = makeProvider({
      instances: { main: { user: 'reader', passwordRef: 'mysql_password', tables: ['shop.orders'] } },
      connector: makeConnector(() => []).connector,
      credentials: { mysql_password: '' },
    })
    expect((await blank.instances())[0]?.configured).toBe(false)
  })

  it('keeps only well-formed table grants', async () => {
    const provider = makeProvider({
      instances: { main: { user: 'reader', passwordRef: 'mysql_password', tables: ['shop.orders', 'shop.orders.id', 'bad'] } },
      connector: makeConnector(() => []).connector,
      credentials: CREDENTIALS,
    })
    expect((await configured(provider)).tables).toEqual(['shop.orders'])
  })
})

describe('MySqlSourceProvider operations', () => {
  it('probes the connection with a whitelisted SELECT', async () => {
    const bench = makeConnector(() => [{ version: '8.0.35' }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.check(await configured(provider)))
      .resolves.toEqual({ label: '8.0.35', detail: 'db.test:3306' })
    expect(statementsOf(bench)).toEqual(['SELECT VERSION() AS version'])
    expect(bench.closed()).toBe(1)
  })

  it('fails a probe that reported no version', async () => {
    const bench = makeConnector(() => [])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.check(await configured(provider)))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_PROVIDER_ERROR' }))
    expect(bench.closed()).toBe(1)
  })

  it('matches granted table names for a search and issues no statement', async () => {
    const bench = makeConnector(() => [])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    await expect(provider.search(config, 'ORDER', 10, SIGNAL)).resolves.toEqual([{
      ref: brandString<SourceItemRef>('shop.orders'),
      title: 'shop.orders',
      summary: 'granted table',
    }])
    // The kind has no full-text search: a query that matches no granted table
    // name, a blank query, and a limit below one all answer nothing.
    await expect(provider.search(config, 'no such table', 10, SIGNAL)).resolves.toEqual([])
    await expect(provider.search(config, '   ', 10, SIGNAL)).resolves.toEqual([])
    await expect(provider.search(config, 'orders', 0, SIGNAL)).resolves.toEqual([])
    expect(bench.statements).toEqual([])
    expect(bench.options).toEqual([])
  })

  it('lists the granted databases the server reports', async () => {
    const bench = makeConnector(() => [{ Database: 'shop' }, { Database: 'secret' }, { Database: 7 }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS, maxListItems: 5 })
    await expect(provider.list(await configured(provider), undefined, SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('shop'), title: 'shop', summary: 'database' },
    ])
    expect(statementsOf(bench)).toEqual(['SHOW DATABASES'])
  })

  it('cuts a database listing at the kind\'s item cap', async () => {
    const bench = makeConnector(() => [{ Database: 'shop' }, { Database: 'shop' }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS, maxListItems: 1 })
    await expect(provider.list(await configured(provider), undefined, SIGNAL)).resolves.toHaveLength(1)
  })

  it('lists one granted database\'s tables, quoting the identifier', async () => {
    const bench = makeConnector(() => [{ Tables_in_shop: 'orders' }, { Tables_in_shop: 'customers' }, { Tables_in_shop: 'secrets' }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.list(await configured(provider), brandString<SourceItemRef>('shop'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('shop.orders'), title: 'shop.orders', summary: 'table' },
      { ref: brandString<SourceItemRef>('shop.customers'), title: 'shop.customers', summary: 'table' },
    ])
    expect(statementsOf(bench)).toEqual(['SHOW TABLES FROM `shop`'])
  })

  it('keeps a listing inside the database it was asked for', async () => {
    const bench = makeConnector(() => [{ Tables_in_shop: 'orders' }])
    const provider = makeProvider({
      instances: {
        main: { ...GRANTED, databases: ['shop', 'other'], tables: ['shop.orders', 'shop.customers', 'other.thing'] },
      },
      connector: bench.connector,
      credentials: CREDENTIALS,
    })
    await expect(provider.list(await configured(provider), brandString<SourceItemRef>('shop'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('shop.orders'), title: 'shop.orders', summary: 'table' },
    ])
  })

  it('lists one granted table\'s columns', async () => {
    const bench = makeConnector(() => [
      { Field: 'id', Type: 'int unsigned' },
      { Field: 'total', Type: 'decimal(10,2)' },
      { Field: '', Type: 'int' },
    ])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.list(await configured(provider), brandString<SourceItemRef>('shop.orders'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('shop.orders.id'), title: 'id', summary: 'int unsigned' },
      { ref: brandString<SourceItemRef>('shop.orders.total'), title: 'total', summary: 'decimal(10,2)' },
    ])
    expect(statementsOf(bench)).toEqual(['DESCRIBE `shop`.`orders`'])
  })

  it('reads a granted table through an explicit projection', async () => {
    const bench = makeConnector(statement => statement.startsWith('DESCRIBE')
      ? [{ Field: 'id', Type: 'int' }, { Field: 'total', Type: 'int' }]
      : [{ id: 1, total: 12 }, { id: 2, total: 30 }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const document = await provider.read(await configured(provider), brandString<SourceItemRef>('shop.orders'), SIGNAL)
    expect(document).toEqual({
      ref: 'shop.orders',
      title: 'shop.orders',
      content: 'id\ttotal\n1\t12\n2\t30',
      truncated: false,
    })
    expect(statementsOf(bench)).toEqual([
      'DESCRIBE `shop`.`orders`',
      'SELECT `id`, `total` FROM `shop`.`orders` LIMIT 101',
    ])
    expect(bench.closed()).toBe(1)
  })

  it('reads one column of a granted table', async () => {
    const bench = makeConnector(statement => statement.startsWith('DESCRIBE')
      ? [{ Field: 'id', Type: 'int' }, { Field: 'total', Type: 'int' }]
      : [{ total: 12 }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    const document = await provider.read(config, brandString<SourceItemRef>('shop.orders.total'), SIGNAL)
    expect(document.content).toBe('total\n12')
    expect(statementsOf(bench)[1]).toBe('SELECT `total` FROM `shop`.`orders` LIMIT 101')
    await expect(provider.read(config, brandString<SourceItemRef>('shop.orders.extra'), SIGNAL))
      .rejects.toThrow('MySQL table "shop.orders" has no column "extra"')
  })

  it('marks a read that hit the row limit, and one that hit the byte cap', async () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({ id: index }))
    const overflow = makeConnector(statement => statement.startsWith('DESCRIBE') ? [{ Field: 'id', Type: 'int' }] : rows)
    const provider = makeProvider({
      instances: { main: { ...GRANTED, maxRows: 2 } },
      connector: overflow.connector,
      credentials: CREDENTIALS,
    })
    const document = await provider.read(await configured(provider), brandString<SourceItemRef>('shop.orders'), SIGNAL)
    expect(document.truncated).toBe(true)
    expect(document.content).toBe('id\n0\n1\n[truncated: more than 2 rows]')
    expect(statementsOf(overflow)[1]).toBe('SELECT `id` FROM `shop`.`orders` LIMIT 3')

    const wide = makeConnector(statement => statement.startsWith('DESCRIBE')
      ? [{ Field: 'id', Type: 'int' }]
      : [{ id: 'x'.repeat(500) }])
    const bytes = makeProvider({
      instances: { main: GRANTED },
      connector: wide.connector,
      credentials: CREDENTIALS,
      maxReadBytes: 120,
    })
    const cut = await bytes.read(await configured(bytes), brandString<SourceItemRef>('shop.orders'), SIGNAL)
    expect(cut.truncated).toBe(true)
    expect(new TextEncoder().encode(cut.content).length).toBeLessThanOrEqual(120)
    expect(cut.content).toContain('[truncated:')
  })

  it('refuses a table, a database, and a column the configuration does not grant', async () => {
    const bench = makeConnector(() => [])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    for (const ref of ['secret.table', 'shop.secrets', 'not a handle', 'a.b.c.d', '']) {
      await expect(provider.read(config, brandString<SourceItemRef>(ref), SIGNAL), ref)
        .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    }
    await expect(provider.list(config, brandString<SourceItemRef>('secret'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    await expect(provider.list(config, brandString<SourceItemRef>('shop.secrets'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    await expect(provider.list(config, brandString<SourceItemRef>('a.b.c.d'), SIGNAL), 'malformed').rejects
      .toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    expect(bench.statements).toEqual([])
    expect(bench.options).toEqual([])
  })

  it('refuses an injected identifier before any statement is issued', async () => {
    const bench = makeConnector(() => [])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    for (const ref of [
      'shop.orders`; DROP TABLE `shop`.`customers`; --',
      'shop.orders` UNION SELECT `password` FROM `shop`.`users` --',
      'shop.orders` INTO OUTFILE "/tmp/x" --',
    ]) {
      await expect(provider.read(config, brandString<SourceItemRef>(ref), SIGNAL), ref)
        .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    }
    // No identifier a caller supplied ever reaches a statement: only the
    // configuration's own grant text does.
    expect(bench.statements).toEqual([])
  })

  it('quotes a granted identifier that carries a backtick', async () => {
    const bench = makeConnector(() => [{ 'Tables_in_we`ird': 'orders' }])
    const provider = makeProvider({
      instances: { main: { ...GRANTED, databases: ['we`ird'], tables: ['we`ird.orders'] } },
      connector: bench.connector,
      credentials: CREDENTIALS,
    })
    const config = await configured(provider)
    await expect(provider.list(config, brandString<SourceItemRef>('we`ird'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('we`ird.orders'), title: 'we`ird.orders', summary: 'table' },
    ])
    expect(statementsOf(bench)).toEqual(['SHOW TABLES FROM `we``ird`'])
  })

  it('fails a table the server reports without columns', async () => {
    const bench = makeConnector(() => [])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    await expect(provider.list(config, brandString<SourceItemRef>('shop.orders'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_PROVIDER_ERROR' }))
    await expect(provider.read(config, brandString<SourceItemRef>('shop.orders'), SIGNAL))
      .rejects.toThrow('MySQL reports no columns for "shop.orders"')
    expect(bench.closed()).toBe(2)
  })

  it('refuses an unconfigured source and one whose password disappeared', async () => {
    const bench = makeConnector(() => [])
    const unconfigured = makeProvider({ instances: { main: { user: 'reader', passwordRef: 'mysql_password' } }, connector: bench.connector, credentials: CREDENTIALS })
    const config = (await unconfigured.instances())[0] as MySqlSourceConfig
    await expect(unconfigured.check(config)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.search(config, 'orders', 5, SIGNAL)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.read(config, brandString<SourceItemRef>('shop.orders'), SIGNAL)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.list(config, undefined, SIGNAL)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(bench.statements).toEqual([])

    const gone = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const configuredConfig = await configured(gone)
    const withoutPassword = makeProvider({ instances: { main: GRANTED }, connector: bench.connector })
    await expect(withoutPassword.check(configuredConfig)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(bench.options).toEqual([])
  })

  it('honours caller cancellation before opening a connection', async () => {
    const bench = makeConnector(() => [{ version: '8.0.35' }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    const controller = new AbortController()
    controller.abort()
    await expect(provider.search(config, 'orders', 5, controller.signal)).rejects.toThrow()
    await expect(provider.check(config)).resolves.toBeDefined()
    await expect(provider.list(config, undefined, controller.signal)).rejects.toThrow()
    expect(bench.options).toHaveLength(1)
  })

  it('drops driver rows that are not plain records', async () => {
    const bench = makeConnector(() => [null, { Database: 'shop' }, 'row', ['nested']])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.list(await configured(provider), undefined, SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('shop'), title: 'shop', summary: 'database' },
    ])
  })

  it('opens the mysql2 connector when none is injected', async () => {
    // Nothing listens on this loopback port, so the real driver adapter runs and
    // the connection fails rather than reaching a server.
    const provider = new MySqlSourceProvider({
      config: () => ({
        maxReadBytes: DEFAULT_MAX_READ_BYTES,
        maxListItems: DEFAULT_MAX_LIST_ITEMS,
        instances: { main: { ...GRANTED, host: '127.0.0.1', port: 1 } },
      }),
      resolveCredential: () => Promise.resolve('secret'),
    })
    await expect(provider.check(await configured(provider))).rejects.toThrow()
  })

  it('refuses a configuration that names no credential at all', async () => {
    const bench = makeConnector(() => [{ version: '8.0.35' }])
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    const config = await configured(provider)
    const { passwordRef: _noCredential, ...withoutPasswordRef } = config
    await expect(provider.check(withoutPasswordRef))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(bench.options).toEqual([])
  })

  it('closes the connection when an operation fails inside it', async () => {
    const bench = makeConnector(() => { throw new Error('driver exploded') })
    const provider = makeProvider({ instances: { main: GRANTED }, connector: bench.connector, credentials: CREDENTIALS })
    await expect(provider.check(await configured(provider))).rejects.toThrow('driver exploded')
    expect(bench.closed()).toBe(1)
  })
})

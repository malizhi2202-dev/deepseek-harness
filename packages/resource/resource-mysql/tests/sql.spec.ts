import { describe, expect, it } from 'vitest'
import {
  asRow,
  assertReadOnlyStatement,
  firstStringValue,
  parseMySqlHandle,
  quoteIdentifier,
  readColumn,
  renderRows,
  runReadOnlyStatement,
} from '@deepseek-ai/dsh-resource-mysql'
import type { MySqlSession } from '@deepseek-ai/dsh-resource-mysql'

/** A session that records every statement it is handed. */
function recordingSession(rows: readonly unknown[] = []): { session: MySqlSession; statements: string[] } {
  const statements: string[] = []
  return {
    statements,
    session: {
      query: (statement) => {
        statements.push(statement)
        return Promise.resolve(rows)
      },
      end: () => Promise.resolve(),
    },
  }
}

describe('assertReadOnlyStatement', () => {
  it('accepts the three read statements this source issues', () => {
    for (const statement of [
      'SELECT 1',
      'select `a` from `db`.`t` LIMIT 1',
      'SHOW DATABASES',
      'SHOW TABLES FROM `db`',
      'DESCRIBE `db`.`t`',
      'describe `db`.`t`',
      '  SELECT 1;  ',
    ]) {
      expect(() => { assertReadOnlyStatement(statement) }).not.toThrow()
    }
  })

  it('refuses every statement that is not a read, by default', () => {
    const refused = [
      '',
      '   ',
      ';',
      'DROP',
      'INSERT INTO `db`.`t` VALUES (1)',
      'UPDATE `db`.`t` SET a = 1',
      'DELETE FROM `db`.`t`',
      'DROP TABLE `db`.`t`',
      'ALTER TABLE `db`.`t` ADD COLUMN a INT',
      'CREATE TABLE `db`.`t` (a INT)',
      'TRUNCATE TABLE `db`.`t`',
      'GRANT ALL ON *.* TO `x`',
      'REVOKE ALL ON *.* FROM `x`',
      'CALL `p`()',
      'SET SESSION TRANSACTION READ WRITE',
      'LOAD DATA INFILE "/etc/passwd" INTO TABLE `t`',
      'WITH x AS (SELECT 1) SELECT * FROM x',
      'EXPLAIN SELECT 1',
      'HANDLER `t` OPEN',
      '/* comment */ DROP TABLE `t`',
    ]
    for (const statement of refused) {
      expect(() => { assertReadOnlyStatement(statement) }, statement)
        .toThrow(expect.objectContaining({ code: 'SOURCE_DENIED' }))
    }
  })

  it('refuses a second statement smuggled into one string', () => {
    expect(() => { assertReadOnlyStatement('SELECT 1; DROP TABLE `t`') })
      .toThrow('the statement carries more than one statement')
  })

  it('refuses read-shaped statements that write or lock', () => {
    for (const statement of [
      'SELECT * FROM `t` INTO OUTFILE "/tmp/x"',
      'SELECT * FROM `t` into dumpfile "/tmp/x"',
      'SELECT * FROM `t` FOR UPDATE',
      'SELECT * FROM `t` LOCK IN SHARE MODE',
    ]) {
      expect(() => { assertReadOnlyStatement(statement) }, statement)
        .toThrow(expect.objectContaining({ code: 'SOURCE_DENIED' }))
    }
  })
})

describe('runReadOnlyStatement', () => {
  it('classifies before the session sees the statement', async () => {
    const { session, statements } = recordingSession([{ a: 1 }])
    await expect(runReadOnlyStatement(session, 'SELECT 1')).resolves.toEqual([{ a: 1 }])
    expect(statements).toEqual(['SELECT 1'])
  })

  it('refuses a write at the entry, so the session is never called', async () => {
    const { session, statements } = recordingSession()
    for (const statement of ['DROP TABLE `t`', 'SELECT 1; DROP TABLE `t`', 'SELECT * FROM `t` INTO OUTFILE "/tmp/x"']) {
      await expect(runReadOnlyStatement(session, statement, []))
        .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_DENIED' }))
    }
    expect(statements).toEqual([])
  })

  it('binds values without interpolating them into the statement', async () => {
    const bound: unknown[][] = []
    const session: MySqlSession = {
      query: (statement, values) => {
        bound.push([statement, ...values])
        return Promise.resolve([])
      },
      end: () => Promise.resolve(),
    }
    await runReadOnlyStatement(session, 'SELECT * FROM `t` WHERE a = ?', ["'; DROP TABLE t; --"])
    expect(bound).toEqual([['SELECT * FROM `t` WHERE a = ?', "'; DROP TABLE t; --"]])
  })
})

describe('quoteIdentifier', () => {
  it('quotes an identifier and doubles any backtick inside it', () => {
    expect(quoteIdentifier('table')).toBe('`table`')
    expect(quoteIdentifier('we`ird')).toBe('`we``ird`')
  })
})

describe('parseMySqlHandle', () => {
  it('splits one, two, or three parts', () => {
    expect(parseMySqlHandle('db')).toEqual({ database: 'db' })
    expect(parseMySqlHandle('db.table')).toEqual({ database: 'db', table: 'table' })
    expect(parseMySqlHandle('db.table.column')).toEqual({ database: 'db', table: 'table', column: 'column' })
  })

  it('refuses a handle with too many or empty parts', () => {
    for (const ref of ['db.table.column.extra', '', 'db..table', '.table', 'db.', 'db.table.']) {
      expect(parseMySqlHandle(ref)).toBeUndefined()
    }
  })
})

describe('asRow', () => {
  it('keeps a plain record and drops everything else', () => {
    expect(asRow({ a: 1 })).toEqual({ a: 1 })
    expect(asRow([1, 2])).toBeUndefined()
    expect(asRow(null)).toBeUndefined()
    expect(asRow('row')).toBeUndefined()
  })
})

describe('firstStringValue', () => {
  it('returns the first non-empty string in the row', () => {
    expect(firstStringValue({ Tables_in_db: 'alpha' })).toBe('alpha')
    expect(firstStringValue({ a: 1, b: 'beta' })).toBe('beta')
    expect(firstStringValue({ a: 1, b: '' })).toBeUndefined()
    expect(firstStringValue({})).toBeUndefined()
  })
})

describe('readColumn', () => {
  it('reads a column name and type', () => {
    expect(readColumn({ Field: 'id', Type: 'int unsigned' })).toEqual({ name: 'id', type: 'int unsigned' })
    expect(readColumn({ Field: 'id' })).toEqual({ name: 'id', type: '' })
    expect(readColumn({ Field: 'id', Type: 4 })).toEqual({ name: 'id', type: '' })
    expect(readColumn({ Field: '' })).toBeUndefined()
    expect(readColumn({})).toBeUndefined()
  })
})

describe('renderRows', () => {
  it('renders a header and one tab-separated line per row', () => {
    expect(renderRows(['a', 'b'], [{ a: 'x', b: 2 }, { a: null, b: 'y' }])).toBe('a\tb\nx\t2\nNULL\ty')
  })

  it('renders every value kind the driver can report', () => {
    const rendered = renderRows(['v'], [
      { v: undefined },
      { v: 12 },
      { v: 12n },
      { v: true },
      { v: new Date('2026-09-21T00:00:00.000Z') },
      { v: Buffer.from('abc') },
      { v: { nested: true } },
      { v: [1, 2] },
      { v: () => undefined },
    ])
    expect(rendered.split('\n')).toEqual([
      'v',
      'NULL',
      '12',
      '12',
      'true',
      '2026-09-21T00:00:00.000Z',
      '<binary 3 bytes>',
      '{"nested":true}',
      '[1,2]',
      '<unsupported value>',
    ])
  })
})

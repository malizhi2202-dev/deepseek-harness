import { describe, expect, it } from 'vitest'
import { GitAlignRequestError } from '@deepseek-ai/dsh-git-align'
import {
  assertCommitPaths,
  boundConflicts,
  detailOf,
  exitCodeOf,
  parseLineSeparated,
  parseMergeTreeConflicts,
  parseNullSeparated,
  parseNumstatZ,
  stdoutOf,
} from '@deepseek-ai/dsh-git-align-local'

describe('exitCodeOf', () => {
  it('reads a numeric exit status', () => {
    expect(exitCodeOf(Object.assign(new Error('failed'), { code: 128 }))).toBe(128)
  })

  it('answers undefined for a spawn failure and for non-objects', () => {
    expect(exitCodeOf(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBeUndefined()
    expect(exitCodeOf(new Error('missing'))).toBeUndefined()
    expect(exitCodeOf('nope')).toBeUndefined()
    expect(exitCodeOf(null)).toBeUndefined()
  })
})

describe('stdoutOf', () => {
  it('reads captured stdout and falls back to empty', () => {
    expect(stdoutOf(Object.assign(new Error('failed'), { stdout: 'partial' }))).toBe('partial')
    expect(stdoutOf(new Error('failed'))).toBe('')
    expect(stdoutOf(undefined)).toBe('')
  })
})

describe('detailOf', () => {
  it('reads an error message and stringifies a non-Error throw', () => {
    expect(detailOf(new Error('spawn failed'))).toBe('spawn failed')
    expect(detailOf('thrown text')).toBe('thrown text')
  })
})

describe('assertCommitPaths', () => {
  it('accepts repository-relative paths', () => {
    expect(() => { assertCommitPaths(['src/a.ts', 'src/b.md']) }).not.toThrow()
  })

  it('rejects an empty set, which would commit the whole index', () => {
    expect(() => { assertCommitPaths([]) }).toThrow(GitAlignRequestError)
  })

  it.each(['', '.', '..', '/etc/passwd', ':!excluded', 'a\0b'])(
    'rejects the unusable entry %j',
    (path) => {
      expect(() => { assertCommitPaths([path]) }).toThrow(GitAlignRequestError)
    },
  )
})

describe('parseNumstatZ', () => {
  it('reads counted records and totals nothing itself', () => {
    expect(parseNumstatZ('3\t1\tsrc/a.ts\0')).toEqual([
      { path: 'src/a.ts', insertions: 3, deletions: 1, binary: false },
    ])
  })

  it('reads a binary record as zero counts', () => {
    expect(parseNumstatZ('-\t-\tassets/logo.png\0')).toEqual([
      { path: 'assets/logo.png', insertions: 0, deletions: 0, binary: true },
    ])
  })

  it('keeps a path that contains a tab as one path', () => {
    expect(parseNumstatZ('1\t2\ta\tb.txt\0')).toEqual([
      { path: 'a\tb.txt', insertions: 1, deletions: 2, binary: false },
    ])
  })

  it('skips the trailing empty record', () => {
    expect(parseNumstatZ('')).toEqual([])
  })

  it('rejects an undocumented record shape', () => {
    expect(() => parseNumstatZ('3\tsrc/a.ts\0')).toThrow(/unparsable numstat record/)
    expect(() => parseNumstatZ('3\t1\t\0')).toThrow(/empty path/)
    expect(() => parseNumstatZ('x\t1\tsrc/a.ts\0')).toThrow(/unparsable numstat counts/)
    expect(() => parseNumstatZ('3\t-1\tsrc/a.ts\0')).toThrow(/unparsable numstat counts/)
  })
})

describe('parseMergeTreeConflicts', () => {
  it('drops the merged tree object id line', () => {
    expect(parseMergeTreeConflicts(`${'b'.repeat(40)}\nsrc/a.ts\n\nsrc/b.ts\n`)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('keeps every line when the first is not an object id', () => {
    expect(parseMergeTreeConflicts('src/a.ts\n')).toEqual(['src/a.ts'])
  })

  it('answers an empty list for empty output', () => {
    expect(parseMergeTreeConflicts('')).toEqual([])
  })
})

describe('parseNullSeparated', () => {
  it('splits on NUL and drops the trailing empty entry', () => {
    expect(parseNullSeparated('src/a.ts\0src/b.ts\0')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(parseNullSeparated('')).toEqual([])
  })
})

describe('parseLineSeparated', () => {
  it('splits on newlines and drops empty lines', () => {
    expect(parseLineSeparated('.env\nsrc/a.ts\n')).toEqual(['.env', 'src/a.ts'])
    expect(parseLineSeparated('')).toEqual([])
  })
})

describe('boundConflicts', () => {
  it('cuts the list and retains the true total', () => {
    expect(boundConflicts(['a', 'b', 'c'], 2)).toEqual({ paths: ['a', 'b'], total: 3 })
  })

  it('keeps an exact-length list whole', () => {
    expect(boundConflicts(['a', 'b'], 2)).toEqual({ paths: ['a', 'b'], total: 2 })
  })
})

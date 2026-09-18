/**
 * Tests for the git machine-readable parsers: every record shape the commands
 * emit, decoded from captured stdout strings, plus the unrecognized-record
 * refusals. The service that runs git against a live repository is covered in
 * `service.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { parseBranchList, parseHistory, parseStatusPorcelain } from '../src/parse.ts'

/** One field separator, as `log --format` writes it. */
const F = '\x1f'
/** One record terminator, as `log --format` and `for-each-ref` write it. */
const R = '\x1e'
/** One NUL terminator, as `-z` writes it. */
const N = '\0'

describe('parseStatusPorcelain', () => {
  it('reads the branch headers of a clean repository', () => {
    const output = [
      '# branch.oid 868919447ee24b11c2ae361450fbe8cbbcf2596a',
      '# branch.head master',
      '# branch.upstream origin/master',
      '# branch.ab +2 -1',
    ].map(line => `${line}${N}`).join('')
    expect(parseStatusPorcelain(output)).toEqual({
      head: { oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a', branch: 'master', upstream: 'origin/master', ahead: 2, behind: 1 },
      entries: [],
    })
  })

  it('drops the unborn and detached markers instead of recording them', () => {
    const unborn = `# branch.oid (initial)${N}# branch.head main${N}`
    expect(parseStatusPorcelain(unborn).head).toEqual({ branch: 'main' })
    const detached = `# branch.oid 868919447ee24b11c2ae361450fbe8cbbcf2596a${N}# branch.head (detached)${N}`
    expect(parseStatusPorcelain(detached).head).toEqual({ oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a' })
  })

  it('reads modified entries with a path containing spaces', () => {
    const output = `# branch.oid 868919447ee24b11c2ae361450fbe8cbbcf2596a${N}`
      + `# branch.head master${N}`
      + `1 .M N... 100644 100644 100644 5626abf0f72e58d7a153368b5a7db4c673c0e171 5626abf0f72e58d7a153368b5a7db4c673c0e171 a file with spaces.txt${N}`
    expect(parseStatusPorcelain(output).entries).toEqual([
      { kind: 'changed', path: 'a file with spaces.txt', unstaged: 'modified' },
    ])
  })

  it('reads staged and unstaged sides of one entry separately', () => {
    const record = '1 MM N... 100644 100644 100644 5626abf0f72e58d7a153368b5a7db4c673c0e171 5626abf0f72e58d7a153368b5a7db4c673c0e171 a.txt'
    expect(parseStatusPorcelain(`${record}${N}`).entries).toEqual([
      { kind: 'changed', path: 'a.txt', staged: 'modified', unstaged: 'modified' },
    ])
    const added = '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 5626abf0f72e58d7a153368b5a7db4c673c0e171 b.txt'
    expect(parseStatusPorcelain(`${added}${N}`).entries).toEqual([
      { kind: 'changed', path: 'b.txt', staged: 'added' },
    ])
  })

  it('reads a rename with its pre-rename path', () => {
    const output = `2 RM N... 100644 100644 100644 5626abf0f72e58d7a153368b5a7db4c673c0e171 5626abf0f72e58d7a153368b5a7db4c673c0e171 R100 renamed.txt${N}a.txt${N}`
    expect(parseStatusPorcelain(output).entries).toEqual([
      { kind: 'changed', path: 'renamed.txt', origPath: 'a.txt', staged: 'renamed', unstaged: 'modified' },
    ])
  })

  it('reads untracked and unmerged entries', () => {
    const unmerged = 'u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 0000000000000000000000000000000000000000 conflict.txt'
    const output = `? new.txt${N}${unmerged}${N}`
    expect(parseStatusPorcelain(output).entries).toEqual([
      { kind: 'untracked', path: 'new.txt' },
      { kind: 'changed', path: 'conflict.txt', staged: 'unmerged' },
    ])
  })

  it('refuses an ignored record, which the seam never asks for', () => {
    expect(() => parseStatusPorcelain(`! build/${N}`)).toThrow(/outside the contract/)
  })

  it('refuses a tracked record without its path', () => {
    const truncated = '1 .M N... 100644 100644 100644 h h'
    expect(() => parseStatusPorcelain(`${truncated}${N}`)).toThrow(/without a path/)
  })

  it('refuses a rename without its pre-rename segment', () => {
    const renamed = '2 R. N... 100644 100644 100644 h h R100 renamed.txt'
    expect(() => parseStatusPorcelain(`${renamed}${N}`)).toThrow(/pre-rename path/)
  })

  it('refuses an unrecognized record kind and a malformed pair', () => {
    expect(() => parseStatusPorcelain(`3 .M N...${N}`)).toThrow(/unrecognized porcelain record/)
    expect(() => parseStatusPorcelain(`1 .MAB N...${N}`)).toThrow(/unrecognized porcelain record/)
  })

  it('refuses an unmerged record without its path', () => {
    const truncated = 'u UU N... 100644 100644 100644 100644 h h h'
    expect(() => parseStatusPorcelain(`${truncated}${N}`)).toThrow(/without a path/)
  })

  it('ignores headers the seam does not read', () => {
    const output = `# branch.oid 868919447ee24b11c2ae361450fbe8cbbcf2596a${N}# branch.head master${N}# stash 2${N}`
    expect(parseStatusPorcelain(output).head).toEqual({ oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a', branch: 'master' })
  })
})

describe('parseBranchList', () => {
  it('reads each branch head as a name and tip', () => {
    const output = `master${F}868919447ee24b11c2ae361450fbe8cbbcf2596a${R}\n`
      + `feature${F}bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e${R}\n`
    expect(parseBranchList(output)).toEqual([
      { name: 'master', tip: '868919447ee24b11c2ae361450fbe8cbbcf2596a' },
      { name: 'feature', tip: 'bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e' },
    ])
  })

  it('reads an empty listing', () => {
    expect(parseBranchList('')).toEqual([])
  })

  it('refuses a record missing either field', () => {
    expect(() => parseBranchList(`master${R}`)).toThrow(/unrecognized branch record/)
    expect(() => parseBranchList(`${F}868919447ee24b11c2ae361450fbe8cbbcf2596a${R}`)).toThrow(/unrecognized branch record/)
  })
})

describe('parseHistory', () => {
  it('reads each commit with its parents, author, date, and subject', () => {
    const output = `868919447ee24b11c2ae361450fbe8cbbcf2596a${F}bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e${F}probe${F}2026-09-18T13:20:05+08:00${F}second${R}\n`
      + `bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e${F}${F}probe${F}2026-09-18T13:19:41+08:00${F}first${R}\n`
    expect(parseHistory(output)).toEqual([
      {
        oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a',
        parents: ['bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e'],
        author: 'probe',
        authoredAt: '2026-09-18T13:20:05+08:00',
        subject: 'second',
      },
      {
        oid: 'bfb9d8fe1d5b26ac1898b4c691ce7490549e0a2e',
        parents: [],
        author: 'probe',
        authoredAt: '2026-09-18T13:19:41+08:00',
        subject: 'first',
      },
    ])
  })

  it('reads a merge commit with several parents', () => {
    const output = `${'m'.repeat(40)}${F}${'1'.repeat(40)} ${'2'.repeat(40)} ${'3'.repeat(40)}${F}a${F}d${F}subject${R}`
    expect(parseHistory(output)[0]?.parents).toEqual(['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)])
  })

  it('keeps a subject containing punctuation', () => {
    const output = `${'o'.repeat(40)}${F}${F}a${F}d${F}a subject: with, separators${R}`
    expect(parseHistory(output)[0]?.subject).toBe('a subject: with, separators')
  })

  it('refuses a record missing a field', () => {
    expect(() => parseHistory(`oid${F}parent${F}author${R}`)).toThrow(/unrecognized commit record/)
  })
})

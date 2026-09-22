import { describe, expect, it } from 'vitest'
import {
  readApiError,
  readLoginResult,
  readPage,
  readSearchEntries,
  readSitename,
  readTitleList,
  readToken,
} from '@deepseek-ai/dsh-resource-mediawiki'

describe('MediaWiki wire guards', () => {
  it('rejects anything that is not a plain record', () => {
    for (const payload of [undefined, null, 42, 'text', [], true]) {
      expect(readApiError(payload)).toBeUndefined()
      expect(readLoginResult(payload)).toBeUndefined()
      expect(readSitename(payload)).toBeUndefined()
      expect(readToken(payload, 'logintoken')).toBeUndefined()
      expect(readSearchEntries(payload)).toBeUndefined()
      expect(readPage(payload)).toBeUndefined()
      expect(readTitleList(payload, 'allcategories', 'category')).toBeUndefined()
    }
  })

  it('reads an API error envelope only when both fields are usable', () => {
    expect(readApiError({ error: { code: 'badvalue', info: 'nope' } })).toEqual({ code: 'badvalue', info: 'nope' })
    expect(readApiError({ error: { code: '', info: 'nope' } })).toBeUndefined()
    expect(readApiError({ error: { code: 'badvalue' } })).toBeUndefined()
    expect(readApiError({ error: { code: 7, info: 8 } })).toBeUndefined()
    expect(readApiError({ error: 'not an object' })).toBeUndefined()
  })

  it('reads a login outcome, keeping only a string reason', () => {
    expect(readLoginResult({ login: { result: 'Success' } })).toEqual({ result: 'Success' })
    expect(readLoginResult({ login: { result: 'WrongPass', reason: 'bad' } })).toEqual({ result: 'WrongPass', reason: 'bad' })
    expect(readLoginResult({ login: { result: 'WrongPass', reason: 3 } })).toEqual({ result: 'WrongPass' })
    expect(readLoginResult({ login: { result: '' } })).toBeUndefined()
    expect(readLoginResult({ login: {} })).toBeUndefined()
  })

  it('reads a token and a site name out of the query envelope', () => {
    expect(readToken({ query: { tokens: { logintoken: 'T' } } }, 'logintoken')).toBe('T')
    expect(readToken({ query: { tokens: { logintoken: '' } } }, 'logintoken')).toBeUndefined()
    expect(readToken({ query: { tokens: {} } }, 'logintoken')).toBeUndefined()
    expect(readToken({ query: 'x' }, 'logintoken')).toBeUndefined()
    expect(readSitename({ query: { general: { sitename: 'Wiki' } } })).toBe('Wiki')
    expect(readSitename({ query: { general: { sitename: 1 } } })).toBeUndefined()
    expect(readSitename({ query: {} })).toBeUndefined()
  })

  it('reads search entries, dropping the ones with no title', () => {
    const payload = {
      query: {
        search: [
          { title: 'Alpha', snippet: '<span class="searchmatch">A</span>lpha' },
          { title: 'Beta' },
          { title: '' },
          { snippet: 'orphan' },
          'not an object',
        ],
      },
    }
    expect(readSearchEntries(payload)).toEqual([
      { title: 'Alpha', snippet: '<span class="searchmatch">A</span>lpha' },
      { title: 'Beta' },
    ])
    expect(readSearchEntries({ query: { search: 'not a list' } })).toBeUndefined()
  })

  it('reads one page from a revisions query', () => {
    const page = { query: { pages: [{ title: 'Alpha', revisions: [{ slots: { main: { content: 'body' } } }] }] } }
    expect(readPage(page)).toEqual({ title: 'Alpha', missing: false, content: 'body' })
    expect(readPage({ query: { pages: [{ title: 'Gone', missing: true }] } })).toEqual({ title: 'Gone', missing: true })
    expect(readPage({ query: { pages: [] } })).toBeUndefined()
    expect(readPage({ query: { pages: [{ revisions: [] }] } })).toBeUndefined()
    expect(readPage({ query: { pages: [{ title: 'Alpha' }] } })).toBeUndefined()
    expect(readPage({ query: { pages: [{ title: 'Alpha', revisions: [{ slots: { main: { content: 5 } } }] }] } })).toBeUndefined()
    expect(readPage({ query: { pages: [{ title: 'Alpha', revisions: 'nope' }] } })).toBeUndefined()
    expect(readPage({ query: { pages: 'nope' } })).toBeUndefined()
  })

  it('reads a title list, dropping entries with no usable title', () => {
    const payload = { query: { allcategories: [{ category: 'One' }, { category: '' }, {}, 'x'] } }
    expect(readTitleList(payload, 'allcategories', 'category')).toEqual(['One'])
    expect(readTitleList({ query: { categorymembers: [{ title: 'A' }, { title: 'B' }] } }, 'categorymembers', 'title'))
      .toEqual(['A', 'B'])
    expect(readTitleList({ query: { allcategories: {} } }, 'allcategories', 'category')).toBeUndefined()
  })
})

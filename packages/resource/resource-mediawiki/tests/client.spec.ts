import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaWikiClient, defaultMediaWikiFetch } from '@deepseek-ai/dsh-resource-mediawiki'
import type { MediaWikiFetch, MediaWikiRequest, MediaWikiResponse } from '@deepseek-ai/dsh-resource-mediawiki'

/** One recorded request, with its form body decoded. */
interface RecordedCall {
  readonly url: string
  readonly params: URLSearchParams
  readonly request: MediaWikiRequest
}

/** A scripted exchange that records every call and answers from a handler. */
function makeFetch(handler: (call: RecordedCall) => MediaWikiResponse): { fetch: MediaWikiFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    fetch: (url, request) => {
      const call: RecordedCall = { url, params: new URLSearchParams(request.body), request }
      calls.push(call)
      return Promise.resolve(handler(call))
    },
  }
}

/** One successful JSON response, optionally carrying cookies. */
function json(payload: unknown, setCookie: readonly string[] = []): MediaWikiResponse {
  return { status: 200, body: JSON.stringify(payload), setCookie }
}

const BASE_URL = 'https://wiki.example/w/api.php'

describe('defaultMediaWikiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the form body and refuses redirects', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Promise.resolve(new Response('{"ok":true}', {
        status: 200,
        headers: { 'set-cookie': 'session=abc; Path=/' },
      }))
    })
    const response = await defaultMediaWikiFetch(BASE_URL, {
      body: 'action=query',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(BASE_URL)
    expect(seen[0]?.init.method).toBe('POST')
    // A wiki that answered with a redirect must fail before the request follows
    // it, so the configured endpoint stays the only origin contacted.
    expect(seen[0]?.init.redirect).toBe('error')
    expect(seen[0]?.init.body).toBe('action=query')
    expect(response.status).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    expect(response.setCookie).toEqual(['session=abc; Path=/'])
  })

  it('forwards the caller signal when one is present', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen.push(init)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    const controller = new AbortController()
    await defaultMediaWikiFetch(BASE_URL, { body: '', headers: {}, signal: controller.signal })
    expect(seen[0]?.signal).toBe(controller.signal)
  })
})

describe('MediaWikiClient', () => {
  it('sends format and formatversion with every call and returns the decoded body', async () => {
    const { fetch, calls } = makeFetch(() => json({ query: { general: { sitename: 'Wiki' } } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, fetch })
    const payload = await client.call({ action: 'query', meta: 'siteinfo' })
    expect(payload).toEqual({ query: { general: { sitename: 'Wiki' } } })
    expect(calls[0]?.params.get('format')).toBe('json')
    expect(calls[0]?.params.get('formatversion')).toBe('2')
    expect(calls[0]?.params.get('action')).toBe('query')
    expect(calls[0]?.request.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(calls[0]?.request.headers['cookie']).toBeUndefined()
  })

  it('keeps the cookies a response sets and sends them on the next call', async () => {
    const { fetch, calls } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } }, ['session=abc; Path=/; HttpOnly', 'extra=1'])
      : json({ login: { result: 'Success' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'Bot@reader', password: 'secret', fetch })
    await client.login()
    expect(calls).toHaveLength(2)
    expect(calls[0]?.request.headers['cookie']).toBeUndefined()
    expect(calls[1]?.request.headers['cookie']).toBe('session=abc; extra=1')
    expect(calls[1]?.params.get('lgname')).toBe('Bot@reader')
    expect(calls[1]?.params.get('lgpassword')).toBe('secret')
    expect(calls[1]?.params.get('lgtoken')).toBe('T')
  })

  it('ignores a Set-Cookie value that carries no name', async () => {
    const { fetch, calls } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } }, ['=novalue; Path=/'])
      : json({ login: { result: 'Success' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'u', password: 'p', fetch })
    await client.login()
    expect(calls[1]?.request.headers['cookie']).toBeUndefined()
  })

  it('fails when the wiki returns no login token', async () => {
    const { fetch } = makeFetch(() => json({ query: { tokens: {} } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'u', password: 'p', fetch })
    await expect(client.login()).rejects.toThrow(expect.objectContaining({
      code: 'SOURCE_PROVIDER_ERROR',
      message: 'MediaWiki returned no login token',
    }))
  })

  it('fails with the wiki\'s own reason when the password is refused', async () => {
    const { fetch } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } })
      : json({ login: { result: 'WrongPass', reason: 'Incorrect password' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'u', password: 'p', fetch })
    await expect(client.login()).rejects.toThrow('MediaWiki login failed (WrongPass: Incorrect password)')
  })

  it('reports a refused password the wiki explained without a reason', async () => {
    const { fetch } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } })
      : json({ login: { result: 'WrongPass' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'u', password: 'p', fetch })
    await expect(client.login()).rejects.toThrow('MediaWiki login failed (WrongPass)')
  })

  it('sends an empty user name and password when the client was given none', async () => {
    const { fetch, calls } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } })
      : json({ login: { result: 'Success' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, fetch })
    await client.login()
    expect(calls[1]?.params.get('lgname')).toBe('')
    expect(calls[1]?.params.get('lgpassword')).toBe('')
  })

  it('reports a login result that carries no code at all', async () => {
    const { fetch } = makeFetch(call => call.params.get('action') === 'query'
      ? json({ query: { tokens: { logintoken: 'T' } } })
      : json({ login: {} }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, username: 'u', password: 'p', fetch })
    await expect(client.login()).rejects.toThrow('MediaWiki login failed (no result)')
  })

  it('fails on a non-2xx status', async () => {
    const { fetch } = makeFetch(() => ({ status: 503, body: '{}', setCookie: [] }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, fetch })
    await expect(client.call({ action: 'query' })).rejects.toThrow(expect.objectContaining({
      code: 'SOURCE_PROVIDER_ERROR',
      message: 'MediaWiki returned HTTP 503',
    }))
  })

  it('fails on a body that is not JSON', async () => {
    const { fetch } = makeFetch(() => ({ status: 200, body: '<html>', setCookie: [] }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, fetch })
    await expect(client.call({ action: 'query' })).rejects.toThrow('MediaWiki returned a body that is not JSON')
  })

  it('fails with the wiki\'s error envelope', async () => {
    const { fetch } = makeFetch(() => json({ error: { code: 'readapidenied', info: 'You need read permission' } }))
    const client = new MediaWikiClient({ baseUrl: BASE_URL, fetch })
    await expect(client.call({ action: 'query' })).rejects.toThrow('MediaWiki error readapidenied: You need read permission')
  })
})

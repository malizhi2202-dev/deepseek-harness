import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  MediaWikiSourceProvider,
} from '@deepseek-ai/dsh-resource-mediawiki'
import type {
  MediaWikiFetch,
  MediaWikiInstance,
  MediaWikiRequest,
  MediaWikiResolvedConfig,
  MediaWikiResponse,
  MediaWikiSourceConfig,
} from '@deepseek-ai/dsh-resource-mediawiki'
import type { SourceItemRef } from '@deepseek-ai/dsh-resource'

const BASE_URL = 'https://wiki.example/w/api.php'

/** One recorded request, with its form body decoded. */
interface RecordedCall {
  readonly params: URLSearchParams
  readonly request: MediaWikiRequest
}

/** A scripted exchange that records every call. */
function makeFetch(handler: (call: RecordedCall) => MediaWikiResponse): { fetch: MediaWikiFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    fetch: (_url, request) => {
      const call: RecordedCall = { params: new URLSearchParams(request.body), request }
      calls.push(call)
      return Promise.resolve(handler(call))
    },
  }
}

/** One successful JSON response. */
function json(payload: unknown): MediaWikiResponse {
  return { status: 200, body: JSON.stringify(payload), setCookie: [] }
}

/** A provider over fixed settings, a scripted exchange, and fixed credential values. */
function makeProvider(options: {
  instances: Record<string, MediaWikiInstance>
  maxReadBytes?: number
  maxListItems?: number
  fetch: MediaWikiFetch
  credentials?: Record<string, string>
}): MediaWikiSourceProvider {
  const config: MediaWikiResolvedConfig = {
    maxReadBytes: options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    maxListItems: options.maxListItems ?? DEFAULT_MAX_LIST_ITEMS,
    instances: options.instances,
  }
  return new MediaWikiSourceProvider({
    config: () => config,
    resolveCredential: (ref: CredentialRef) => Promise.resolve(options.credentials?.[ref]),
    fetch: options.fetch,
  })
}

/** One configured instance as `instances()` reports it. */
async function configuredInstance(
  provider: MediaWikiSourceProvider,
  id = 'wiki',
): Promise<MediaWikiSourceConfig> {
  const found = (await provider.instances()).find(instance => instance.ref.id === id)
  if (found === undefined) throw new Error(`no instance ${id}`)
  return found
}

/** An exchange that answers only the calls one operation makes. */
function scripted(handlers: Record<string, unknown>): { fetch: MediaWikiFetch; calls: RecordedCall[] } {
  return makeFetch((call) => {
    const key = call.params.get('list') ?? call.params.get('prop') ?? call.params.get('meta') ?? 'unknown'
    const payload = handlers[key]
    if (payload === undefined) throw new Error(`unscripted MediaWiki call: ${key}`)
    return json(payload)
  })
}

describe('MediaWikiSourceProvider capabilities', () => {
  it('declares all three operations and the current limits', () => {
    const provider = makeProvider({ instances: {}, fetch: () => Promise.reject(new Error('unused')), maxReadBytes: 1234, maxListItems: 7 })
    expect(provider.kind).toBe('mediawiki')
    expect(provider.capabilities).toMatchObject({ search: true, browse: true, read: true, maxReadBytes: 1234, maxListItems: 7 })
    expect(provider.capabilities.description).toContain('1234 bytes')
  })
})

describe('MediaWikiSourceProvider.instances', () => {
  it('reports an anonymous wiki as configured', async () => {
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch: () => Promise.reject(new Error('unused')) })
    const instances = await provider.instances()
    expect(instances).toEqual([{ ref: { kind: 'mediawiki', id: 'wiki' }, configured: true, baseUrl: BASE_URL }])
  })

  it('reports a bot-password wiki as configured only while its credential resolves', async () => {
    const instances = { wiki: { baseUrl: BASE_URL, username: 'Bot@reader', passwordRef: 'wiki_bot' } }
    const resolved = makeProvider({ instances, fetch: () => Promise.reject(new Error('unused')), credentials: { wiki_bot: 'secret' } })
    expect((await resolved.instances())[0]?.configured).toBe(true)

    const missing = makeProvider({ instances, fetch: () => Promise.reject(new Error('unused')) })
    expect((await missing.instances())[0]?.configured).toBe(false)

    const blank = makeProvider({ instances, fetch: () => Promise.reject(new Error('unused')), credentials: { wiki_bot: '' } })
    expect((await blank.instances())[0]?.configured).toBe(false)
  })

  it('reports an endpoint that is not an http(s) URL as unconfigured', async () => {
    for (const baseUrl of ['not a url', 'ftp://wiki.example/api.php']) {
      const provider = makeProvider({ instances: { wiki: { baseUrl } }, fetch: () => Promise.reject(new Error('unused')) })
      expect((await provider.instances())[0]?.configured).toBe(false)
    }
  })

  it('reports a half-configured bot password as unconfigured', async () => {
    const onlyUser = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, username: 'Bot@reader' } },
      fetch: () => Promise.reject(new Error('unused')),
    })
    expect((await onlyUser.instances())[0]?.configured).toBe(false)

    const onlyRef = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, passwordRef: 'wiki_bot' } },
      fetch: () => Promise.reject(new Error('unused')),
      credentials: { wiki_bot: 'secret' },
    })
    expect((await onlyRef.instances())[0]?.configured).toBe(false)

    const badName = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, username: 'Bot@reader', passwordRef: 'not a name' } },
      fetch: () => Promise.reject(new Error('unused')),
    })
    expect((await badName.instances())[0]?.configured).toBe(false)
  })

  it('reports every declared wiki, in settings order, and makes no request', async () => {
    const calls: RecordedCall[] = []
    const provider = makeProvider({
      instances: { first: { baseUrl: BASE_URL }, second: { baseUrl: 'https://other.example/w/api.php' } },
      fetch: (_url, request) => {
        calls.push({ params: new URLSearchParams(request.body), request })
        return Promise.reject(new Error('unused'))
      },
    })
    expect((await provider.instances()).map(instance => instance.ref.id)).toEqual(['first', 'second'])
    expect(calls).toEqual([])
  })
})

describe('MediaWikiSourceProvider operations', () => {
  it('probes the wiki and reports its site name', async () => {
    const { fetch } = scripted({ siteinfo: { query: { general: { sitename: 'Example Wiki' } } } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.check(await configuredInstance(provider))).resolves.toEqual({ label: 'Example Wiki', detail: BASE_URL })
  })

  it('fails a probe that carries no site name', async () => {
    const { fetch } = scripted({ siteinfo: { query: { general: {} } } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.check(await configuredInstance(provider)))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_PROVIDER_ERROR' }))
  })

  it('searches with the wiki\'s own full-text search and strips snippet markup', async () => {
    const { fetch, calls } = scripted({
      search: {
        query: {
          search: [
            { title: 'Alpha', snippet: '<span class="searchmatch">Al</span>pha is a page' },
            { title: 'Beta', snippet: '<b></b>' },
            { title: 'Gamma' },
          ],
        },
      },
    })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    const hits = await provider.search(await configuredInstance(provider), 'alpha', 5, new AbortController().signal)
    expect(hits).toEqual([
      { ref: brandString<SourceItemRef>('Alpha'), title: 'Alpha', summary: 'Alpha is a page' },
      { ref: brandString<SourceItemRef>('Beta'), title: 'Beta' },
      { ref: brandString<SourceItemRef>('Gamma'), title: 'Gamma' },
    ])
    expect(calls[0]?.params.get('srsearch')).toBe('alpha')
    expect(calls[0]?.params.get('srlimit')).toBe('5')
  })

  it('returns nothing for a search limit below one, without calling the wiki', async () => {
    const { fetch, calls } = scripted({})
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.search(await configuredInstance(provider), 'alpha', 0, new AbortController().signal))
      .resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('fails a search whose result list is malformed', async () => {
    const { fetch } = scripted({ search: { query: {} } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.search(await configuredInstance(provider), 'alpha', 5, new AbortController().signal))
      .rejects.toThrow('MediaWiki returned no search results list')
  })

  it('reads one page\'s wikitext', async () => {
    const { fetch, calls } = scripted({
      revisions: { query: { pages: [{ title: 'Alpha', revisions: [{ slots: { main: { content: 'the body' } } }] }] } },
    })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    const document = await provider.read(await configuredInstance(provider), brandString<SourceItemRef>('Alpha'), new AbortController().signal)
    expect(document).toEqual({ ref: 'Alpha', title: 'Alpha', content: 'the body', truncated: false })
    expect(calls[0]?.params.get('rvslots')).toBe('main')
    expect(calls[0]?.params.get('titles')).toBe('Alpha')
  })

  it('reads a page that does not exist as not found', async () => {
    const { fetch } = scripted({ revisions: { query: { pages: [{ title: 'Gone', missing: true }] } } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.read(await configuredInstance(provider), brandString<SourceItemRef>('Gone'), new AbortController().signal))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
  })

  it('reads a page that carries no content as not found', async () => {
    const { fetch } = scripted({ revisions: { query: { pages: [{ title: 'Alpha', revisions: [] }] } } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.read(await configuredInstance(provider), brandString<SourceItemRef>('Alpha'), new AbortController().signal))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
  })

  it('cuts a long page at the declared read cap and marks it', async () => {
    const content = 'x'.repeat(5_000)
    const { fetch } = scripted({
      revisions: { query: { pages: [{ title: 'Big', revisions: [{ slots: { main: { content } } }] }] } },
    })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch, maxReadBytes: 200 })
    const document = await provider.read(await configuredInstance(provider), brandString<SourceItemRef>('Big'), new AbortController().signal)
    expect(document.truncated).toBe(true)
    expect(new TextEncoder().encode(document.content).length).toBeLessThanOrEqual(200)
    expect(document.content).toContain('[truncated:')
  })

  it('lists the wiki\'s categories with the namespace prefix every handle needs', async () => {
    const { fetch, calls } = scripted({ allcategories: { query: { allcategories: [{ category: 'Science' }, { category: 'Arts' }] } } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    const hits = await provider.list(await configuredInstance(provider), undefined, new AbortController().signal)
    expect(hits).toEqual([
      { ref: brandString<SourceItemRef>('Category:Science'), title: 'Category:Science' },
      { ref: brandString<SourceItemRef>('Category:Arts'), title: 'Category:Arts' },
    ])
    expect(calls[0]?.params.get('aclimit')).toBe('50')
  })

  it('lists one category\'s members', async () => {
    const { fetch, calls } = scripted({
      categorymembers: { query: { categorymembers: [{ title: 'Alpha' }, { title: 'Beta' }] } },
    })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch, maxListItems: 1 })
    const hits = await provider.list(await configuredInstance(provider), brandString<SourceItemRef>('Category:Science'), new AbortController().signal)
    expect(hits).toEqual([{ ref: brandString<SourceItemRef>('Alpha'), title: 'Alpha' }])
    expect(calls[0]?.params.get('cmtitle')).toBe('Category:Science')
    expect(calls[0]?.params.get('cmlimit')).toBe('1')
  })

  it('fails a listing the wiki answered without a list', async () => {
    const { fetch } = scripted({ allcategories: { query: {} } })
    const provider = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch })
    await expect(provider.list(await configuredInstance(provider), undefined, new AbortController().signal))
      .rejects.toThrow('MediaWiki returned no listing')
  })

  it('signs in with a bot password before the operation, and only then', async () => {
    const { fetch, calls } = makeFetch((call) => {
      if (call.params.get('meta') === 'tokens') return json({ query: { tokens: { logintoken: 'T' } } })
      if (call.params.get('action') === 'login') return json({ login: { result: 'Success' } })
      return json({ query: { general: { sitename: 'Wiki' } } })
    })
    const provider = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, username: 'Bot@reader', passwordRef: 'wiki_bot' } },
      fetch,
      credentials: { wiki_bot: 'secret' },
    })
    await expect(provider.check(await configuredInstance(provider))).resolves.toEqual({ label: 'Wiki', detail: BASE_URL })
    expect(calls.map(call => call.params.get('action'))).toEqual(['query', 'login', 'query'])

    // An anonymous wiki never signs in.
    const anonymous = makeFetch(() => json({ query: { general: { sitename: 'Wiki' } } }))
    const open = makeProvider({ instances: { wiki: { baseUrl: BASE_URL } }, fetch: anonymous.fetch })
    await open.check(await configuredInstance(open))
    expect(anonymous.calls).toHaveLength(1)
  })

  it('refuses to fall back to anonymous access when the credential disappears', async () => {
    const { fetch, calls } = scripted({})
    const provider = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, username: 'Bot@reader', passwordRef: 'wiki_bot' } },
      fetch,
      credentials: { wiki_bot: 'secret' },
    })
    const config = await configuredInstance(provider)
    const withoutCredential = makeProvider({
      instances: { wiki: { baseUrl: BASE_URL, username: 'Bot@reader', passwordRef: 'wiki_bot' } },
      fetch,
    })
    await expect(withoutCredential.check(config))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(calls).toEqual([])
  })

  it('uses the redirect-refusing default exchange when none is injected', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen.push(init)
      return Promise.resolve(new Response(JSON.stringify({ query: { general: { sitename: 'Wiki' } } }), { status: 200 }))
    })
    try {
      const provider = new MediaWikiSourceProvider({
        config: () => ({
          maxReadBytes: DEFAULT_MAX_READ_BYTES,
          maxListItems: DEFAULT_MAX_LIST_ITEMS,
          instances: { wiki: { baseUrl: BASE_URL } },
        }),
        resolveCredential: () => Promise.resolve(undefined),
      })
      await expect(provider.check(await configuredInstance(provider))).resolves.toEqual({ label: 'Wiki', detail: BASE_URL })
      expect(seen[0]?.redirect).toBe('error')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses every operation on an unconfigured wiki before any request', async () => {
    const { fetch, calls } = scripted({})
    const provider = makeProvider({ instances: { wiki: { baseUrl: 'not a url' } }, fetch })
    const config = (await provider.instances())[0] as MediaWikiSourceConfig
    const signal = new AbortController().signal
    await expect(provider.check(config)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(provider.search(config, 'q', 5, signal)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(provider.read(config, brandString<SourceItemRef>('A'), signal)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(provider.list(config, undefined, signal)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(calls).toEqual([])
  })
})

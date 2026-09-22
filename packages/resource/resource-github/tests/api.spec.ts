import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OctokitGitHubApi,
  createGitHubApi,
  readAuthenticatedLogin,
  readCodeSearchHits,
  readContent,
  readDirectoryEntries,
} from '@deepseek-ai/dsh-resource-github'
import type { OctokitLike } from '@deepseek-ai/dsh-resource-github'

/** One recorded octokit call. */
interface RecordedCall {
  readonly route: string
  readonly params: Record<string, unknown> | undefined
}

/** A stub octokit that records its calls and answers from a handler. */
function makeOctokit(handler: (call: RecordedCall) => unknown): { client: OctokitLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const answer = (route: string, params?: Record<string, unknown>): Promise<{ data: unknown }> => {
    const call: RecordedCall = { route, params }
    calls.push(call)
    return Promise.resolve({ data: handler(call) })
  }
  return {
    calls,
    client: {
      rest: {
        search: { code: params => answer('search.code', params) },
        repos: { getContent: params => answer('repos.getContent', params) },
        users: { getAuthenticated: params => answer('users.getAuthenticated', params) },
      },
    },
  }
}

const FILE_PAYLOAD = {
  type: 'file',
  path: 'README.md',
  name: 'README.md',
  size: 5,
  encoding: 'base64',
  content: Buffer.from('hello', 'utf8').toString('base64'),
}

describe('GitHub wire guards', () => {
  it('rejects a code-search response without a results list', () => {
    expect(() => readCodeSearchHits({})).toThrow(expect.objectContaining({ code: 'SOURCE_PROVIDER_ERROR' }))
    expect(() => readCodeSearchHits({ items: 'nope' })).toThrow('GitHub returned no code-search results list')
    expect(readCodeSearchHits({ items: [] })).toEqual([])
  })

  it('drops code-search hits that name no repository or path', () => {
    const payload = {
      items: [
        { path: 'src/a.ts', repository: { full_name: 'octo/repo' } },
        { path: 'src/b.ts', repository: {} },
        { repository: { full_name: 'octo/repo' } },
        { path: '', repository: { full_name: 'octo/repo' } },
        'not an object',
        { path: 'src/c.ts', repository: 'not an object' },
      ],
    }
    expect(readCodeSearchHits(payload)).toEqual([{ repository: 'octo/repo', path: 'src/a.ts' }])
  })

  it('rejects a directory response that is not a list', () => {
    expect(() => readDirectoryEntries({})).toThrow('GitHub returned no directory listing')
  })

  it('keeps only the directory entries that name a file or a directory', () => {
    const payload = [
      { type: 'file', path: 'a.ts', name: 'a.ts', size: 12 },
      { type: 'dir', path: 'src', name: 'src' },
      { type: 'symlink', path: 'link', name: 'link' },
      { type: 'file', path: 'b.ts' },
      { type: 'file', name: 'c.ts' },
      'not an object',
    ]
    expect(readDirectoryEntries(payload)).toEqual([
      { path: 'a.ts', name: 'a.ts', kind: 'file', size: 12 },
      { path: 'src', name: 'src', kind: 'directory', size: 0 },
    ])
  })

  it('decodes a file and reports a listing or an unavailable entry', () => {
    expect(readContent(FILE_PAYLOAD)).toEqual({ kind: 'file', text: 'hello' })
    expect(readContent([FILE_PAYLOAD])).toEqual({
      kind: 'listing',
      entries: [{ path: 'README.md', name: 'README.md', kind: 'file', size: 5 }],
    })
    // Above GitHub's inline-content limit, and for a symlink or a submodule,
    // the response carries no content and no encoding.
    expect(readContent({ type: 'file', encoding: 'none', content: '' })).toEqual({ kind: 'unavailable' })
    expect(readContent({ type: 'symlink' })).toEqual({ kind: 'unavailable' })
    expect(readContent({ type: 'dir' })).toEqual({ kind: 'unavailable' })
    expect(readContent('not an object')).toEqual({ kind: 'unavailable' })
  })

  it('reads the authenticated login, or refuses a response without one', () => {
    expect(readAuthenticatedLogin({ login: 'octocat' })).toEqual({ login: 'octocat' })
    expect(() => readAuthenticatedLogin({})).toThrow('GitHub returned no account for the configured token')
  })
})

describe('OctokitGitHubApi', () => {
  it('qualifies a code search with one repo term per granted repository', async () => {
    const { client, calls } = makeOctokit(() => ({ items: [{ path: 'a.ts', repository: { full_name: 'octo/repo' } }] }))
    const api = new OctokitGitHubApi(client)
    await expect(api.searchCode('needle', ['octo/repo', 'octo/other'], 5)).resolves.toEqual([{ repository: 'octo/repo', path: 'a.ts' }])
    expect(calls[0]?.params).toMatchObject({ q: 'needle repo:octo/repo repo:octo/other', per_page: 5 })
  })

  it('sends the bare query when no repository is granted and forwards cancellation', async () => {
    const { client, calls } = makeOctokit(() => ({ items: [] }))
    const api = new OctokitGitHubApi(client)
    const controller = new AbortController()
    await api.searchCode('needle', [], 3, controller.signal)
    expect(calls[0]?.params).toMatchObject({ q: 'needle', per_page: 3, request: { signal: controller.signal } })
  })

  it('reads a path inside a repository, with and without cancellation', async () => {
    const { client, calls } = makeOctokit(() => FILE_PAYLOAD)
    const api = new OctokitGitHubApi(client)
    await expect(api.getContent('octo/repo', 'README.md')).resolves.toEqual({ kind: 'file', text: 'hello' })
    expect(calls[0]?.params).toMatchObject({ owner: 'octo', repo: 'repo', path: 'README.md' })
    expect(calls[0]?.params?.['request']).toBeUndefined()

    const controller = new AbortController()
    await api.getContent('octo/repo', '', controller.signal)
    expect(calls[1]?.params).toMatchObject({ owner: 'octo', repo: 'repo', path: '', request: { signal: controller.signal } })
  })

  it('refuses a repository that is not owner/name', async () => {
    const { client } = makeOctokit(() => FILE_PAYLOAD)
    const api = new OctokitGitHubApi(client)
    for (const repository of ['owner', 'owner/', '/name']) {
      await expect(api.getContent(repository, 'a.ts')).rejects.toThrow('is not an owner/name repository')
    }
  })

  it('identifies the token account, with and without cancellation', async () => {
    const { client, calls } = makeOctokit(() => ({ login: 'octocat' }))
    const api = new OctokitGitHubApi(client)
    await expect(api.getAuthenticated()).resolves.toEqual({ login: 'octocat' })
    expect(calls[0]?.params).toEqual({})
    const controller = new AbortController()
    await api.getAuthenticated(controller.signal)
    expect(calls[1]?.params).toEqual({ request: { signal: controller.signal } })
  })
})

describe('createGitHubApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reaches the configured API base with the token, refusing redirects', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({ login: 'octocat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    const api = createGitHubApi({ baseUrl: 'https://api.github.test', token: 'secret-token' })
    await expect(api.getAuthenticated()).resolves.toEqual({ login: 'octocat' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://api.github.test/user')
    // A redirect would forward the token to another origin, so the request must
    // fail before following one.
    expect(seen[0]?.init.redirect).toBe('error')
    expect(String((seen[0]?.init.headers as Record<string, string>)['authorization'])).toContain('secret-token')
  })
})

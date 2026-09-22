import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SourceItemRef } from '@deepseek-ai/dsh-resource'
import {
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_READ_BYTES,
  GITHUB_DEFAULT_BASE_URL,
  GitHubSourceProvider,
  parseGitHubHandle,
} from '@deepseek-ai/dsh-resource-github'
import type {
  GitHubApi,
  GitHubInstance,
  GitHubResolvedConfig,
  GitHubSourceConfig,
} from '@deepseek-ai/dsh-resource-github'

/** One recorded API call. */
interface RecordedCall {
  readonly operation: string
  readonly args: readonly unknown[]
}

/** A stub REST API that records its calls and answers from a handler. */
function makeApi(handler: (operation: string) => unknown): { api: GitHubApi; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const record = (operation: string, args: readonly unknown[]): Promise<never> => {
    calls.push({ operation, args })
    return Promise.resolve(handler(operation)) as Promise<never>
  }
  return {
    calls,
    api: {
      searchCode: (query, repositories, limit, signal) => record('searchCode', [query, repositories, limit, signal]),
      getContent: (repository, path, signal) => record('getContent', [repository, path, signal]),
      getAuthenticated: signal => record('getAuthenticated', [signal]),
    },
  }
}

/** A provider over fixed settings, a stub API, and fixed credential values. */
function makeProvider(options: {
  instances: Record<string, GitHubInstance>
  api: GitHubApi
  maxReadBytes?: number
  maxListItems?: number
  credentials?: Record<string, string>
}): GitHubSourceProvider {
  const config: GitHubResolvedConfig = {
    maxReadBytes: options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    maxListItems: options.maxListItems ?? DEFAULT_MAX_LIST_ITEMS,
    instances: options.instances,
  }
  return new GitHubSourceProvider({
    config: () => config,
    resolveCredential: (ref: CredentialRef) => Promise.resolve(options.credentials?.[ref]),
    createApi: () => options.api,
  })
}

const GRANTED = ['octo/repo', 'octo/other']
const SIGNAL = new AbortController().signal

/** One configured source as `instances()` reports it. */
async function configured(provider: GitHubSourceProvider, id = 'work'): Promise<GitHubSourceConfig> {
  const found = (await provider.instances()).find(instance => instance.ref.id === id)
  if (found === undefined) throw new Error(`no instance ${id}`)
  return found
}

describe('parseGitHubHandle', () => {
  it('splits a handle into its repository and path', () => {
    expect(parseGitHubHandle('octo/repo')).toEqual({ repository: 'octo/repo', path: '' })
    expect(parseGitHubHandle('octo/repo:src/a.ts')).toEqual({ repository: 'octo/repo', path: 'src/a.ts' })
    expect(parseGitHubHandle('octo/repo:')).toEqual({ repository: 'octo/repo', path: '' })
  })

  it('refuses a handle that names no repository', () => {
    for (const ref of ['octo', '/repo', 'octo/', '']) {
      expect(parseGitHubHandle(ref)).toBeUndefined()
    }
  })
})

describe('GitHubSourceProvider capabilities', () => {
  it('declares all three operations, the request quota, and the current limits', () => {
    const provider = makeProvider({ instances: {}, api: makeApi(() => undefined).api, maxReadBytes: 4321, maxListItems: 9 })
    expect(provider.kind).toBe('github')
    expect(provider.capabilities).toMatchObject({ search: true, browse: true, read: true, maxReadBytes: 4321, maxListItems: 9 })
    expect(provider.capabilities.description).toContain('10 requests per minute')
    expect(provider.capabilities.description).toContain('4321 bytes')
  })
})

describe('GitHubSourceProvider.instances', () => {
  it('reports a granted repository as configured while the token resolves', async () => {
    const instances = { work: { tokenRef: 'github_pat', repositories: GRANTED } }
    const resolved = makeProvider({ instances, api: makeApi(() => undefined).api, credentials: { github_pat: 'token' } })
    expect(await resolved.instances()).toEqual([{
      ref: { kind: 'github', id: 'work' },
      configured: true,
      tokenRef: 'github_pat',
      baseUrl: GITHUB_DEFAULT_BASE_URL,
      repositories: GRANTED,
    }])
  })

  it('reports an unusable source as unconfigured', async () => {
    const cases: Record<string, GitHubInstance>[] = [
      { work: { repositories: GRANTED } },
      { work: { tokenRef: 'not a name', repositories: GRANTED } },
      { work: { tokenRef: 'github_pat', repositories: [] } },
      { work: { tokenRef: 'github_pat', repositories: ['not-a-repository'] } },
      { work: { tokenRef: 'github_pat', repositories: GRANTED, baseUrl: 'not a url' } },
      { work: { tokenRef: 'github_pat', repositories: GRANTED, baseUrl: 'ftp://api.test' } },
    ]
    for (const instances of cases) {
      const provider = makeProvider({ instances, api: makeApi(() => undefined).api })
      expect((await provider.instances())[0]?.configured).toBe(false)
    }
    const blank = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => undefined).api,
      credentials: { github_pat: '' },
    })
    expect((await blank.instances())[0]?.configured).toBe(false)
  })

  it('reports a source that grants no repository list as unconfigured', async () => {
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat' } },
      api: makeApi(() => undefined).api,
      credentials: { github_pat: 'token' },
    })
    expect((await provider.instances())[0]).toMatchObject({ configured: false, repositories: [] })
  })

  it('keeps an enterprise API base and drops malformed grant entries', async () => {
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', baseUrl: 'https://github.test/api/v3', repositories: ['octo/repo', 'octo/repo:src'] } },
      api: makeApi(() => undefined).api,
      credentials: { github_pat: 'token' },
    })
    const config = await configured(provider)
    expect(config.baseUrl).toBe('https://github.test/api/v3')
    expect(config.repositories).toEqual(['octo/repo'])
  })
})

describe('GitHubSourceProvider operations', () => {
  it('probes the token and reports the account', async () => {
    const { api } = makeApi(() => ({ login: 'octocat' }))
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
    })
    await expect(provider.check(await configured(provider)))
      .resolves.toEqual({ label: 'octocat', detail: GITHUB_DEFAULT_BASE_URL })
  })

  it('searches inside the granted repositories and keeps only granted hits', async () => {
    const { api, calls } = makeApi(() => [
      { repository: 'octo/repo', path: 'src/a.ts' },
      { repository: 'someone/else', path: 'src/b.ts' },
    ])
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
    })
    await expect(provider.search(await configured(provider), 'needle', 10, SIGNAL)).resolves.toEqual([{
      ref: brandString<SourceItemRef>('octo/repo:src/a.ts'),
      title: 'src/a.ts',
      summary: 'octo/repo',
    }])
    expect(calls[0]?.args).toEqual(['needle', GRANTED, 10, SIGNAL])
  })

  it('returns nothing for a search limit below one, without calling GitHub', async () => {
    const { api, calls } = makeApi(() => [])
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
    })
    await expect(provider.search(await configured(provider), 'needle', 0, SIGNAL)).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('reads one file, cut at the declared cap', async () => {
    const text = 'x'.repeat(2_000)
    const { api, calls } = makeApi(() => ({ kind: 'file', text }))
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
      maxReadBytes: 300,
    })
    const document = await provider.read(await configured(provider), brandString<SourceItemRef>('octo/repo:src/a.ts'), SIGNAL)
    expect(document.title).toBe('src/a.ts')
    expect(document.truncated).toBe(true)
    expect(new TextEncoder().encode(document.content).length).toBeLessThanOrEqual(300)
    expect(calls[0]?.args).toEqual(['octo/repo', 'src/a.ts', SIGNAL])
  })

  it('reads a short file whole', async () => {
    const { api } = makeApi(() => ({ kind: 'file', text: 'hello' }))
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
    })
    await expect(provider.read(await configured(provider), brandString<SourceItemRef>('octo/repo:README.md'), SIGNAL))
      .resolves.toEqual({ ref: 'octo/repo:README.md', title: 'README.md', content: 'hello', truncated: false })
  })

  it('refuses a read of a directory, of an entry without content, and of an ungranted path', async () => {
    const directory = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'listing', entries: [] })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(directory.read(await configured(directory), brandString<SourceItemRef>('octo/repo:src'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))

    const unavailable = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'unavailable' })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(unavailable.read(await configured(unavailable), brandString<SourceItemRef>('octo/repo:big.bin'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_PROVIDER_ERROR' }))

    const ungranted = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'file', text: 'secret' })).api,
      credentials: { github_pat: 'token' },
    })
    const config = await configured(ungranted)
    for (const ref of ['someone/else:src/a.ts', 'not-a-handle', 'octo/other/../../etc/passwd']) {
      await expect(ungranted.read(config, brandString<SourceItemRef>(ref), SIGNAL))
        .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    }
  })

  it('lists the granted repositories without calling GitHub', async () => {
    const { api, calls } = makeApi(() => ({ kind: 'listing', entries: [] }))
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
      maxListItems: 1,
    })
    await expect(provider.list(await configured(provider), undefined, SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('octo/repo'), title: 'octo/repo' },
    ])
    expect(calls).toEqual([])
  })

  it('lists one directory\'s entries, cut at the kind\'s cap', async () => {
    const { api, calls } = makeApi(() => ({
      kind: 'listing',
      entries: [
        { path: 'src/a.ts', name: 'a.ts', kind: 'file', size: 12 },
        { path: 'src/nested', name: 'nested', kind: 'directory', size: 0 },
      ],
    }))
    const provider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
      maxListItems: 1,
    })
    await expect(provider.list(await configured(provider), brandString<SourceItemRef>('octo/repo:src'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('octo/repo:src/a.ts'), title: 'a.ts', summary: '12 bytes' },
    ])
    expect(calls[0]?.args).toEqual(['octo/repo', 'src', SIGNAL])

    const wider = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({
        kind: 'listing',
        entries: [{ path: 'src/nested', name: 'nested', kind: 'directory', size: 0 }],
      })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(wider.list(await configured(wider), brandString<SourceItemRef>('octo/repo:src'), SIGNAL)).resolves.toEqual([
      { ref: brandString<SourceItemRef>('octo/repo:src/nested'), title: 'nested', summary: 'directory' },
    ])
  })

  it('refuses a listing of a file, of an entry without a listing, and of an ungranted path', async () => {
    const file = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'file', text: 'hello' })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(file.list(await configured(file), brandString<SourceItemRef>('octo/repo:README.md'), SIGNAL))
      .rejects.toThrow('is a file, not a directory')

    const unavailable = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'unavailable' })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(unavailable.list(await configured(unavailable), brandString<SourceItemRef>('octo/repo:src'), SIGNAL))
      .rejects.toThrow('GitHub returned no listing for "octo/repo:src"')

    const ungranted = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api: makeApi(() => ({ kind: 'listing', entries: [] })).api,
      credentials: { github_pat: 'token' },
    })
    await expect(ungranted.list(await configured(ungranted), brandString<SourceItemRef>('someone/else'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
  })

  it('builds the octokit-backed API when no factory is injected', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen.push(init)
      return Promise.resolve(new Response(JSON.stringify({ login: 'octocat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    try {
      const provider = new GitHubSourceProvider({
        config: () => ({
          maxReadBytes: DEFAULT_MAX_READ_BYTES,
          maxListItems: DEFAULT_MAX_LIST_ITEMS,
          instances: { work: { tokenRef: 'github_pat', repositories: GRANTED, baseUrl: 'https://api.github.test' } },
        }),
        resolveCredential: () => Promise.resolve('token'),
      })
      await expect(provider.check(await configured(provider))).resolves.toEqual({ label: 'octocat', detail: 'https://api.github.test' })
      expect(seen[0]?.redirect).toBe('error')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses every operation on an unconfigured source, and one whose token disappeared', async () => {
    const { api, calls } = makeApi(() => undefined)
    const unconfigured = makeProvider({ instances: { work: { tokenRef: 'github_pat', repositories: [] } }, api })
    const config = (await unconfigured.instances())[0] as GitHubSourceConfig
    await expect(unconfigured.check(config)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.search(config, 'q', 5, SIGNAL)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.read(config, brandString<SourceItemRef>('octo/repo:a.ts'), SIGNAL))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    await expect(unconfigured.list(config, undefined, SIGNAL)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(calls).toEqual([])

    const gone = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
      credentials: { github_pat: 'token' },
    })
    const configuredConfig = await configured(gone)
    const withoutToken = makeProvider({
      instances: { work: { tokenRef: 'github_pat', repositories: GRANTED } },
      api,
    })
    await expect(withoutToken.check(configuredConfig)).rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    // A configuration that names no credential at all cannot open the API.
    const { tokenRef: _noCredential, ...withoutTokenRef } = configuredConfig
    await expect(withoutToken.check(withoutTokenRef))
      .rejects.toThrow(expect.objectContaining({ code: 'SOURCE_UNCONFIGURED' }))
    expect(calls).toEqual([])
  })
})

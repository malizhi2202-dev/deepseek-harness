/**
 * The GitHub REST surface this provider uses, the octokit-backed implementation,
 * and the guards that narrow octokit's untrusted JSON into the provider's own
 * values. The provider depends on {@link GitHubApi}, so a test substitutes the
 * exchange without touching the provider's decisions.
 *
 * @module @deepseek-ai/dsh-resource-github/api
 */

import { Octokit } from '@octokit/rest'
import { SOURCE_PROVIDER_ERROR, SourceError } from '@deepseek-ai/dsh-resource'

/** One code-search hit, after narrowing. */
export interface GitHubCodeHit {
  /** `owner/name` of the repository the hit lives in. */
  readonly repository: string
  /** The file's path inside that repository. */
  readonly path: string
}

/** One directory entry, after narrowing. */
export interface GitHubContentEntry {
  /** The entry's path inside the repository. */
  readonly path: string
  /** The entry's final path segment. */
  readonly name: string
  /** Whether the entry is a file or a directory. */
  readonly kind: 'file' | 'directory'
  /** The file's size in bytes; zero for a directory. */
  readonly size: number
}

/** What one content request answered. */
export type GitHubContent =
  | { readonly kind: 'file'; readonly text: string }
  | { readonly kind: 'listing'; readonly entries: readonly GitHubContentEntry[] }
  | { readonly kind: 'unavailable' }

/** The GitHub operations this provider performs. */
export interface GitHubApi {
  /**
   * Search code inside the given repositories.
   * @param query - the caller's query text.
   * @param repositories - repositories the search may return hits from.
   * @param limit - upper bound on returned hits.
   * @param signal - caller cancellation.
   * @returns the narrowed hits.
   */
  searchCode(
    query: string,
    repositories: readonly string[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<GitHubCodeHit[]>
  /**
   * Read one path's content.
   * @param repository - `owner/name` of the repository.
   * @param path - the path inside the repository; the empty string is the root.
   * @param signal - caller cancellation.
   * @returns the narrowed content.
   */
  getContent(repository: string, path: string, signal?: AbortSignal): Promise<GitHubContent>
  /**
   * Identify the token's account.
   * @param signal - caller cancellation.
   * @returns the authenticated login.
   */
  getAuthenticated(signal?: AbortSignal): Promise<{ login: string }>
}

/** Read one value as a plain record, or `undefined` for anything else. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read one field as a non-empty string, or `undefined` for anything else. */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Narrow a code-search response.
 * @param payload - octokit's `data` for `GET /search/code`.
 * @returns the usable hits, dropping entries that name no repository or path.
 */
export function readCodeSearchHits(payload: unknown): GitHubCodeHit[] {
  const items = asRecord(payload)?.['items']
  if (!Array.isArray(items)) {
    throw new SourceError('GitHub returned no code-search results list', SOURCE_PROVIDER_ERROR)
  }
  const hits: GitHubCodeHit[] = []
  for (const item of items) {
    const entry = asRecord(item)
    const path = asNonEmptyString(entry?.['path'])
    const repository = asNonEmptyString(asRecord(entry?.['repository'])?.['full_name'])
    if (path === undefined || repository === undefined) continue
    hits.push({ repository, path })
  }
  return hits
}

/** The content kind octokit reports for one entry. */
function contentKind(value: unknown): 'file' | 'directory' | undefined {
  if (value === 'file') return 'file'
  if (value === 'dir') return 'directory'
  return undefined
}

/**
 * Narrow a directory listing.
 * @param payload - octokit's `data` for a directory content request.
 * @returns the entries that name a file or a directory.
 */
export function readDirectoryEntries(payload: unknown): GitHubContentEntry[] {
  if (!Array.isArray(payload)) {
    throw new SourceError('GitHub returned no directory listing', SOURCE_PROVIDER_ERROR)
  }
  const entries: GitHubContentEntry[] = []
  for (const item of payload) {
    const entry = asRecord(item)
    const kind = contentKind(entry?.['type'])
    const path = asNonEmptyString(entry?.['path'])
    const name = asNonEmptyString(entry?.['name'])
    if (kind === undefined || path === undefined || name === undefined) continue
    const size = entry?.['size']
    entries.push({ path, name, kind, size: typeof size === 'number' ? size : 0 })
  }
  return entries
}

/**
 * Narrow a content response into a file's text or a directory listing.
 * @param payload - octokit's `data` for a content request.
 * @returns the file's decoded text, the directory's entries, or `unavailable` for
 *   an entry GitHub reports without inline content (a symlink, a submodule, or a
 *   file above the inline-content size limit).
 */
export function readContent(payload: unknown): GitHubContent {
  if (Array.isArray(payload)) return { kind: 'listing', entries: readDirectoryEntries(payload) }
  const entry = asRecord(payload)
  const kind = contentKind(entry?.['type'])
  const content = entry?.['content']
  if (kind !== 'file' || entry?.['encoding'] !== 'base64' || typeof content !== 'string') {
    return { kind: 'unavailable' }
  }
  return { kind: 'file', text: Buffer.from(content, 'base64').toString('utf8') }
}

/**
 * Narrow an authenticated-user response.
 * @param payload - octokit's `data` for `GET /user`.
 * @returns the login.
 */
export function readAuthenticatedLogin(payload: unknown): { login: string } {
  const login = asNonEmptyString(asRecord(payload)?.['login'])
  if (login === undefined) {
    throw new SourceError('GitHub returned no account for the configured token', SOURCE_PROVIDER_ERROR)
  }
  return { login }
}

/** Split `owner/name` into the two parameters the REST API takes. */
function splitRepository(repository: string): { owner: string; repo: string } {
  const separator = repository.indexOf('/')
  if (separator <= 0 || separator === repository.length - 1) {
    throw new SourceError(`"${repository}" is not an owner/name repository`, SOURCE_PROVIDER_ERROR)
  }
  return { owner: repository.slice(0, separator), repo: repository.slice(separator + 1) }
}

/** The octokit surface {@link OctokitGitHubApi} calls. */
export interface OctokitLike {
  /** The REST endpoint groups this provider uses. */
  readonly rest: {
    readonly search: {
      readonly code: (params: Record<string, unknown>) => Promise<{ data: unknown }>
    }
    readonly repos: {
      readonly getContent: (params: Record<string, unknown>) => Promise<{ data: unknown }>
    }
    readonly users: {
      readonly getAuthenticated: (params?: Record<string, unknown>) => Promise<{ data: unknown }>
    }
  }
}

/** Request options carrying caller cancellation through octokit. */
function requestOptions(signal: AbortSignal | undefined): Record<string, unknown> {
  return signal === undefined ? {} : { request: { signal } }
}

/** The octokit-backed implementation of {@link GitHubApi}. */
export class OctokitGitHubApi implements GitHubApi {
  /**
   * @param client - the octokit client to call; a test substitutes a stub.
   */
  constructor(private readonly client: OctokitLike) {}

  /**
   * Search code inside the granted repositories by qualifying the query with one
   * `repo:` term per repository.
   * @param query - the caller's query text.
   * @param repositories - repositories the search may return hits from.
   * @param limit - upper bound on returned hits.
   * @param signal - caller cancellation.
   * @returns the narrowed hits.
   */
  async searchCode(
    query: string,
    repositories: readonly string[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<GitHubCodeHit[]> {
    const qualifiers = repositories.map(repository => `repo:${repository}`).join(' ')
    const response = await this.client.rest.search.code({
      q: qualifiers.length === 0 ? query : `${query} ${qualifiers}`,
      per_page: limit,
      ...requestOptions(signal),
    })
    return readCodeSearchHits(response.data)
  }

  /**
   * Read one path's content.
   * @param repository - `owner/name` of the repository.
   * @param path - the path inside the repository; the empty string is the root.
   * @param signal - caller cancellation.
   * @returns the narrowed content.
   */
  async getContent(repository: string, path: string, signal?: AbortSignal): Promise<GitHubContent> {
    const response = await this.client.rest.repos.getContent({
      ...splitRepository(repository),
      path,
      ...requestOptions(signal),
    })
    return readContent(response.data)
  }

  /**
   * Identify the token's account.
   * @param signal - caller cancellation.
   * @returns the authenticated login.
   */
  async getAuthenticated(signal?: AbortSignal): Promise<{ login: string }> {
    const response = await this.client.rest.users.getAuthenticated(requestOptions(signal))
    return readAuthenticatedLogin(response.data)
  }
}

/**
 * Build the octokit client for one instance.
 *
 * The cast states the narrow structural view this module consumes: octokit's
 * endpoint methods are typed to their own per-route parameter objects, which no
 * single structural signature can express.
 */
function createOctokit(baseUrl: string, token: string): OctokitLike {
  const client = new Octokit({ auth: token, baseUrl, request: { redirect: 'error' } })
  return client as unknown as OctokitLike
}

/**
 * Build the octokit-backed API for one instance.
 * @param options - the API base and the personal access token.
 * @returns the API the provider calls.
 */
export function createGitHubApi(options: { baseUrl: string; token: string }): GitHubApi {
  return new OctokitGitHubApi(createOctokit(options.baseUrl, options.token))
}

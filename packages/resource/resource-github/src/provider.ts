/**
 * `GitHubSourceProvider`: the GitHub kind of `ctx.sources`, backed by the
 * official REST API through octokit. Search runs GitHub's code search inside the
 * repositories the source grants, read returns one file's text, and list returns
 * the granted repositories or a directory's entries.
 *
 * @module @deepseek-ai/dsh-resource-github/provider
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import {
  SOURCE_NOT_FOUND,
  SOURCE_PROVIDER_ERROR,
  SOURCE_UNCONFIGURED,
  SourceError,
  boundDocumentContent,
} from '@deepseek-ai/dsh-resource'
import type {
  SourceCapabilities,
  SourceDescription,
  SourceDocument,
  SourceHit,
  SourceItemRef,
  SourceProvider,
} from '@deepseek-ai/dsh-resource'
import { createGitHubApi } from './api.ts'
import type { GitHubApi } from './api.ts'
import type { GitHubInstance, GitHubSourceConfig } from './types.ts'

/** The kind this provider implements. */
export const GITHUB_KIND = 'github'

/** This kind's settings namespace. */
export const GITHUB_SETTINGS_NAMESPACE = 'resource-github'

/** Default cap on one read, in bytes. */
export const DEFAULT_MAX_READ_BYTES = 200_000

/** Default cap on one listing, in items. */
export const DEFAULT_MAX_LIST_ITEMS = 50

/** The public GitHub REST API base. */
export const GITHUB_DEFAULT_BASE_URL = 'https://api.github.com'

/** The GitHub values every operation reads, after the settings schema resolved them. */
export interface GitHubResolvedConfig {
  /** Cap on one read, in bytes. */
  readonly maxReadBytes: number
  /** Cap on one listing, in items. */
  readonly maxListItems: number
  /** Configured sources, keyed by instance id. */
  readonly instances: Readonly<Record<string, GitHubInstance>>
}

/** Collaborators the provider reads on every operation. */
export interface GitHubSourceProviderOptions {
  /** The kind's currently resolved settings. */
  readonly config: () => GitHubResolvedConfig
  /** Resolve one credential reference to its current value; `undefined` while unset. */
  readonly resolveCredential: (ref: CredentialRef) => Promise<string | undefined>
  /** Build the REST API for one instance; defaults to the octokit-backed one. */
  readonly createApi?: (options: { baseUrl: string; token: string }) => GitHubApi
}

/** One GitHub handle split into its parts. */
interface GitHubHandle {
  /** `owner/name` of the repository. */
  readonly repository: string
  /** The path inside the repository; the empty string is the repository root. */
  readonly path: string
}

/** A trimmed value, or `undefined` for a blank one. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}

/** Whether a configured endpoint is an absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'https:' || protocol === 'http:'
}

/**
 * Split one GitHub handle into its repository and path parts.
 * @param ref - a handle of the form `owner/name` or `owner/name:path`.
 * @returns the parts, or `undefined` when the handle names no repository.
 */
export function parseGitHubHandle(ref: string): GitHubHandle | undefined {
  const separator = ref.indexOf(':')
  const repository = separator === -1 ? ref : ref.slice(0, separator)
  const path = separator === -1 ? '' : ref.slice(separator + 1)
  if (!repository.includes('/') || repository.startsWith('/') || repository.endsWith('/')) return undefined
  return { repository, path }
}

/** One GitHub source's provider. */
export class GitHubSourceProvider implements SourceProvider<GitHubSourceConfig> {
  readonly kind = GITHUB_KIND

  /**
   * @param options - resolved settings, credential resolution, and the REST API factory.
   */
  constructor(private readonly options: GitHubSourceProviderOptions) {}

  /**
   * What this kind answers. The read cap comes from the current settings.
   * @returns the kind's capabilities and its model-facing limits statement.
   */
  get capabilities(): SourceCapabilities {
    const { maxReadBytes, maxListItems } = this.options.config()
    return {
      search: true,
      browse: true,
      read: true,
      maxReadBytes,
      maxListItems,
      description: `Search code and read files in the GitHub repositories this source grants, through the official REST API. search uses GitHub's code search, which GitHub limits to 10 requests per minute and which returns hits only inside the granted repositories; read returns one file's text, cut to ${String(maxReadBytes)} bytes with a truncation marker; list returns the granted repositories, or one directory's entries. A repository the source does not grant, and any path inside it, reads as not found.`,
    }
  }

  /**
   * Resolve every declared source, reporting whether it is usable. A source is
   * unconfigured when its endpoint is not an http(s) URL, it grants no
   * repository, its token reference is not a credential name, or that credential
   * currently resolves to nothing.
   * @returns the declared sources, configured or not.
   */
  async instances(): Promise<readonly GitHubSourceConfig[]> {
    const configs: GitHubSourceConfig[] = []
    for (const [id, instance] of Object.entries(this.options.config().instances)) {
      const tokenRefName = nonEmpty(instance.tokenRef)
      const tokenRef = tokenRefName !== undefined && isCredentialRefName(tokenRefName)
        ? (tokenRefName as CredentialRef)
        : undefined
      const token = tokenRef === undefined ? undefined : await this.options.resolveCredential(tokenRef)
      const repositories = (instance.repositories ?? []).filter(repository => parseGitHubHandle(repository)?.path === '')
      configs.push({
        ref: { kind: GITHUB_KIND, id },
        configured: isHttpUrl(instance.baseUrl ?? GITHUB_DEFAULT_BASE_URL)
          && tokenRef !== undefined
          && token !== undefined
          && token.length > 0
          && repositories.length > 0,
        ...tokenRef === undefined ? {} : { tokenRef },
        baseUrl: instance.baseUrl ?? GITHUB_DEFAULT_BASE_URL,
        repositories,
      })
    }
    return configs
  }

  /**
   * Probe the token and report the account it belongs to.
   * @param config - the source to probe.
   * @returns the authenticated login and the API base.
   */
  async check(config: GitHubSourceConfig): Promise<SourceDescription> {
    this.assertConfigured(config)
    const api = await this.openApi(config)
    const account = await api.getAuthenticated()
    return { label: account.login, detail: config.baseUrl }
  }

  /**
   * Search code inside the granted repositories.
   * @param config - the source to search.
   * @param query - the search text.
   * @param limit - upper bound on returned hits.
   * @param signal - caller cancellation.
   * @returns the hits, most relevant first.
   */
  async search(
    config: GitHubSourceConfig,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<SourceHit[]> {
    this.assertConfigured(config)
    if (limit < 1) return []
    const api = await this.openApi(config)
    const hits = await api.searchCode(query, config.repositories, limit, signal)
    return hits
      // GitHub's `repo:` qualifier already scopes the query; the grant list is
      // checked again here so no answer can name a repository the source does
      // not expose.
      .filter(hit => config.repositories.includes(hit.repository))
      .slice(0, limit)
      .map(hit => ({
        ref: brandString<SourceItemRef>(`${hit.repository}:${hit.path}`),
        title: hit.path,
        summary: hit.repository,
      }))
  }

  /**
   * Read one file's text, bounded by the declared read cap.
   * @param config - the source to read from.
   * @param ref - the file handle, as returned by `search` or `list`.
   * @param signal - caller cancellation.
   * @returns the bounded document.
   */
  async read(config: GitHubSourceConfig, ref: SourceItemRef, signal: AbortSignal): Promise<SourceDocument> {
    this.assertConfigured(config)
    const handle = this.grantedHandle(config, ref)
    const api = await this.openApi(config)
    const content = await api.getContent(handle.repository, handle.path, signal)
    if (content.kind === 'listing') {
      throw new SourceError(`GitHub path "${ref}" is a directory, not a file`, SOURCE_NOT_FOUND)
    }
    if (content.kind === 'unavailable') {
      throw new SourceError(`GitHub returned no inline content for "${ref}"`, SOURCE_PROVIDER_ERROR)
    }
    const bounded = boundDocumentContent(content.text, this.options.config().maxReadBytes)
    return { ref, title: handle.path, content: bounded.content, truncated: bounded.truncated }
  }

  /**
   * List the granted repositories, or one directory's entries.
   * @param config - the source to list.
   * @param ref - a repository or path handle, or `undefined` for the granted repositories.
   * @param signal - caller cancellation.
   * @returns the entries, bounded by the instance's listing cap.
   */
  async list(config: GitHubSourceConfig, ref: SourceItemRef | undefined, signal: AbortSignal): Promise<SourceHit[]> {
    this.assertConfigured(config)
    const limit = this.options.config().maxListItems
    if (ref === undefined) {
      return config.repositories.slice(0, limit).map(repository => ({
        ref: brandString<SourceItemRef>(repository),
        title: repository,
      }))
    }
    const handle = this.grantedHandle(config, ref)
    const api = await this.openApi(config)
    const content = await api.getContent(handle.repository, handle.path, signal)
    if (content.kind === 'file') {
      throw new SourceError(`GitHub path "${ref}" is a file, not a directory`, SOURCE_NOT_FOUND)
    }
    if (content.kind === 'unavailable') {
      throw new SourceError(`GitHub returned no listing for "${ref}"`, SOURCE_PROVIDER_ERROR)
    }
    return content.entries.slice(0, limit).map(entry => ({
      ref: brandString<SourceItemRef>(`${handle.repository}:${entry.path}`),
      title: entry.name,
      summary: entry.kind === 'directory' ? 'directory' : `${String(entry.size)} bytes`,
    }))
  }

  /** Refuse an instance whose settings are incomplete before any request opens. */
  private assertConfigured(config: GitHubSourceConfig): void {
    if (!config.configured) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" is not configured`, SOURCE_UNCONFIGURED)
    }
  }

  /**
   * Admit one handle only when it names a repository this source grants. An
   * unlisted repository and every path inside it answer as not found, so the
   * token's wider scope never becomes visible.
   */
  private grantedHandle(config: GitHubSourceConfig, ref: string): GitHubHandle {
    const handle = parseGitHubHandle(ref)
    if (handle === undefined || !config.repositories.includes(handle.repository)) {
      throw new SourceError(`GitHub has no granted repository or path "${ref}"`, SOURCE_NOT_FOUND)
    }
    return handle
  }

  /** Build one instance's REST API with the credential resolved for this operation. */
  private async openApi(config: GitHubSourceConfig): Promise<GitHubApi> {
    const token = config.tokenRef === undefined ? undefined : await this.options.resolveCredential(config.tokenRef)
    if (token === undefined || token.length === 0) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" has no token`, SOURCE_UNCONFIGURED)
    }
    return (this.options.createApi ?? createGitHubApi)({ baseUrl: config.baseUrl, token })
  }
}

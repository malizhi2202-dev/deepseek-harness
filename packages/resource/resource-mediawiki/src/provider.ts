/**
 * `MediaWikiSourceProvider`: the MediaWiki kind of `ctx.sources`, backed by the
 * Action API. Search runs the wiki's full-text search, read returns one page's
 * wikitext, and list returns a category's members or, with no container, the
 * wiki's categories.
 *
 * @module @deepseek-ai/dsh-resource-mediawiki/provider
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
import { MediaWikiClient, defaultMediaWikiFetch } from './client.ts'
import type { MediaWikiFetch } from './client.ts'
import type { MediaWikiInstance, MediaWikiSourceConfig } from './types.ts'
import { readPage, readSearchEntries, readSitename, readTitleList } from './wire.ts'

/** The kind this provider implements. */
export const MEDIAWIKI_KIND = 'mediawiki'

/** This kind's settings namespace. */
export const MEDIAWIKI_SETTINGS_NAMESPACE = 'resource-mediawiki'

/** Default cap on one read, in bytes. */
export const DEFAULT_MAX_READ_BYTES = 200_000

/** Default cap on one listing, in items. */
export const DEFAULT_MAX_LIST_ITEMS = 50

/** The wiki values every operation reads, after the settings schema resolved them. */
export interface MediaWikiResolvedConfig {
  /** Cap on one read, in bytes. */
  readonly maxReadBytes: number
  /** Cap on one listing, in items. */
  readonly maxListItems: number
  /** Configured instances, keyed by instance id. */
  readonly instances: Readonly<Record<string, MediaWikiInstance>>
}

/** Collaborators the provider reads on every operation. */
export interface MediaWikiSourceProviderOptions {
  /** The kind's currently resolved settings. */
  readonly config: () => MediaWikiResolvedConfig
  /** Resolve one credential reference to its current value; `undefined` while unset. */
  readonly resolveCredential: (ref: CredentialRef) => Promise<string | undefined>
  /** The HTTP exchange to use; defaults to the redirect-refusing fetch. */
  readonly fetch?: MediaWikiFetch
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

/** Strip the wiki markup MediaWiki's search snippets carry. */
function plainSnippet(snippet: string): string {
  return snippet.replaceAll(/<[^>]*>/gu, '').trim()
}

/** The MediaWiki kind's provider. */
export class MediaWikiSourceProvider implements SourceProvider<MediaWikiSourceConfig> {
  readonly kind = MEDIAWIKI_KIND

  /**
   * @param options - resolved settings, credential resolution, and the HTTP exchange.
   */
  constructor(private readonly options: MediaWikiSourceProviderOptions) {}

  /**
   * What this kind answers. The read cap comes from the current settings, so a
   * configuration change moves the limit the model is told about.
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
      description: `Search and read pages on configured MediaWiki wikis through the Action API. search runs the wiki's own full-text search and returns page titles; read returns one page's wikitext, cut to ${String(maxReadBytes)} bytes with a truncation marker; list returns a category's members, or every category of the wiki when no container is given. A page the wiki does not expose to the configured account reads as not found.`,
    }
  }

  /**
   * Resolve every declared instance, reporting whether it is usable. A missing
   * endpoint, a half-configured bot password, or a credential reference whose
   * value is not set leaves the instance unconfigured.
   * @returns the declared instances, configured or not.
   */
  async instances(): Promise<readonly MediaWikiSourceConfig[]> {
    const configs: MediaWikiSourceConfig[] = []
    for (const [id, instance] of Object.entries(this.options.config().instances)) {
      const username = nonEmpty(instance.username)
      const passwordRefName = nonEmpty(instance.passwordRef)
      const anonymous = username === undefined && passwordRefName === undefined
      const authenticated = username !== undefined
        && passwordRefName !== undefined
        && isCredentialRefName(passwordRefName)
      const passwordRef = authenticated ? (passwordRefName as CredentialRef) : undefined
      const password = passwordRef === undefined ? undefined : await this.options.resolveCredential(passwordRef)
      configs.push({
        ref: { kind: MEDIAWIKI_KIND, id },
        configured: isHttpUrl(instance.baseUrl)
          && (anonymous || authenticated)
          && (passwordRef === undefined || (password !== undefined && password.length > 0)),
        baseUrl: instance.baseUrl,
        ...username === undefined ? {} : { username },
        ...passwordRef === undefined ? {} : { passwordRef },
      })
    }
    return configs
  }

  /**
   * Probe the wiki and report its site name.
   * @param config - the instance to probe.
   * @returns the wiki's site name and endpoint.
   */
  async check(config: MediaWikiSourceConfig): Promise<SourceDescription> {
    this.assertConfigured(config)
    const client = await this.openSession(config)
    const sitename = readSitename(await client.call({ action: 'query', meta: 'siteinfo', siprop: 'general' }))
    if (sitename === undefined) {
      throw new SourceError('MediaWiki returned no site information', SOURCE_PROVIDER_ERROR)
    }
    return { label: sitename, detail: config.baseUrl }
  }

  /**
   * Run the wiki's full-text search.
   * @param config - the instance to search.
   * @param query - the search text.
   * @param limit - upper bound on returned hits.
   * @param signal - caller cancellation.
   * @returns the page titles the wiki ranked, most relevant first.
   */
  async search(
    config: MediaWikiSourceConfig,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<SourceHit[]> {
    this.assertConfigured(config)
    if (limit < 1) return []
    const client = await this.openSession(config, signal)
    const payload = await client.call({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit) }, signal)
    const entries = readSearchEntries(payload)
    if (entries === undefined) {
      throw new SourceError('MediaWiki returned no search results list', SOURCE_PROVIDER_ERROR)
    }
    return entries.slice(0, limit).map((entry) => {
      const snippet = entry.snippet === undefined ? undefined : plainSnippet(entry.snippet)
      return {
        ref: brandString<SourceItemRef>(entry.title),
        title: entry.title,
        ...snippet === undefined || snippet.length === 0 ? {} : { summary: snippet },
      }
    })
  }

  /**
   * Read one page's wikitext, bounded by the declared read cap.
   * @param config - the instance to read from.
   * @param ref - the page title, as returned by `search` or `list`.
   * @param signal - caller cancellation.
   * @returns the bounded document.
   */
  async read(config: MediaWikiSourceConfig, ref: SourceItemRef, signal: AbortSignal): Promise<SourceDocument> {
    this.assertConfigured(config)
    const client = await this.openSession(config, signal)
    const page = readPage(await client.call({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: ref,
    }, signal))
    if (page === undefined || page.missing || page.content === undefined) {
      throw new SourceError(`MediaWiki has no page titled "${ref}"`, SOURCE_NOT_FOUND)
    }
    const bounded = boundDocumentContent(page.content, this.options.config().maxReadBytes)
    return { ref, title: page.title, content: bounded.content, truncated: bounded.truncated }
  }

  /**
   * List a category's members, or the wiki's categories when no container is given.
   * @param config - the instance to list.
   * @param ref - the category title, or `undefined` for the wiki's categories.
   * @param signal - caller cancellation.
   * @returns the member titles, bounded by the instance's listing cap.
   */
  async list(config: MediaWikiSourceConfig, ref: SourceItemRef | undefined, signal: AbortSignal): Promise<SourceHit[]> {
    this.assertConfigured(config)
    const limit = this.options.config().maxListItems
    const client = await this.openSession(config, signal)
    const categories = ref === undefined
    const payload = categories
      ? await client.call({ action: 'query', list: 'allcategories', aclimit: String(limit) }, signal)
      : await client.call({ action: 'query', list: 'categorymembers', cmtitle: ref, cmlimit: String(limit) }, signal)
    const titles = categories
      ? readTitleList(payload, 'allcategories', 'category')
      : readTitleList(payload, 'categorymembers', 'title')
    if (titles === undefined) {
      throw new SourceError('MediaWiki returned no listing', SOURCE_PROVIDER_ERROR)
    }
    // `allcategories` reports names without the namespace prefix; every handle
    // this provider returns must be usable as a later `titles` or `cmtitle`.
    return titles.slice(0, limit).map(title => categories ? `Category:${title}` : title).map(title => ({
      ref: brandString<SourceItemRef>(title),
      title,
    }))
  }

  /** Refuse an instance whose settings are incomplete before any connection opens. */
  private assertConfigured(config: MediaWikiSourceConfig): void {
    if (!config.configured) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" is not configured`, SOURCE_UNCONFIGURED)
    }
  }

  /**
   * Open one client for a single operation, signing in when the instance uses a
   * bot password. The credential is resolved here, per operation, so a changed
   * value reaches the next call without a restart.
   */
  private async openSession(config: MediaWikiSourceConfig, signal?: AbortSignal): Promise<MediaWikiClient> {
    const password = config.passwordRef === undefined ? undefined : await this.options.resolveCredential(config.passwordRef)
    // An instance that declared a bot password must not silently fall back to
    // anonymous access when the credential stops resolving.
    if (config.passwordRef !== undefined && (password === undefined || password.length === 0)) {
      throw new SourceError(`source "${config.ref.kind}:${config.ref.id}" has no password`, SOURCE_UNCONFIGURED)
    }
    const client = new MediaWikiClient({
      baseUrl: config.baseUrl,
      ...config.username === undefined ? {} : { username: config.username },
      ...password === undefined ? {} : { password },
      fetch: this.options.fetch ?? defaultMediaWikiFetch,
    })
    if (password !== undefined) await client.login(signal)
    return client
  }
}

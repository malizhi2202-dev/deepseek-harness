/**
 * Narrowing guards for the MediaWiki Action API's JSON. Every value here arrives
 * from a remote wiki, so each field the provider consumes is checked before use;
 * a response the guards cannot vouch for is rejected rather than guessed at.
 *
 * @module @deepseek-ai/dsh-resource-mediawiki/wire
 */

/** One MediaWiki API error object. */
export interface MediaWikiApiError {
  /** Stable MediaWiki error code. */
  readonly code: string
  /** Human-readable error text from the wiki. */
  readonly info: string
}

/** One login attempt's outcome. */
export interface MediaWikiLoginResult {
  /** `Success`, `WrongPass`, `NeedToken`, or another wiki-supplied result code. */
  readonly result: string
  /** The wiki's explanation, when it supplied one. */
  readonly reason?: string
}

/** One page as a `prop=revisions` query reports it. */
export interface MediaWikiPage {
  /** The page title as the wiki resolved it. */
  readonly title: string
  /** True when the wiki has no such page; `content` is then absent. */
  readonly missing: boolean
  /** The page's wikitext, present for a page that exists and carries content. */
  readonly content?: string
}

/** One search result before normalization. */
export interface MediaWikiSearchEntry {
  /** The page title, which is also the item handle. */
  readonly title: string
  /** Highlighted snippet, still carrying wiki markup. */
  readonly snippet?: string
}

/** Read one object as a plain record, or `undefined` for anything else. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read one field as a non-empty string, or `undefined` for anything else. */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read the envelope's error object.
 * @param payload - the decoded response body.
 * @returns the error, or `undefined` when the response carries none or malformed fields.
 */
export function readApiError(payload: unknown): MediaWikiApiError | undefined {
  const error = asRecord(asRecord(payload)?.['error'])
  if (error === undefined) return undefined
  const code = asNonEmptyString(error['code'])
  const info = typeof error['info'] === 'string' ? error['info'] : undefined
  if (code === undefined || info === undefined) return undefined
  return { code, info }
}

/**
 * Read a login attempt's outcome.
 * @param payload - the decoded response body.
 * @returns the outcome, or `undefined` when the response carries none.
 */
export function readLoginResult(payload: unknown): MediaWikiLoginResult | undefined {
  const login = asRecord(asRecord(payload)?.['login'])
  if (login === undefined) return undefined
  const result = asNonEmptyString(login['result'])
  if (result === undefined) return undefined
  const reason = typeof login['reason'] === 'string' ? login['reason'] : undefined
  return { result, ...reason === undefined ? {} : { reason } }
}

/**
 * Read one token from a `meta=tokens` response.
 * @param payload - the decoded response body.
 * @param name - the token field to read, such as `logintoken`.
 * @returns the token, or `undefined` when the response does not carry it.
 */
export function readToken(payload: unknown, name: string): string | undefined {
  const query = asRecord(asRecord(payload)?.['query'])
  return asNonEmptyString(asRecord(query?.['tokens'])?.[name])
}

/**
 * Read the wiki's site name from a `meta=siteinfo` response.
 * @param payload - the decoded response body.
 * @returns the site name, or `undefined` when the response does not carry it.
 */
export function readSitename(payload: unknown): string | undefined {
  const query = asRecord(asRecord(payload)?.['query'])
  return asNonEmptyString(asRecord(query?.['general'])?.['sitename'])
}

/**
 * Read search results, dropping entries that carry no usable title.
 * @param payload - the decoded response body.
 * @returns the entries in the wiki's relevance order, or `undefined` when the list itself is malformed.
 */
export function readSearchEntries(payload: unknown): MediaWikiSearchEntry[] | undefined {
  const query = asRecord(asRecord(payload)?.['query'])
  const list = query?.['search']
  if (!Array.isArray(list)) return undefined
  const entries: MediaWikiSearchEntry[] = []
  for (const item of list) {
    const title = asNonEmptyString(asRecord(item)?.['title'])
    if (title === undefined) continue
    const snippet = asNonEmptyString(asRecord(item)?.['snippet'])
    entries.push({ title, ...snippet === undefined ? {} : { snippet } })
  }
  return entries
}

/**
 * Read the single page a `prop=revisions&rvslots=main` query answered for.
 * @param payload - the decoded response body.
 * @returns the page, or `undefined` when the response carries no usable page entry.
 */
export function readPage(payload: unknown): MediaWikiPage | undefined {
  const query = asRecord(asRecord(payload)?.['query'])
  const pages = query?.['pages']
  if (!Array.isArray(pages) || pages.length === 0) return undefined
  const page = asRecord(pages[0])
  const title = asNonEmptyString(page?.['title'])
  if (title === undefined) return undefined
  if (page?.['missing'] === true) return { title, missing: true }
  const revisions = page?.['revisions']
  const revision = Array.isArray(revisions) ? asRecord(revisions[0]) : undefined
  const slots = asRecord(revision?.['slots'])
  const content = asRecord(slots?.['main'])?.['content']
  if (typeof content !== 'string') return undefined
  return { title, missing: false, content }
}

/**
 * Read one title list, such as `allcategories` or `categorymembers`.
 * @param payload - the decoded response body.
 * @param listName - the `query` field holding the list.
 * @param titleField - the field inside each entry holding the title.
 * @returns the titles in wiki order, or `undefined` when the list itself is malformed.
 */
export function readTitleList(payload: unknown, listName: string, titleField: string): string[] | undefined {
  const query = asRecord(asRecord(payload)?.['query'])
  const list = query?.[listName]
  if (!Array.isArray(list)) return undefined
  const titles: string[] = []
  for (const item of list) {
    const title = asNonEmptyString(asRecord(item)?.[titleField])
    if (title !== undefined) titles.push(title)
  }
  return titles
}

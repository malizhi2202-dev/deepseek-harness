/**
 * Minimal MediaWiki Action API client: one wiki endpoint, a cookie jar, and the
 * two calls a bot password needs. Every operation builds its own client, so a
 * changed credential reaches the next operation and no session outlives a call.
 *
 * The client refuses redirects. A wiki endpoint that answers with a redirect
 * would otherwise be free to carry the bot password's session cookies to another
 * origin, and the configured endpoint is the only origin this provider trusts.
 *
 * @module @deepseek-ai/dsh-resource-mediawiki/client
 */

import { SOURCE_PROVIDER_ERROR, SourceError } from '@deepseek-ai/dsh-resource'
import { readApiError, readLoginResult, readToken } from './wire.ts'

/** One HTTP response the client consumes. */
export interface MediaWikiResponse {
  /** HTTP status code. */
  readonly status: number
  /** Decoded response body. */
  readonly body: string
  /** `Set-Cookie` header values, in response order. */
  readonly setCookie: readonly string[]
}

/** One form-encoded request the client issues. */
export interface MediaWikiRequest {
  /** Form-encoded body; the Action API accepts every read as a POST. */
  readonly body: string
  /** Request headers, including the current cookie header when the jar holds one. */
  readonly headers: Readonly<Record<string, string>>
  /** Caller cancellation, when the operation carries one. */
  readonly signal?: AbortSignal
}

/** The HTTP exchange the client performs; tests substitute a stub. */
export type MediaWikiFetch = (url: string, request: MediaWikiRequest) => Promise<MediaWikiResponse>

/** Resolved options for one wiki. */
export interface MediaWikiClientOptions {
  /** Action API endpoint. */
  readonly baseUrl: string
  /** Bot-password user name; absent for anonymous access. */
  readonly username?: string
  /** Bot password; absent for anonymous access. */
  readonly password?: string
  /** The HTTP exchange to use. */
  readonly fetch: MediaWikiFetch
}

/**
 * The default exchange: one `fetch` call with redirects refused.
 * @param url - the Action API endpoint.
 * @param request - the form body, headers, and optional cancellation.
 * @returns the status, the response text, and every `Set-Cookie` value.
 */
export const defaultMediaWikiFetch: MediaWikiFetch = async (url, request) => {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: request.headers,
    body: request.body,
    ...request.signal === undefined ? {} : { signal: request.signal },
  })
  return { status: response.status, body: await response.text(), setCookie: response.headers.getSetCookie() }
}

/** One wiki endpoint's client. */
export class MediaWikiClient {
  private readonly cookies = new Map<string, string>()

  /**
   * @param options - endpoint, optional bot password, and the HTTP exchange.
   */
  constructor(private readonly options: MediaWikiClientOptions) {}

  /**
   * Sign in with the configured bot password. A wiki that rejects the password
   * or omits the login token is reported as a provider failure, never retried.
   * @param signal - caller cancellation, when the operation carries one.
   */
  async login(signal?: AbortSignal): Promise<void> {
    const token = readToken(await this.call({ action: 'query', meta: 'tokens', type: 'login' }, signal), 'logintoken')
    if (token === undefined) {
      throw new SourceError('MediaWiki returned no login token', SOURCE_PROVIDER_ERROR)
    }
    const login = readLoginResult(await this.call({
      action: 'login',
      lgname: this.options.username ?? '',
      lgpassword: this.options.password ?? '',
      lgtoken: token,
    }, signal))
    if (login === undefined || login.result !== 'Success') {
      const detail = login === undefined ? 'no result' : `${login.result}${login.reason === undefined ? '' : `: ${login.reason}`}`
      throw new SourceError(`MediaWiki login failed (${detail})`, SOURCE_PROVIDER_ERROR)
    }
  }

  /**
   * Issue one Action API call and return its decoded body.
   * @param params - Action API parameters; `format` and `formatversion` are added.
   * @param signal - caller cancellation, when the operation carries one.
   * @returns the decoded JSON body.
   */
  async call(params: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<unknown> {
    const body = new URLSearchParams({ ...params, format: 'json', formatversion: '2' })
    const cookie = this.cookieHeader()
    const response = await this.options.fetch(this.options.baseUrl, {
      body: body.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'application/json',
        ...cookie.length === 0 ? {} : { 'cookie': cookie },
      },
      ...signal === undefined ? {} : { signal },
    })
    for (const value of response.setCookie) this.storeCookie(value)
    if (response.status < 200 || response.status >= 300) {
      throw new SourceError(`MediaWiki returned HTTP ${response.status}`, SOURCE_PROVIDER_ERROR)
    }
    let payload: unknown
    try {
      payload = JSON.parse(response.body)
    } catch (error) {
      throw new SourceError('MediaWiki returned a body that is not JSON', SOURCE_PROVIDER_ERROR, { cause: error })
    }
    const apiError = readApiError(payload)
    if (apiError !== undefined) {
      throw new SourceError(`MediaWiki error ${apiError.code}: ${apiError.info}`, SOURCE_PROVIDER_ERROR)
    }
    return payload
  }

  /** The current `Cookie` header value, or the empty string when the jar is empty. */
  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  /** Store one `Set-Cookie` value's name and value. */
  private storeCookie(value: string): void {
    const pair = value.split(';')[0] as string
    const separator = pair.indexOf('=')
    if (separator <= 0) return
    this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

/**
 * The QQ access-token cache.
 *
 * The application credential pair is not what an OpenAPI call carries: it
 * exchanges for an access token, the token lives at most 7200 seconds, and
 * every call carries it in an `Authorization: QQBot <access_token>` header. The
 * platform rotates the token for a request that arrives inside the last 60
 * seconds of its life, during which the previous token stays valid, so a cache
 * that replaces the token at that boundary never makes a caller see the change.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

/** The application credential pair one bot exchanges for access tokens. */
export interface QqApplication {
  /** The application id from the QQ bot developer console. */
  readonly appId: string
  /** The application secret; a credential, never logged. */
  readonly clientSecret: string
}

/** One access token and the lifetime the platform gave it. */
export interface QqAccessToken {
  /** The token an OpenAPI call carries. */
  readonly token: string
  /** The lifetime the platform stated, in seconds. */
  readonly expiresInSeconds: number
}

/**
 * Exchange an application credential pair for a fresh access token.
 * @param application - the credential pair to exchange.
 * @returns the token and its stated lifetime.
 */
export type QqTokenExchange = (application: QqApplication) => Promise<QqAccessToken>

/** How far before its stated expiry a token is replaced, which is the platform's own rotation window. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000

/** The access token one application's calls carry, refreshed before it expires. */
export class AccessTokenCache {
  private token: string | undefined
  private expiresAt = 0
  private pending: Promise<string> | undefined

  /**
   * @param application - the credential pair exchanged for tokens.
   * @param exchange - how a fresh token is obtained.
   */
  constructor(
    private readonly application: QqApplication,
    private readonly exchange: QqTokenExchange,
  ) {}

  /**
   * The token to carry now.
   *
   * Concurrent callers share one exchange, so a burst of calls at the rotation
   * boundary makes one request rather than one per caller.
   * @returns the access token.
   * @throws when the exchange failed; the failure is not cached.
   */
  get(): Promise<string> {
    if (this.token !== undefined && Date.now() < this.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return Promise.resolve(this.token)
    }
    this.pending ??= this.exchange(this.application)
      .then((issued) => {
        this.token = issued.token
        this.expiresAt = Date.now() + issued.expiresInSeconds * 1000
        return issued.token
      })
      .finally(() => { this.pending = undefined })
    return this.pending
  }

  /**
   * Drop the cached token, so the next call exchanges for a new one.
   *
   * A call that reports the token expired is the one case the refresh margin
   * cannot cover: the platform invalidated the token before its stated expiry.
   */
  invalidate(): void {
    this.token = undefined
    this.expiresAt = 0
  }
}

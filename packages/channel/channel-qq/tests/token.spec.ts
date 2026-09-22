/**
 * Pins the QQ access-token cache: one exchange covers a burst of callers, the
 * token is replaced at the platform's own 60-second rotation boundary and not
 * before it, a failed exchange is not cached, and an invalidated token is
 * exchanged again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessTokenCache, TOKEN_REFRESH_MARGIN_MS } from '../src/token.ts'
import type { QqAccessToken, QqTokenExchange } from '../src/token.ts'

/** The application every case exchanges. */
const APPLICATION = { appId: 'app-test', clientSecret: 'secret-test' }

/** One exchange whose answers the test controls. */
function exchangeOf(answers: Array<QqAccessToken | Error>): QqTokenExchange {
  let index = 0
  return vi.fn(() => {
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as QqAccessToken)
  })
}

describe('AccessTokenCache', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('exchanges once and reuses the token inside its life', async () => {
    const exchange = exchangeOf([{ token: 'first', expiresInSeconds: 7200 }])
    const cache = new AccessTokenCache(APPLICATION, exchange)

    await expect(cache.get()).resolves.toBe('first')
    vi.advanceTimersByTime(TOKEN_REFRESH_MARGIN_MS + 1)
    await expect(cache.get()).resolves.toBe('first')
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('replaces the token one millisecond inside the rotation margin', async () => {
    const exchange = exchangeOf([
      { token: 'first', expiresInSeconds: 7200 },
      { token: 'second', expiresInSeconds: 7200 },
    ])
    const cache = new AccessTokenCache(APPLICATION, exchange)

    await cache.get()
    vi.advanceTimersByTime(7200_000 - TOKEN_REFRESH_MARGIN_MS - 1)
    await expect(cache.get()).resolves.toBe('first')

    vi.advanceTimersByTime(1)
    await expect(cache.get()).resolves.toBe('second')
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('shares one exchange between concurrent callers', async () => {
    const exchange = exchangeOf([{ token: 'shared', expiresInSeconds: 7200 }])
    const cache = new AccessTokenCache(APPLICATION, exchange)

    await expect(Promise.all([cache.get(), cache.get()])).resolves.toEqual(['shared', 'shared'])
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed exchange', async () => {
    const exchange = exchangeOf([
      new Error('the exchange failed'),
      { token: 'recovered', expiresInSeconds: 7200 },
    ])
    const cache = new AccessTokenCache(APPLICATION, exchange)

    await expect(cache.get()).rejects.toThrow('the exchange failed')
    await expect(cache.get()).resolves.toBe('recovered')
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('exchanges again after the token is invalidated', async () => {
    const exchange = exchangeOf([
      { token: 'first', expiresInSeconds: 7200 },
      { token: 'second', expiresInSeconds: 7200 },
    ])
    const cache = new AccessTokenCache(APPLICATION, exchange)

    await cache.get()
    cache.invalidate()
    await expect(cache.get()).resolves.toBe('second')
    expect(exchange).toHaveBeenCalledTimes(2)
  })
})

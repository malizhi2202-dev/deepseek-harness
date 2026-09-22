/**
 * Pins the WeChat QR sign-in flow: the challenge carries the payload the caller
 * must render and the deadline this build stops accepting it at, every status
 * the platform documents maps onto one outcome, a challenge the platform expires
 * or blocks is replaced up to the flow's own limit, a redirect moves the polls to
 * the host the platform named, the flow stops at its deadline rather than polling
 * forever, and a cancellation is reported as such while any other failure is
 * rethrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WechatSignIn } from '../src/signin.ts'
import type { WechatQrChallenge, WechatSignInControls, WechatSignInOptions } from '../src/signin.ts'
import type { WechatQrResponse, WechatQrStatus, WechatWire } from '../src/wire.ts'

/** One scripted status answer, or the failure the poll rejects with. */
type Answer = WechatQrStatus | Error

/** The script one sign-in case runs against, shared across redirects. */
interface Script {
  /** The challenges `createQrChallenge` hands out, in order. */
  readonly challenges: WechatQrResponse[]
  /** The answers `getQrStatus` hands out, in order; the last repeats once the script is spent. */
  readonly answers: Answer[]
  /** Every challenge handle the flow polled, in order. */
  readonly asked: string[]
  /** Every host the flow redirected to, in order. */
  readonly hosts: string[]
}

/** A wire stub the sign-in flow drives. */
class StubWire {
  constructor(private readonly script: Script, readonly baseUrl = 'https://ilinkai.weixin.qq.com') {}

  withBaseUrl(baseUrl: string): StubWire {
    this.script.hosts.push(baseUrl)
    return new StubWire(this.script, baseUrl)
  }

  createQrChallenge(): Promise<WechatQrResponse> {
    const next = this.script.challenges.shift()
    if (next === undefined) throw new Error('the test scripted no challenge')
    return Promise.resolve(next)
  }

  getQrStatus(qrcode: string): Promise<WechatQrStatus> {
    this.script.asked.push(qrcode)
    const answer = this.script.answers.shift() ?? waiting()
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve(answer)
  }
}

/** One status answer carrying nothing but its own state. */
function status(overrides: Partial<WechatQrStatus> = {}): WechatQrStatus {
  return {
    status: 'wait',
    botToken: undefined,
    accountId: undefined,
    baseUrl: undefined,
    userId: undefined,
    redirectHost: undefined,
    ...overrides,
  }
}

/** The answer the platform gives while it waits for a scan. */
function waiting(): WechatQrStatus {
  return status()
}

/** One script holding the given answers. */
function script(...answers: Answer[]): Script {
  return {
    challenges: [1, 2, 3, 4].map(n => ({ qrcode: `qr-${n}`, payload: `https://login.invalid/qr-${n}` })),
    answers,
    asked: [],
    hosts: [],
  }
}

/** One flow over a scripted wire, with an interactive caller's own timings. */
function flow(scripted: Script, options: WechatSignInOptions = {}): WechatSignIn {
  const wire = new StubWire(scripted) as unknown as WechatWire
  return new WechatSignIn(wire, { pollGapMs: 10, timeoutMs: 100, maxRefreshes: 2, ...options })
}

/** One challenge to hand to `wait`. */
function challenge(overrides: Partial<WechatQrChallenge> = {}): WechatQrChallenge {
  return { qrcode: 'qr-0', payload: 'https://login.invalid/qr-0', expiresAt: Date.now() + 300_000, ...overrides }
}

/**
 * Drive one flow to its outcome, letting each poll gap elapse.
 *
 * The rejection is claimed before the timers run, because a flow that fails on
 * its first poll would otherwise report an unhandled rejection while the ticks
 * are being advanced.
 * @param pending - the flow's own promise.
 * @returns the outcome.
 */
async function settle<T>(pending: Promise<T>): Promise<T> {
  pending.catch(() => {})
  for (let tick = 0; tick < 12; tick += 1) await vi.advanceTimersByTimeAsync(10)
  return pending
}

describe('WechatSignIn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => { vi.useRealTimers() })

  it('hands back the payload to render and this build\'s own deadline', async () => {
    const scripted = script()
    scripted.challenges[0] = { qrcode: 'qr-1', payload: 'https://login.invalid/qr-1' }

    await expect(flow(scripted).start()).resolves.toEqual({
      qrcode: 'qr-1',
      payload: 'https://login.invalid/qr-1',
      expiresAt: 1_000_000 + 300_000,
    })
  })

  it('reports a challenge this build already stopped accepting', async () => {
    const scripted = script()
    await expect(flow(scripted).wait(challenge({ expiresAt: 1_000_000 }))).resolves.toEqual({ kind: 'expired' })
    expect(scripted.asked).toEqual([])
  })

  it('returns the credential the platform issued on confirmation', async () => {
    const scripted = script(status({
      status: 'confirmed',
      botToken: 'bot-token-1',
      accountId: 'bot-1',
      baseUrl: 'https://ilinkai.invalid',
      userId: 'user-1',
    }))

    await expect(settle(flow(scripted).wait(challenge()))).resolves.toEqual({
      kind: 'confirmed',
      accountId: 'bot-1',
      token: 'bot-token-1',
      baseUrl: 'https://ilinkai.invalid',
      userId: 'user-1',
    })
  })

  it('keeps the host it started on when the confirmation named none', async () => {
    const scripted = script(status({ status: 'confirmed', botToken: 'bot-token-1', accountId: 'bot-1' }))

    await expect(settle(flow(scripted).wait(challenge()))).resolves.toMatchObject({
      kind: 'confirmed',
      baseUrl: 'https://ilinkai.weixin.qq.com',
    })
  })

  it('refuses a confirmation that carried no account', async () => {
    const scripted = script(status({ status: 'confirmed', botToken: 'bot-token-1' }))

    await expect(settle(flow(scripted).wait(challenge()))).rejects.toThrow('confirmed the sign-in without returning a bot account')
  })

  it('replaces a challenge the platform expired and reports each replacement', async () => {
    const scripted = script(status({ status: 'expired' }), status({ status: 'confirmed', botToken: 't', accountId: 'bot-1' }))
    const seen: WechatQrChallenge[] = []

    await expect(settle(flow(scripted).wait(challenge(), { onChallenge: (next) => { seen.push(next) } })))
      .resolves.toMatchObject({ kind: 'confirmed' })
    expect(scripted.asked).toEqual(['qr-0', 'qr-1'])
    expect(seen).toEqual([{ qrcode: 'qr-1', payload: 'https://login.invalid/qr-1', expiresAt: 1_000_000 + 300_000 }])
  })

  it('gives up once it has replaced as many challenges as it may', async () => {
    const expired = status({ status: 'expired' })
    await expect(settle(flow(script(expired, expired, expired)).wait(challenge()))).resolves.toEqual({ kind: 'expired' })
  })

  it('reports a blocked challenge as blocked once replacements run out', async () => {
    const blocked = status({ status: 'verify_code_blocked' })
    await expect(settle(flow(script(blocked, blocked, blocked)).wait(challenge()))).resolves.toEqual({ kind: 'blocked' })
  })

  it('reports a bound account, a required code, and a completed sign-in', async () => {
    await expect(settle(flow(script(status({ status: 'binded_redirect' }))).wait(challenge())))
      .resolves.toEqual({ kind: 'already-bound' })
    await expect(settle(flow(script(status({ status: 'need_verifycode' }))).wait(challenge())))
      .resolves.toEqual({ kind: 'verification-required' })
  })

  it('collects the code the platform asked for and polls on with it', async () => {
    const scripted = script(status({ status: 'need_verifycode' }), status({ status: 'confirmed', botToken: 't', accountId: 'bot-1' }))
    const attempts: number[] = []

    await expect(settle(flow(scripted).wait(challenge(), {
      onVerifyCode: (attempt) => {
        attempts.push(attempt)
        return Promise.resolve('1234')
      },
    }))).resolves.toMatchObject({ kind: 'confirmed' })
    expect(attempts).toEqual([1])
  })

  it('moves its polls to the host a scan redirect named', async () => {
    const scripted = script(status({ status: 'scaned_but_redirect', redirectHost: 'redirect.invalid' }), status({ status: 'confirmed', botToken: 't', accountId: 'bot-1' }))

    await expect(settle(flow(scripted).wait(challenge()))).resolves.toMatchObject({ kind: 'confirmed' })
    expect(scripted.hosts).toEqual(['https://redirect.invalid'])
  })

  it('keeps polling through a redirect the platform named no host for', async () => {
    const scripted = script(status({ status: 'scaned_but_redirect' }), status({ status: 'confirmed', botToken: 't', accountId: 'bot-1' }))

    await expect(settle(flow(scripted).wait(challenge()))).resolves.toMatchObject({ kind: 'confirmed' })
    expect(scripted.hosts).toEqual([])
  })

  it('stops at its own deadline rather than polling forever', async () => {
    const scripted = script()

    await expect(settle(flow(scripted, { timeoutMs: 35 }).wait(challenge()))).resolves.toEqual({ kind: 'timeout' })
    expect(scripted.asked).toEqual(['qr-0', 'qr-0', 'qr-0', 'qr-0'])
  })

  it('reports a cancelled flow as cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const controls: WechatSignInControls = { signal: controller.signal }

    await expect(settle(flow(script(new Error('the transfer failed'))).wait(challenge(), controls)))
      .resolves.toEqual({ kind: 'cancelled' })
  })

  it('rethrows a failure the caller did not cancel', async () => {
    await expect(settle(flow(script(new Error('the transfer failed'))).wait(challenge())))
      .rejects.toThrow('the transfer failed')

    const controller = new AbortController()
    await expect(settle(flow(script(new Error('the transfer failed'))).wait(challenge(), { signal: controller.signal })))
      .rejects.toThrow('the transfer failed')
  })
})

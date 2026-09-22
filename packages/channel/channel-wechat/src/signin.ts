/**
 * The WeChat QR sign-in flow: request a challenge, poll it, and hand back the
 * credential the platform issues on confirmation.
 *
 * The QR payload is secret-equivalent. It embeds the login token, so it reaches
 * a display without passing through a log, a session log, or an error message;
 * this module obtains it and polls, and presenting it belongs to the caller.
 *
 * The platform's own timings are what the flow implements: the status poll is
 * itself a long poll, a challenge is replaced when the platform expires it, and
 * the whole flow stops at a deadline rather than polling forever.
 *
 * @module @deepseek-ai/dsh-channel-wechat
 */

import type { WechatQrResponse, WechatWire } from './wire.ts'

/** How long one challenge stays usable before a caller must request a new one. */
const CHALLENGE_TTL_MS = 5 * 60_000

/** How long one sign-in may run before the flow reports a timeout. */
const DEFAULT_TIMEOUT_MS = 480_000

/** How long the flow waits between two status polls. */
const DEFAULT_POLL_GAP_MS = 1_000

/** How many times an expired or blocked challenge is replaced before giving up. */
const DEFAULT_MAX_REFRESHES = 3

/** One QR challenge a caller must display and then poll. */
export interface WechatQrChallenge {
  /** The opaque login-session handle the status poll echoes back. */
  readonly qrcode: string
  /** The payload to render as a QR image; it embeds the login token. */
  readonly payload: string
  /** When this build stops accepting the challenge, in epoch milliseconds. */
  readonly expiresAt: number
}

/** How one sign-in attempt ended. */
export type WechatSignInOutcome =
  | {
    /** The platform confirmed the scan and issued the account's credential. */
    readonly kind: 'confirmed'
    /** The bot account id the credential belongs to. */
    readonly accountId: string
    /** The bot token; a credential, never logged. */
    readonly token: string
    /** The API host the account must use afterwards. */
    readonly baseUrl: string
    /** The scanning user's id, when the platform named one. */
    readonly userId: string | undefined
  }
  | { readonly kind: 'expired' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'already-bound' }
  | { readonly kind: 'verification-required' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }

/** What the caller supplies while a sign-in is running. */
export interface WechatSignInControls {
  /**
   * Collect the numeric code the phone displays. Absent means the flow reports
   * {@link WechatSignInOutcome} `verification-required` instead of waiting.
   * @param attempt - which code the platform is asking for, counting from one.
   * @returns the code the user entered.
   */
  readonly onVerifyCode?: (attempt: number) => Promise<string>
  /**
   * Receive a replacement challenge, which the caller must display in place of
   * the expired one.
   * @param challenge - the new challenge.
   */
  readonly onChallenge?: (challenge: WechatQrChallenge) => void
  /** Cancels the flow; the result is then `cancelled`. */
  readonly signal?: AbortSignal
}

/** The timings one sign-in flow runs on. */
export interface WechatSignInOptions {
  /** The `bot_type` the QR endpoint takes. */
  readonly botType?: string
  /** The most milliseconds one sign-in may take. */
  readonly timeoutMs?: number
  /** The pause between two status polls. */
  readonly pollGapMs?: number
  /** How many times an expired or blocked challenge is replaced. */
  readonly maxRefreshes?: number
}

/**
 * Wait one poll gap.
 * @param ms - the pause in milliseconds.
 * @returns a promise that settles after the pause.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Build the challenge a caller displays from one platform response.
 * @param response - the platform's response.
 * @param startedAt - when the challenge was requested, in epoch milliseconds.
 * @returns the challenge.
 */
function challengeOf(response: WechatQrResponse, startedAt: number): WechatQrChallenge {
  return { qrcode: response.qrcode, payload: response.payload, expiresAt: startedAt + CHALLENGE_TTL_MS }
}

/**
 * The QR sign-in flow for one WeChat bot account.
 *
 * A caller that is driving an interactive flow may shorten the timings; the
 * defaults are the platform's own.
 */
export class WechatSignIn {
  private readonly botType: string
  private readonly timeoutMs: number
  private readonly pollGapMs: number
  private readonly maxRefreshes: number

  /**
   * @param wire - the client the QR endpoints are reached through.
   * @param options - the platform's timings, overridable by an interactive caller.
   */
  constructor(private readonly wire: WechatWire, options: WechatSignInOptions = {}) {
    this.botType = options.botType ?? '3'
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pollGapMs = options.pollGapMs ?? DEFAULT_POLL_GAP_MS
    this.maxRefreshes = options.maxRefreshes ?? DEFAULT_MAX_REFRESHES
  }

  /**
   * Request one challenge to display.
   * @returns the challenge, whose `payload` is what the caller renders and whose `qrcode` it polls with.
   * @throws {Error} when the platform refused the request or named no payload.
   */
  async start(): Promise<WechatQrChallenge> {
    return challengeOf(await this.wire.createQrChallenge(this.botType), Date.now())
  }

  /**
   * Poll one challenge until the platform confirms it or the flow ends.
   * @param challenge - the challenge the caller displayed.
   * @param controls - how to collect a verification code, receive a replacement challenge, and cancel.
   * @returns how the attempt ended; a `confirmed` result carries the credential.
   * @throws {Error} when the platform answered a confirmation without an account, or the transfer failed.
   */
  async wait(challenge: WechatQrChallenge, controls: WechatSignInControls = {}): Promise<WechatSignInOutcome> {
    if (Date.now() >= challenge.expiresAt) return { kind: 'expired' }
    let wire = this.wire
    let current = challenge
    let verifyCode: string | undefined
    let attempt = 0
    let refreshes = 0
    const deadline = Date.now() + this.timeoutMs
    try {
      while (Date.now() < deadline) {
        const status = await wire.getQrStatus(current.qrcode, verifyCode, controls.signal)
        switch (status.status) {
          case 'confirmed': {
            if (status.accountId === undefined || status.botToken === undefined) {
              throw new Error('the platform confirmed the sign-in without returning a bot account')
            }
            return {
              kind: 'confirmed',
              accountId: status.accountId,
              token: status.botToken,
              baseUrl: status.baseUrl ?? wire.baseUrl,
              userId: status.userId,
            }
          }
          case 'expired':
          case 'verify_code_blocked': {
            refreshes += 1
            if (refreshes > this.maxRefreshes) {
              return { kind: status.status === 'expired' ? 'expired' : 'blocked' }
            }
            current = await this.replaceChallenge(wire, controls)
            verifyCode = undefined
            break
          }
          case 'binded_redirect':
            return { kind: 'already-bound' }
          case 'need_verifycode': {
            if (controls.onVerifyCode === undefined) return { kind: 'verification-required' }
            attempt += 1
            verifyCode = await controls.onVerifyCode(attempt)
            // The platform is waiting on the code, so the next poll follows at once.
            continue
          }
          case 'scaned_but_redirect': {
            if (status.redirectHost !== undefined) wire = wire.withBaseUrl(`https://${status.redirectHost}`)
            break
          }
          default:
            // `wait`, `scaned`, and any status a later platform revision adds all
            // mean the same thing here: keep polling.
            break
        }
        await sleep(this.pollGapMs)
      }
    } catch (error: unknown) {
      if (controls.signal?.aborted === true) return { kind: 'cancelled' }
      throw error
    }
    return { kind: 'timeout' }
  }

  /**
   * Replace one challenge the platform expired or blocked.
   * @param wire - the client the QR endpoints are reached through.
   * @param controls - the caller's replacement-challenge handler.
   * @returns the replacement challenge.
   */
  private async replaceChallenge(wire: WechatWire, controls: WechatSignInControls): Promise<WechatQrChallenge> {
    const next = challengeOf(await wire.createQrChallenge(this.botType), Date.now())
    controls.onChallenge?.(next)
    return next
  }
}

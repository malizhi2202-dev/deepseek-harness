/**
 * The QQ bot open platform's wire: the OpenAPI calls over HTTPS and the
 * WebSocket gateway that carries inbound events.
 *
 * Authentication is a short-lived token rather than the credential itself, so
 * this module owns the token cache and refreshes before expiry; a call that
 * still meets an expired token invalidates it and repeats once, which is what
 * keeps that fact out of every caller. The gateway is the same shape as every
 * other socket-based platform here: identify once, heartbeat on the interval the
 * platform states, resume the session after a drop, and re-identify when the
 * session is gone.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'
import { readExpiresIn, readFailureCode, readJsonObject, readObject, readPositive, readText } from './json.ts'
import { AccessTokenCache } from './token.ts'
import type { QqAccessToken, QqApplication } from './token.ts'

/** The API host the current platform documentation names. */
export const QQ_DEFAULT_API_BASE = 'https://api.bot.qq.com'

/** Where the application credential pair is exchanged; the platform states it is the same for production and sandbox. */
export const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

/** The one event class this connector subscribes to: single-chat and group messages. */
export const QQ_INTENTS = 1 << 25

/** The gateway's own opcodes. */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
} as const

/** The failure code a call carries when the access token is expired or unknown. */
const TOKEN_EXPIRED_CODE = 11244

/** The heartbeat interval used when the platform's hello frame names none. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000

/** The pause before the first reconnection attempt. */
const RECONNECT_BASE_MS = 2_000

/** The ceiling the pause between reconnection attempts grows to. */
const MAX_BACKOFF_MS = 60_000

/**
 * Exchange an application credential pair for a fresh access token.
 * @param application - the credential pair to exchange.
 * @returns the token and the lifetime the platform stated.
 * @throws {Error} when the transfer failed or the platform refused the pair.
 */
export async function exchangeAccessToken(application: QqApplication): Promise<QqAccessToken> {
  const response = await fetch(QQ_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: application.appId, clientSecret: application.clientSecret }),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`the access-token exchange answered HTTP ${String(response.status)}`)
  const record = readJsonObject(raw, 'getAppAccessToken')
  const code = readFailureCode(record)
  if (code !== 0) {
    throw new Error(`the access-token exchange was refused with code=${String(code)}: ${readText(record, 'message')}`)
  }
  const token = readText(record, 'access_token')
  const expiresInSeconds = readExpiresIn(record)
  if (token === '' || expiresInSeconds <= 0) throw new Error('the access-token exchange returned no usable token')
  return { token, expiresInSeconds }
}

/** The OpenAPI client for one QQ bot application. */
export class QqApi {
  private readonly tokens: AccessTokenCache

  /**
   * @param application - the credential pair the token cache exchanges.
   * @param baseUrl - the API host, which a sandbox deployment points elsewhere.
   */
  constructor(application: QqApplication, private readonly baseUrl: string) {
    this.tokens = new AccessTokenCache(application, exchangeAccessToken)
  }

  /**
   * The access token to carry now, refreshed before it expires.
   * @returns the access token.
   */
  accessToken(): Promise<string> {
    return this.tokens.get()
  }

  /**
   * Look up the gateway a session is opened against.
   * @returns the gateway URL.
   * @throws {Error} when the platform refused the lookup or named no URL.
   */
  async gatewayUrl(): Promise<string> {
    const url = readText(await this.request('GET', '/gateway'), 'url')
    if (url === '') throw new Error('the gateway lookup returned no url')
    return url
  }

  /**
   * Send one message into a group.
   * @param groupOpenid - the group's open id.
   * @param body - the message body, already carrying its passive-reply fields.
   * @throws {Error} when the platform refused the send.
   */
  async sendGroupMessage(groupOpenid: string, body: unknown): Promise<void> {
    await this.request('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, body)
  }

  /**
   * Send one message to a single chat.
   * @param userOpenid - the peer's open id.
   * @param body - the message body, already carrying its passive-reply fields.
   * @throws {Error} when the platform refused the send.
   */
  async sendC2cMessage(userOpenid: string, body: unknown): Promise<void> {
    await this.request('POST', `/v2/users/${encodeURIComponent(userOpenid)}/messages`, body)
  }

  /**
   * Download one attachment, refusing a transfer past `maxBytes` at the byte
   * that crosses it rather than after buffering the whole body.
   *
   * No credential is attached: the URL belongs to the platform's CDN rather than
   * to the API host this client authenticates against.
   * @param url - the attachment URL the event stated.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the attachment bytes.
   * @throws {ChatMediaTooLargeError} when the transfer would exceed `maxBytes`.
   * @throws {Error} when the transfer failed.
   */
  async download(url: string, maxBytes: number): Promise<Uint8Array> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`the attachment download answered HTTP ${String(response.status)}`)
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) throw new ChatMediaTooLargeError(maxBytes)
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of response.body ?? []) {
      total += chunk.byteLength
      if (total > maxBytes) throw new ChatMediaTooLargeError(maxBytes)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  /**
   * Perform one OpenAPI call and return its body.
   * @param method - the HTTP method.
   * @param path - the path, without the API host.
   * @param body - the JSON body, when the call carries one.
   * @returns the parsed response body.
   * @throws {Error} when the transfer failed or the platform refused the call.
   */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    let refreshed = false
    for (;;) {
      const token = await this.tokens.get()
      const response = await fetch(new URL(path, `${this.baseUrl}/`), {
        method,
        headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
      })
      const raw = await response.text()
      if (!response.ok) throw new Error(`${method} ${path} answered HTTP ${String(response.status)}: ${raw}`)
      const record = readJsonObject(raw, `${method} ${path}`)
      const code = readFailureCode(record)
      if (code === 0) return record
      if (code === TOKEN_EXPIRED_CODE && !refreshed) {
        refreshed = true
        this.tokens.invalidate()
        continue
      }
      throw new Error(`QQ refused ${method} ${path} with err_code=${String(code)}: ${readText(record, 'message')}`)
    }
  }
}

/** What the gateway reports to the connector that opened it. */
export interface QqGatewayHandlers {
  /**
   * One dispatch event arrived.
   * @param event - the platform's event name.
   * @param data - the event body.
   */
  readonly onDispatch: (event: string, data: unknown) => void
  /** The platform established the session, which it does again after a resume. */
  readonly onReady: () => void
  /**
   * The connection failed.
   * @param error - what failed.
   */
  readonly onError: (error: unknown) => void
}

/** The WebSocket session inbound events arrive on. */
export class QqGateway {
  private socket: WebSocket | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private sessionId: string | undefined
  private seq: number | undefined
  private attempts = 0
  private closed = false

  /**
   * @param api - the client the gateway URL and access token come from.
   * @param handlers - what the session reports.
   */
  constructor(
    private readonly api: QqApi,
    private readonly handlers: QqGatewayHandlers,
  ) {}

  /**
   * Open the gateway and start the session.
   *
   * Resolves once the socket is constructed rather than once the platform
   * establishes the session: the session is reported through
   * {@link QqGatewayHandlers.onReady}, and waiting for it here would leave a
   * caller blocked on a platform that reconnects on its own.
   * @throws {Error} when the gateway URL could not be looked up or the socket could not be constructed.
   */
  async open(): Promise<void> {
    const url = await this.api.gatewayUrl()
    if (this.closed) return
    const socket = new WebSocket(url)
    this.socket = socket
    socket.addEventListener('message', (event: { data: unknown }) => { this.receive(String(event.data)) })
    socket.addEventListener('close', () => { this.lost() })
    socket.addEventListener('error', () => { this.handlers.onError(new Error('the QQ gateway socket failed')) })
  }

  /** Close the session and stop reconnecting. */
  close(): void {
    this.closed = true
    this.stopHeartbeat()
    if (this.retry !== undefined) {
      clearTimeout(this.retry)
      this.retry = undefined
    }
    this.socket?.close()
  }

  /**
   * Handle one gateway frame.
   * @param raw - the frame's text.
   */
  private receive(raw: string): void {
    let frame: Record<string, unknown>
    try {
      frame = readJsonObject(raw, 'the gateway')
    } catch (error: unknown) {
      this.handlers.onError(error)
      return
    }
    switch (frame['op']) {
      case OP.HELLO:
        this.handshake(readObject(frame, 'd'))
        return
      case OP.DISPATCH: {
        const seq = frame['s']
        if (typeof seq === 'number') this.seq = seq
        const event = readText(frame, 't')
        if (event === 'READY') {
          this.sessionId = readText(readObject(frame, 'd'), 'session_id')
          this.attempts = 0
          this.handlers.onReady()
        } else if (event === 'RESUMED') {
          this.attempts = 0
          this.handlers.onReady()
        }
        this.handlers.onDispatch(event, frame['d'])
        return
      }
      case OP.RECONNECT:
        this.socket?.close()
        return
      case OP.INVALID_SESSION:
        this.sessionId = undefined
        this.seq = undefined
        this.socket?.close()
        return
      default:
        // A heartbeat acknowledgement needs no action, and an opcode a later
        // platform revision adds is ignored rather than treated as a failure.
        return
    }
  }

  /**
   * Start the heartbeat and identify or resume the session.
   * @param body - the hello frame's body.
   */
  private handshake(body: Record<string, unknown>): void {
    const interval = readPositive(body, 'heartbeat_interval') ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      this.send({ op: OP.HEARTBEAT, d: this.seq ?? null })
    }, interval)
    void this.identify().catch((error: unknown) => {
      this.handlers.onError(error)
      this.socket?.close()
    })
  }

  /** Identify a new session, or resume the one the socket dropped. */
  private async identify(): Promise<void> {
    const token = `QQBot ${await this.api.accessToken()}`
    if (this.sessionId !== undefined && this.seq !== undefined) {
      this.send({ op: OP.RESUME, d: { token, session_id: this.sessionId, seq: this.seq } })
      return
    }
    this.send({ op: OP.IDENTIFY, d: { token, intents: QQ_INTENTS, shard: [0, 1], properties: {} } })
  }

  /**
   * Send one frame.
   * @param frame - the frame to serialize.
   */
  private send(frame: unknown): void {
    this.socket?.send(JSON.stringify(frame))
  }

  /** Handle a socket that closed, by reconnecting unless this client closed it. */
  private lost(): void {
    this.stopHeartbeat()
    this.socket = undefined
    if (this.closed) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, MAX_BACKOFF_MS)
    this.attempts += 1
    this.retry = setTimeout(() => {
      this.retry = undefined
      void this.open().catch((error: unknown) => {
        this.handlers.onError(error)
        this.lost()
      })
    }, delay)
  }

  /** Stop the heartbeat, when one is running. */
  private stopHeartbeat(): void {
    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
  }
}

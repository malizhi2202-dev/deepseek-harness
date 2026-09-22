/**
 * The WeChat (微信) bot channel's HTTP wire: plain JSON over HTTPS, with no
 * binary framing and no obfuscated artifact.
 *
 * The endpoints are the ones Tencent publishes with the official bot channel.
 * `POST ilink/bot/getupdates` holds the connection open until a message arrives
 * or the server's window closes, which is what makes this channel work without
 * a public address; `POST ilink/bot/sendmessage` sends one message; the two QR
 * endpoints sign an account in. Every call carries `iLink-App-Id`, and an
 * authenticated call adds `AuthorizationType: ilink_bot_token`,
 * `Authorization: Bearer <token>`, and a per-request `X-WECHAT-UIN`.
 *
 * Message identifiers are uint64 on the wire and are read losslessly: the seam
 * treats them as opaque keys, and a rounded number would merge two distinct
 * messages into one deduplication entry.
 *
 * @module @deepseek-ai/dsh-channel-wechat
 */

import { createDecipheriv, randomBytes } from 'node:crypto'
import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'

/** The bot API host the official channel uses when a deployment records none. */
export const WECHAT_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** The CDN host inbound media bytes are downloaded from. */
export const WECHAT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

/** The application id the official bot channel sends. */
const ILINK_APP_ID = 'bot'

/** The channel protocol revision this build announces, as `0x00MMNNPP`. */
const ILINK_APP_CLIENT_VERSION = '65792'

/** The client-side window one long poll is held open for, in milliseconds. */
const LONG_POLL_TIMEOUT_MS = 35_000

/** The client-side window an ordinary API call is given, in milliseconds. */
const API_TIMEOUT_MS = 15_000

/** The client-side window a lightweight API call is given, in milliseconds. */
const CONFIG_TIMEOUT_MS = 10_000

/** The `bot_type` the QR endpoints take for this channel build. */
export const WECHAT_QR_BOT_TYPE = '3'

/**
 * Wire keys whose value is a uint64 identifier. A JSON string escapes every
 * quote inside it, so a quoted key followed by a colon can only be a property
 * name; the lookahead keeps an integer prefix of a float from matching.
 */
const ID_NUMBER = /"(message_id|msg_id|svr_id)"(\s*:\s*)(\d+)(?![\d.])/g

/**
 * Parse one response body, keeping uint64 identifiers as the strings the seam
 * treats them as.
 * @param raw - the response body text.
 * @returns the parsed JSON value.
 * @throws {SyntaxError} when the body is not JSON.
 */
export function parseWechatJson(raw: string): unknown {
  return JSON.parse(raw.replace(ID_NUMBER, '"$1"$2"$3"'))
}

/** The account one wire client talks as. */
export interface WechatAccount {
  /** The bot API host, without a trailing slash. */
  readonly baseUrl: string
  /** The bot token the QR sign-in issued. */
  readonly token: string
  /** The value sent as `bot_agent`, which the platform logs and never authenticates on. */
  readonly botAgent: string
}

/** One long-poll result: the cursor to send next, and whatever arrived with it. */
export interface WechatUpdates {
  /** The cursor to send on the next poll; the cursor that was sent when the window closed empty. */
  readonly cursor: string
  /** The raw message objects the platform delivered, unvalidated. */
  readonly messages: readonly unknown[]
  /** The window the server asked this client to use next, when it named one. */
  readonly longPollMs: number | undefined
}

/** One inbound media reference, as the platform states it. */
export interface WechatMediaRef {
  /** The absolute URL the bytes are fetched from. */
  readonly url: string
  /** The AES-128 key the bytes are encrypted with, or undefined when they are plaintext. */
  readonly key: Uint8Array | undefined
}

/** The QR challenge the platform created for one sign-in attempt. */
export interface WechatQrResponse {
  /** The opaque login-session handle the status poll echoes back. */
  readonly qrcode: string
  /** The payload to render as a QR image; it embeds the login token. */
  readonly payload: string
}

/** One state of the platform's QR sign-in, as the status poll reported it. */
export interface WechatQrStatus {
  /** The platform's own status word. */
  readonly status: string
  /** The bot token, delivered only with `confirmed`. */
  readonly botToken: string | undefined
  /** The bot account id, delivered only with `confirmed`. */
  readonly accountId: string | undefined
  /** The API host the account must use afterwards, when the platform named one. */
  readonly baseUrl: string | undefined
  /** The scanning user's id, when the platform named one. */
  readonly userId: string | undefined
  /** The host later polls must use, sent with `scaned_but_redirect`. */
  readonly redirectHost: string | undefined
}

/** The JSON body every authenticated bot request carries alongside its own fields. */
interface BaseInfo {
  readonly channel_version: string
  readonly bot_agent: string
}

/**
 * Whether a caught value is the abort a closed long-poll window reports.
 * @param error - what the fetch rejected with.
 * @returns true when the request was aborted rather than refused.
 */
function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/**
 * Read one response body as a JSON object.
 * @param raw - the response body text.
 * @param call - the call name the failure names.
 * @returns the parsed object.
 * @throws {Error} when the body is not a JSON object.
 */
function readObject(raw: string, call: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = parseWechatJson(raw)
  } catch {
    // The only throw here is JSON.parse refusing the body, and the call name is
    // what a reader needs to find the endpoint that returned it.
    throw new Error(`${call} returned a body that is not JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${call} returned a JSON value that is not an object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Read one field the platform states as a string.
 * @param value - the field's value.
 * @returns the string, or the empty string when the field is absent or another type.
 */
function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Read one field the platform states as a positive number.
 * @param value - the field's value.
 * @returns the number, or undefined when the field is absent, not a number, or not positive.
 */
function readPositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Read the `base_info` object every authenticated request carries.
 * @param account - the account the request talks as.
 * @returns the wire object.
 */
function baseInfo(account: WechatAccount): BaseInfo {
  return { channel_version: ILINK_APP_CLIENT_VERSION, bot_agent: account.botAgent }
}

/**
 * Read one AES-128 key the platform states, accepting either encoding it uses.
 * @param value - the key as base64 of 16 bytes, or as 32 hexadecimal characters.
 * @returns the key bytes, or undefined when the value is neither encoding.
 */
function readAesKey(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const bytes = /^[0-9a-fA-F]{32}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64')
  return bytes.byteLength === 16 ? bytes : undefined
}

/**
 * Read one media reference out of a message item's `media` object.
 * @param media - the item's `media` value.
 * @param itemKey - the item's own `aeskey` value, which the platform prefers for images.
 * @returns the reference, or undefined when the item names no URL to fetch.
 */
export function readMediaRef(media: unknown, itemKey: unknown): WechatMediaRef | undefined {
  if (media === null || typeof media !== 'object' || Array.isArray(media)) return undefined
  const record = media as Record<string, unknown>
  const full = readText(record['full_url'])
  const param = readText(record['encrypt_query_param'])
  const url = full !== ''
    ? full
    : param === ''
      ? ''
      : `${WECHAT_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(param)}`
  if (url === '') return undefined
  return { url, key: readAesKey(itemKey) ?? readAesKey(record['aes_key']) }
}

/** The JSON-over-HTTPS client for one WeChat bot account. */
export class WechatWire {
  /**
   * @param account - the account every call talks as.
   */
  constructor(private readonly account: WechatAccount) {}

  /** The host this client talks to. */
  get baseUrl(): string {
    return this.account.baseUrl
  }

  /**
   * The same account talking to another host, for the redirect the platform
   * sends while a QR sign-in is being scanned.
   * @param baseUrl - the host the platform named.
   * @returns a client for that host, sharing this account's token.
   */
  withBaseUrl(baseUrl: string): WechatWire {
    return new WechatWire({ ...this.account, baseUrl })
  }

  /**
   * Poll for inbound messages, holding the connection open until one arrives or
   * the window closes.
   *
   * A window that closes with nothing is a normal result rather than a failure,
   * so the cursor comes back unchanged and the caller polls again.
   * @param cursor - the cursor the previous poll returned, or the empty string on the first poll.
   * @param options - cancels the poll, and the window to hold this one open for.
   * @returns the messages that arrived, and the cursor to send next.
   * @throws {Error} when the platform refused the call or the transfer failed.
   */
  async getUpdates(
    cursor: string,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<WechatUpdates> {
    const signal = options.signal
    let raw: string
    try {
      raw = await this.send('POST', 'ilink/bot/getupdates', {
        body: { get_updates_buf: cursor, base_info: baseInfo(this.account) },
        authenticated: true,
        timeoutMs: options.timeoutMs ?? LONG_POLL_TIMEOUT_MS,
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || !isAbort(error)) throw error
      return { cursor, messages: [], longPollMs: undefined }
    }
    const record = readObject(raw, 'getUpdates')
    const messages = record['msgs']
    return {
      cursor: readText(record['get_updates_buf']) || cursor,
      messages: Array.isArray(messages) ? messages : [],
      longPollMs: readPositive(record['longpolling_timeout_ms']),
    }
  }

  /**
   * Send one text message into one conversation.
   * @param toUserId - the conversation's peer id.
   * @param text - the message body, already rendered for this platform.
   * @param contextToken - the token the platform issued with the conversation's last inbound message.
   * @throws {Error} when the platform refused the send.
   */
  async sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    const raw = await this.send('POST', 'ilink/bot/sendmessage', {
      body: {
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `dsh-${randomBytes(8).toString('hex')}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text } }],
          context_token: contextToken,
        },
        base_info: baseInfo(this.account),
      },
      authenticated: true,
      timeoutMs: API_TIMEOUT_MS,
    })
    const record = readObject(raw, 'sendMessage')
    const ret = record['ret']
    if (typeof ret === 'number' && ret !== 0) {
      throw new Error(`sendMessage was refused with ret=${String(ret)}: ${readText(record['errmsg'])}`)
    }
  }

  /**
   * Create one QR sign-in challenge.
   * @param botType - the `bot_type` the endpoint takes.
   * @returns the challenge's session handle and the payload to render.
   * @throws {Error} when the platform refused the call or named no payload.
   */
  async createQrChallenge(botType: string): Promise<WechatQrResponse> {
    const raw = await this.send('POST', `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, {
      body: { local_token_list: [] },
      authenticated: false,
      timeoutMs: CONFIG_TIMEOUT_MS,
    })
    const record = readObject(raw, 'getBotQrcode')
    const qrcode = readText(record['qrcode'])
    const payload = readText(record['qrcode_img_content'])
    if (qrcode === '' || payload === '') throw new Error('getBotQrcode returned no QR code')
    return { qrcode, payload }
  }

  /**
   * Poll one QR sign-in challenge, holding the connection open as the message
   * poll does.
   *
   * A window that closes with nothing, or a transfer that fails, reports
   * `wait`: the flow's own deadline decides when to stop.
   * @param qrcode - the challenge's session handle.
   * @param verifyCode - the code the phone displayed, when the platform asked for one.
   * @param signal - cancels the poll; an abort from it rejects rather than reporting `wait`.
   * @returns the platform's status and whatever it delivered with it.
   * @throws {Error} when the platform answered with a body that is not an object.
   */
  async getQrStatus(qrcode: string, verifyCode?: string, signal?: AbortSignal): Promise<WechatQrStatus> {
    const query = verifyCode === undefined
      ? ''
      : `&verify_code=${encodeURIComponent(verifyCode)}`
    let raw: string
    try {
      raw = await this.send('GET', `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${query}`, {
        authenticated: false,
        timeoutMs: LONG_POLL_TIMEOUT_MS,
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      return { status: 'wait', botToken: undefined, accountId: undefined, baseUrl: undefined, userId: undefined, redirectHost: undefined }
    }
    const record = readObject(raw, 'getQrcodeStatus')
    return {
      status: readText(record['status']),
      botToken: readText(record['bot_token']) || undefined,
      accountId: readText(record['ilink_bot_id']) || undefined,
      baseUrl: readText(record['baseurl']) || undefined,
      userId: readText(record['ilink_user_id']) || undefined,
      redirectHost: readText(record['redirect_host']) || undefined,
    }
  }

  /**
   * Download one media reference, refusing a transfer past `maxBytes` at the
   * byte that crosses it rather than after buffering the whole body.
   * @param ref - the reference the platform stated.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the decrypted bytes.
   * @throws {ChatMediaTooLargeError} when the transfer would exceed `maxBytes`.
   * @throws {Error} when the transfer failed.
   */
  async download(ref: WechatMediaRef, maxBytes: number): Promise<Uint8Array> {
    const response = await fetch(ref.url)
    if (!response.ok) throw new Error(`media download failed with HTTP ${String(response.status)}`)
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) throw new ChatMediaTooLargeError(maxBytes)
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('the media response carried no body')
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) throw new ChatMediaTooLargeError(maxBytes)
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    const body = Buffer.concat(chunks)
    if (ref.key === undefined) return body
    const decipher = createDecipheriv('aes-128-ecb', ref.key, null)
    return Buffer.concat([decipher.update(body), decipher.final()])
  }

  /**
   * Perform one request and return its body text.
   * @param method - the HTTP method.
   * @param endpoint - the path, with any query already encoded.
   * @param options - the body, whether a token is attached, and the client-side window.
   * @returns the response body text.
   * @throws {Error} when the transport failed or the platform answered a non-2xx status.
   */
  private async send(
    method: 'GET' | 'POST',
    endpoint: string,
    options: {
      readonly body?: unknown
      readonly authenticated: boolean
      readonly timeoutMs: number
      readonly signal?: AbortSignal
    },
  ): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, options.timeoutMs)
    const signal = options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal])
    const headers: Record<string, string> = {
      'iLink-App-Id': ILINK_APP_ID,
      'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION,
    }
    if (options.authenticated) {
      headers['Content-Type'] = 'application/json'
      headers['AuthorizationType'] = 'ilink_bot_token'
      headers['Authorization'] = `Bearer ${this.account.token}`
      headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString('base64')
    }
    try {
      const response = await fetch(new URL(endpoint, `${this.account.baseUrl}/`), {
        method,
        headers,
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
        signal,
      })
      const raw = await response.text()
      if (!response.ok) throw new Error(`${method} ${endpoint} answered HTTP ${String(response.status)}: ${raw}`)
      return raw
    } finally {
      clearTimeout(timer)
    }
  }
}

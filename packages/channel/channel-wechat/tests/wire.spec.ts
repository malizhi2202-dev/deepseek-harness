/**
 * Pins the WeChat wire against a stubbed transfer: uint64 identifiers survive
 * parsing as strings, a media reference is built from whichever field the
 * platform sent, every request carries the headers the channel needs, a poll
 * window that closes empty is a normal result rather than a failure, a QR status
 * poll reports `wait` on a transfer failure but rethrows a cancellation, and a
 * download is refused at the byte that crosses its cap and decrypted with the
 * key the item stated.
 */
import { createCipheriv } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'
import {
  WECHAT_CDN_BASE_URL,
  WECHAT_DEFAULT_BASE_URL,
  WechatWire,
  parseWechatJson,
  readMediaRef,
} from '../src/wire.ts'
import type { WechatAccount } from '../src/wire.ts'

/** The account every case talks as. */
const ACCOUNT: WechatAccount = { baseUrl: WECHAT_DEFAULT_BASE_URL, token: 'token-1', botAgent: 'DeepSeekHarness' }

/** A stubbed transfer answering every call with one body. */
function answering(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
}

/** The URL and request options of one recorded call. */
function callOf(mock: ReturnType<typeof vi.fn>, index: number): { url: URL; init: RequestInit } {
  const call = mock.mock.calls[index] as [URL | string, RequestInit]
  return { url: new URL(String(call[0])), init: call[1] }
}

/** The JSON body of one recorded call. */
function bodyOf(init: RequestInit): unknown {
  return JSON.parse(typeof init.body === 'string' ? init.body : '')
}

/** The headers of one recorded call. */
function headersOf(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  return callOf(mock, index).init.headers as Record<string, string>
}

describe('parseWechatJson', () => {
  it('keeps a uint64 identifier as the string the seam treats it as', () => {
    expect(parseWechatJson('{"message_id":18446744073709551615}'))
      .toEqual({ message_id: '18446744073709551615' })
    expect(parseWechatJson('{"msg_id": 42, "svr_id": 7}')).toEqual({ msg_id: '42', svr_id: '7' })
  })

  it('leaves a number that is not an identifier alone', () => {
    expect(parseWechatJson('{"message_type":2,"ret":0,"ratio":1.5}'))
      .toEqual({ message_type: 2, ret: 0, ratio: 1.5 })
  })

  it('refuses a body that is not JSON', () => {
    expect(() => parseWechatJson('nope')).toThrow(SyntaxError)
  })
})

describe('readMediaRef', () => {
  it('prefers the absolute URL the platform stated', () => {
    expect(readMediaRef({ full_url: 'https://cdn.invalid/a.png' }, undefined))
      .toEqual({ url: 'https://cdn.invalid/a.png', key: undefined })
  })

  it('builds the CDN URL from an encrypted query parameter', () => {
    expect(readMediaRef({ encrypt_query_param: 'a b' }, undefined))
      .toEqual({ url: `${WECHAT_CDN_BASE_URL}/download?encrypted_query_param=a%20b`, key: undefined })
  })

  it('reads the key from either encoding the platform uses', () => {
    const hex = readMediaRef({ full_url: 'https://cdn.invalid/a' }, '00112233445566778899aabbccddeeff')
    expect(hex?.key).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'))

    const base64 = readMediaRef({ full_url: 'https://cdn.invalid/a', aes_key: Buffer.alloc(16, 1).toString('base64') }, undefined)
    expect(base64?.key).toEqual(Buffer.alloc(16, 1))
  })

  it('ignores a key that is neither encoding or the wrong length', () => {
    expect(readMediaRef({ full_url: 'https://cdn.invalid/a' }, 'short')?.key).toBeUndefined()
    expect(readMediaRef({ full_url: 'https://cdn.invalid/a', aes_key: 7 }, undefined)?.key).toBeUndefined()
    expect(readMediaRef({ full_url: 'https://cdn.invalid/a' }, '')?.key).toBeUndefined()
  })

  it('reports no reference for a media object that names no URL', () => {
    expect(readMediaRef({}, undefined)).toBeUndefined()
    expect(readMediaRef(null, undefined)).toBeUndefined()
    expect(readMediaRef([1], undefined)).toBeUndefined()
  })
})

describe('WechatWire', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports and replaces the host it talks to', () => {
    const wire = new WechatWire(ACCOUNT)
    expect(wire.baseUrl).toBe(WECHAT_DEFAULT_BASE_URL)
    expect(wire.withBaseUrl('https://other.invalid').baseUrl).toBe('https://other.invalid')
  })

  describe('getUpdates', () => {
    it('returns the messages, the next cursor, and the window the platform named', async () => {
      const fetchMock = answering({ ret: 0, msgs: [{ message_id: 1 }], get_updates_buf: 'cursor-2', longpolling_timeout_ms: 20_000 })
      vi.stubGlobal('fetch', fetchMock)

      await expect(new WechatWire(ACCOUNT).getUpdates('cursor-1')).resolves.toEqual({
        cursor: 'cursor-2',
        messages: [{ message_id: '1' }],
        longPollMs: 20_000,
      })

      const { url, init } = callOf(fetchMock, 0)
      expect(url.pathname).toBe('/ilink/bot/getupdates')
      expect(init.method).toBe('POST')
      expect(bodyOf(init)).toEqual({
        get_updates_buf: 'cursor-1',
        base_info: { channel_version: '65792', bot_agent: 'DeepSeekHarness' },
      })
      expect(headersOf(fetchMock)).toMatchObject({
        'iLink-App-Id': 'bot',
        AuthorizationType: 'ilink_bot_token',
        Authorization: 'Bearer token-1',
      })
      expect(headersOf(fetchMock)['X-WECHAT-UIN']).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('keeps the cursor and reports no messages when the window closed empty', async () => {
      vi.stubGlobal('fetch', answering({ ret: 0 }))
      await expect(new WechatWire(ACCOUNT).getUpdates('cursor-1')).resolves.toEqual({
        cursor: 'cursor-1',
        messages: [],
        longPollMs: undefined,
      })
    })

    it('reports no messages when the platform sent something that is not a list', async () => {
      vi.stubGlobal('fetch', answering({ msgs: 'nope' }))
      await expect(new WechatWire(ACCOUNT).getUpdates('')).resolves.toMatchObject({ messages: [] })
    })

    it('reports an empty window when its own request window closed', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('fetch', vi.fn((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('the window closed'), { name: 'AbortError' }))
          })
        })))
        const poll = new WechatWire(ACCOUNT).getUpdates('cursor-1', { timeoutMs: 30 })

        await vi.advanceTimersByTimeAsync(30)
        await expect(poll).resolves.toEqual({ cursor: 'cursor-1', messages: [], longPollMs: undefined })
      } finally {
        vi.useRealTimers()
      }
    })

    it('reports the abort when the caller cancelled the poll', async () => {
      const controller = new AbortController()
      vi.stubGlobal('fetch', vi.fn((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        })
      })))
      const poll = new WechatWire(ACCOUNT).getUpdates('cursor-1', { signal: controller.signal })
      controller.abort()

      await expect(poll).rejects.toThrow('cancelled')
    })

    it('reports a transfer failure that is not an abort', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('the network is down'))))
      await expect(new WechatWire(ACCOUNT).getUpdates('cursor-1')).rejects.toThrow('the network is down')
    })

    it('reports a refusal and a body that is not an object', async () => {
      vi.stubGlobal('fetch', answering({}, 500))
      await expect(new WechatWire(ACCOUNT).getUpdates('')).rejects.toThrow('getupdates answered HTTP 500')

      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 200 }))))
      await expect(new WechatWire(ACCOUNT).getUpdates('')).rejects.toThrow('getUpdates returned a body that is not JSON')

      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[1]', { status: 200 }))))
      await expect(new WechatWire(ACCOUNT).getUpdates('')).rejects.toThrow('getUpdates returned a JSON value that is not an object')
    })
  })

  describe('sendText', () => {
    it('sends one text item carrying the conversation token', async () => {
      const fetchMock = answering({ ret: 0 })
      vi.stubGlobal('fetch', fetchMock)

      await new WechatWire(ACCOUNT).sendText('peer-1', 'hi', 'context-1')

      const { url, init } = callOf(fetchMock, 0)
      expect(url.pathname).toBe('/ilink/bot/sendmessage')
      const body = bodyOf(init) as { msg: Record<string, unknown> }
      expect(body.msg).toMatchObject({
        from_user_id: '',
        to_user_id: 'peer-1',
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: 'hi' } }],
        context_token: 'context-1',
      })
      expect(body.msg['client_id']).toMatch(/^dsh-[0-9a-f]{16}$/)
    })

    it('reports a send the platform refused', async () => {
      vi.stubGlobal('fetch', answering({ ret: -14, errmsg: 'token stale' }))
      await expect(new WechatWire(ACCOUNT).sendText('peer-1', 'hi', 'context-1'))
        .rejects.toThrow('sendMessage was refused with ret=-14: token stale')
    })
  })

  describe('createQrChallenge', () => {
    it('requests a challenge for the bot type it was given', async () => {
      const fetchMock = answering({ qrcode: 'qr-1', qrcode_img_content: 'https://login.invalid/qr-1' })
      vi.stubGlobal('fetch', fetchMock)

      await expect(new WechatWire(ACCOUNT).createQrChallenge('3')).resolves.toEqual({
        qrcode: 'qr-1',
        payload: 'https://login.invalid/qr-1',
      })

      const { url, init } = callOf(fetchMock, 0)
      expect(url.pathname).toBe('/ilink/bot/get_bot_qrcode')
      expect(url.searchParams.get('bot_type')).toBe('3')
      expect(bodyOf(init)).toEqual({ local_token_list: [] })
      expect(headersOf(fetchMock)['Authorization']).toBeUndefined()
    })

    it('reports a challenge the platform did not return', async () => {
      vi.stubGlobal('fetch', answering({ qrcode: 'qr-1' }))
      await expect(new WechatWire(ACCOUNT).createQrChallenge('3')).rejects.toThrow('getBotQrcode returned no QR code')
    })
  })

  describe('getQrStatus', () => {
    it('reports the status and everything delivered with it', async () => {
      const fetchMock = answering({
        status: 'confirmed',
        bot_token: 'bot-token-1',
        ilink_bot_id: 'bot-1',
        baseurl: 'https://ilinkai.invalid',
        ilink_user_id: 'user-1',
        redirect_host: 'redirect.invalid',
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(new WechatWire(ACCOUNT).getQrStatus('qr-1', '1234')).resolves.toEqual({
        status: 'confirmed',
        botToken: 'bot-token-1',
        accountId: 'bot-1',
        baseUrl: 'https://ilinkai.invalid',
        userId: 'user-1',
        redirectHost: 'redirect.invalid',
      })

      const { url, init } = callOf(fetchMock, 0)
      expect(url.pathname).toBe('/ilink/bot/get_qrcode_status')
      expect(url.searchParams.get('qrcode')).toBe('qr-1')
      expect(url.searchParams.get('verify_code')).toBe('1234')
      expect(init.method).toBe('GET')
    })

    it('reports every absent field as absent', async () => {
      vi.stubGlobal('fetch', answering({ status: 'wait' }))
      await expect(new WechatWire(ACCOUNT).getQrStatus('qr-1')).resolves.toEqual({
        status: 'wait',
        botToken: undefined,
        accountId: undefined,
        baseUrl: undefined,
        userId: undefined,
        redirectHost: undefined,
      })
    })

    it('reports a wait when the transfer failed', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('the network is down'))))
      await expect(new WechatWire(ACCOUNT).getQrStatus('qr-1')).resolves.toMatchObject({ status: 'wait' })
    })

    it('reports the abort when the caller cancelled the poll', async () => {
      const controller = new AbortController()
      vi.stubGlobal('fetch', vi.fn((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        })
      })))
      const poll = new WechatWire(ACCOUNT).getQrStatus('qr-1', undefined, controller.signal)
      controller.abort()

      await expect(poll).rejects.toThrow('cancelled')
    })
  })

  describe('download', () => {
    /** The key one encrypted download case uses. */
    const KEY = Buffer.from('00112233445566778899aabbccddeeff', 'hex')

    it('returns the bytes as they arrived when the reference carried no key', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3])))))
      await expect(new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: undefined }, 8))
        .resolves.toEqual(Buffer.from([1, 2, 3]))
    })

    it('decrypts the bytes with the key the item stated', async () => {
      const cipher = createCipheriv('aes-128-ecb', KEY, null)
      const encrypted = Buffer.concat([cipher.update(Buffer.from('hello')), cipher.final()])
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array(encrypted)))))

      const data = await new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: KEY }, 64)
      expect(Buffer.from(data).toString()).toBe('hello')
    })

    it('refuses a transfer past its cap before reading it', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } }),
      )))
      await expect(new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: undefined }, 2))
        .rejects.toThrow(ChatMediaTooLargeError)
    })

    it('refuses at the byte that crosses its cap while streaming', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3])))))
      await expect(new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: undefined }, 2))
        .rejects.toThrow(ChatMediaTooLargeError)
    })

    it('reports a transfer that failed and a body that carried nothing', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))))
      await expect(new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: undefined }, 8))
        .rejects.toThrow('media download failed with HTTP 404')

      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))))
      await expect(new WechatWire(ACCOUNT).download({ url: 'https://cdn.invalid/a', key: undefined }, 8))
        .rejects.toThrow('the media response carried no body')
    })
  })
})

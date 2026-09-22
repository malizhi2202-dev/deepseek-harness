/**
 * Pins the QQ wire against a stubbed transfer and socket: the credential pair is
 * exchanged for a token that every call carries, a call that meets an expired
 * token exchanges once more and repeats, a platform refusal is reported with its
 * code, an attachment download is refused at the byte that crosses its cap, and
 * the gateway identifies, heartbeats, resumes, and re-identifies across a drop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'
import { exchangeAccessToken, QQ_DEFAULT_API_BASE, QQ_INTENTS, QqApi, QqGateway } from '../src/api.ts'

/** One frame a stubbed socket received. */
type Frame = Record<string, unknown>

/** A WebSocket the test drives frame by frame. */
class FakeSocket {
  static opened: FakeSocket[] = []
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.emit('close', {})
  }

  /** Deliver one event to this socket's listeners. */
  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  /** The frames this socket sent, parsed. */
  frames(): Frame[] {
    return this.sent.map(raw => JSON.parse(raw) as Frame)
  }

  /** The one frame of a given opcode this socket sent. */
  frame(op: number): Frame {
    const found = this.frames().filter(frame => frame['op'] === op)
    expect(found).toHaveLength(1)
    return found[0] as Frame
  }
}

/** A JSON response for the stubbed transfer. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A stubbed transfer whose recorded calls are typed for the assertions below. */
type TransferMock = Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>

/** A stubbed transfer that routes each call by a URL fragment. */
function transfer(routes: Array<[string, () => Response]>): TransferMock {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    for (const [fragment, answer] of routes) {
      if (url.includes(fragment)) return Promise.resolve(answer())
    }
    return Promise.reject(new Error(`the test transfer was asked for ${url}`))
  })
}

/** The token route every API case needs. */
const TOKEN_ROUTE: [string, () => Response] = ['getAppAccessToken', () => json({ access_token: 'token-1', expires_in: '7200' })]

/** The application every case exchanges. */
const APPLICATION = { appId: 'app-1', clientSecret: 'secret-1' }

/** The last call the stubbed transfer received. */
function lastCall(mock: TransferMock): { url: string; init: RequestInit } {
  const call = mock.mock.calls.at(-1)
  if (call === undefined) throw new Error('the test transfer was not called')
  const input = call[0]
  return {
    url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    init: call[1] ?? {},
  }
}

/** The JSON body of one recorded call. */
function bodyOf(init: RequestInit): unknown {
  return JSON.parse(typeof init.body === 'string' ? init.body : '')
}

describe('exchangeAccessToken', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the credential pair and reads a lifetime stated as a string', async () => {
    const fetchMock = transfer([TOKEN_ROUTE])
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeAccessToken(APPLICATION)).resolves.toEqual({ token: 'token-1', expiresInSeconds: 7200 })
    const call = lastCall(fetchMock)
    expect(call.url).toBe('https://bots.qq.com/app/getAppAccessToken')
    expect(call.init.method).toBe('POST')
    expect(bodyOf(call.init)).toEqual({ appId: 'app-1', clientSecret: 'secret-1' })
  })

  it('refuses a transfer that failed', async () => {
    vi.stubGlobal('fetch', transfer([['getAppAccessToken', () => json({}, 500)]]))
    await expect(exchangeAccessToken(APPLICATION)).rejects.toThrow('the access-token exchange answered HTTP 500')
  })

  it('refuses a business failure with its code', async () => {
    vi.stubGlobal('fetch', transfer([['getAppAccessToken', () => json({ code: 100007, message: 'appid invalid' })]]))
    await expect(exchangeAccessToken(APPLICATION)).rejects.toThrow('code=100007')
  })

  it('refuses an answer carrying no usable token', async () => {
    vi.stubGlobal('fetch', transfer([['getAppAccessToken', () => json({ access_token: '', expires_in: '7200' })]]))
    await expect(exchangeAccessToken(APPLICATION)).rejects.toThrow('returned no usable token')
  })
})

describe('QqApi', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('carries the exchanged token on every call', async () => {
    const fetchMock = transfer([TOKEN_ROUTE, ['/gateway', () => json({ url: 'wss://gateway.invalid' })]])
    vi.stubGlobal('fetch', fetchMock)

    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).gatewayUrl()).resolves.toBe('wss://gateway.invalid')
    const call = lastCall(fetchMock)
    expect(call.url).toBe(`${QQ_DEFAULT_API_BASE}/gateway`)
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe('QQBot token-1')
  })

  it('refuses a gateway lookup that named no url', async () => {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/gateway', () => json({})]]))
    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).gatewayUrl())
      .rejects.toThrow('the gateway lookup returned no url')
  })

  it('sends a group message to the group path', async () => {
    const fetchMock = transfer([TOKEN_ROUTE, ['/v2/groups/', () => json({ id: 'sent' })]])
    vi.stubGlobal('fetch', fetchMock)

    await new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendGroupMessage('group/openid', { content: 'hi' })
    const call = lastCall(fetchMock)
    expect(call.url).toBe(`${QQ_DEFAULT_API_BASE}/v2/groups/group%2Fopenid/messages`)
    expect(call.init.method).toBe('POST')
    expect(bodyOf(call.init)).toEqual({ content: 'hi' })
  })

  it('sends a single-chat message to the user path', async () => {
    const fetchMock = transfer([TOKEN_ROUTE, ['/v2/users/', () => json({ id: 'sent' })]])
    vi.stubGlobal('fetch', fetchMock)

    await new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendC2cMessage('peer-1', { content: 'hi' })
    expect(lastCall(fetchMock).url).toBe(`${QQ_DEFAULT_API_BASE}/v2/users/peer-1/messages`)
  })

  it('repeats one call after an expired token and succeeds', async () => {
    let refusals = 0
    const fetchMock = transfer([
      TOKEN_ROUTE,
      ['/v2/users/', () => {
        refusals += 1
        return refusals === 1 ? json({ err_code: 11244, message: 'token expired' }) : json({ id: 'sent' })
      }],
    ])
    vi.stubGlobal('fetch', fetchMock)

    await new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendC2cMessage('peer-1', { content: 'hi' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('reports the refusal when the repeated call is refused again', async () => {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/v2/users/', () => json({ err_code: 11244, message: 'token expired' })]]))
    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendC2cMessage('peer-1', {}))
      .rejects.toThrow('QQ refused POST /v2/users/peer-1/messages with err_code=11244: token expired')
  })

  it('reports a refusal with its code and message', async () => {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/v2/groups/', () => json({ err_code: 40034128, message: '超限' })]]))
    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendGroupMessage('g1', {}))
      .rejects.toThrow('err_code=40034128: 超限')
  })

  it('reports a transfer that failed', async () => {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/v2/groups/', () => json({}, 429)]]))
    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendGroupMessage('g1', {}))
      .rejects.toThrow('POST /v2/groups/g1/messages answered HTTP 429')
  })

  it('reports a body that is not JSON', async () => {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/v2/groups/', () => new Response('nope', { status: 200 })]]))
    await expect(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE).sendGroupMessage('g1', {}))
      .rejects.toThrow('POST /v2/groups/g1/messages returned a body that is not JSON')
  })

  describe('download', () => {
    /** An API whose token exchange never runs, because a download carries no credential. */
    function api(): QqApi {
      return new QqApi(APPLICATION, QQ_DEFAULT_API_BASE)
    }

    it('returns the attachment bytes', async () => {
      vi.stubGlobal('fetch', transfer([['cdn.invalid', () => new Response(new Uint8Array([1, 2, 3]))]]))
      await expect(api().download('https://cdn.invalid/a.png', 8)).resolves.toEqual(Buffer.from([1, 2, 3]))
    })

    it('refuses a transfer past its cap before reading it', async () => {
      vi.stubGlobal('fetch', transfer([['cdn.invalid', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } })]]))
      await expect(api().download('https://cdn.invalid/a.png', 2)).rejects.toThrow(ChatMediaTooLargeError)
    })

    it('refuses at the byte that crosses its cap while streaming', async () => {
      vi.stubGlobal('fetch', transfer([['cdn.invalid', () => new Response(new Uint8Array([1, 2, 3]))]]))
      await expect(api().download('https://cdn.invalid/a.png', 2)).rejects.toThrow(ChatMediaTooLargeError)
    })

    it('returns nothing for an attachment that carried no body', async () => {
      vi.stubGlobal('fetch', transfer([['cdn.invalid', () => new Response(null, { status: 200 })]]))
      await expect(api().download('https://cdn.invalid/a.png', 8)).resolves.toEqual(Buffer.from([]))
    })

    it('reads past a content length the platform did not state as a number', async () => {
      vi.stubGlobal('fetch', transfer([
        ['cdn.invalid', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': 'unknown' } })],
      ]))
      await expect(api().download('https://cdn.invalid/a.png', 8)).resolves.toEqual(Buffer.from([1, 2, 3]))
    })

    it('reports a transfer that failed', async () => {
      vi.stubGlobal('fetch', transfer([['cdn.invalid', () => new Response('', { status: 403 })]]))
      await expect(api().download('https://cdn.invalid/a.png', 8)).rejects.toThrow('answered HTTP 403')
    })
  })
})

describe('QqGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.opened = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** The handlers one gateway case records through. */
  function recorder(): { events: string[]; ready: number; errors: unknown[] } {
    return { events: [], ready: 0, errors: [] }
  }

  /** Build a gateway whose gateway lookup and token exchange are stubbed. */
  function gateway(record: ReturnType<typeof recorder>, routes: Array<[string, () => Response]> = []): QqGateway {
    vi.stubGlobal('fetch', transfer([TOKEN_ROUTE, ['/gateway', () => json({ url: 'wss://gateway.invalid' })], ...routes]))
    return new QqGateway(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE), {
      onDispatch(event, data) {
        record.events.push(event)
        expect(data).toBeDefined()
      },
      onReady() { record.ready += 1 },
      onError(error) { record.errors.push(error) },
    })
  }

  /** One hello frame at a stated heartbeat interval. */
  function hello(interval = 45_000): string {
    return JSON.stringify({ op: 10, d: { heartbeat_interval: interval } })
  }

  it('opens the socket the platform named', async () => {
    const record = recorder()
    await gateway(record).open()
    expect(FakeSocket.opened.map(socket => socket.url)).toEqual(['wss://gateway.invalid'])
  })

  it('heartbeats on the stated interval and identifies with the token', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.frame(2)).toEqual({
      op: 2,
      d: { token: 'QQBot token-1', intents: QQ_INTENTS, shard: [0, 1], properties: {} },
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.frames().filter(frame => frame['op'] === 1)).toEqual([{ op: 1, d: null }])
  })

  it('heartbeats on the interval it falls back to when the platform names none', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: JSON.stringify({ op: 10, d: {} }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.frame(2)['op']).toBe(2)

    await vi.advanceTimersByTimeAsync(45_000)
    expect(socket.frames().filter(frame => frame['op'] === 1)).toEqual([{ op: 1, d: null }])
  })

  it('accepts a dispatch that carries no sequence', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm1' } }) })
    expect(record.events).toEqual(['C2C_MESSAGE_CREATE'])

    socket.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.frames().filter(frame => frame['op'] === 1)).toEqual([{ op: 1, d: null }])
  })

  it('reports READY and RESUMED as ready and passes every dispatch on', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: JSON.stringify({ op: 0, s: 7, t: 'READY', d: { session_id: 'session-1' } }) })
    socket.emit('message', { data: JSON.stringify({ op: 0, s: 8, t: 'RESUMED', d: {} }) })
    socket.emit('message', { data: JSON.stringify({ op: 0, s: 9, t: 'C2C_MESSAGE_CREATE', d: { id: 'm1' } }) })

    expect(record.ready).toBe(2)
    expect(record.events).toEqual(['READY', 'RESUMED', 'C2C_MESSAGE_CREATE'])
    expect(record.errors).toEqual([])
  })

  it('resumes the session it held after the socket drops', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const first = FakeSocket.opened[0] as FakeSocket
    first.emit('message', { data: hello(1000) })
    first.emit('message', { data: JSON.stringify({ op: 0, s: 7, t: 'READY', d: { session_id: 'session-1' } }) })
    await vi.advanceTimersByTimeAsync(0)

    first.close()
    await vi.advanceTimersByTimeAsync(2000)
    const second = FakeSocket.opened[1] as FakeSocket
    second.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(0)

    expect(second.frame(6)).toEqual({ op: 6, d: { token: 'QQBot token-1', session_id: 'session-1', seq: 7 } })
  })

  it('identifies again when the platform invalidated the session', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const first = FakeSocket.opened[0] as FakeSocket
    first.emit('message', { data: hello(1000) })
    first.emit('message', { data: JSON.stringify({ op: 0, s: 7, t: 'READY', d: { session_id: 'session-1' } }) })
    await vi.advanceTimersByTimeAsync(0)

    first.emit('message', { data: JSON.stringify({ op: 9, d: false }) })
    await vi.advanceTimersByTimeAsync(2000)
    const second = FakeSocket.opened[1] as FakeSocket
    second.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(0)

    expect(second.frame(2)['op']).toBe(2)
  })

  it('reconnects when the platform asks it to', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const first = FakeSocket.opened[0] as FakeSocket

    first.emit('message', { data: JSON.stringify({ op: 7, d: null }) })
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeSocket.opened).toHaveLength(2)
  })

  it('reports a socket failure and reconnects', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('error', {})
    expect(record.errors).toHaveLength(1)

    socket.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeSocket.opened).toHaveLength(2)
  })

  it('reports a frame it cannot read without dropping the session', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: 'not json' })
    expect(record.errors).toHaveLength(1)
    expect(record.events).toEqual([])
  })

  it('ignores an opcode it does not handle', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: JSON.stringify({ op: 11, d: null }) })
    expect(record.errors).toEqual([])
    expect(socket.sent).toEqual([])
  })

  it('reports a token that expired before the handshake and drops the socket', async () => {
    const record = recorder()
    let exchanges = 0
    vi.stubGlobal('fetch', transfer([
      ['getAppAccessToken', () => {
        exchanges += 1
        return exchanges === 1 ? json({ access_token: 'token-1', expires_in: 1 }) : json({ code: 100016, message: 'bad secret' })
      }],
      ['/gateway', () => json({ url: 'wss://gateway.invalid' })],
    ]))
    const session = new QqGateway(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE), {
      onDispatch() { record.events.push('dispatch') },
      onReady() { record.ready += 1 },
      onError(error) { record.errors.push(error) },
    })
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(0)
    expect(record.errors).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(record.errors.length).toBeGreaterThan(1)
  })

  it('reports a gateway lookup that failed on reconnect and keeps retrying', async () => {
    const record = recorder()
    let lookups = 0
    vi.stubGlobal('fetch', transfer([
      TOKEN_ROUTE,
      ['/gateway', () => {
        lookups += 1
        return lookups === 1 ? json({ url: 'wss://gateway.invalid' }) : json({}, 500)
      }],
    ]))
    const session = new QqGateway(new QqApi(APPLICATION, QQ_DEFAULT_API_BASE), {
      onDispatch() { record.events.push('dispatch') },
      onReady() { record.ready += 1 },
      onError(error) { record.errors.push(error) },
    })
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(record.errors).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(lookups).toBeGreaterThan(2)
  })

  it('cancels a pending reconnect when it is closed', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket

    socket.close()
    session.close()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('stops reconnecting and heartbeating once it is closed', async () => {
    const record = recorder()
    const session = gateway(record)
    await session.open()
    const socket = FakeSocket.opened[0] as FakeSocket
    socket.emit('message', { data: hello(1000) })
    await vi.advanceTimersByTimeAsync(0)

    session.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.opened).toHaveLength(1)
    expect(socket.frames().filter(frame => frame['op'] === 1)).toEqual([])
  })

  it('does not open a socket when it was closed while the gateway was being looked up', async () => {
    const record = recorder()
    const session = gateway(record)
    const opening = session.open()
    session.close()
    await opening
    expect(FakeSocket.opened).toEqual([])
  })
})

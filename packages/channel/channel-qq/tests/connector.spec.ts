/**
 * Pins the QQ channel connector: the plugin's name, injections, and all-empty
 * configuration defaults; the credential reference the settings section names
 * resolved per client and per connection, so the transport is built from the
 * secret rather than from the reference; the gateway's inbound events normalized
 * onto the seam's handlers and remembered so a reply rides on the message that
 * asked; `onReady` and `onError` left optional; and `apply` registering exactly
 * one connector with the channel registry.
 *
 * The transfer and the socket are faked at the global boundary, so no request is
 * made and no connection is opened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers, ChatInboundMessage } from '@deepseek-ai/dsh-channel'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { conversationId } from '../src/client.ts'
import { QQ_CAPABILITIES, QQ_REPLY_BUDGET, Config, apply, createQqConnector, inject, name } from '../src/index.ts'

/** A WebSocket the test drives frame by frame. */
class FakeSocket {
  static opened: FakeSocket[] = []
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(): void {}

  close(): void {
    this.emit('close', {})
  }

  /** Deliver one event to this socket's listeners. */
  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** The URL one recorded call was made to. */
function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

/** The socket the connector opened last. */
function lastSocket(): FakeSocket {
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('the connector opened no socket')
  return socket
}

/** A stubbed transfer whose recorded calls are typed for the assertions below. */
type TransferMock = Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>

/** A stubbed transfer answering the token exchange and the gateway lookup. */
function transfer(): TransferMock {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('getAppAccessToken')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }), { status: 200 }))
    }
    if (url.includes('/gateway')) {
      return Promise.resolve(new Response(JSON.stringify({ url: 'wss://gateway.invalid' }), { status: 200 }))
    }
    if (url.includes('/messages')) {
      return Promise.resolve(new Response(JSON.stringify({ id: 'sent-1' }), { status: 200 }))
    }
    return Promise.reject(new Error(`the test transfer was asked for ${url}`))
  })
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { appId: 'app-test', appSecretRef: 'QQ_APP_SECRET', ...overrides }
}

/** A context carrying the channel registry and one seeded credential storage. */
async function open(seed: Record<string, string> = { QQ_APP_SECRET: 'app-test-secret' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

/** One gateway dispatch frame. */
function dispatch(event: string, data: unknown): string {
  return JSON.stringify({ op: 0, s: 1, t: event, d: data })
}

/** One single-chat message event body. */
function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'msg-1', content: 'hello', author: { user_openid: 'peer-1', username: 'Test User' }, ...overrides }
}

describe('plugin declaration', () => {
  it('registers under its own name and declares the services it reads', () => {
    expect(name).toBe('channel-qq')
    expect(inject).toEqual(['chatChannels', 'credentials'])
  })

  it('defaults every configuration field to empty rather than to a working value', () => {
    expect(Config({})).toEqual({ appId: '', appSecretRef: '', apiBaseUrl: '' })
    expect(Config({ appId: 'app-test', appSecretRef: 'QQ_APP_SECRET', apiBaseUrl: 'https://sandbox.invalid' })).toEqual({
      appId: 'app-test',
      appSecretRef: 'QQ_APP_SECRET',
      apiBaseUrl: 'https://sandbox.invalid',
    })
  })
})

describe('createQqConnector', () => {
  let fetchMock: TransferMock

  beforeEach(() => {
    FakeSocket.opened = []
    fetchMock = transfer()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('declares the qq channel, its reply budget, its capabilities, and its settings namespace', async () => {
    const connector = createQqConnector(await open())

    expect(connector.channel).toBe('qq')
    expect(connector.replyBudget).toBe(QQ_REPLY_BUDGET)
    expect(connector.capabilities).toBe(QQ_CAPABILITIES)
    expect(connector.settings.namespace).toBe('chat-channel-qq')
    expect(connector.settings.schema).toBe(Config)
    expect(connector.settings.credentialFields).toEqual(['appSecretRef'])
    expect(connector.settings.base).toEqual({})
  })

  it('reports the tighter of the two platform reply budgets', () => {
    expect(QQ_REPLY_BUDGET).toBe(4)
  })

  it('layers the plugin configuration under the user section', async () => {
    const connector = createQqConnector(await open(), { apiBaseUrl: 'https://sandbox.invalid' })
    expect(connector.settings.base).toEqual({ apiBaseUrl: 'https://sandbox.invalid' })
  })

  it('builds a client over a transport built from the resolved secret', async () => {
    const connector = createQqConnector(await open())

    const client = await connector.createClient(section())

    await expect(client.checkCredentials()).resolves.toEqual({
      accountLabel: 'QQ bot app-test',
      details: ['api https://api.bot.qq.com'],
    })
  })

  it('refuses a reference name the credential grammar rejects', async () => {
    const connector = createQqConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'not a reference' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appSecretRef' }))
  })

  it('refuses a well-formed reference with nothing stored behind it', async () => {
    const connector = createQqConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'QQ_ABSENT_SECRET' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appSecretRef' }))
  })

  it('refuses a section missing a required field before resolving any credential', async () => {
    const connector = createQqConnector(await open())

    await expect(connector.createClient({ appId: 'app-test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appSecretRef' }))
  })

  it('streams normalized inbound messages, remembers them, and reports ready', async () => {
    const ctx = await open()
    const connector = createQqConnector(ctx)
    const seen: ChatInboundMessage[] = []
    let ready = 0
    const handlers: ChatConnectorHandlers = {
      onMessage: (inbound) => { seen.push(inbound) },
      onReady: () => { ready += 1 },
    }

    const connection = await connector.connect(section(), handlers)
    const socket = lastSocket()
    expect(socket.url).toBe('wss://gateway.invalid')

    socket.emit('message', { data: dispatch('C2C_MESSAGE_CREATE', message()) })
    expect(seen).toEqual([{
      chatId: 'direct:peer-1',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Test User',
    }])

    socket.emit('message', { data: JSON.stringify({ op: 0, s: 2, t: 'READY', d: { session_id: 'session-1' } }) })
    expect(ready).toBe(1)

    socket.emit('message', { data: dispatch('GROUP_AT_MESSAGE_CREATE', { id: 'msg-2', content: '@bot hi' }) })
    expect(seen).toHaveLength(1)

    connection.close()
  })

  it('lets a reply ride on the message the gateway delivered', async () => {
    const ctx = await open()
    const connector = createQqConnector(ctx)
    const connection = await connector.connect(section(), { onMessage: () => {} })

    lastSocket().emit('message', { data: dispatch('C2C_MESSAGE_CREATE', message({ id: 'msg-7' })) })

    const client = await connector.createClient(section())
    await client.sendText(conversationId('direct', 'peer-1'), 'hi')

    const sent = fetchMock.mock.calls.find(([input]) => urlOf(input).includes('/v2/users/'))
    const body = sent?.[1]?.body
    expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual({ content: 'hi', msg_type: 0, msg_id: 'msg-7', msg_seq: 1 })
    connection.close()
  })

  it('reports a gateway failure through the optional error handler', async () => {
    const ctx = await open()
    const connector = createQqConnector(ctx)
    const errors: unknown[] = []

    const connection = await connector.connect(section(), { onMessage: () => {}, onError: (error) => { errors.push(error) } })
    lastSocket().emit('message', { data: 'not json' })

    expect(errors).toHaveLength(1)
    connection.close()
  })

  it('connects without the ready and error handlers, which the seam leaves optional', async () => {
    const ctx = await open()
    const connector = createQqConnector(ctx)

    const connection = await connector.connect(section(), { onMessage: () => {} })
    lastSocket().emit('message', { data: 'not json' })
    connection.close()

    expect(FakeSocket.opened).toHaveLength(1)
  })
})

describe('apply', () => {
  beforeEach(() => {
    FakeSocket.opened = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', transfer())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('registers the qq connector with the channel registry', async () => {
    const ctx = await open()

    apply(ctx, { appId: 'app-test', appSecretRef: 'QQ_APP_SECRET' })

    expect(ctx.chatChannels.list()).toHaveLength(1)
    expect(ctx.chatChannels.get('qq')).toMatchObject({
      channel: 'qq',
      replyBudget: QQ_REPLY_BUDGET,
      capabilities: QQ_CAPABILITIES,
      settings: { base: { appId: 'app-test', appSecretRef: 'QQ_APP_SECRET' } },
    })
  })
})

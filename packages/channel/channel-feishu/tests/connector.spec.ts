/**
 * Pins the Feishu channel connector: the plugin's name, injections, and
 * configuration defaults; the credential reference the settings section names
 * resolved per client and per connection, so the SDK is built from the secret
 * rather than from the reference; the inbound event normalized onto the seam's
 * handlers; the socket's ready, reconnect, and error callbacks forwarded; and
 * `apply` registering exactly one connector with the channel registry.
 *
 * The SDK is faked at the wire boundary by replacing the package that builds
 * the real client, dispatcher, and WebSocket, so no socket is ever opened.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers, ChatInboundMessage } from '@deepseek-ai/dsh-channel'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { Config, FeishuChatClient, apply, createFeishuConnector, inject, name } from '../src/index.ts'

const APP_ID = 'cli_0123456789abcdef'

/** Every SDK client the connector built, in construction order. */
const clients = vi.hoisted(() => [] as Array<Record<string, unknown>>)

/** Every socket the connector built, in construction order. */
const sockets = vi.hoisted(() => [] as Array<{
  config: Record<string, unknown>
  started: boolean
  closed: boolean
  handlers: Record<string, (payload: unknown) => void>
}>)

/** Every event dispatcher the connector built, in construction order. */
const dispatchers = vi.hoisted(() => [] as Array<Record<string, (payload: unknown) => void>>)

vi.mock('@larksuiteoapi/node-sdk', () => ({
  AppType: { SelfBuild: 0, ISV: 1 },
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  LoggerLevel: { error: 'error' },
  Client: class {
    readonly config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
      clients.push(config)
    }
  },
  EventDispatcher: class {
    register(handlers: Record<string, (payload: unknown) => void>) {
      dispatchers.push(handlers)
      return { handlers }
    }
  },
  WSClient: class {
    private readonly entry: (typeof sockets)[number]

    constructor(config: Record<string, unknown>) {
      this.entry = { config, started: false, closed: false, handlers: dispatchers.at(-1) ?? {} }
      sockets.push(this.entry)
    }

    start(): Promise<void> {
      this.entry.started = true
      return Promise.resolve()
    }

    close(): void {
      this.entry.closed = true
    }
  },
}))

/** The socket the connector built last; the mock always records one. */
function lastSocket(): (typeof sockets)[number] {
  const socket = sockets.at(-1)
  if (socket === undefined) throw new Error('the connector built no socket')
  return socket
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { appId: APP_ID, domain: 'feishu', appSecretRef: 'FEISHU_APP_SECRET', ...overrides }
}

/** One `im.message.receive_v1` event carrying a text body. */
function event(text = 'hello'): unknown {
  return {
    sender: { sender_id: { open_id: 'ou-test' } },
    message: {
      message_id: 'msg-1',
      chat_id: 'oc-test',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text }),
    },
  }
}

/** A context carrying the channel registry and one seeded credential storage. */
async function open(seed: Record<string, string> = { FEISHU_APP_SECRET: 'app-secret' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

describe('plugin declaration', () => {
  it('registers under its own name and declares the services it reads', () => {
    expect(name).toBe('channel-feishu')
    expect(inject).toEqual(['chatChannels', 'credentials'])
  })

  it('defaults every field to empty except the deployment, which has a working default', () => {
    expect(Config({})).toEqual({ appId: '', domain: 'feishu', appSecretRef: '' })
    expect(Config({ appId: APP_ID, domain: 'lark', appSecretRef: 'FEISHU_APP_SECRET' })).toEqual({
      appId: APP_ID,
      domain: 'lark',
      appSecretRef: 'FEISHU_APP_SECRET',
    })
  })
})

describe('createFeishuConnector', () => {
  it('declares the feishu channel, its capabilities, and its settings namespace', async () => {
    const connector = createFeishuConnector(await open())

    expect(connector.channel).toBe('feishu')
    expect(connector.settings.namespace).toBe('chat-channel-feishu')
    expect(connector.settings.schema).toBe(Config)
    expect(connector.settings.credentialFields).toEqual(['appSecretRef'])
    expect(connector.settings.base).toEqual({})
    expect(connector.capabilities.maxTextChars).toBe(30_000)
  })

  it('layers the plugin configuration under the user section', async () => {
    const connector = createFeishuConnector(await open(), { appId: APP_ID })
    expect(connector.settings.base).toEqual({ appId: APP_ID })
  })

  it('builds a client over an SDK client built from the resolved secret', async () => {
    const connector = createFeishuConnector(await open())

    const client = await connector.createClient(section())

    expect(client).toBeInstanceOf(FeishuChatClient)
    expect(clients.at(-1)).toEqual({
      appId: APP_ID,
      appSecret: 'app-secret',
      appType: 0,
      domain: 'https://open.feishu.cn',
    })
  })

  it('signs in to the Lark deployment when the section names it', async () => {
    const connector = createFeishuConnector(await open())

    await connector.createClient(section({ domain: 'lark' }))

    expect(clients.at(-1)).toMatchObject({ domain: 'https://open.larksuite.com' })
  })

  it('refuses a reference name the credential grammar rejects', async () => {
    const connector = createFeishuConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'not a reference' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'appSecretRef',
        message: 'not a reference is not a credential reference name',
      }))
  })

  it('refuses a well-formed reference with nothing stored behind it', async () => {
    const connector = createFeishuConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'FEISHU_ABSENT_SECRET' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'appSecretRef',
        message: 'no credential is configured for FEISHU_ABSENT_SECRET',
      }))
  })

  it('refuses a section missing a required field before resolving any credential', async () => {
    const connector = createFeishuConnector(await open())

    await expect(connector.createClient({ domain: 'feishu', appSecretRef: 'FEISHU_APP_SECRET' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
  })

  it('streams normalized inbound messages and reports the socket as ready', async () => {
    const connector = createFeishuConnector(await open())
    const seen: ChatInboundMessage[] = []
    let ready = 0
    const handlers: ChatConnectorHandlers = {
      onMessage: (message) => { seen.push(message) },
      onReady: () => { ready += 1 },
    }

    const connection = await connector.connect(section(), handlers)
    const socket = lastSocket()
    expect(socket.started).toBe(true)
    expect(socket.config).toMatchObject({
      appId: APP_ID,
      appSecret: 'app-secret',
      domain: 'https://open.feishu.cn',
      loggerLevel: 'error',
    })

    socket.handlers['im.message.receive_v1']?.(event())
    expect(seen).toEqual([{
      chatId: 'oc-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
    }])

    // A payload the connector cannot read is dropped rather than forwarded.
    socket.handlers['im.message.receive_v1']?.({})
    expect(seen).toHaveLength(1)

    const onReady = socket.config['onReady'] as () => void
    const onReconnected = socket.config['onReconnected'] as () => void
    onReady()
    onReconnected()
    expect(ready).toBe(2)

    connection.close()
    expect(socket.closed).toBe(true)
  })

  it('opens the socket against the Lark deployment when the section names it', async () => {
    const connector = createFeishuConnector(await open())

    await connector.connect(section({ domain: 'lark' }), { onMessage: () => {} })

    expect(lastSocket().config).toMatchObject({ domain: 'https://open.larksuite.com' })
  })

  it('forwards a socket failure to the caller', async () => {
    const connector = createFeishuConnector(await open())
    const failures: unknown[] = []

    await connector.connect(section(), {
      onMessage: () => {},
      onError: (error) => { failures.push(error) },
    })

    const failure = new Error('socket dropped')
    const onError = lastSocket().config['onError'] as (error: Error) => void
    onError(failure)
    expect(failures).toEqual([failure])
  })

  it('connects without a ready or error handler, which the seam leaves optional', async () => {
    const connector = createFeishuConnector(await open())

    const connection = await connector.connect(section(), { onMessage: () => {} })
    const socket = lastSocket()
    expect(socket.started).toBe(true)

    const onReady = socket.config['onReady'] as () => void
    const onReconnected = socket.config['onReconnected'] as () => void
    const onError = socket.config['onError'] as (error: Error) => void
    onReady()
    onReconnected()
    onError(new Error('dropped'))

    connection.close()
    expect(socket.closed).toBe(true)
  })
})

describe('apply', () => {
  it('registers exactly one connector with the channel registry', async () => {
    const ctx = await open()

    apply(ctx, {})

    expect(ctx.chatChannels.list().map(connector => connector.channel)).toEqual(['feishu'])
    // A lookup by the literal id is what holds this provider's merged channel id in place.
    expect(ctx.chatChannels.get('feishu')).toMatchObject({ channel: 'feishu' })
  })
})

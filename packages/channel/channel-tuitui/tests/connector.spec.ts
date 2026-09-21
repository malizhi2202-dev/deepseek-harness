/**
 * Pins the Tuitui channel connector: the plugin's name, injections, and
 * all-empty configuration defaults; the credential reference the settings
 * section names resolved per client and per connection, so the transport is
 * built from the secret rather than from the reference; the inbound stream
 * normalized onto the seam's handlers with `onReady` optional; and `apply`
 * registering exactly one connector with the channel registry.
 *
 * The transport is faked at the wire boundary by replacing the package that
 * builds the real WebSocket and HTTP client, so no socket is ever opened.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers, ChatInboundMessage } from '@deepseek-ai/dsh-channel'
import type { IncomingMessage } from '@deepseek-ai/dsh-tuitui'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import {
  Config,
  TUITUI_CAPABILITIES,
  TuituiChatClient,
  apply,
  createTuituiConnector,
  inject,
  name,
} from '../src/index.ts'

/** Every transport the connector built, in construction order. */
const built = vi.hoisted(() => [] as Array<{
  appId: string
  appSecret: string
  host: string
  connected: boolean
  disconnected: boolean
  deliver: ((message: unknown) => void) | undefined
}>)

vi.mock('@deepseek-ai/dsh-tuitui', () => ({
  TuituiClient: class {
    private readonly entry: (typeof built)[number]

    constructor(appId: string, appSecret: string, host: string) {
      this.entry = { appId, appSecret, host, connected: false, disconnected: false, deliver: undefined }
      built.push(this.entry)
    }

    onMessage(handler: (message: unknown) => void): void {
      this.entry.deliver = handler
    }

    connect(): Promise<void> {
      this.entry.connected = true
      return Promise.resolve()
    }

    disconnect(): Promise<void> {
      this.entry.disconnected = true
      return Promise.resolve()
    }
  },
}))

/** The transport the connector built last; the mock always records one. */
function lastTransport(): (typeof built)[number] {
  const transport = built.at(-1)
  if (transport === undefined) throw new Error('the connector built no transport')
  return transport
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { host: 'im.invalid', appId: 'app-test', appSecretRef: 'TUITUI_APP_SECRET', ...overrides }
}

/** One normalized transport message, group-shaped unless a test says otherwise. */
function inbound(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: '1000000000000001',
    chatType: 'group',
    chatName: 'Test Group',
    userId: 'user-test',
    userName: 'Test User',
    messageId: 'msg-1',
    text: 'hello',
    mediaUrls: [],
    raw: {},
    ...overrides,
  }
}

/** A context carrying the channel registry and one seeded credential storage. */
async function open(seed: Record<string, string> = { TUITUI_APP_SECRET: 'app-test-secret' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

describe('plugin declaration', () => {
  it('registers under its own name and declares the services it reads', () => {
    expect(name).toBe('channel-tuitui')
    expect(inject).toEqual(['chatChannels', 'credentials'])
  })

  it('defaults every configuration field to empty rather than to a working value', () => {
    expect(Config({})).toEqual({ host: '', appId: '', appSecretRef: '' })
    expect(Config({ host: 'im.invalid', appId: 'app-test', appSecretRef: 'TUITUI_APP_SECRET' })).toEqual({
      host: 'im.invalid',
      appId: 'app-test',
      appSecretRef: 'TUITUI_APP_SECRET',
    })
  })
})

describe('createTuituiConnector', () => {
  it('declares the tuitui channel, its capabilities, and its settings namespace', async () => {
    const connector = createTuituiConnector(await open())

    expect(connector.channel).toBe('tuitui')
    expect(connector.capabilities).toBe(TUITUI_CAPABILITIES)
    expect(connector.settings.namespace).toBe('chat-channel-tuitui')
    expect(connector.settings.schema).toBe(Config)
    expect(connector.settings.credentialFields).toEqual(['appSecretRef'])
    expect(connector.settings.base).toEqual({})
  })

  it('layers the plugin configuration under the user section', async () => {
    const connector = createTuituiConnector(await open(), { host: 'im.invalid' })
    expect(connector.settings.base).toEqual({ host: 'im.invalid' })
  })

  it('builds a client over a transport built from the resolved secret', async () => {
    const connector = createTuituiConnector(await open(), { host: 'im.invalid' })

    const client = await connector.createClient(section())

    expect(client).toBeInstanceOf(TuituiChatClient)
    expect(lastTransport()).toMatchObject({
      appId: 'app-test',
      appSecret: 'app-test-secret',
      host: 'im.invalid',
    })
    await expect(client.checkCredentials()).resolves.toEqual({
      accountLabel: 'app app-test',
      details: ['host im.invalid'],
    })
  })

  it('refuses a reference name the credential grammar rejects', async () => {
    const connector = createTuituiConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'not a reference' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'appSecretRef',
        message: 'not a reference is not a credential reference name',
      }))
  })

  it('refuses a well-formed reference with nothing stored behind it', async () => {
    const connector = createTuituiConnector(await open())

    await expect(connector.createClient(section({ appSecretRef: 'TUITUI_ABSENT_SECRET' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'appSecretRef',
        message: 'no credential is configured for TUITUI_ABSENT_SECRET',
      }))
  })

  it('refuses a section missing a required field before resolving any credential', async () => {
    const connector = createTuituiConnector(await open())

    await expect(connector.createClient({ host: 'im.invalid', appId: 'app-test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appSecretRef' }))
  })

  it('streams normalized inbound messages and reports the running loop as ready', async () => {
    const connector = createTuituiConnector(await open())
    const seen: ChatInboundMessage[] = []
    let ready = 0
    const handlers: ChatConnectorHandlers = {
      onMessage: (message) => { seen.push(message) },
      onReady: () => { ready += 1 },
    }

    const connection = await connector.connect(section(), handlers)
    const transport = lastTransport()
    expect(transport).toMatchObject({
      appId: 'app-test',
      appSecret: 'app-test-secret',
      host: 'im.invalid',
      connected: true,
    })

    transport.deliver?.(inbound({ chatType: 'dm', chatId: 'user-test' }))
    expect(seen).toEqual([{
      chatId: 'user-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Test User',
    }])
    expect(ready).toBe(1)

    connection.close()
    await Promise.resolve()
    expect(transport.disconnected).toBe(true)
  })

  it('connects without a ready handler, which the seam leaves optional', async () => {
    const connector = createTuituiConnector(await open())

    const connection = await connector.connect(section(), { onMessage: () => {} })
    const transport = lastTransport()
    expect(transport.connected).toBe(true)

    connection.close()
    await Promise.resolve()
    expect(transport.disconnected).toBe(true)
  })
})

describe('apply', () => {
  it('registers the tuitui connector with the channel registry', async () => {
    const ctx = await open()

    apply(ctx, { host: 'im.invalid', appId: 'app-test', appSecretRef: 'TUITUI_APP_SECRET' })

    expect(ctx.chatChannels.list()).toHaveLength(1)
    expect(ctx.chatChannels.get('tuitui')).toMatchObject({
      channel: 'tuitui',
      capabilities: TUITUI_CAPABILITIES,
      settings: { base: { host: 'im.invalid', appId: 'app-test', appSecretRef: 'TUITUI_APP_SECRET' } },
    })
  })
})

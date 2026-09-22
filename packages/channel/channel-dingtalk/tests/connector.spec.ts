/**
 * Pins the DingTalk channel connector: the plugin's name, injections, and
 * all-empty configuration defaults; the credential reference the settings
 * section names resolved per client and per connection, so the Stream client is
 * built from the secret rather than from the reference; the robot callback
 * normalized onto the seam's handlers with the session webhook recorded for the
 * outbound client; the socket's own state reported as ready or failed; and
 * `apply` registering exactly one connector with the channel registry.
 *
 * The SDK is faked at the wire boundary by replacing the package that builds the
 * real Stream client, so no socket is ever opened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers, ChatInboundMessage } from '@deepseek-ai/dsh-channel'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { Config, DingTalkChatClient, apply, createDingTalkConnector, inject, name } from '../src/index.ts'

/** Mutable knobs the faked Stream client reads, which a test sets before connecting. */
const state = vi.hoisted(() => ({ failConnect: false }))

/** Every Stream client the connector built, in construction order. */
const streams = vi.hoisted(() => [] as Array<{
  config: Record<string, unknown>
  connected: boolean
  disconnected: boolean
  deliver: ((message: unknown) => { status: string }) | undefined
}>)

vi.mock('dingtalk-stream', () => ({
  EventAck: { SUCCESS: 'SUCCESS', LATER: 'LATER' },
  DWClient: class {
    private readonly entry: (typeof streams)[number]

    constructor(config: Record<string, unknown>) {
      this.entry = { config, connected: false, disconnected: false, deliver: undefined }
      streams.push(this.entry)
    }

    get connected(): boolean {
      return this.entry.connected
    }

    getAccessToken(): Promise<string> {
      return Promise.resolve('token')
    }

    registerAllEventListener(handler: (message: unknown) => { status: string }): void {
      this.entry.deliver = handler
    }

    connect(): Promise<void> {
      this.entry.connected = !state.failConnect
      return Promise.resolve()
    }

    disconnect(): void {
      this.entry.connected = false
      this.entry.disconnected = true
    }
  },
}))

/** The Stream client the connector built last; the mock always records one. */
function lastStream(): (typeof streams)[number] {
  const stream = streams.at(-1)
  if (stream === undefined) throw new Error('the connector built no Stream client')
  return stream
}

/** One Stream message carrying a robot callback. */
function message(overrides: Record<string, unknown> = {}): unknown {
  return {
    headers: { messageId: 'stream-1' },
    data: JSON.stringify({
      msgId: 'msg-1',
      conversationId: 'cid-1',
      conversationType: '2',
      msgtype: 'text',
      text: { content: 'hello' },
      senderNick: 'Test User',
      sessionWebhook: 'https://example.invalid/hook',
      sessionWebhookExpiredTime: Date.now() + 60_000,
      ...overrides,
    }),
  }
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { clientId: 'ding-app-key', clientSecretRef: 'DINGTALK_CLIENT_SECRET', ...overrides }
}

/** A context carrying the channel registry and one seeded credential storage. */
async function open(seed: Record<string, string> = { DINGTALK_CLIENT_SECRET: 'client-secret' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

afterEach(() => {
  state.failConnect = false
})

describe('plugin declaration', () => {
  it('registers under its own name and declares the services it reads', () => {
    expect(name).toBe('channel-dingtalk')
    expect(inject).toEqual(['chatChannels', 'credentials'])
  })

  it('defaults every configuration field to empty rather than to a working value', () => {
    expect(Config({})).toEqual({ clientId: '', clientSecretRef: '' })
    expect(Config({ clientId: 'ding-app-key', clientSecretRef: 'DINGTALK_CLIENT_SECRET' })).toEqual({
      clientId: 'ding-app-key',
      clientSecretRef: 'DINGTALK_CLIENT_SECRET',
    })
  })
})

describe('createDingTalkConnector', () => {
  it('declares the dingtalk channel, its capabilities, and its settings namespace', async () => {
    const connector = createDingTalkConnector(await open())

    expect(connector.channel).toBe('dingtalk')
    expect(connector.settings.namespace).toBe('chat-channel-dingtalk')
    expect(connector.settings.schema).toBe(Config)
    expect(connector.settings.credentialFields).toEqual(['clientSecretRef'])
    expect(connector.settings.base).toEqual({})
    expect(connector.capabilities.markdown).toBe(true)
    expect(connector.capabilities.quoting).toBe(false)
  })

  it('layers the plugin configuration under the user section', async () => {
    const connector = createDingTalkConnector(await open(), { clientId: 'ding-app-key' })
    expect(connector.settings.base).toEqual({ clientId: 'ding-app-key' })
  })

  it('builds a client over a Stream client built from the resolved secret', async () => {
    const connector = createDingTalkConnector(await open())

    const client = await connector.createClient(section())

    expect(client).toBeInstanceOf(DingTalkChatClient)
    expect(lastStream().config).toEqual({ clientId: 'ding-app-key', clientSecret: 'client-secret' })
    await expect(client.checkCredentials()).resolves.toEqual({ accountLabel: 'app ding-app-key' })
  })

  it('refuses a reference name the credential grammar rejects', async () => {
    const connector = createDingTalkConnector(await open())

    await expect(connector.createClient(section({ clientSecretRef: 'not a reference' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'clientSecretRef',
        message: 'not a reference is not a credential reference name',
      }))
  })

  it('refuses a well-formed reference with nothing stored behind it', async () => {
    const connector = createDingTalkConnector(await open())

    await expect(connector.createClient(section({ clientSecretRef: 'DINGTALK_ABSENT_SECRET' })))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'clientSecretRef',
        message: 'no credential is configured for DINGTALK_ABSENT_SECRET',
      }))
  })

  it('refuses a section missing a required field before resolving any credential', async () => {
    const connector = createDingTalkConnector(await open())

    await expect(connector.createClient({ clientSecretRef: 'DINGTALK_CLIENT_SECRET' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'clientId' }))
  })

  it('streams normalized inbound messages, records the webhook, and reports the socket as ready', async () => {
    const connector = createDingTalkConnector(await open())
    const seen: ChatInboundMessage[] = []
    let ready = 0
    const handlers: ChatConnectorHandlers = {
      onMessage: (inbound) => { seen.push(inbound) },
      onReady: () => { ready += 1 },
    }

    const connection = await connector.connect(section(), handlers)
    const stream = lastStream()
    expect(stream.connected).toBe(true)
    expect(stream.config).toEqual({ clientId: 'ding-app-key', clientSecret: 'client-secret' })
    expect(ready).toBe(1)

    const ack = stream.deliver?.(message())
    expect(ack).toEqual({ status: 'SUCCESS' })
    expect(seen).toEqual([{
      chatId: 'cid-1',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Test User',
    }])

    connection.close()
    expect(stream.disconnected).toBe(true)
  })

  it('acknowledges a callback it cannot read without forwarding anything', async () => {
    const connector = createDingTalkConnector(await open())
    const seen: ChatInboundMessage[] = []

    await connector.connect(section(), { onMessage: (inbound) => { seen.push(inbound) } })
    const stream = lastStream()

    expect(stream.deliver?.({ headers: { messageId: 'stream-1' }, data: 'not json' }))
      .toEqual({ status: 'SUCCESS' })
    expect(seen).toEqual([])
  })

  it('reports a connection the platform never opened as a failure', async () => {
    state.failConnect = true
    const connector = createDingTalkConnector(await open())
    const failures: unknown[] = []

    await connector.connect(section(), {
      onMessage: () => {},
      onError: (error) => { failures.push(error) },
    })

    expect(lastStream().connected).toBe(false)
    expect(failures).toEqual([new Error('DingTalk refused the Stream connection')])
  })

  it('connects without a ready or error handler, which the seam leaves optional', async () => {
    const connector = createDingTalkConnector(await open())

    const connection = await connector.connect(section(), { onMessage: () => {} })
    expect(lastStream().connected).toBe(true)
    connection.close()

    state.failConnect = true
    const failed = await connector.connect(section(), { onMessage: () => {} })
    expect(lastStream().connected).toBe(false)
    failed.close()
  })
})

describe('apply', () => {
  it('registers exactly one connector with the channel registry', async () => {
    const ctx = await open()

    apply(ctx, {})

    expect(ctx.chatChannels.list().map(connector => connector.channel)).toEqual(['dingtalk'])
    // A lookup by the literal id is what holds this provider's merged channel id in place.
    expect(ctx.chatChannels.get('dingtalk')).toMatchObject({ channel: 'dingtalk' })
  })
})

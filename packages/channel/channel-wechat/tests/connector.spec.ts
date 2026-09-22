/**
 * Pins the WeChat channel connector: the plugin's name, injections, and
 * all-empty configuration defaults; the credential reference the settings
 * section names resolved per client and per connection; the QR sign-in flow
 * available before any token exists; the long-poll stream normalized onto the
 * seam's handlers with the conversation token remembered for the reply; a failed
 * poll reported and retried at the platform's own paces; `close` ending the loop;
 * and `apply` registering exactly one connector with the channel registry.
 *
 * The transfer is faked at the global boundary, so no request is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers, ChatInboundMessage } from '@deepseek-ai/dsh-channel'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { WECHAT_CAPABILITIES, WechatChatClient } from '../src/client.ts'
import { WechatSignIn } from '../src/signin.ts'
import { Config, apply, createWechatConnector, inject, name } from '../src/index.ts'

/** A transfer stub whose answers the test scripts by call number. */
class Transfer {
  calls = 0

  constructor(private readonly answers: Array<() => Response | Promise<Response>>) {}

  readonly mock = vi.fn<typeof fetch>(() => {
    const answer = this.answers[Math.min(this.calls, this.answers.length - 1)]
    this.calls += 1
    if (answer === undefined) throw new Error('the test scripted no answer')
    return Promise.resolve(answer())
  })
}

/** A JSON response for the stubbed transfer. */
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** The address one stubbed transfer was sent to, in whichever form the connector passed it. */
function calledUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href
  return input instanceof Request ? input.url : input
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { tokenRef: 'WECHAT_BOT_TOKEN', ...overrides }
}

/** A context carrying the channel registry and one seeded credential storage. */
async function open(seed: Record<string, string> = { WECHAT_BOT_TOKEN: 'bot-token-1' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

/** One raw platform message. */
function rawMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: 'msg-1',
    from_user_id: 'peer-1',
    context_token: 'context-1',
    message_type: 1,
    item_list: [{ type: 1, text_item: { text: 'hello' } }],
    ...overrides,
  }
}

/** Let the stream's pending poll and its handlers run. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

describe('plugin declaration', () => {
  it('registers under its own name and declares the services it reads', () => {
    expect(name).toBe('channel-wechat')
    expect(inject).toEqual(['chatChannels', 'credentials'])
  })

  it('defaults every configuration field to empty rather than to a working value', () => {
    expect(Config({})).toEqual({ baseUrl: '', tokenRef: '', botAgent: '' })
    expect(Config({ baseUrl: 'https://ilinkai.invalid', tokenRef: 'WECHAT_BOT_TOKEN', botAgent: 'Other' })).toEqual({
      baseUrl: 'https://ilinkai.invalid',
      tokenRef: 'WECHAT_BOT_TOKEN',
      botAgent: 'Other',
    })
  })
})

describe('createWechatConnector', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('declares the wechat channel, its capabilities, and its settings namespace', async () => {
    const connector = createWechatConnector(await open())

    expect(connector.channel).toBe('wechat')
    expect(connector.capabilities).toBe(WECHAT_CAPABILITIES)
    expect(connector.settings.namespace).toBe('chat-channel-wechat')
    expect(connector.settings.schema).toBe(Config)
    expect(connector.settings.credentialFields).toEqual(['tokenRef'])
    expect(connector.settings.base).toEqual({})
  })

  it('layers the plugin configuration under the user section', async () => {
    const connector = createWechatConnector(await open(), { botAgent: 'Other' })
    expect(connector.settings.base).toEqual({ botAgent: 'Other' })
  })

  it('builds a client over a wire built from the resolved token', async () => {
    const connector = createWechatConnector(await open())

    const client = await connector.createClient(section())

    expect(client).toBeInstanceOf(WechatChatClient)
    await expect(client.checkCredentials()).resolves.toEqual({
      accountLabel: 'wechat bot at https://ilinkai.weixin.qq.com',
      details: ['token reference WECHAT_BOT_TOKEN'],
    })
  })

  it('offers the QR sign-in before any token exists', async () => {
    const connector = createWechatConnector(await open({}))

    expect(connector.signIn(section({ tokenRef: '' }))).toBeInstanceOf(WechatSignIn)
  })

  it('refuses a reference name the credential grammar rejects', async () => {
    const connector = createWechatConnector(await open())

    await expect(connector.createClient(section({ tokenRef: 'not a reference' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
  })

  it('refuses a well-formed reference with nothing stored behind it', async () => {
    const connector = createWechatConnector(await open())

    await expect(connector.createClient(section({ tokenRef: 'WECHAT_ABSENT_TOKEN' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
  })

  it('refuses a section missing a required field before resolving any credential', async () => {
    const connector = createWechatConnector(await open())

    await expect(connector.createClient({}))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
  })

  it('streams normalized inbound messages, remembers the conversation token, and reports ready', async () => {
    const transfer = new Transfer([
      () => json({ ret: 0, msgs: [rawMessage()], get_updates_buf: 'cursor-2', longpolling_timeout_ms: 20_000 }),
      () => json({ ret: 0 }),
    ])
    vi.stubGlobal('fetch', transfer.mock)
    const connector = createWechatConnector(await open())
    const seen: ChatInboundMessage[] = []
    let ready = 0
    const handlers: ChatConnectorHandlers = {
      onMessage: (inbound) => { seen.push(inbound) },
      onReady: () => { ready += 1 },
    }

    const connection = await connector.connect(section(), handlers)
    await flush()

    expect(seen).toEqual([{
      chatId: 'peer-1',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
    }])
    expect(ready).toBe(1)

    const client = await connector.createClient(section())
    await client.sendText('peer-1' as never, 'hi')
    const sent = transfer.mock.mock.calls.find(([input]) => calledUrl(input).includes('/sendmessage'))
    expect(sent).toBeDefined()

    await vi.advanceTimersByTimeAsync(1000)
    connection.close()
    await vi.advanceTimersByTimeAsync(1000)
  })

  it('reports a failed poll, backs off, and reports ready again once it recovers', async () => {
    const transfer = new Transfer([
      () => { throw new Error('the network is down') },
      () => json({ ret: 0 }),
    ])
    vi.stubGlobal('fetch', transfer.mock)
    const connector = createWechatConnector(await open())
    const errors: unknown[] = []
    let ready = 0

    const connection = await connector.connect(section(), {
      onMessage: () => {},
      onReady: () => { ready += 1 },
      onError: (error) => { errors.push(error) },
    })
    await flush()
    expect(errors).toEqual([expect.objectContaining({ message: 'the network is down' })])
    expect(ready).toBe(0)

    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(ready).toBe(1)

    connection.close()
    await vi.advanceTimersByTimeAsync(1000)
  })

  it('waits longer after several consecutive failures', async () => {
    const transfer = new Transfer([() => { throw new Error('the network is down') }])
    vi.stubGlobal('fetch', transfer.mock)
    const connector = createWechatConnector(await open())
    const errors: unknown[] = []

    const connection = await connector.connect(section(), { onMessage: () => {}, onError: (error) => { errors.push(error) } })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(errors).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(29_000)
    expect(errors).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(errors).toHaveLength(4)

    connection.close()
  })

  it('ends the loop without reporting a failure when it is closed mid-poll', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      })
    })))
    const connector = createWechatConnector(await open())
    const errors: unknown[] = []

    const connection = await connector.connect(section(), { onMessage: () => {}, onError: (error) => { errors.push(error) } })
    await flush()
    connection.close()
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(errors).toEqual([])
  })

  it('connects without the ready and error handlers, which the seam leaves optional', async () => {
    const transfer = new Transfer([() => json({ ret: 0, msgs: [rawMessage({ message_type: 2 })] })])
    vi.stubGlobal('fetch', transfer.mock)
    const connector = createWechatConnector(await open())

    const connection = await connector.connect(section(), { onMessage: () => {} })
    await flush()
    connection.close()
    await vi.advanceTimersByTimeAsync(1000)

    expect(transfer.calls).toBe(1)
  })

  it('stops polling once the connection is closed', async () => {
    const transfer = new Transfer([() => json({ ret: 0 })])
    vi.stubGlobal('fetch', transfer.mock)
    const connector = createWechatConnector(await open())

    const connection = await connector.connect(section(), { onMessage: () => {} })
    await flush()
    connection.close()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(transfer.calls).toBe(1)
  })
})

describe('apply', () => {
  it('registers the wechat connector with the channel registry', async () => {
    const ctx = await open()

    apply(ctx, { tokenRef: 'WECHAT_BOT_TOKEN' })

    expect(ctx.chatChannels.list()).toHaveLength(1)
    expect(ctx.chatChannels.get('wechat')).toMatchObject({
      channel: 'wechat',
      capabilities: WECHAT_CAPABILITIES,
      settings: { base: { tokenRef: 'WECHAT_BOT_TOKEN' } },
    })
  })
})

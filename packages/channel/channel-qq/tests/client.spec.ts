/**
 * Pins the QQ side of the seam: the capability declaration, configuration
 * narrowing that refuses an absent or empty field by name and defaults the API
 * host only when it is empty, the conversation id carrying the send endpoint,
 * inbound normalization with lazy attachment handles, and the outbound client
 * that assigns one passive-reply sequence per chunk.
 */
import { describe, expect, it } from 'vitest'
import type { ChatChannelConfig, ChatId, ChatMessageId } from '@deepseek-ai/dsh-channel'
import {
  QQ_CAPABILITIES,
  QQ_MAX_TEXT_CHARS,
  QqChatClient,
  conversationId,
  parseConversationId,
  readInboundMessage,
  readQqConfig,
} from '../src/client.ts'
import type { QqAttachmentSource, QqSendTransport } from '../src/client.ts'
import { PassiveReplies } from '../src/replies.ts'

/** One message the stubbed transport sent. */
interface Sent {
  /** Which send endpoint was used. */
  readonly kind: 'group' | 'direct'
  /** The open id in the endpoint's path. */
  readonly openid: string
  /** The request body. */
  readonly body: Record<string, unknown>
}

/** A transport stub recording what the client sends. */
class StubTransport implements QqSendTransport {
  readonly sent: Sent[] = []
  probes = 0

  accessToken(): Promise<string> {
    this.probes += 1
    return Promise.resolve('token-1')
  }

  sendGroupMessage(groupOpenid: string, body: unknown): Promise<void> {
    this.sent.push({ kind: 'group', openid: groupOpenid, body: body as Record<string, unknown> })
    return Promise.resolve()
  }

  sendC2cMessage(userOpenid: string, body: unknown): Promise<void> {
    this.sent.push({ kind: 'direct', openid: userOpenid, body: body as Record<string, unknown> })
    return Promise.resolve()
  }
}

/** An attachment source that records the URLs it was asked for. */
class StubSource implements QqAttachmentSource {
  readonly asked: string[] = []

  download(url: string, maxBytes: number): Promise<Uint8Array> {
    this.asked.push(`${url}@${String(maxBytes)}`)
    return Promise.resolve(new Uint8Array([1, 2, 3]))
  }
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { appId: 'app-test', appSecretRef: 'QQ_APP_SECRET', ...overrides }
}

/** One gateway event body, single-chat shaped unless a test says otherwise. */
function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    content: 'hello',
    author: { user_openid: 'peer-1', username: 'Test User' },
    timestamp: '2026-09-21T00:00:00Z',
    ...overrides,
  }
}

describe('QQ_CAPABILITIES', () => {
  it('declares what QQ carries and what it does not', () => {
    expect(QQ_CAPABILITIES).toEqual({
      quoting: false,
      inbound: { images: true, files: true },
      outbound: { images: false, files: false },
      markdown: false,
    })
  })
})

describe('readQqConfig', () => {
  it('reads the fields it needs and defaults the host only when it is empty', () => {
    expect(readQqConfig(section())).toEqual({
      appId: 'app-test',
      appSecretRef: 'QQ_APP_SECRET',
      apiBaseUrl: 'https://api.bot.qq.com',
    })
    expect(readQqConfig(section({ apiBaseUrl: 'https://sandbox.invalid' })).apiBaseUrl).toBe('https://sandbox.invalid')
    expect(readQqConfig(section({ apiBaseUrl: 7 })).apiBaseUrl).toBe('https://api.bot.qq.com')
  })

  it('refuses an absent or empty required field by name', () => {
    expect(() => readQqConfig({ appSecretRef: 'QQ_APP_SECRET' }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
    expect(() => readQqConfig({ appId: 'app-test', appSecretRef: 7 }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appSecretRef' }))
    expect(() => readQqConfig({ appId: '', appSecretRef: 'QQ_APP_SECRET' }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
  })
})

describe('conversation ids', () => {
  it('round-trips a conversation through its id', () => {
    expect(parseConversationId(conversationId('group', 'g1'))).toEqual({ kind: 'group', openid: 'g1' })
    expect(parseConversationId(conversationId('direct', 'peer:1'))).toEqual({ kind: 'direct', openid: 'peer:1' })
  })

  it('refuses an id it did not mint', () => {
    expect(parseConversationId('nope')).toBeUndefined()
    expect(parseConversationId('tuitui:peer-1')).toBeUndefined()
    expect(parseConversationId('group:')).toBeUndefined()
  })
})

describe('readInboundMessage', () => {
  it('normalizes a group at-message', () => {
    const message = readInboundMessage('GROUP_AT_MESSAGE_CREATE', event({
      group_openid: 'g1',
      author: { member_openid: 'member-1', username: 'Member' },
    }), new StubSource())

    expect(message).toEqual({
      chatId: 'group:g1',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Member',
    })
  })

  it('normalizes a single-chat message and trims its text', () => {
    const message = readInboundMessage('C2C_MESSAGE_CREATE', event({ content: '  hi  ' }), new StubSource())
    expect(message).toMatchObject({ chatId: 'direct:peer-1', chatKind: 'direct', text: 'hi' })
  })

  it('falls back to the author id when the kind-specific open id is absent', () => {
    const message = readInboundMessage('GROUP_MESSAGE_CREATE', event({
      group_openid: 'g1',
      author: { id: 'member-1' },
    }), new StubSource())
    expect(message).toMatchObject({ chatId: 'group:g1' })
    expect(message?.senderName).toBeUndefined()
  })

  it('carries no text when the message carried only whitespace', () => {
    const message = readInboundMessage('C2C_MESSAGE_CREATE', event({ content: '   ' }), new StubSource())
    expect(message?.text).toBeNull()
  })

  it('admits no event this channel does not carry', () => {
    const source = new StubSource()
    expect(readInboundMessage('READY', event(), source)).toBeNull()
    expect(readInboundMessage('C2C_MESSAGE_CREATE', 'not an object', source)).toBeNull()
    expect(readInboundMessage('C2C_MESSAGE_CREATE', event({ author: null }), source)).toBeNull()
    expect(readInboundMessage('C2C_MESSAGE_CREATE', event({ id: '' }), source)).toBeNull()
    expect(readInboundMessage('GROUP_AT_MESSAGE_CREATE', event({ group_openid: '' }), source)).toBeNull()
    expect(readInboundMessage('C2C_MESSAGE_CREATE', event({ author: { user_openid: '' } }), source)).toBeNull()
  })

  it('builds an image handle and a file handle from the attachments', async () => {
    const source = new StubSource()
    const message = readInboundMessage('C2C_MESSAGE_CREATE', event({
      attachments: [
        { url: 'https://cdn.invalid/a.png', content_type: 'image/png', filename: 'a.png' },
        { url: 'https://cdn.invalid/b.zip', content_type: 'file', filename: 'b.zip' },
        { url: 'https://cdn.invalid/c.silk', content_type: 'voice' },
        { url: '', content_type: 'image/png' },
        null,
      ],
    }), source)

    await expect(message?.images?.[0]?.fetch(1024)).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' })
    await expect(message?.files?.[0]?.fetch(1024)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(message?.files?.[0]?.fileName).toBe('b.zip')
    expect(source.asked).toEqual(['https://cdn.invalid/a.png@1024', 'https://cdn.invalid/b.zip@1024'])
  })

  it('names an attachment the platform left unnamed', () => {
    const message = readInboundMessage('C2C_MESSAGE_CREATE', event({
      attachments: [{ url: 'https://cdn.invalid/b', content_type: 'file' }],
    }), new StubSource())
    expect(message?.files?.[0]?.fileName).toBe('file')
  })
})

describe('QqChatClient', () => {
  /** A client whose ledger already holds one received message. */
  function fixture(): { client: QqChatClient; api: StubTransport; replies: PassiveReplies; chat: ChatId } {
    const api = new StubTransport()
    const replies = new PassiveReplies(8)
    const chat = conversationId('group', 'g1')
    replies.remember(chat, 'msg-1')
    return { client: new QqChatClient(api, replies, readQqConfig(section())), api, replies, chat }
  }

  it('sends each chunk as the next passive reply to the newest message', async () => {
    const { client, api, chat } = fixture()

    await client.sendText(chat, 'a'.repeat(QQ_MAX_TEXT_CHARS + 1))

    expect(api.sent).toEqual([
      { kind: 'group', openid: 'g1', body: { content: 'a'.repeat(QQ_MAX_TEXT_CHARS), msg_type: 0, msg_id: 'msg-1', msg_seq: 1 } },
      { kind: 'group', openid: 'g1', body: { content: 'a', msg_type: 0, msg_id: 'msg-1', msg_seq: 2 } },
    ])
  })

  it('routes a single-chat conversation to the user endpoint', async () => {
    const api = new StubTransport()
    const replies = new PassiveReplies(8)
    const chat = conversationId('direct', 'peer-1')
    replies.remember(chat, 'msg-9')

    await new QqChatClient(api, replies, readQqConfig(section())).sendText(chat, 'hi')

    expect(api.sent).toEqual([
      { kind: 'direct', openid: 'peer-1', body: { content: 'hi', msg_type: 0, msg_id: 'msg-9', msg_seq: 1 } },
    ])
  })

  it('downgrades one reply requested as Markdown', async () => {
    const { client, api, chat } = fixture()

    await client.sendText(chat, '**bold**', { markdown: true })
    await client.sendText(chat, '**bold**', { markdown: false })

    expect(api.sent.map(sent => sent.body['content'])).toEqual(['bold', '**bold**'])
  })

  it('sends nothing, and consumes no sequence, for text that carries nothing', async () => {
    const { client, api, chat } = fixture()

    await client.sendText(chat, '   ')

    expect(api.sent).toEqual([])
  })

  it('refuses a conversation id it did not mint', async () => {
    const { client } = fixture()
    await expect(client.sendText('tuitui:peer-1' as ChatId, 'hi'))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
  })

  it('refuses a send with no received message left to ride on', async () => {
    const api = new StubTransport()
    const replies = new PassiveReplies(8)

    await expect(new QqChatClient(api, replies, readQqConfig(section())).sendText(conversationId('group', 'g1'), 'hi'))
      .rejects.toThrow('QQ accepts a group or single-chat message only as a reply to one it received in the last five minutes')
    expect(api.sent).toEqual([])
  })

  it('replies to the named message and advances its sequence', async () => {
    const { client, api } = fixture()

    await client.replyText('msg-1' as ChatMessageId, 'first')
    await client.replyText('msg-1' as ChatMessageId, 'second')

    expect(api.sent.map(sent => sent.body)).toEqual([
      { content: 'first', msg_type: 0, msg_id: 'msg-1', msg_seq: 1 },
      { content: 'second', msg_type: 0, msg_id: 'msg-1', msg_seq: 2 },
    ])
  })

  it('sends nothing for a reply that carries nothing', async () => {
    const { client, api } = fixture()

    await client.replyText('msg-1' as ChatMessageId, '   ')

    expect(api.sent).toEqual([])
  })

  it('refuses a reply to a message it never saw', async () => {
    const { client } = fixture()
    await expect(client.replyText('msg-absent' as ChatMessageId, 'hi'))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
  })

  it('refuses a reply whose ledger entry names a conversation it did not mint', async () => {
    const api = new StubTransport()
    const replies = new PassiveReplies(8)
    replies.remember('tuitui:peer-1', 'msg-1')

    await expect(new QqChatClient(api, replies, readQqConfig(section())).replyText('msg-1' as ChatMessageId, 'hi'))
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
  })

  it('refuses to send a file, which the capability declaration already excludes', async () => {
    const { client } = fixture()
    await expect(client.sendFile())
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
  })

  it('probes the credential pair by exchanging it for a token', async () => {
    const { client, api } = fixture()

    await expect(client.checkCredentials()).resolves.toEqual({
      accountLabel: 'QQ bot app-test',
      details: ['api https://api.bot.qq.com'],
    })
    expect(api.probes).toBe(1)
  })
})

/**
 * Pins the WeChat side of the seam: the capability declaration, configuration
 * narrowing that defaults only the fields a deployment may leave empty and
 * refuses an absent token reference by name, the conversation table's bound, the
 * media type read from an image's own signature, inbound normalization including
 * the kinds the seam cannot carry, and the outbound client that downgrades
 * Markdown before chunking and refuses the operations WeChat cannot perform.
 */
import { describe, expect, it } from 'vitest'
import type { ChatChannelConfig, ChatId } from '@deepseek-ai/dsh-channel'
import {
  WECHAT_CAPABILITIES,
  WECHAT_DEFAULT_BOT_AGENT,
  WECHAT_MAX_TEXT_CHARS,
  WechatChatClient,
  WechatConversations,
  readInboundMessage,
  readWechatConfig,
  readWechatHost,
  sniffImageMime,
} from '../src/client.ts'
import type { WechatMediaSource } from '../src/client.ts'
import type { WechatMediaRef } from '../src/wire.ts'

/** A media source recording what it was asked to fetch. */
class StubSource implements WechatMediaSource {
  readonly asked: Array<{ url: string; maxBytes: number }> = []

  constructor(private readonly data: Uint8Array = new Uint8Array([1, 2, 3])) {}

  download(ref: WechatMediaRef, maxBytes: number): Promise<Uint8Array> {
    this.asked.push({ url: ref.url, maxBytes })
    return Promise.resolve(this.data)
  }
}

/** A transport stub recording what the client sends. */
class StubTransport {
  readonly sent: Array<{ chatId: string; text: string; contextToken: string }> = []

  sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    this.sent.push({ chatId: toUserId, text, contextToken })
    return Promise.resolve()
  }
}

/** One resolved channel section carrying exactly the fields the connector reads. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { tokenRef: 'WECHAT_BOT_TOKEN', ...overrides }
}

/** One raw platform message, text-shaped unless a test says otherwise. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: 'msg-1',
    from_user_id: 'peer-1',
    context_token: 'context-1',
    message_type: 1,
    item_list: [{ type: 1, text_item: { text: 'hello' } }],
    ...overrides,
  }
}

describe('WECHAT_CAPABILITIES', () => {
  it('declares what WeChat carries and what it does not', () => {
    expect(WECHAT_CAPABILITIES).toEqual({
      quoting: false,
      inbound: { images: true, files: true },
      outbound: { images: false, files: false },
      markdown: false,
      maxTextChars: WECHAT_MAX_TEXT_CHARS,
      maxInboundBytes: 100 * 1024 * 1024,
    })
  })
})

describe('configuration narrowing', () => {
  it('defaults only the host and the announced name', () => {
    expect(readWechatHost(section())).toEqual({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      botAgent: WECHAT_DEFAULT_BOT_AGENT,
    })
    expect(readWechatHost(section({ baseUrl: 'https://ilinkai.invalid', botAgent: 'Other' }))).toEqual({
      baseUrl: 'https://ilinkai.invalid',
      botAgent: 'Other',
    })
    expect(readWechatHost({ baseUrl: 7, botAgent: 7 })).toEqual({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      botAgent: WECHAT_DEFAULT_BOT_AGENT,
    })
  })

  it('reads the token reference alongside the host fields', () => {
    expect(readWechatConfig(section())).toEqual({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      tokenRef: 'WECHAT_BOT_TOKEN',
      botAgent: WECHAT_DEFAULT_BOT_AGENT,
    })
  })

  it('refuses an absent or empty token reference by name', () => {
    expect(() => readWechatConfig({}))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
    expect(() => readWechatConfig({ tokenRef: '' }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
    expect(() => readWechatConfig({ tokenRef: 7 }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'tokenRef' }))
  })
})

describe('sniffImageMime', () => {
  it('reads the media type from the bytes themselves', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('image/gif')
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffImageMime(webp)).toBe('image/webp')
  })

  it('reports an unknown signature as an opaque byte stream', () => {
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream')
    expect(sniffImageMime(new Uint8Array())).toBe('application/octet-stream')
    const riffOnly = new Uint8Array(12)
    riffOnly.set([0x52, 0x49, 0x46, 0x46], 0)
    expect(sniffImageMime(riffOnly)).toBe('application/octet-stream')
  })
})

describe('WechatConversations', () => {
  it('answers with the newest token one conversation carried', () => {
    const conversations = new WechatConversations(8)
    conversations.remember('peer-1', 'context-1')
    expect(conversations.tokenFor('peer-1')).toBe('context-1')

    conversations.remember('peer-1', 'context-2')
    expect(conversations.tokenFor('peer-1')).toBe('context-2')
  })

  it('answers with nothing for a conversation it never saw', () => {
    expect(new WechatConversations(8).tokenFor('peer-1')).toBeUndefined()
  })

  it('forgets the least recently recorded conversation once it is full', () => {
    const conversations = new WechatConversations(2)
    conversations.remember('peer-1', 'context-1')
    conversations.remember('peer-2', 'context-2')
    conversations.remember('peer-1', 'context-3')
    conversations.remember('peer-3', 'context-4')

    expect(conversations.tokenFor('peer-1')).toBe('context-3')
    expect(conversations.tokenFor('peer-2')).toBeUndefined()
    expect(conversations.tokenFor('peer-3')).toBe('context-4')
  })
})

describe('readInboundMessage', () => {
  it('normalizes a text message and carries its context token', () => {
    expect(readInboundMessage(raw(), new StubSource())).toEqual({
      contextToken: 'context-1',
      message: {
        chatId: 'peer-1',
        chatKind: 'direct',
        messageId: 'msg-1',
        text: 'hello',
      },
    })
  })

  it('joins several text items with a newline', () => {
    const inbound = readInboundMessage(raw({
      item_list: [{ type: 1, text_item: { text: 'one' } }, { type: 1, text_item: { text: 'two' } }, { type: 1 }],
    }), new StubSource())
    expect(inbound?.message.text).toBe('one\ntwo')
  })

  it('carries no text for a message with no item the seam can read', () => {
    const inbound = readInboundMessage(raw({ item_list: [{ type: 9 }] }), new StubSource())
    expect(inbound?.message.text).toBeNull()
  })

  it('reduces a voice item to its transcript', () => {
    const inbound = readInboundMessage(raw({ item_list: [{ type: 3, voice_item: { text: 'spoken words' } }] }), new StubSource())
    expect(inbound?.message.text).toBe('spoken words')
  })

  it('keeps the first placeholder it found and ignores an item kind it does not know', () => {
    expect(readInboundMessage(raw({ item_list: [{ type: 5 }, { type: 9 }, { type: 'text' }] }), new StubSource())?.message.text)
      .toBe('[视频]')
  })

  it('reduces a media kind the seam cannot carry to a placeholder', () => {
    expect(readInboundMessage(raw({ item_list: [{ type: 3 }] }), new StubSource())?.message.text).toBe('[语音]')
    expect(readInboundMessage(raw({ item_list: [{ type: 5 }] }), new StubSource())?.message.text).toBe('[视频]')
  })

  it('builds an image handle whose media type comes from the bytes', async () => {
    const source = new StubSource(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const inbound = readInboundMessage(raw({
      item_list: [{ type: 2, image_item: { media: { full_url: 'https://cdn.invalid/a' }, aeskey: '00112233445566778899aabbccddeeff' } }],
    }), source)

    await expect(inbound?.message.images?.[0]?.fetch(1024)).resolves.toEqual({
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mime: 'image/png',
    })
    expect(source.asked).toEqual([{ url: 'https://cdn.invalid/a', maxBytes: 1024 }])
  })

  it('builds a file handle named the way the platform named it', async () => {
    const source = new StubSource()
    const inbound = readInboundMessage(raw({
      item_list: [{ type: 4, file_item: { media: { full_url: 'https://cdn.invalid/a.zip' }, file_name: 'a.zip' } }],
    }), source)

    await expect(inbound?.message.files?.[0]?.fetch(2048)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(inbound?.message.files?.[0]?.fileName).toBe('a.zip')
    expect(source.asked).toEqual([{ url: 'https://cdn.invalid/a.zip', maxBytes: 2048 }])
  })

  it('names an attachment the platform left unnamed', () => {
    const inbound = readInboundMessage(raw({ item_list: [{ type: 4, file_item: { media: { full_url: 'https://cdn.invalid/a' } } }] }), new StubSource())
    expect(inbound?.message.files?.[0]?.fileName).toBe('file')
  })

  it('drops an attachment item that names nothing to fetch', () => {
    const inbound = readInboundMessage(raw({
      item_list: [{ type: 2, image_item: {} }, { type: 4, file_item: {} }],
    }), new StubSource())
    expect(inbound?.message.images).toBeUndefined()
    expect(inbound?.message.files).toBeUndefined()
  })

  it('falls back to an item id when the message carried none', () => {
    const inbound = readInboundMessage(raw({ message_id: '', item_list: [{ type: 9, msg_id: 'item-1' }] }), new StubSource())
    expect(inbound?.message.messageId).toBe('item-1')
  })

  it('reports an empty message id when neither the message nor its items named one', () => {
    const inbound = readInboundMessage(raw({ message_id: '', item_list: [] }), new StubSource())
    expect(inbound?.message.messageId).toBe('')
  })

  it('admits no message the bot itself sent, and none without a sender', () => {
    const source = new StubSource()
    expect(readInboundMessage(raw({ message_type: 2 }), source)).toBeNull()
    expect(readInboundMessage(raw({ from_user_id: '' }), source)).toBeNull()
    expect(readInboundMessage(raw({ from_user_id: 7 }), source)).toBeNull()
    expect(readInboundMessage(null, source)).toBeNull()
    expect(readInboundMessage('nope', source)).toBeNull()
    expect(readInboundMessage(raw({ item_list: 'nope' }), source)?.message.text).toBeNull()
  })
})

describe('WechatChatClient', () => {
  /** A client whose conversation table already holds one token. */
  function fixture(): { client: WechatChatClient; transport: StubTransport; chat: ChatId } {
    const transport = new StubTransport()
    const conversations = new WechatConversations(8)
    conversations.remember('peer-1', 'context-1')
    return {
      client: new WechatChatClient(transport, conversations, readWechatConfig(section())),
      transport,
      chat: 'peer-1' as ChatId,
    }
  }

  it('sends each chunk with the conversation token', async () => {
    const { client, transport, chat } = fixture()

    await client.sendText(chat, 'a'.repeat(WECHAT_MAX_TEXT_CHARS + 1))

    expect(transport.sent).toEqual([
      { chatId: 'peer-1', text: 'a'.repeat(WECHAT_MAX_TEXT_CHARS), contextToken: 'context-1' },
      { chatId: 'peer-1', text: 'a', contextToken: 'context-1' },
    ])
  })

  it('downgrades one reply requested as Markdown before chunking it', async () => {
    const { client, transport, chat } = fixture()

    await client.sendText(chat, '**bold**', { markdown: true })
    await client.sendText(chat, '**bold**', { markdown: false })

    expect(transport.sent.map(sent => sent.text)).toEqual(['bold', '**bold**'])
  })

  it('sends nothing for text that carries nothing', async () => {
    const { client, transport, chat } = fixture()

    await client.sendText(chat, '   ')

    expect(transport.sent).toEqual([])
  })

  it('refuses a send into a conversation that never spoke', async () => {
    const { client, transport } = fixture()

    await expect(client.sendText('peer-absent' as ChatId, 'hi'))
      .rejects.toThrow('no WeChat conversation token is known for peer-absent')
    expect(transport.sent).toEqual([])
  })

  it('refuses the operations the capability declaration excludes', async () => {
    const { client } = fixture()
    await expect(client.replyText()).rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
    await expect(client.sendFile()).rejects.toThrow(expect.objectContaining({ code: 'CHAT_UNSUPPORTED' }))
  })

  it('describes the account without making a call', async () => {
    const { client } = fixture()

    await expect(client.checkCredentials()).resolves.toEqual({
      accountLabel: 'wechat bot at https://ilinkai.weixin.qq.com',
      details: ['token reference WECHAT_BOT_TOKEN'],
    })
  })
})

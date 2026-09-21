/**
 * Pins the Tuitui side of the chat-channel seam: the platform's capability
 * declaration, configuration narrowing that refuses an absent or non-string
 * field by name, inbound normalization onto the seam's two conversation kinds,
 * and the outbound client that forwards text while refusing the operations
 * Tuitui cannot carry.
 */
import { describe, expect, it } from 'vitest'
import type { ChatChannelConfig } from '@deepseek-ai/dsh-channel'
import type { IncomingMessage, TuituiTransport } from '@deepseek-ai/dsh-tuitui'
import { TUITUI_CAPABILITIES, TuituiChatClient, readTuituiConfig, toInboundMessage } from '../src/client.ts'

/** A transport stub whose only exercised member is the outbound text send. */
class StubTransport implements TuituiTransport {
  readonly sent: Array<{ chatId: string; content: string }> = []

  constructor(private readonly accepted: boolean) {}

  connect(): Promise<void> {
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    return Promise.resolve()
  }

  onMessage(): void {}

  onCallback(): void {}

  sendMessage(chatId: string, content: string): Promise<boolean> {
    this.sent.push({ chatId, content })
    return Promise.resolve(this.accepted)
  }

  sendReaction(): Promise<boolean> {
    return Promise.resolve(false)
  }

  sendInteractive(): Promise<string | undefined> {
    return Promise.resolve(undefined)
  }

  updateInteractive(): Promise<boolean> {
    return Promise.resolve(false)
  }
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

/** The client under test over one stub transport, for the section in play. */
function client(transport: TuituiTransport, overrides: ChatChannelConfig = {}): TuituiChatClient {
  return new TuituiChatClient(transport, readTuituiConfig(section(overrides)))
}

describe('TUITUI_CAPABILITIES', () => {
  it('declares text-only markdown transport with no quoting and no attachments', () => {
    expect(TUITUI_CAPABILITIES).toEqual({
      quoting: false,
      inbound: { images: false, files: false },
      outbound: { images: false, files: false },
      markdown: true,
      maxTextChars: 20_000,
    })
  })
})

describe('readTuituiConfig', () => {
  it('narrows a resolved section to the three Tuitui fields', () => {
    expect(readTuituiConfig(section())).toEqual({
      host: 'im.invalid',
      appId: 'app-test',
      appSecretRef: 'TUITUI_APP_SECRET',
    })
  })

  it('refuses an empty field, naming it', () => {
    for (const key of ['host', 'appId', 'appSecretRef']) {
      expect(() => readTuituiConfig(section({ [key]: '' })))
        .toThrow(expect.objectContaining({
          code: 'CHAT_CONFIG',
          field: key,
          message: `${key} is required to reach Tuitui`,
        }))
    }
  })

  it('refuses a field that is present but not a string', () => {
    expect(() => readTuituiConfig(section({ host: 8282 })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'host' }))
  })

  it('refuses a section that omits the field entirely', () => {
    expect(() => readTuituiConfig({ appId: 'app-test', appSecretRef: 'TUITUI_APP_SECRET' }))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'host' }))
  })
})

describe('toInboundMessage', () => {
  it('reads a direct message as a direct chat', () => {
    expect(toInboundMessage(inbound({ chatType: 'dm', chatId: 'user-test' }))).toEqual({
      chatId: 'user-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Test User',
    })
  })

  it('reads a group as a group chat', () => {
    expect(toInboundMessage(inbound())).toMatchObject({ chatKind: 'group' })
  })

  it('reads a team thread as a group chat', () => {
    expect(toInboundMessage(inbound({ chatType: 'channel', chatId: 'teams_t_c_1' })))
      .toMatchObject({ chatKind: 'group', chatId: 'teams_t_c_1' })
  })

  it('reports no text as null rather than as an empty string', () => {
    expect(toInboundMessage(inbound({ text: '' }))).toMatchObject({ text: null })
  })

  it('omits the sender name when the platform event carries none', () => {
    const message = toInboundMessage(inbound({ userName: '' }))
    expect(message).not.toHaveProperty('senderName')
    expect(message).toMatchObject({ chatId: '1000000000000001', messageId: 'msg-1' })
  })
})

describe('TuituiChatClient', () => {
  it('describes the configured application and host as the account', async () => {
    await expect(client(new StubTransport(true)).checkCredentials()).resolves.toEqual({
      accountLabel: 'app app-test',
      details: ['host im.invalid'],
    })
  })

  it('forwards the text unchanged, with or without a rendering request', async () => {
    const transport = new StubTransport(true)
    const chatId = toInboundMessage(inbound()).chatId
    const tuitui = client(transport)

    await tuitui.sendText(chatId, 'plain')
    await tuitui.sendText(chatId, '**bold**', { markdown: true })

    expect(transport.sent).toEqual([
      { chatId: '1000000000000001', content: 'plain' },
      { chatId: '1000000000000001', content: '**bold**' },
    ])
  })

  it('reports an unsupported failure when the transport refuses the send', async () => {
    const chatId = toInboundMessage(inbound()).chatId
    await expect(client(new StubTransport(false)).sendText(chatId, 'hello'))
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_UNSUPPORTED',
        message: 'Tuitui refused the message',
      }))
  })

  it('refuses to quote a specific message', async () => {
    await expect(client(new StubTransport(true)).replyText())
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_UNSUPPORTED',
        message: 'Tuitui cannot quote a specific message',
      }))
  })

  it('refuses to send a file', async () => {
    await expect(client(new StubTransport(true)).sendFile())
      .rejects.toThrow(expect.objectContaining({
        code: 'CHAT_UNSUPPORTED',
        message: 'Tuitui cannot send files',
      }))
  })
})

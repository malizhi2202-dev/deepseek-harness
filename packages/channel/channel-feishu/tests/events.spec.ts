import { describe, expect, it } from 'vitest'
import { FeishuInboundFile, FeishuInboundImage } from '../src/media.ts'
import { parseMessageEvent, toInboundMessage } from '../src/events.ts'
import type { FeishuInbound } from '../src/events.ts'
import { StubFeishuApi } from './stub.ts'

/** One `im.message.receive_v1` payload whose message carries `content`. */
function event(
  messageType: string,
  content: unknown,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    sender: { sender_id: { open_id: 'ou-test' } },
    message: {
      message_id: 'msg-1',
      chat_id: 'oc-test',
      chat_type: 'p2p',
      message_type: messageType,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      ...overrides,
    },
  }
}

describe('parseMessageEvent', () => {
  it('reads a direct text message', () => {
    expect(parseMessageEvent(event('text', { text: 'hello' }))).toEqual({
      chatId: 'oc-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
      imageKeys: [],
      file: null,
    })
  })

  it('reads any chat type other than a person-to-person chat as a group', () => {
    const payload = event('text', { text: 'hello' }, { chat_type: 'group' })
    expect(parseMessageEvent(payload)).toMatchObject({ chatKind: 'group' })
    const absent = event('text', { text: 'hello' }, { chat_type: undefined })
    expect(parseMessageEvent(absent)).toMatchObject({ chatKind: 'group' })
  })

  it('reads an empty text body as no text rather than as an empty message', () => {
    expect(parseMessageEvent(event('text', { text: '' }))).toMatchObject({ text: null })
    expect(parseMessageEvent(event('text', {}))).toMatchObject({ text: null })
  })

  it('renders a rich-text body with its title, links, images, and non-text elements', () => {
    const payload = event('post', {
      title: 'Report',
      content: [
        [{ tag: 'text', text: 'see ' }, { tag: 'a', text: 'the doc', href: 'https://example.invalid' }],
        [{ tag: 'img', image_key: 'img-1' }, { tag: 'at', user_id: 'ou-test' }, 5],
      ],
    })

    expect(parseMessageEvent(payload)).toEqual({
      chatId: 'oc-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'Report\nsee the doc (https://example.invalid)\n',
      imageKeys: ['img-1'],
      file: null,
    })
  })

  it('reads a rich-text body whose image carries no key, and one with no paragraphs at all', () => {
    expect(parseMessageEvent(event('post', { content: [[{ tag: 'img' }]] }))).toMatchObject({
      text: null,
      imageKeys: [],
    })
    expect(parseMessageEvent(event('post', { content: 'not paragraphs' }))).toMatchObject({
      text: null,
      imageKeys: [],
    })
    expect(parseMessageEvent(event('post', { content: ['not a paragraph'] }))).toMatchObject({
      text: null,
      imageKeys: [],
    })
  })

  it('reads an image message as one image and no text', () => {
    expect(parseMessageEvent(event('image', { image_key: 'img-2' }))).toMatchObject({
      text: null,
      imageKeys: ['img-2'],
      file: null,
    })
  })

  it('reads an image message with no key as no media at all', () => {
    expect(parseMessageEvent(event('image', {}))).toMatchObject({ imageKeys: [] })
  })

  it('reads a file message with the sender’s own name, and one that carried none', () => {
    expect(parseMessageEvent(event('file', { file_key: 'f-1', file_name: 'report.pdf' }))).toMatchObject({
      file: { fileKey: 'f-1', fileName: 'report.pdf' },
    })
    expect(parseMessageEvent(event('file', { file_key: 'f-1' }))).toMatchObject({
      file: { fileKey: 'f-1', fileName: 'attachment' },
    })
  })

  it('reads a file message with no key as no media at all', () => {
    expect(parseMessageEvent(event('file', {}))).toMatchObject({ file: null })
  })

  it('reads a message type this connector cannot forward as an empty message', () => {
    expect(parseMessageEvent(event('audio', { file_key: 'f-1' }))).toEqual({
      chatId: 'oc-test',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: null,
      imageKeys: [],
      file: null,
    })
  })

  it('refuses a payload that is not a message', () => {
    expect(parseMessageEvent(null)).toBeNull()
    expect(parseMessageEvent('not an event')).toBeNull()
    expect(parseMessageEvent({})).toBeNull()
    expect(parseMessageEvent({ message: [] })).toBeNull()
  })

  it('refuses a message missing any field it needs', () => {
    for (const missing of ['message_id', 'chat_id', 'message_type', 'content']) {
      expect(parseMessageEvent(event('text', { text: 'hello' }, { [missing]: undefined }))).toBeNull()
      expect(parseMessageEvent(event('text', { text: 'hello' }, { [missing]: '' }))).toBeNull()
    }
  })

  it('refuses a body that is not JSON, or that is JSON but not an object', () => {
    expect(parseMessageEvent(event('text', 'not json'))).toBeNull()
    expect(parseMessageEvent(event('text', '[1,2,3]'))).toBeNull()
    expect(parseMessageEvent(event('text', 'null'))).toBeNull()
  })
})

describe('toInboundMessage', () => {
  const api = new StubFeishuApi()

  /** One validated event, overridden per test. */
  function inbound(overrides: Partial<FeishuInbound> = {}): FeishuInbound {
    return {
      chatId: 'oc-test',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
      imageKeys: [],
      file: null,
      ...overrides,
    }
  }

  it('carries no media handles when the message carried no media', () => {
    const message = toInboundMessage(api, inbound())

    expect(message).toEqual({
      chatId: 'oc-test',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
    })
    expect('images' in message).toBe(false)
    expect('files' in message).toBe(false)
  })

  it('attaches one lazy handle per image, each closed over the message it arrived on', async () => {
    const message = toInboundMessage(api, inbound({ imageKeys: ['img-1', 'img-2'] }))

    expect(message.images).toHaveLength(2)
    expect(message.images?.[0]).toBeInstanceOf(FeishuInboundImage)
    await message.images?.[0]?.fetch(1024)
    expect(api.downloaded.at(-1)).toEqual({ messageId: 'msg-1', fileKey: 'img-1', type: 'image' })
  })

  it('attaches one lazy file handle carrying the sender’s name', () => {
    const message = toInboundMessage(api, inbound({ file: { fileKey: 'f-1', fileName: 'report.pdf' } }))

    expect(message.files?.[0]).toBeInstanceOf(FeishuInboundFile)
    expect(message.files?.[0]?.fileName).toBe('report.pdf')
  })
})

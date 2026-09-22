/**
 * Feishu's inbound event reader: platform JSON validated into the fields the
 * seam needs, and the media keys the lazy handles are built from.
 *
 * The SDK dispatches only `im.message.receive_v1`, but it parses the event
 * without validating it, so everything this module reads is checked here: an
 * event missing a message id, a chat id, or a message type is not a message
 * this connector can answer. The message body arrives as a JSON *string* inside
 * that event, which is the second wire boundary this module validates.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { ChatId, ChatInboundMessage, ChatMessageId } from '@deepseek-ai/dsh-channel'
import { FeishuInboundFile, FeishuInboundImage } from './media.ts'
import type { FeishuApi } from './types.ts'

/** The name Feishu gives a file whose event carried none. */
const UNNAMED_FILE = 'attachment'

/** One validated inbound Feishu message, before the seam's media handles are attached. */
export interface FeishuInbound {
  /** The conversation the message arrived in. */
  readonly chatId: string
  /** Direct chat with the bot, or a group. */
  readonly chatKind: 'direct' | 'group'
  /** The platform's message identity. */
  readonly messageId: string
  /** The message text, or null when it carried none. */
  readonly text: string | null
  /** Keys of the images this message carried, in the order Feishu listed them. */
  readonly imageKeys: readonly string[]
  /** The file this message carried, when it carried one. */
  readonly file: { readonly fileKey: string; readonly fileName: string } | null
}

/** One JSON object, or null for anything else. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** One non-empty string, or undefined for anything else. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The parsed body of one message's `content` string, or null when it is not one. */
function parseContent(content: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(content))
  } catch {
    // Feishu sends `content` as a JSON string, and this call is the only
    // statement that can throw on a body this connector cannot read.
    return null
  }
}

/** The text and media one rich-text (`post`) body carries. */
function readPost(body: Record<string, unknown>): Pick<FeishuInbound, 'text' | 'imageKeys' | 'file'> {
  const imageKeys: string[] = []
  const paragraphs = Array.isArray(body['content']) ? body['content'] : []
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const parts: string[] = []
    for (const element of Array.isArray(paragraph) ? paragraph : []) {
      const node = record(element)
      if (node === null) continue
      if (node['tag'] === 'img') {
        const key = str(node['image_key'])
        if (key !== undefined) imageKeys.push(key)
        continue
      }
      const text = str(node['text'])
      if (text === undefined) continue
      const href = str(node['href'])
      parts.push(href === undefined ? text : `${text} (${href})`)
    }
    lines.push(parts.join(''))
  }
  const rendered = lines.join('\n')
  const title = str(body['title'])
  const joined = [title, rendered]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('\n')
  return { text: joined === '' ? null : joined, imageKeys, file: null }
}

/** The text and media one message body carries, by Feishu's message type. */
function readBody(messageType: string, body: Record<string, unknown>): Pick<FeishuInbound, 'text' | 'imageKeys' | 'file'> {
  switch (messageType) {
    case 'text': {
      return { text: str(body['text']) ?? null, imageKeys: [], file: null }
    }
    case 'post': {
      return readPost(body)
    }
    case 'image': {
      const key = str(body['image_key'])
      return { text: null, imageKeys: key === undefined ? [] : [key], file: null }
    }
    case 'file': {
      const key = str(body['file_key'])
      return {
        text: null,
        imageKeys: [],
        file: key === undefined ? null : { fileKey: key, fileName: str(body['file_name']) ?? UNNAMED_FILE },
      }
    }
    default: {
      // Every other message type — audio, media, sticker, share_chat, and
      // whatever Feishu adds next — carries nothing this seam can forward, so
      // it parses to an empty message and the bridge answers it with its own
      // unsupported-message notice.
      return { text: null, imageKeys: [], file: null }
    }
  }
}

/**
 * Validate one `im.message.receive_v1` payload into the seam's inbound fields.
 * @param payload - the event the SDK dispatched.
 * @returns the validated message, or null when the payload is not one.
 */
export function parseMessageEvent(payload: unknown): FeishuInbound | null {
  const message = record(record(payload)?.['message'])
  if (message === null) return null
  const messageId = str(message['message_id'])
  const chatId = str(message['chat_id'])
  const messageType = str(message['message_type'])
  const content = str(message['content'])
  if (messageId === undefined || chatId === undefined || messageType === undefined || content === undefined) return null
  const body = parseContent(content)
  if (body === null) return null
  return {
    chatId,
    chatKind: message['chat_type'] === 'p2p' ? 'direct' : 'group',
    messageId,
    ...readBody(messageType, body),
  }
}

/**
 * Attach the seam's lazy media handles to one validated message.
 *
 * The handles close over the message id, because Feishu downloads an attachment
 * through the message that carried it.
 * @param api - the SDK view the downloads go through.
 * @param event - the validated inbound message.
 * @returns the seam's inbound message.
 */
export function toInboundMessage(api: FeishuApi, event: FeishuInbound): ChatInboundMessage {
  return {
    chatId: brandString<ChatId>(event.chatId),
    chatKind: event.chatKind,
    messageId: brandString<ChatMessageId>(event.messageId),
    text: event.text,
    ...event.imageKeys.length === 0
      ? {}
      : { images: event.imageKeys.map(key => new FeishuInboundImage(api, event.messageId, key)) },
    ...event.file === null
      ? {}
      : { files: [new FeishuInboundFile(api, event.messageId, event.file.fileKey, event.file.fileName)] },
  }
}

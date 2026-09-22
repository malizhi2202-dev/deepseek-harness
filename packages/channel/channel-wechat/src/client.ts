/**
 * The WeChat (微信) side of the chat-channel seam: configuration narrowing, the
 * capability declaration, inbound normalization with lazy media handles, and the
 * outbound client.
 *
 * Two platform facts drive the whole translation. The platform is single-chat,
 * so every inbound message is a direct chat and the peer id is the conversation.
 * And an outbound message is signed with the `context_token` the conversation's
 * last inbound message carried, which is why the client and the connection share
 * one bounded conversation table rather than each holding their own.
 *
 * @module @deepseek-ai/dsh-channel-wechat
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { ChatConfigError, ChatUnsupportedError } from '@deepseek-ai/dsh-channel'
import type {
  ChatAccountInfo,
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatClient,
  ChatId,
  ChatInboundFile,
  ChatInboundImage,
  ChatInboundMessage,
  ChatMessageId,
  ChatSendOptions,
} from '@deepseek-ai/dsh-channel'
import { WECHAT_DEFAULT_BASE_URL, readMediaRef } from './wire.ts'
import type { WechatMediaRef } from './wire.ts'
import { chunkWechatText, downgradeWechatMarkdown } from './markdown.ts'

/** Characters one WeChat message carries, which is the platform's own outbound chunk size. */
export const WECHAT_MAX_TEXT_CHARS = 4000

/** The largest inbound attachment this provider transfers, mirroring the official client's cap. */
export const WECHAT_MAX_INBOUND_BYTES = 100 * 1024 * 1024

/** The `bot_agent` a deployment that names none sends. */
export const WECHAT_DEFAULT_BOT_AGENT = 'DeepSeekHarness'

/** The `message_type` the platform stamps on a message the bot itself sent. */
const MESSAGE_TYPE_BOT = 2

/** `MessageItem.type` for a text item. */
const ITEM_TEXT = 1

/** `MessageItem.type` for an image item. */
const ITEM_IMAGE = 2

/** `MessageItem.type` for a voice item. */
const ITEM_VOICE = 3

/** `MessageItem.type` for a file item. */
const ITEM_FILE = 4

/** `MessageItem.type` for a video item. */
const ITEM_VIDEO = 5

/** The placeholder text a media kind the seam cannot carry is reduced to. */
const MEDIA_LABELS: Readonly<Record<number, string>> = {
  [ITEM_VOICE]: '[语音]',
  [ITEM_VIDEO]: '[视频]',
}

/**
 * What WeChat can carry.
 *
 * Markdown is declared false because the platform renders plain text only; the
 * client still downgrades Markdown to text rather than letting markers reach the
 * chat. Outbound attachments are declared false because the upload path
 * (`getuploadurl`, AES encryption, the CDN POST) is not implemented here, so the
 * bridge's refusal to send files is the correct outcome.
 */
export const WECHAT_CAPABILITIES: ChatChannelCapabilities = {
  quoting: false,
  inbound: { images: true, files: true },
  outbound: { images: false, files: false },
  markdown: false,
  maxTextChars: WECHAT_MAX_TEXT_CHARS,
  maxInboundBytes: WECHAT_MAX_INBOUND_BYTES,
}

/** The WeChat configuration section, resolved. */
export interface WechatChannelConfig {
  /** The bot API host, which is what the QR sign-in's confirmation recorded. */
  readonly baseUrl: string
  /** Name of the `dsh-credentials` reference holding the bot token, never the token. */
  readonly tokenRef: string
  /** The value sent as `bot_agent`. */
  readonly botAgent: string
}

/** The media download the inbound handles call back into. */
export interface WechatMediaSource {
  /**
   * Download one media reference, refusing anything past `maxBytes`.
   * @param ref - the reference the platform stated.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the decrypted bytes.
   */
  download(ref: WechatMediaRef, maxBytes: number): Promise<Uint8Array>
}

/** One normalized inbound message, with the token an answer to it must carry. */
export interface WechatInbound {
  /** The seam's inbound message. */
  readonly message: ChatInboundMessage
  /** The token the platform issued with this conversation's message. */
  readonly contextToken: string
}

/**
 * Narrow an unknown JSON value to a plain object.
 * @param value - the value to narrow.
 * @returns the object, or undefined when the value is not one.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Read one field the platform states as a string.
 * @param value - the field's value.
 * @returns the string, or the empty string when the field is absent or another type.
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Read the image media type from the bytes' own signature.
 *
 * The platform's media reference carries no content type, and the bridge
 * validates an inbound image against the types the attachment service stores, so
 * the type has to come from the bytes.
 * @param data - the decrypted image bytes.
 * @returns the media type, or `application/octet-stream` when the signature matches none.
 */
export function sniffImageMime(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif'
  const riff = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
  const webp = data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  return riff && webp ? 'image/webp' : 'application/octet-stream'
}

/**
 * Read one required configuration field.
 * @param section - the resolved channel configuration section.
 * @returns the reference name the field holds.
 * @throws {ChatConfigError} naming the field when it is absent or empty.
 */
function requiredTokenRef(section: ChatChannelConfig): string {
  const value = section['tokenRef']
  if (typeof value !== 'string' || value === '') {
    throw new ChatConfigError('tokenRef', 'tokenRef is required to reach WeChat')
  }
  return value
}

/**
 * Read one optional configuration field.
 * @param section - the resolved channel configuration section.
 * @param key - the field to read.
 * @returns the string, or the empty string when the field is absent or another type.
 */
function optionalText(section: ChatChannelConfig, key: string): string {
  const value = section[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Narrow one resolved configuration section to the fields that name the host.
 *
 * These are the fields a QR sign-in needs, and it needs them before any token
 * exists, so they are read without the token reference.
 * @param section - the resolved channel configuration section.
 * @returns the host the account talks to and the name it announces itself under.
 */
export function readWechatHost(section: ChatChannelConfig): { baseUrl: string; botAgent: string } {
  const baseUrl = optionalText(section, 'baseUrl')
  return {
    baseUrl: baseUrl === '' ? WECHAT_DEFAULT_BASE_URL : baseUrl,
    botAgent: optionalText(section, 'botAgent') || WECHAT_DEFAULT_BOT_AGENT,
  }
}

/**
 * Narrow one resolved configuration section to the WeChat fields.
 *
 * An empty `baseUrl` resolves to the host the official channel uses, and an
 * empty `botAgent` to this provider's own name: both are defaults a deployment
 * overrides rather than values this package guesses at.
 * @param section - the resolved channel configuration section.
 * @returns the resolved WeChat fields.
 * @throws {ChatConfigError} when a required field is missing.
 */
export function readWechatConfig(section: ChatChannelConfig): WechatChannelConfig {
  return { ...readWechatHost(section), tokenRef: requiredTokenRef(section) }
}

/**
 * The conversation table one connector shares between its client and its
 * connection.
 *
 * The platform issues a `context_token` with every inbound message and requires
 * it back on every outbound one, so the token arrives on the connection and is
 * spent by the client. The table is bounded because a long-lived bot sees
 * unboundedly many peers.
 */
export class WechatConversations {
  private readonly tokens = new Map<string, string>()

  /**
   * @param limit - the most conversations this table remembers.
   */
  constructor(private readonly limit: number) {}

  /**
   * Record the token one conversation's newest inbound message carried.
   * @param chatId - the conversation's peer id.
   * @param contextToken - the token to sign the next outbound message with.
   */
  remember(chatId: string, contextToken: string): void {
    this.tokens.delete(chatId)
    this.tokens.set(chatId, contextToken)
    if (this.tokens.size > this.limit) {
      const excess = [...this.tokens.keys()].slice(0, this.tokens.size - this.limit)
      for (const key of excess) this.tokens.delete(key)
    }
  }

  /**
   * The token one conversation's newest inbound message carried.
   * @param chatId - the conversation's peer id.
   * @returns the token, or undefined when this table has seen no message from it.
   */
  tokenFor(chatId: string): string | undefined {
    return this.tokens.get(chatId)
  }
}

/**
 * Build one inbound image handle from an image item.
 * @param item - the item's `image_item` object.
 * @param source - the download the handle calls back into.
 * @returns the handle, or null when the item names nothing to fetch.
 */
function imageHandle(item: Record<string, unknown> | undefined, source: WechatMediaSource): ChatInboundImage | null {
  const ref = readMediaRef(item?.['media'], item?.['aeskey'])
  if (ref === undefined) return null
  return {
    async fetch(maxBytes: number) {
      const data = await source.download(ref, maxBytes)
      return { data, mime: sniffImageMime(data) }
    },
  }
}

/**
 * Build one inbound file handle from a file item.
 * @param item - the item's `file_item` object.
 * @param source - the download the handle calls back into.
 * @returns the handle, or null when the item names nothing to fetch.
 */
function fileHandle(item: Record<string, unknown> | undefined, source: WechatMediaSource): ChatInboundFile | null {
  const ref = readMediaRef(item?.['media'], undefined)
  if (ref === undefined) return null
  return {
    fileName: asText(item?.['file_name']) || 'file',
    fetch: (maxBytes: number) => source.download(ref, maxBytes),
  }
}

/**
 * Read one message's text, which is its text items joined.
 * @param items - the message's item objects.
 * @returns the text, or null when the message carries none.
 */
function readTextBody(items: readonly Record<string, unknown>[]): string | null {
  const parts: string[] = []
  for (const item of items) {
    if (item['type'] !== ITEM_TEXT) continue
    const text = asText(asRecord(item['text_item'])?.['text'])
    if (text !== '') parts.push(text)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/**
 * Read the placeholder one media kind the seam cannot carry is reduced to.
 *
 * A voice item is preferred as its transcript, which is what the sender's own
 * client already produced; the label is the fallback for a kind with neither.
 * @param items - the message's item objects.
 * @returns the label, or null when every item is a kind the seam carries.
 */
function readMediaLabel(items: readonly Record<string, unknown>[]): string | null {
  let label: string | null = null
  for (const item of items) {
    if (item['type'] === ITEM_VOICE) {
      const transcript = asText(asRecord(item['voice_item'])?.['text'])
      if (transcript !== '') return transcript
    }
    const type = item['type']
    if (label === null && typeof type === 'number') label = MEDIA_LABELS[type] ?? null
  }
  return label
}

/**
 * Normalize one raw `getupdates` message into the seam's inbound message.
 *
 * The platform is single-chat, so every message is a direct chat. A message the
 * bot itself sent is skipped: it is the platform's own copy of an outbound
 * message, not something to admit.
 * @param raw - one entry of the platform's `msgs` array.
 * @param source - the download the media handles call back into.
 * @returns the inbound message and the token an answer must carry, or null for a message this channel does not admit.
 */
export function readInboundMessage(raw: unknown, source: WechatMediaSource): WechatInbound | null {
  const record = asRecord(raw)
  if (record === undefined || record['message_type'] === MESSAGE_TYPE_BOT) return null
  const chatId = asText(record['from_user_id'])
  if (chatId === '') return null
  const rawItems = record['item_list']
  const items = Array.isArray(rawItems)
    ? rawItems.map(item => asRecord(item)).filter((item): item is Record<string, unknown> => item !== undefined)
    : []
  const images: ChatInboundImage[] = []
  const files: ChatInboundFile[] = []
  for (const item of items) {
    if (item['type'] === ITEM_IMAGE) {
      const handle = imageHandle(asRecord(item['image_item']), source)
      if (handle !== null) images.push(handle)
    } else if (item['type'] === ITEM_FILE) {
      const handle = fileHandle(asRecord(item['file_item']), source)
      if (handle !== null) files.push(handle)
    }
  }
  const text = readTextBody(items) ?? readMediaLabel(items)
  const fallbackId = items.map(item => asText(item['msg_id'])).find(id => id !== '') ?? ''
  return {
    contextToken: asText(record['context_token']),
    message: {
      chatId: brandString<ChatId>(chatId),
      chatKind: 'direct',
      messageId: brandString<ChatMessageId>(asText(record['message_id']) || fallbackId),
      text,
      ...images.length === 0 ? {} : { images },
      ...files.length === 0 ? {} : { files },
    },
  }
}

/** The outbound client the bridge sends WeChat messages through. */
export class WechatChatClient implements ChatClient {
  /**
   * @param wire - the transport this client sends through.
   * @param conversations - the table holding the token each conversation's last message carried.
   * @param config - the resolved section naming the account a probe reports.
   */
  constructor(
    private readonly wire: WechatSendTransport,
    private readonly conversations: WechatConversations,
    private readonly config: WechatChannelConfig,
  ) {}

  /**
   * Describe the account the configured reference signs in as.
   *
   * The probe makes no call: the platform exposes no account fact a token
   * exchange would add, and the seam requires a probe that is safe to run while
   * the channel is live.
   * @returns the account label and the host it talks to.
   */
  checkCredentials(): Promise<ChatAccountInfo | null> {
    return Promise.resolve({
      accountLabel: `wechat bot at ${this.config.baseUrl}`,
      details: [`token reference ${this.config.tokenRef}`],
    })
  }

  /**
   * Send one text message into one conversation.
   *
   * Markdown is downgraded before chunking, because the downgrade changes the
   * length and the platform's cap applies to what is actually sent.
   * @param chatId - the conversation's peer id.
   * @param text - the message body.
   * @param options - rendering request; see {@link ChatSendOptions}.
   * @throws {Error} when no token is known for the conversation, which is what
   *   an outbound message to a conversation that never spoke looks like.
   * @throws {Error} when the platform refused a send.
   */
  async sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    const contextToken = this.conversations.tokenFor(chatId)
    if (contextToken === undefined) {
      throw new Error(`no WeChat conversation token is known for ${chatId}`)
    }
    const rendered = options?.markdown === true ? downgradeWechatMarkdown(text) : text
    for (const chunk of chunkWechatText(rendered, WECHAT_MAX_TEXT_CHARS)) {
      await this.wire.sendText(chatId, chunk, contextToken)
    }
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.quoting` is false and the bridge never calls this.
   */
  replyText(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('WeChat cannot quote a specific message'))
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.outbound.files` is false and the bridge never calls this.
   */
  sendFile(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('WeChat outbound attachments are not implemented'))
  }
}

/** The one outbound operation the client performs, so a test can drive it without a socket. */
export interface WechatSendTransport {
  /**
   * Send one text message into one conversation.
   * @param toUserId - the conversation's peer id.
   * @param text - the message body.
   * @param contextToken - the token the conversation's last inbound message carried.
   */
  sendText(toUserId: string, text: string, contextToken: string): Promise<void>
}

/**
 * The QQ side of the chat-channel seam: configuration narrowing, the capability
 * declaration, inbound event normalization with lazy attachment handles, and the
 * outbound client.
 *
 * Two platform facts drive the translation. A group or single-chat message is
 * sent only as a passive reply, so every outbound message rides on a received
 * message id and carries a sequence that the ledger assigns. And the two send
 * endpoints differ only by their path, so the conversation id this provider
 * mints carries the kind the path depends on.
 *
 * @module @deepseek-ai/dsh-channel-qq
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
import { QQ_DEFAULT_API_BASE } from './api.ts'
import { readText } from './json.ts'
import { PassiveReplies } from './replies.ts'
import type { QqPassiveReply } from './replies.ts'
import { chunkQqText, downgradeQqMarkdown } from './markdown.ts'

/**
 * Characters this client puts in one message.
 *
 * The platform documents no outbound text cap, so this is this build's own
 * bound rather than a platform fact, and it matches the bridge's default chunk
 * size so a reply the bridge already split is forwarded whole.
 */
export const QQ_MAX_TEXT_CHARS = 4000

/** The group event names the platform delivers an at-message under. */
const GROUP_EVENTS = ['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE']

/** The single-chat event name. */
const DIRECT_EVENT = 'C2C_MESSAGE_CREATE'

/**
 * What QQ can carry.
 *
 * Markdown is declared false: the platform's markdown form is a template a
 * deployment defines in its console, and this provider sends the plain-text
 * form, so a reply's Markdown is downgraded here rather than rendered there.
 * Outbound attachments are declared false because the upload path is not
 * implemented, so the bridge's refusal to send files is the correct outcome.
 */
export const QQ_CAPABILITIES: ChatChannelCapabilities = {
  quoting: false,
  inbound: { images: true, files: true },
  outbound: { images: false, files: false },
  markdown: false,
}

/** The QQ configuration section, resolved. */
export interface QqChannelConfig {
  /** The application id from the QQ bot developer console. */
  readonly appId: string
  /** Name of the `dsh-credentials` reference holding the application secret, never the secret. */
  readonly appSecretRef: string
  /** The API host, which a sandbox deployment points elsewhere. */
  readonly apiBaseUrl: string
}

/** The attachment download the inbound handles call back into. */
export interface QqAttachmentSource {
  /**
   * Download one attachment, refusing anything past `maxBytes`.
   * @param url - the attachment URL the event stated.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the attachment bytes.
   */
  download(url: string, maxBytes: number): Promise<Uint8Array>
}

/** The one outbound surface the client uses, so a test can drive it without a socket. */
export interface QqSendTransport {
  /**
   * Probe the application credential pair.
   * @returns the access token the probe exchanged.
   */
  accessToken(): Promise<string>
  /**
   * Send one message into a group.
   * @param groupOpenid - the group's open id.
   * @param body - the message body.
   */
  sendGroupMessage(groupOpenid: string, body: unknown): Promise<void>
  /**
   * Send one message to a single chat.
   * @param userOpenid - the peer's open id.
   * @param body - the message body.
   */
  sendC2cMessage(userOpenid: string, body: unknown): Promise<void>
}

/** The conversation kind a QQ send endpoint depends on. */
interface QqConversation {
  /** Which of the two send endpoints this conversation uses. */
  readonly kind: 'direct' | 'group'
  /** The open id the endpoint's path carries. */
  readonly openid: string
}

/**
 * Mint the conversation id one QQ conversation is addressed by.
 *
 * The id is opaque to everything downstream; the kind is encoded because the
 * two send endpoints differ only by their path, and a reply must not have to
 * guess which one a conversation needs.
 * @param kind - whether the conversation is a group or a single chat.
 * @param openid - the group's or peer's open id.
 * @returns the conversation id.
 */
export function conversationId(kind: 'direct' | 'group', openid: string): ChatId {
  return brandString<ChatId>(`${kind}:${openid}`)
}

/**
 * Read one conversation id back into the endpoint it addresses.
 * @param chatId - the conversation id.
 * @returns the conversation, or undefined when the id was not minted here.
 */
export function parseConversationId(chatId: string): QqConversation | undefined {
  const separator = chatId.indexOf(':')
  if (separator === -1) return undefined
  const kind = chatId.slice(0, separator)
  if (kind !== 'direct' && kind !== 'group') return undefined
  const openid = chatId.slice(separator + 1)
  return openid === '' ? undefined : { kind, openid }
}

/**
 * Read one event body, or null when the frame carried none.
 * @param data - the frame's `d` field.
 * @returns the body object, or null.
 */
function bodyOf(data: unknown): Record<string, unknown> | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/**
 * Read one required configuration field.
 * @param section - the resolved channel configuration section.
 * @param key - the field to read.
 * @returns the value the field holds.
 * @throws {ChatConfigError} naming the field when it is absent or empty.
 */
function requiredField(section: ChatChannelConfig, key: string): string {
  const value = section[key]
  if (typeof value !== 'string' || value === '') {
    throw new ChatConfigError(key, `${key} is required to reach QQ`)
  }
  return value
}

/**
 * Narrow one resolved configuration section to the QQ fields.
 *
 * An empty `apiBaseUrl` resolves to the host the current platform documentation
 * names, which is a default a deployment overrides rather than a value this
 * package guesses at.
 * @param section - the resolved channel configuration section.
 * @returns the resolved QQ fields.
 * @throws {ChatConfigError} when a required field is missing.
 */
export function readQqConfig(section: ChatChannelConfig): QqChannelConfig {
  const baseUrl = section['apiBaseUrl']
  return {
    appId: requiredField(section, 'appId'),
    appSecretRef: requiredField(section, 'appSecretRef'),
    apiBaseUrl: typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : QQ_DEFAULT_API_BASE,
  }
}

/**
 * Build one inbound image handle from an attachment.
 * @param url - the attachment URL.
 * @param mime - the media type the platform stated.
 * @param source - the download the handle calls back into.
 * @returns the handle.
 */
function imageHandle(url: string, mime: string, source: QqAttachmentSource): ChatInboundImage {
  return {
    async fetch(maxBytes: number) {
      return { data: await source.download(url, maxBytes), mime }
    },
  }
}

/**
 * Build one inbound file handle from an attachment.
 * @param url - the attachment URL.
 * @param fileName - the name the platform stated, or the empty string.
 * @param source - the download the handle calls back into.
 * @returns the handle.
 */
function fileHandle(url: string, fileName: string, source: QqAttachmentSource): ChatInboundFile {
  return {
    fileName: fileName === '' ? 'file' : fileName,
    fetch: (maxBytes: number) => source.download(url, maxBytes),
  }
}

/**
 * Normalize one gateway dispatch event into the seam's inbound message.
 * @param event - the platform's event name.
 * @param data - the event body.
 * @param source - the download the attachment handles call back into.
 * @returns the seam's inbound message, or null for an event this channel does not admit.
 */
export function readInboundMessage(event: string, data: unknown, source: QqAttachmentSource): ChatInboundMessage | null {
  const body = bodyOf(data)
  if (body === null) return null
  const group = GROUP_EVENTS.includes(event)
  if (!group && event !== DIRECT_EVENT) return null
  const author = bodyOf(body['author'])
  if (author === null) return null
  const openid = readText(author, group ? 'member_openid' : 'user_openid') || readText(author, 'id')
  const conversation = group ? readText(body, 'group_openid') : openid
  const messageId = readText(body, 'id')
  if (conversation === '' || openid === '' || messageId === '') return null
  const images: ChatInboundImage[] = []
  const files: ChatInboundFile[] = []
  const rawAttachments = body['attachments']
  for (const entry of Array.isArray(rawAttachments) ? rawAttachments : []) {
    const attachment = bodyOf(entry)
    if (attachment === null) continue
    const url = readText(attachment, 'url')
    const contentType = readText(attachment, 'content_type')
    if (url === '' || contentType === 'voice') continue
    if (contentType.startsWith('image/')) images.push(imageHandle(url, contentType, source))
    else files.push(fileHandle(url, readText(attachment, 'filename'), source))
  }
  const content = readText(body, 'content').trim()
  const senderName = readText(author, 'username')
  return {
    chatId: conversationId(group ? 'group' : 'direct', conversation),
    chatKind: group ? 'group' : 'direct',
    messageId: brandString<ChatMessageId>(messageId),
    text: content === '' ? null : content,
    ...senderName === '' ? {} : { senderName },
    ...images.length === 0 ? {} : { images },
    ...files.length === 0 ? {} : { files },
  }
}

/** The outbound client the bridge sends QQ messages through. */
export class QqChatClient implements ChatClient {
  /**
   * @param api - the transport this client sends through.
   * @param replies - the ledger of received messages a reply can still ride on.
   * @param config - the resolved section naming the application a probe reports.
   */
  constructor(
    private readonly api: QqSendTransport,
    private readonly replies: PassiveReplies,
    private readonly config: QqChannelConfig,
  ) {}

  /**
   * Probe the application credential pair by exchanging it for a token.
   *
   * The exchange is the only call that proves the pair is usable, and the token
   * cache makes it free when a connection already holds one.
   * @returns the application label and the host it talks to.
   * @throws when the platform refused the pair.
   */
  async checkCredentials(): Promise<ChatAccountInfo | null> {
    await this.api.accessToken()
    return {
      accountLabel: `QQ bot ${this.config.appId}`,
      details: [`api ${this.config.apiBaseUrl}`],
    }
  }

  /**
   * Send one text message into a conversation.
   *
   * Every chunk is a separate message, so each takes the next sequence for the
   * message the reply rides on.
   * @param chatId - the conversation to send to.
   * @param text - the message body.
   * @param options - rendering request; a Markdown request is downgraded here.
   * @throws {ChatUnsupportedError} when the conversation id was not minted here,
   *   or when no received message in it is still replyable.
   * @throws {Error} when the platform refused a send.
   */
  async sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    const target = parseConversationId(chatId)
    if (target === undefined) {
      throw new ChatUnsupportedError(`${chatId} is not a QQ conversation id this provider minted`)
    }
    const chunks = chunkQqText(render(text, options), QQ_MAX_TEXT_CHARS)
    if (chunks.length === 0) return
    for (const chunk of chunks) {
      const reply = this.replies.claim(chatId)
      if (reply === undefined) throw replyRefusal()
      await this.send(target, reply, chunk)
    }
  }

  /**
   * Send one text message as a reply to a named received message.
   * @param messageId - the received message to reply to.
   * @param text - the message body.
   * @param options - rendering request; a Markdown request is downgraded here.
   * @throws {ChatUnsupportedError} when that message is unknown or no longer replyable.
   * @throws {Error} when the platform refused a send.
   */
  async replyText(messageId: ChatMessageId, text: string, options?: ChatSendOptions): Promise<void> {
    const chunks = chunkQqText(render(text, options), QQ_MAX_TEXT_CHARS)
    if (chunks.length === 0) return
    for (const chunk of chunks) {
      const reply = this.replies.claimMessage(messageId)
      if (reply === undefined) throw replyRefusal()
      const target = parseConversationId(reply.chatId)
      if (target === undefined) throw replyRefusal()
      await this.send(target, reply, chunk)
    }
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.outbound.files` is false and the bridge never calls this.
   */
  sendFile(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('QQ outbound attachments are not implemented'))
  }

  /**
   * Send one chunk as a passive reply.
   * @param target - the conversation the reply goes into.
   * @param reply - the message id and sequence the reply rides on.
   * @param text - the chunk to send.
   */
  private async send(target: QqConversation, reply: QqPassiveReply, text: string): Promise<void> {
    const body = { content: text, msg_type: 0, msg_id: reply.messageId, msg_seq: reply.seq }
    if (target.kind === 'group') await this.api.sendGroupMessage(target.openid, body)
    else await this.api.sendC2cMessage(target.openid, body)
  }
}

/**
 * Render one message body for this platform.
 * @param text - the body the bridge handed over.
 * @param options - the rendering request.
 * @returns the plain text to send.
 */
function render(text: string, options: ChatSendOptions | undefined): string {
  return options?.markdown === true ? downgradeQqMarkdown(text) : text
}

/**
 * The refusal a reply that has nothing to ride on raises.
 * @returns the error to throw.
 */
function replyRefusal(): ChatUnsupportedError {
  return new ChatUnsupportedError('QQ accepts a group or single-chat message only as a reply to one it received in the last five minutes')
}

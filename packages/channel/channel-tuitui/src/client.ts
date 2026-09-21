/**
 * The Tuitui side of the chat-channel seam: configuration narrowing, capability
 * declaration, and the outbound client the bridge sends through.
 *
 * Everything protocol-shaped lives in `@deepseek-ai/dsh-tuitui`; this module
 * only translates between that transport's vocabulary and the seam's. Two
 * translations are worth stating outright because the seam cannot express them
 * per conversation:
 *
 * - Tuitui has no reply-quoting, so `capabilities.quoting` is false and
 *   `replyText` refuses. A group reply is a plain message.
 * - Markdown is rendered only in team threads, which the transport decides from
 *   the conversation id. The capability is declared true and the text is
 *   forwarded unchanged, so the transport renders what it can and a direct
 *   message shows the same text verbatim.
 *
 * @module @deepseek-ai/dsh-channel-tuitui
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { ChatConfigError, ChatUnsupportedError } from '@deepseek-ai/dsh-channel'
import type {
  ChatAccountInfo,
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatClient,
  ChatId,
  ChatInboundMessage,
  ChatMessageId,
  ChatSendOptions,
} from '@deepseek-ai/dsh-channel'
import type { IncomingMessage, TuituiTransport } from '@deepseek-ai/dsh-tuitui'

/**
 * Characters the Tuitui sender accepts in one message before it splits the text
 * itself. Mirrors the transport's own chunker, which the bridge's chunk size is
 * clamped under.
 */
const TUITUI_MAX_TEXT_CHARS = 20_000

/** The Tuitui configuration section, validated. */
export interface TuituiChannelConfig {
  /** Tuitui IM server host, without a scheme or port. */
  readonly host: string
  /** The bot application's id from the Tuitui developer console. */
  readonly appId: string
  /** Name of the `dsh-credentials` reference holding the bot application's secret. */
  readonly appSecretRef: string
}

/**
 * What Tuitui can carry.
 *
 * No attachment direction is supported: the transport hands media over only as
 * URLs already rendered into the message text, so a native image or file block
 * would mean re-deriving the platform's message kinds and downloading bytes
 * outside the transport. The text keeps the URL, so the model still receives it.
 */
export const TUITUI_CAPABILITIES: ChatChannelCapabilities = {
  quoting: false,
  inbound: { images: false, files: false },
  outbound: { images: false, files: false },
  markdown: true,
  maxTextChars: TUITUI_MAX_TEXT_CHARS,
}

/**
 * Read one required string field out of a resolved configuration section.
 * @param section - the resolved section.
 * @param key - the field to read.
 * @returns the field's value.
 * @throws {ChatConfigError} naming the field when it is absent or empty.
 */
function requiredField(section: ChatChannelConfig, key: string): string {
  const value = section[key]
  if (typeof value !== 'string' || value === '') {
    throw new ChatConfigError(key, `${key} is required to reach Tuitui`)
  }
  return value
}

/**
 * Narrow one resolved configuration section to the Tuitui fields.
 * @param section - the resolved channel configuration section.
 * @returns the validated Tuitui fields.
 * @throws {ChatConfigError} naming the first field that is missing.
 */
export function readTuituiConfig(section: ChatChannelConfig): TuituiChannelConfig {
  return {
    host: requiredField(section, 'host'),
    appId: requiredField(section, 'appId'),
    appSecretRef: requiredField(section, 'appSecretRef'),
  }
}

/**
 * Normalize one transport message into the seam's inbound message.
 *
 * `chatType` is three-valued on the platform and two-valued here: a team thread
 * behaves like a group for the purposes of quoting and the chat lock.
 * @param message - the transport's normalized inbound message.
 * @returns the seam's inbound message.
 */
export function toInboundMessage(message: IncomingMessage): ChatInboundMessage {
  return {
    chatId: brandString<ChatId>(message.chatId),
    chatKind: message.chatType === 'dm' ? 'direct' : 'group',
    messageId: brandString<ChatMessageId>(message.messageId),
    text: message.text === '' ? null : message.text,
    ...message.userName === '' ? {} : { senderName: message.userName },
  }
}

/** The outbound client the bridge sends Tuitui messages through. */
export class TuituiChatClient implements ChatClient {
  /**
   * @param transport - the Tuitui transport this client sends through.
   * @param config - the validated section naming the account a probe reports.
   */
  constructor(
    private readonly transport: TuituiTransport,
    private readonly config: TuituiChannelConfig,
  ) {}

  /**
   * Describe the account the configured credentials identify.
   *
   * The application id and host are configuration, not secrets, and are the
   * whole of what Tuitui exposes without a live call.
   * @returns the application label and the host it talks to.
   */
  checkCredentials(): Promise<ChatAccountInfo | null> {
    return Promise.resolve({
      accountLabel: `app ${this.config.appId}`,
      details: [`host ${this.config.host}`],
    })
  }

  /**
   * Send one text message into a conversation.
   * @param chatId - the Tuitui conversation to send to.
   * @param text - the message body.
   * @param options - rendering request; the transport decides per conversation
   *   whether the text is rendered as Markdown, so it is forwarded unchanged.
   * @throws {ChatUnsupportedError} when the transport refuses the send.
   */
  async sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    void options
    if (!await this.transport.sendMessage(chatId, text)) {
      throw new ChatUnsupportedError('Tuitui refused the message')
    }
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.quoting` is false and the bridge never calls this.
   */
  replyText(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('Tuitui cannot quote a specific message'))
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.outbound.files` is false and the bridge never calls this.
   */
  sendFile(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('Tuitui cannot send files'))
  }
}

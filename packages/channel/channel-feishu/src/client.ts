/**
 * The Feishu side of the chat-channel seam: configuration narrowing, capability
 * declaration, and the outbound client the bridge sends through.
 *
 * Feishu renders Markdown only inside an interactive card, so a formatted send
 * is a card whose `lark_md` element carries the downgraded text; a plain send
 * is a `text` message. The platform reports a refusal as a non-zero `code`
 * inside an HTTP 200 body, so every call is checked and a formatted refusal is
 * raised as `ChatFormatRejectedError`, which is what makes the bridge resend
 * the same chunk plainly.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import { Buffer } from 'node:buffer'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError, ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'
import type {
  ChatAccountInfo,
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatClient,
  ChatId,
  ChatMessageId,
  ChatOutboundFile,
  ChatSendOptions,
} from '@deepseek-ai/dsh-channel'
import { renderLarkMarkdown } from './markdown.ts'
import type { FeishuApi, FeishuDomain } from './types.ts'

/**
 * Characters Feishu accepts in one message body.
 *
 * The bridge chunks outbound text to this ceiling, so a chunk never arrives
 * longer than the platform takes.
 */
export const FEISHU_MAX_TEXT_CHARS = 30_000

/**
 * Bytes Feishu accepts in one uploaded file, and the largest an inbound file
 * message can therefore be.
 */
export const FEISHU_MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024

/** The application-id form Feishu issues, which its own SDK silently declines anything outside. */
const FEISHU_APP_ID = /^cli_[0-9a-fA-F]{16}$/

/** The Feishu configuration section, validated. */
export interface FeishuChannelConfig {
  /** The self-built application's id from the Feishu Open Platform console. */
  readonly appId: string
  /** The deployment whose endpoints the application signs in to. */
  readonly domain: FeishuDomain
  /** Name of the `dsh-credentials` reference holding the application secret. */
  readonly appSecretRef: string
}

/**
 * What Feishu can carry.
 *
 * Every attachment direction except outbound files is declared unsupported
 * because this connector implements no code path for it: the seam's client has
 * no image send, so an accepted image upload would be a capability nothing
 * could reach.
 */
export const FEISHU_CAPABILITIES: ChatChannelCapabilities = {
  quoting: true,
  inbound: { images: true, files: true },
  outbound: { images: false, files: true },
  markdown: true,
  maxTextChars: FEISHU_MAX_TEXT_CHARS,
  maxInboundBytes: FEISHU_MAX_ATTACHMENT_BYTES,
  maxOutboundBytes: FEISHU_MAX_ATTACHMENT_BYTES,
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
    throw new ChatConfigError(key, `${key} is required to reach Feishu`)
  }
  return value
}

/**
 * Narrow one resolved configuration section to the Feishu fields.
 *
 * The application id is checked against the form Feishu issues because the
 * official SDK declines a malformed one by logging and returning, which would
 * leave the panel reporting a connection that never receives anything. The
 * credential field is checked against the reference grammar here rather than
 * where the secret is resolved, so one function names every field a section got
 * wrong.
 * @param section - the resolved channel configuration section.
 * @returns the validated Feishu fields.
 * @throws {ChatConfigError} naming the first field that is missing or malformed.
 */
export function readFeishuConfig(section: ChatChannelConfig): FeishuChannelConfig {
  const appId = requiredField(section, 'appId')
  if (!FEISHU_APP_ID.test(appId)) {
    throw new ChatConfigError('appId', 'appId is not a Feishu application id (cli_ followed by 16 hexadecimal digits)')
  }
  const domain = section['domain']
  if (domain !== 'feishu' && domain !== 'lark') {
    throw new ChatConfigError('domain', 'domain must be feishu or lark')
  }
  const appSecretRef = requiredField(section, 'appSecretRef')
  if (!isCredentialRefName(appSecretRef)) {
    throw new ChatConfigError('appSecretRef', `${appSecretRef} is not a credential reference name`)
  }
  return { appId, domain, appSecretRef }
}

/** The platform's own refusal reason, or a fallback when it gave none. */
function refusal(response: { readonly msg?: string | undefined }, fallback: string): string {
  return response.msg === undefined || response.msg === '' ? fallback : response.msg
}

/** One outbound body in the message type Feishu renders it as. */
function messageBody(text: string, options: ChatSendOptions | undefined): { msgType: string; content: string } {
  if (options?.markdown !== true) return { msgType: 'text', content: JSON.stringify({ text }) }
  const markdown = renderLarkMarkdown(text, FEISHU_MAX_TEXT_CHARS)
  const card = { config: { wide_screen_mode: true }, elements: [{ tag: 'div', text: { tag: 'lark_md', content: markdown } }] }
  return { msgType: 'interactive', content: JSON.stringify(card) }
}

/**
 * Raise Feishu's own refusal reason.
 * @param response - the platform's response envelope.
 * @param msgType - the message type that was sent, which decides how the refusal is filed.
 * @throws {ChatFormatRejectedError} when a rendered message was refused.
 * @throws {Error} when a plain message or a file was refused.
 */
function assertAccepted(
  response: { readonly code?: number | undefined; readonly msg?: string | undefined },
  msgType: string,
): void {
  if (response.code === 0) return
  const reason = refusal(response, `Feishu refused the ${msgType} message`)
  if (msgType === 'interactive') throw new ChatFormatRejectedError(reason)
  throw new Error(reason)
}

/** The outbound client the bridge sends Feishu messages through. */
export class FeishuChatClient implements ChatClient {
  /**
   * @param api - the SDK view every call goes through.
   * @param config - the validated section naming the account a probe reports.
   * @param appSecret - the resolved application secret, which only the credential probe reads.
   */
  constructor(
    private readonly api: FeishuApi,
    private readonly config: FeishuChannelConfig,
    private readonly appSecret: string,
  ) {}

  /**
   * Exchange the configured credentials for a tenant access token.
   * @returns the application label and the token's remaining lifetime.
   * @throws {ChatConfigError} when Feishu refuses the credentials.
   */
  async checkCredentials(): Promise<ChatAccountInfo | null> {
    const response = await this.api.auth.tenantAccessToken.internal({
      data: { app_id: this.config.appId, app_secret: this.appSecret },
    })
    if (response.code !== 0) {
      throw new ChatConfigError('appSecretRef', refusal(response, 'Feishu refused the credentials'))
    }
    const expire = response.data?.expire
    return {
      accountLabel: `app ${this.config.appId}`,
      ...expire === undefined ? {} : { details: [`tenant access token valid for ${String(expire)}s`] },
    }
  }

  /**
   * Send one text message into a conversation.
   * @param chatId - the Feishu conversation to send to.
   * @param text - the message body.
   * @param options - rendering request; Markdown becomes an interactive card.
   * @throws {ChatFormatRejectedError} when a rendered card was refused.
   * @throws {Error} when Feishu refused the message.
   */
  async sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    const body = messageBody(text, options)
    const response = await this.api.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: body.msgType, content: body.content },
    })
    assertAccepted(response, body.msgType)
  }

  /**
   * Reply to one inbound message, which Feishu threads under it.
   * @param messageId - the inbound message being answered.
   * @param text - the message body.
   * @param options - rendering request; Markdown becomes an interactive card.
   * @throws {ChatFormatRejectedError} when a rendered card was refused.
   * @throws {Error} when Feishu refused the reply.
   */
  async replyText(messageId: ChatMessageId, text: string, options?: ChatSendOptions): Promise<void> {
    const body = messageBody(text, options)
    const response = await this.api.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: body.msgType, content: body.content },
    })
    assertAccepted(response, body.msgType)
  }

  /**
   * Upload one file and send it into a conversation.
   * @param chatId - the Feishu conversation to send to.
   * @param file - the bytes and display name.
   * @throws {Error} when Feishu refused the upload or the message.
   */
  async sendFile(chatId: ChatId, file: ChatOutboundFile): Promise<void> {
    const upload = await this.api.im.file.create({
      data: { file_type: 'stream', file_name: file.fileName, file: Buffer.from(file.data) },
    })
    const fileKey = upload?.file_key
    if (fileKey === undefined) throw new Error(`Feishu refused the upload of ${file.fileName}`)
    const response = await this.api.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'file', content: JSON.stringify({ file_key: fileKey }) },
    })
    assertAccepted(response, 'file')
  }
}

/**
 * The DingTalk side of the chat-channel seam: configuration narrowing, capability
 * declaration, the session webhooks a reply goes through, and the outbound
 * client the bridge sends through.
 *
 * DingTalk answers a robot message through a session webhook: the callback
 * carries a URL issued for that conversation and an epoch-millisecond stamp
 * saying when it stops working. The connector records both as inbound messages
 * arrive, and this client posts to the live one, so a reply never needs an
 * access token of its own.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError, ChatUnsupportedError } from '@deepseek-ai/dsh-channel'
import type {
  ChatAccountInfo,
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatClient,
  ChatId,
  ChatSendOptions,
} from '@deepseek-ai/dsh-channel'
import { jsonObject, jsonString } from './json.ts'
import { renderDingTalkMarkdown, titleOf } from './markdown.ts'
import type { DingTalkStream } from './types.ts'

/** Bytes DingTalk accepts in one Markdown message body. */
export const DINGTALK_MAX_TEXT_BYTES = 20_000

/**
 * Characters the bridge may put in one message.
 *
 * DingTalk's ceiling counts bytes and the bridge counts characters, so the
 * declared limit is the byte ceiling divided by UTF-8's longest encoding: no
 * message the bridge builds can exceed the platform's real ceiling, whatever it
 * is written in.
 */
export const DINGTALK_MAX_TEXT_CHARS = Math.floor(DINGTALK_MAX_TEXT_BYTES / 4)

/** Characters the notification title may carry, which is what DingTalk shows in a push. */
export const DINGTALK_MAX_TITLE_CHARS = 16

/** The DingTalk configuration section, validated. */
export interface DingTalkChannelConfig {
  /** The internal application's Client ID, which DingTalk also calls the AppKey. */
  readonly clientId: string
  /** Name of the `dsh-credentials` reference holding the Client Secret, never the secret. */
  readonly clientSecretRef: string
}

/**
 * What DingTalk can carry.
 *
 * A session webhook accepts a text or Markdown body and nothing else, so every
 * attachment direction is unsupported and the client refuses both accordingly.
 */
export const DINGTALK_CAPABILITIES: ChatChannelCapabilities = {
  quoting: false,
  inbound: { images: false, files: false },
  outbound: { images: false, files: false },
  markdown: true,
  maxTextChars: DINGTALK_MAX_TEXT_CHARS,
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
    throw new ChatConfigError(key, `${key} is required to reach DingTalk`)
  }
  return value
}

/**
 * Narrow one resolved configuration section to the DingTalk fields.
 *
 * The credential field is checked against the reference grammar here rather
 * than where the secret is resolved, so one function names every field a
 * section got wrong.
 * @param section - the resolved channel configuration section.
 * @returns the validated DingTalk fields.
 * @throws {ChatConfigError} naming the first field that is missing or malformed.
 */
export function readDingTalkConfig(section: ChatChannelConfig): DingTalkChannelConfig {
  const clientSecretRef = requiredField(section, 'clientSecretRef')
  if (!isCredentialRefName(clientSecretRef)) {
    throw new ChatConfigError('clientSecretRef', `${clientSecretRef} is not a credential reference name`)
  }
  return { clientId: requiredField(section, 'clientId'), clientSecretRef }
}

/**
 * The session webhooks DingTalk has issued, keyed by conversation.
 *
 * DingTalk expires each webhook and issues a fresh one with every inbound
 * message, so an entry is dropped the moment it is read past its stamp rather
 * than kept as a URL that no longer works.
 */
export class DingTalkWebhooks {
  private readonly live = new Map<string, { readonly url: string; readonly expiresAt: number }>()

  /**
   * Record the webhook one inbound message carried.
   * @param chatId - the conversation the message arrived in.
   * @param url - the URL a reply to that conversation is posted to.
   * @param expiresAt - when the URL stops working, as an epoch-millisecond stamp.
   */
  record(chatId: string, url: string, expiresAt: number): void {
    this.live.set(chatId, { url, expiresAt })
  }

  /**
   * The webhook one conversation can be answered through right now.
   * @param chatId - the conversation to answer.
   * @param now - the current epoch-millisecond time.
   * @returns the URL, or undefined when none was issued or the last one expired.
   */
  urlFor(chatId: string, now: number): string | undefined {
    const entry = this.live.get(chatId)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now) {
      this.live.delete(chatId)
      return undefined
    }
    return entry.url
  }
}

/** The outbound client the bridge sends DingTalk messages through. */
export class DingTalkChatClient implements ChatClient {
  /**
   * @param settings - the validated section naming the account a probe reports.
   * @param stream - the Stream client, which only the credential probe calls.
   * @param webhooks - the session webhooks inbound messages recorded.
   */
  constructor(
    private readonly settings: DingTalkChannelConfig,
    private readonly stream: DingTalkStream,
    private readonly webhooks: DingTalkWebhooks,
  ) {}

  /**
   * Exchange the configured credentials for an access token.
   *
   * The exchange is the SDK's own, so this is a live call to DingTalk rather
   * than a restatement of the configuration.
   * @returns the application label.
   */
  async checkCredentials(): Promise<ChatAccountInfo | null> {
    await this.stream.getAccessToken()
    return { accountLabel: `app ${this.settings.clientId}` }
  }

  /**
   * Send one text message into a conversation.
   * @param chatId - the DingTalk conversation to send to.
   * @param text - the message body.
   * @param options - rendering request; Markdown becomes a Markdown message.
   * @throws {ChatFormatRejectedError} when a rendered message was refused.
   * @throws {Error} when no live session webhook exists, or DingTalk refused the message.
   */
  async sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    const body = options?.markdown === true
      ? {
        msgtype: 'markdown',
        markdown: {
          title: titleOf(text, DINGTALK_MAX_TITLE_CHARS),
          text: renderDingTalkMarkdown(text, DINGTALK_MAX_TEXT_BYTES),
        },
      }
      : { msgtype: 'text', text: { content: text } }
    const url = this.webhooks.urlFor(chatId, Date.now())
    if (url === undefined) {
      throw new Error(
        `no live DingTalk session webhook for ${chatId}; DingTalk issues one with each inbound message and it expires`,
      )
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`DingTalk refused the message with HTTP ${String(response.status)}`)
    const result = jsonObject(await response.json())
    const errcode = result?.['errcode']
    if (errcode === 0) return
    throw new Error(jsonString(result?.['errmsg']) ?? 'DingTalk refused the message')
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.quoting` is false and the bridge never calls this.
   */
  replyText(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('DingTalk cannot quote a specific message'))
  }

  /**
   * @throws {ChatUnsupportedError} always; `capabilities.outbound.files` is false and the bridge never calls this.
   */
  sendFile(): Promise<void> {
    return Promise.reject(new ChatUnsupportedError('DingTalk cannot send files'))
  }
}

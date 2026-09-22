/**
 * DingTalk's inbound callback reader: the platform JSON validated into the
 * fields the seam needs, plus the session webhook the reply goes through.
 *
 * The SDK hands over the callback body as an unparsed JSON string, which is the
 * wire boundary this module validates. The session webhook is part of that
 * callback rather than a separate lookup: DingTalk answers a robot message by
 * posting to a URL it issues per conversation and stamps with an expiry, so the
 * connector records both alongside the message.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { ChatId, ChatInboundMessage, ChatMessageId } from '@deepseek-ai/dsh-channel'
import { jsonObject, jsonString } from './json.ts'

/** One validated inbound DingTalk message, before the seam's message is built. */
export interface DingTalkInbound {
  /** The conversation the message arrived in. */
  readonly chatId: string
  /** Direct chat with the robot, or a group. */
  readonly chatKind: 'direct' | 'group'
  /** The platform's message identity. */
  readonly messageId: string
  /** The message text, or null when it carried none this connector can forward. */
  readonly text: string | null
  /** The sender's display name, when the callback carried one. */
  readonly senderName?: string | undefined
  /** The URL a reply to this conversation is posted to. */
  readonly webhook: string
  /** When that URL stops working, as the platform's own epoch-millisecond stamp. */
  readonly webhookExpiresAt: number
}

/**
 * Read the text one robot callback carries.
 *
 * A text callback nests its content one level down; every other message type —
 * picture, rich text, audio, video, file — carries something this seam has no
 * capability for, so it reads as no text and the bridge answers it with its own
 * unsupported-message notice.
 * @param messageType - the callback's `msgtype`.
 * @param body - the parsed callback.
 * @returns the text, or null when the callback carried none.
 */
function readText(messageType: string, body: Record<string, unknown>): string | null {
  if (messageType !== 'text') return null
  return jsonString(jsonObject(body['text'])?.['content']) ?? null
}

/**
 * Validate one Stream robot callback into the seam's inbound fields.
 * @param data - the callback body the SDK handed over, still a JSON string.
 * @returns the validated message, or null when the body is not one.
 */
export function parseRobotCallback(data: string): DingTalkInbound | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    // The SDK hands over the callback body as a JSON string, and this parse is
    // the only statement that can throw on a body this connector cannot read.
    return null
  }
  const body = jsonObject(parsed)
  if (body === null) return null
  const messageId = jsonString(body['msgId'])
  const chatId = jsonString(body['conversationId'])
  const webhook = jsonString(body['sessionWebhook'])
  const expires = body['sessionWebhookExpiredTime']
  if (messageId === undefined || chatId === undefined || webhook === undefined) return null
  if (typeof expires !== 'number' || !Number.isFinite(expires)) return null
  const senderName = jsonString(body['senderNick'])
  return {
    chatId,
    chatKind: body['conversationType'] === '1' ? 'direct' : 'group',
    messageId,
    text: readText(jsonString(body['msgtype']) ?? '', body),
    ...senderName === undefined ? {} : { senderName },
    webhook,
    webhookExpiresAt: expires,
  }
}

/**
 * Build the seam's inbound message from one validated callback.
 * @param event - the validated callback.
 * @returns the seam's inbound message.
 */
export function toInboundMessage(event: DingTalkInbound): ChatInboundMessage {
  return {
    chatId: brandString<ChatId>(event.chatId),
    chatKind: event.chatKind,
    messageId: brandString<ChatMessageId>(event.messageId),
    text: event.text,
    ...event.senderName === undefined ? {} : { senderName: event.senderName },
  }
}

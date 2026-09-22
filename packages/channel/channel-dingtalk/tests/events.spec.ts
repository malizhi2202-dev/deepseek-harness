import { describe, expect, it } from 'vitest'
import { parseRobotCallback, toInboundMessage } from '../src/events.ts'
import type { DingTalkInbound } from '../src/events.ts'

/** One robot callback body, as the Stream SDK hands it over. */
function callback(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    msgId: 'msg-1',
    conversationId: 'cid-1',
    conversationType: '1',
    msgtype: 'text',
    text: { content: 'hello' },
    senderNick: 'Test User',
    sessionWebhook: 'https://example.invalid/webhook',
    sessionWebhookExpiredTime: 1_700_000_000_000,
    ...overrides,
  })
}

describe('parseRobotCallback', () => {
  it('reads a direct text callback in full', () => {
    expect(parseRobotCallback(callback())).toEqual({
      chatId: 'cid-1',
      chatKind: 'direct',
      messageId: 'msg-1',
      text: 'hello',
      senderName: 'Test User',
      webhook: 'https://example.invalid/webhook',
      webhookExpiresAt: 1_700_000_000_000,
    })
  })

  it('reads every conversation type other than a one-to-one chat as a group', () => {
    expect(parseRobotCallback(callback({ conversationType: '2' }))).toMatchObject({ chatKind: 'group' })
    expect(parseRobotCallback(callback({ conversationType: undefined }))).toMatchObject({ chatKind: 'group' })
  })

  it('reads a message type this connector cannot forward as no text', () => {
    expect(parseRobotCallback(callback({ msgtype: 'picture', text: { content: 'ignored' } })))
      .toMatchObject({ text: null })
    expect(parseRobotCallback(callback({ msgtype: undefined }))).toMatchObject({ text: null })
  })

  it('reads a text callback with no content, or content that is not a string, as no text', () => {
    expect(parseRobotCallback(callback({ text: {} }))).toMatchObject({ text: null })
    expect(parseRobotCallback(callback({ text: { content: '' } }))).toMatchObject({ text: null })
    expect(parseRobotCallback(callback({ text: { content: 7 } }))).toMatchObject({ text: null })
    expect(parseRobotCallback(callback({ text: 'not an object' }))).toMatchObject({ text: null })
  })

  it('omits the sender name when the callback carried none', () => {
    const parsed = parseRobotCallback(callback({ senderNick: undefined }))
    expect(parsed).not.toBeNull()
    expect('senderName' in (parsed ?? {})).toBe(false)
    expect(parseRobotCallback(callback({ senderNick: '' }))).not.toHaveProperty('senderName')
  })

  it('refuses a body that is not JSON, or that is JSON but not an object', () => {
    expect(parseRobotCallback('not json')).toBeNull()
    expect(parseRobotCallback('[1,2,3]')).toBeNull()
    expect(parseRobotCallback('null')).toBeNull()
    expect(parseRobotCallback('"a string"')).toBeNull()
  })

  it('refuses a callback missing any field it needs', () => {
    for (const missing of ['msgId', 'conversationId', 'sessionWebhook']) {
      expect(parseRobotCallback(callback({ [missing]: undefined }))).toBeNull()
      expect(parseRobotCallback(callback({ [missing]: '' }))).toBeNull()
      expect(parseRobotCallback(callback({ [missing]: 7 }))).toBeNull()
    }
  })

  it('refuses a callback whose webhook expiry is not a finite number', () => {
    for (const expires of [undefined, '', 'later', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseRobotCallback(callback({ sessionWebhookExpiredTime: expires }))).toBeNull()
    }
  })
})

describe('toInboundMessage', () => {
  /** One validated callback, overridden per test. */
  function inbound(overrides: Partial<DingTalkInbound> = {}): DingTalkInbound {
    return {
      chatId: 'cid-1',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
      webhook: 'https://example.invalid/webhook',
      webhookExpiresAt: 1_700_000_000_000,
      ...overrides,
    }
  }

  it('carries the conversation, the message identity, and the text', () => {
    expect(toInboundMessage(inbound())).toEqual({
      chatId: 'cid-1',
      chatKind: 'group',
      messageId: 'msg-1',
      text: 'hello',
    })
  })

  it('carries the sender name only when the callback had one', () => {
    expect(toInboundMessage(inbound({ senderName: 'Test User' }))).toMatchObject({ senderName: 'Test User' })
    expect('senderName' in toInboundMessage(inbound())).toBe(false)
  })

  it('carries no media handles, because DingTalk delivers none this connector reads', () => {
    const message = toInboundMessage(inbound())
    expect('images' in message).toBe(false)
    expect('files' in message).toBe(false)
  })
})

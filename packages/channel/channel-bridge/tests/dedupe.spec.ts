/**
 * Tests for one binding's two dedupe memories: the durable chat lock and
 * watermark read from the bound Session's own log, and the bounded in-process
 * ring of recently processed platform ids.
 */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { channelLogMemory, RecentInboundIds } from '../src/dedupe.ts'
import type { ChatChannelId, ChatId, ChatMessageId } from '@deepseek-ai/dsh-channel'

/** One channel-sourced message a test Session's log carries. */
interface LoggedMessage {
  readonly channel: string
  readonly chatId: string
  readonly chatKind: 'direct' | 'group'
  readonly messageId: string
}

/** The channel the log memory is read for in these tests. */
const TUITUI: ChatChannelId = 'tuitui'

/** One detached Session carrying the channel-sourced messages a test needs. */
function sessionWithChannelMessages(messages: readonly LoggedMessage[]): Session {
  const session = Session.create(SessionId('session-test'))
  for (const message of messages) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: {
        kind: 'channel',
        channel: TUITUI,
        chatId: brandString<ChatId>(message.chatId),
        chatKind: message.chatKind,
        messageId: brandString<ChatMessageId>(message.messageId),
      },
    }), { surfaceOp: 'append' })
  }
  return session
}

describe('channelLogMemory', () => {
  it('reports nothing for a Session this channel never spoke to', () => {
    expect(channelLogMemory(Session.create(SessionId('empty')), TUITUI)).toEqual({
      lockedChatId: undefined,
      lockedChatIsDirect: false,
      watermark: undefined,
    })
  })

  it('locks the first conversation and watermarks the newest message', () => {
    const session = sessionWithChannelMessages([
      { channel: 'tuitui', chatId: 'chat-a', chatKind: 'direct', messageId: 'm-1' },
      { channel: 'tuitui', chatId: 'chat-a', chatKind: 'direct', messageId: 'm-2' },
    ])
    expect(channelLogMemory(session, TUITUI)).toEqual({
      lockedChatId: 'chat-a',
      lockedChatIsDirect: true,
      watermark: 'm-2',
    })
  })

  it('keeps the first conversation even after a second one speaks', () => {
    const session = sessionWithChannelMessages([
      { channel: 'tuitui', chatId: 'chat-a', chatKind: 'group', messageId: 'm-1' },
      { channel: 'tuitui', chatId: 'chat-b', chatKind: 'direct', messageId: 'm-2' },
    ])
    expect(channelLogMemory(session, TUITUI)).toEqual({
      lockedChatId: 'chat-a',
      lockedChatIsDirect: false,
      watermark: 'm-2',
    })
  })

  it('ignores messages another channel admitted', () => {
    const session = Session.create(SessionId('other-channel'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: {
        kind: 'channel',
        channel: 'other' as ChatChannelId,
        chatId: 'chat-b' as never,
        chatKind: 'direct',
        messageId: 'm-1' as never,
      },
    }), { surfaceOp: 'append' })
    expect(channelLogMemory(session, TUITUI).lockedChatId).toBeUndefined()
  })

  it('ignores a user message that did not come from a channel', () => {
    const session = Session.create(SessionId('plain'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'typed in the app' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(channelLogMemory(session, TUITUI).watermark).toBeUndefined()
  })

  it('ignores a turn event that is not a user message', () => {
    const session = Session.create(SessionId('turns'))
    session.append('turn/start', { turn: 1 })
    expect(channelLogMemory(session, TUITUI).lockedChatId).toBeUndefined()
  })

  it('leaves the watermark unset for a message the platform gave no id', () => {
    const session = sessionWithChannelMessages([
      { channel: 'tuitui', chatId: 'chat-a', chatKind: 'direct', messageId: '' },
    ])
    const memory = channelLogMemory(session, TUITUI)
    expect(memory.lockedChatId).toBe('chat-a')
    expect(memory.watermark).toBeUndefined()
  })
})

describe('RecentInboundIds', () => {
  it('reports an id it was told to remember', () => {
    const ring = new RecentInboundIds(4)
    expect(ring.check('m-1')).toBe(false)
    ring.remember('m-1')
    expect(ring.check('m-1')).toBe(true)
  })

  it('releases an id that was refused rather than admitted', () => {
    const ring = new RecentInboundIds(4)
    ring.remember('m-1')
    ring.forget('m-1')
    expect(ring.check('m-1')).toBe(false)
  })

  it('evicts the oldest id once the ring is full', () => {
    const ring = new RecentInboundIds(2)
    ring.remember('m-1')
    ring.remember('m-2')
    ring.remember('m-3')
    expect(ring.check('m-1')).toBe(false)
    expect(ring.check('m-2')).toBe(true)
    expect(ring.check('m-3')).toBe(true)
  })

  it('ignores an empty id, which is the platform opting out of dedupe', () => {
    const ring = new RecentInboundIds(2)
    ring.remember('')
    expect(ring.check('')).toBe(false)
  })
})

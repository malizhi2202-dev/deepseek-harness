/**
 * Pins the QQ passive-reply ledger at its boundaries: the sequence counts from
 * one and advances per reply, the five-minute window is inclusive at its start
 * and exclusive at its end, an unknown conversation or message claims nothing,
 * and both indexes stay inside their bound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ChatId, ChatMessageId } from '@deepseek-ai/dsh-channel'
import { PASSIVE_REPLY_WINDOW_MS, PassiveReplies } from '../src/replies.ts'

/** One conversation id, branded the way the seam's boundary brands it. */
function chat(value: string): ChatId {
  return brandString<ChatId>(value)
}

/** One message id, branded the way the seam's boundary brands it. */
function message(value: string): ChatMessageId {
  return brandString<ChatMessageId>(value)
}

describe('PassiveReplies', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('claims the first reply at sequence one and advances per reply', () => {
    const ledger = new PassiveReplies(8)
    ledger.remember(chat('group:1'), message('m1'))

    expect(ledger.claim(chat('group:1'))).toEqual({ chatId: 'group:1', messageId: 'm1', seq: 1 })
    expect(ledger.claim(chat('group:1'))).toEqual({ chatId: 'group:1', messageId: 'm1', seq: 2 })
    expect(ledger.claimMessage(message('m1'))).toEqual({ chatId: 'group:1', messageId: 'm1', seq: 3 })
  })

  it('claims nothing for a conversation or message it never saw', () => {
    const ledger = new PassiveReplies(8)
    expect(ledger.claim(chat('group:1'))).toBeUndefined()
    expect(ledger.claimMessage(message('m1'))).toBeUndefined()
  })

  it('keeps a message replyable one millisecond before the window closes', () => {
    const ledger = new PassiveReplies(8)
    ledger.remember(chat('group:1'), message('m1'))

    vi.advanceTimersByTime(PASSIVE_REPLY_WINDOW_MS - 1)
    expect(ledger.claim(chat('group:1'))).toMatchObject({ seq: 1 })
  })

  it('claims nothing at exactly the window and drops the entry', () => {
    const ledger = new PassiveReplies(8)
    ledger.remember(chat('group:1'), message('m1'))

    vi.advanceTimersByTime(PASSIVE_REPLY_WINDOW_MS)
    expect(ledger.claim(chat('group:1'))).toBeUndefined()
    expect(ledger.claimMessage(message('m1'))).toBeUndefined()
  })

  it('forgets the oldest message once the ledger is full', () => {
    const ledger = new PassiveReplies(1)
    ledger.remember(chat('group:1'), message('m1'))
    ledger.remember(chat('group:2'), message('m2'))

    expect(ledger.claimMessage(message('m1'))).toBeUndefined()
    expect(ledger.claim(chat('group:2'))).toMatchObject({ messageId: 'm2', seq: 1 })
  })

  it('forgets the oldest conversation once the chat index is full', () => {
    const ledger = new PassiveReplies(1)
    ledger.remember(chat('group:1'), message('m1'))
    ledger.remember(chat('group:2'), message('m2'))

    expect(ledger.claim(chat('group:1'))).toBeUndefined()
    expect(ledger.claim(chat('group:2'))).toMatchObject({ messageId: 'm2' })
  })

  it('re-points a conversation at its newest message', () => {
    const ledger = new PassiveReplies(8)
    ledger.remember(chat('group:1'), message('m1'))
    ledger.remember(chat('group:1'), message('m2'))

    expect(ledger.claim(chat('group:1'))).toMatchObject({ messageId: 'm2', seq: 1 })
    expect(ledger.claimMessage(message('m1'))).toMatchObject({ messageId: 'm1', seq: 1 })
  })
})

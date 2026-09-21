/**
 * Inbound deduplication for one binding.
 *
 * A platform redelivers: a socket that reconnects replays what it was not
 * acknowledged for, and nothing downstream is idempotent — a queued follow-up
 * becomes a second run and a second chat message. Two memories answer it. The
 * bounded ring catches a replay inside the current process; the durable
 * watermark catches one across a restart, and it is DERIVED from the session
 * log rather than stored beside it: the admitted message is already a
 * `user/message` event whose source carries the platform id, so the log is the
 * one authoritative record and no second persistence domain is needed.
 *
 * The watermark is written last in the only sense that matters here. The
 * session commits that event when the turn claims the input, which is after the
 * message was admitted and after its media transferred, so a crash before the
 * commit leaves no watermark and the platform's replay is admitted again:
 * at-least-once, never a silently swallowed message.
 *
 * @module @deepseek-ai/dsh-channel-bridge
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { ChatChannelId, ChatId, ChatMessageId } from '@deepseek-ai/dsh-channel'

/** The durable memory one bound Session's log holds for one channel. */
export interface ChannelLogMemory {
  /** The conversation that first spoke to this channel; the binding answers it and only it. */
  readonly lockedChatId: ChatId | undefined
  /** Whether that conversation is a direct chat, where nothing is quoted. */
  readonly lockedChatIsDirect: boolean
  /** The platform id of the most recently admitted message, or undefined when none was. */
  readonly watermark: ChatMessageId | undefined
}

/**
 * Read one Session's durable channel memory.
 *
 * The scan is bounded by the session's own log and runs once per connection,
 * not per message.
 * @param session - the bound Session whose log is the durable record.
 * @param channel - the channel whose admitted messages are read.
 * @returns the locked conversation and the watermark; both undefined when this channel admitted nothing.
 */
export function channelLogMemory(session: Session, channel: ChatChannelId): ChannelLogMemory {
  let lockedChatId: ChatId | undefined
  let lockedChatIsDirect = false
  let watermark: ChatMessageId | undefined
  for (const event of session.ownEvents()) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind !== 'channel' || source.channel !== channel) continue
    if (lockedChatId === undefined) {
      lockedChatId = source.chatId
      lockedChatIsDirect = source.chatKind === 'direct'
    }
    if (source.messageId !== '') watermark = source.messageId
  }
  return { lockedChatId, lockedChatIsDirect, watermark }
}

/**
 * The platform message ids one binding has already processed, newest last.
 *
 * The ring is bounded by count rather than age: a platform's redelivery window
 * is small, and an unbounded set would grow for the life of a process.
 */
export class RecentInboundIds {
  private readonly seen = new Set<string>()

  /**
   * @param size - how many ids to remember; at least 1.
   */
  constructor(private readonly size: number) {}

  /**
   * Whether this id was already processed.
   * @param messageId - the platform message id to test.
   * @returns true when the id is in the ring.
   */
  check(messageId: string): boolean {
    return this.seen.has(messageId)
  }

  /**
   * Stop treating one id as processed, for a message that was refused rather
   * than admitted. Without this a message the chat was told about would be
   * dropped silently when the platform redelivers it.
   * @param messageId - the platform message id to release.
   */
  forget(messageId: string): void {
    this.seen.delete(messageId)
  }

  /**
   * Record one processed id, evicting the oldest once the ring is full. An
   * empty id is ignored: it is the platform's way of opting out of dedupe.
   * @param messageId - the platform message id to remember.
   */
  remember(messageId: string): void {
    if (messageId === '') return
    this.seen.add(messageId)
    while (this.seen.size > this.size) {
      const oldest: string | undefined = this.seen.values().next().value
      if (oldest === undefined) break
      this.seen.delete(oldest)
    }
  }
}

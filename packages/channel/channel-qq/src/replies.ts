/**
 * The passive-reply ledger.
 *
 * QQ accepts a group or single-chat message only as a reply to a message the bot
 * received: the send carries that message's id as `msg_id` and a `msg_seq` that
 * counts the replies already sent for it. The platform refuses a repeated
 * `msg_id` and `msg_seq` pair, so the sequence is what makes a second reply to
 * the same message possible at all.
 *
 * The platform bounds how long a message stays replyable. Its own table states
 * five minutes for a group and sixty for a single chat while the same page's
 * `msg_id` description states five for both; this ledger takes the tighter
 * window. Past it there is nothing to ride on, and the client refuses rather
 * than sending an active message, which is a different platform capability with
 * its own quota.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

/** How long a received message stays replyable, in milliseconds. */
export const PASSIVE_REPLY_WINDOW_MS = 5 * 60_000

/** One passive reply about to be sent. */
export interface QqPassiveReply {
  /** The conversation the reply goes into. */
  readonly chatId: string
  /** The received message the reply rides on. */
  readonly messageId: string
  /** The reply's sequence for that message, counting from one. */
  readonly seq: number
}

/** One received message a reply can still ride on. */
interface ReplyWindow {
  /** The conversation the message arrived in. */
  readonly chatId: string
  /** How many replies this message has already carried. */
  seq: number
  /** When the platform stops accepting a passive reply to it. */
  readonly expiresAt: number
}

/** The received messages one connector can still reply to. */
export class PassiveReplies {
  private readonly byMessage = new Map<string, ReplyWindow>()
  private readonly latestByChat = new Map<string, string>()

  /**
   * @param limit - the most received messages this ledger remembers.
   */
  constructor(private readonly limit: number) {}

  /**
   * Record one received message as replyable.
   * @param chatId - the conversation it arrived in.
   * @param messageId - the platform's id for it.
   */
  remember(chatId: string, messageId: string): void {
    this.byMessage.set(messageId, {
      chatId,
      seq: 0,
      expiresAt: Date.now() + PASSIVE_REPLY_WINDOW_MS,
    })
    this.latestByChat.set(chatId, messageId)
    this.trim()
  }

  /**
   * Claim the next reply to the newest message one conversation sent.
   * @param chatId - the conversation to reply into.
   * @returns the reply to send, or undefined when nothing in that conversation is still replyable.
   */
  claim(chatId: string): QqPassiveReply | undefined {
    const messageId = this.latestByChat.get(chatId)
    return messageId === undefined ? undefined : this.claimMessage(messageId)
  }

  /**
   * Claim the next reply to one named message.
   * @param messageId - the message to reply to.
   * @returns the reply to send, or undefined when that message is unknown or no longer replyable.
   */
  claimMessage(messageId: string): QqPassiveReply | undefined {
    const window = this.byMessage.get(messageId)
    if (window === undefined) return undefined
    if (Date.now() >= window.expiresAt) {
      this.byMessage.delete(messageId)
      return undefined
    }
    window.seq += 1
    return { chatId: window.chatId, messageId, seq: window.seq }
  }

  /** Drop the oldest entries once either index outgrows its bound. */
  private trim(): void {
    if (this.byMessage.size > this.limit) {
      const excess = [...this.byMessage.keys()].slice(0, this.byMessage.size - this.limit)
      for (const key of excess) this.byMessage.delete(key)
    }
    if (this.latestByChat.size > this.limit) {
      const stale = [...this.latestByChat.keys()].slice(0, this.latestByChat.size - this.limit)
      for (const key of stale) this.latestByChat.delete(key)
    }
  }
}

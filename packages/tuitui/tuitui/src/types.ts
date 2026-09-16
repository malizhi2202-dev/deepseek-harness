/**
 * Tuitui bridge wire types: normalized inbound messages and callbacks, the
 * outbound transport seam, and the model-visible message source kind.
 *
 * @module @deepseek-ai/dsh-tuitui
 */

/** The three Tuitui conversation scopes the bridge understands. */
export type ChatType = 'dm' | 'group' | 'channel'

/** One normalized inbound Tuitui chat message. */
export interface IncomingMessage {
  /** Stable per-conversation identity (user account, group id, or `teams_...`). */
  readonly chatId: string
  readonly chatType: ChatType
  readonly chatName: string
  /** Sender's Tuitui account; empty for some team-post shapes. */
  readonly userId: string
  readonly userName: string
  readonly messageId: string
  readonly text: string
  /** Media URLs (images, files, voice, video) attached to the message. */
  readonly mediaUrls: readonly string[]
  /** Referenced message id when the sender replied to one of the bot's own messages. */
  readonly replyToMessageId?: string
  /** Lossless parsed event body for diagnostics. */
  readonly raw: Record<string, unknown>
}

/** One button or form callback from an interactive message (the /tree card). */
export interface IncomingCallback {
  readonly chatId: string
  readonly chatType: ChatType
  readonly userId: string
  readonly userName: string
  readonly messageId: string
  /** The JSON-encoded action value carried by the pressed button. */
  readonly actionValue: string
  /** Concatenated form-field text, when the card carried an input. */
  readonly fieldsText: string
  readonly raw: Record<string, unknown>
}

/** Outbound transport seam. The real client is the Tuitui WebSocket + HTTP client; tests inject a stub. */
export interface TuituiTransport {
  /** Open the connection (WebSocket + HTTP client) and begin receiving. */
  connect(): Promise<void>
  /** Close the connection and release resources. */
  disconnect(): Promise<void>
  /** Register the inbound message consumer (one-shot, called before connect). */
  onMessage(handler: (message: IncomingMessage) => void): void
  /** Register the inbound interactive-callback consumer. */
  onCallback(handler: (callback: IncomingCallback) => void): void
  /** Send one text message (long content is chunked internally). */
  sendMessage(chatId: string, content: string): Promise<boolean>
  /** React to one inbound message with an emoji. */
  sendReaction(chatId: string, messageId: string, emoji: string): Promise<boolean>
  /** Send one interactive card; resolves the new message id when assigned. */
  sendInteractive(chatId: string, interactive: Record<string, unknown>): Promise<string | undefined>
  /** Update an existing interactive card in place. */
  updateInteractive(chatId: string, messageId: string, interactive: Record<string, unknown>): Promise<boolean>
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user prompt admitted through the Tuitui bridge. */
    tuitui: {
      readonly kind: 'tuitui'
      readonly chatId: string
      readonly chatType: ChatType
      readonly senderId: string
      readonly senderName: string
    }
  }
}

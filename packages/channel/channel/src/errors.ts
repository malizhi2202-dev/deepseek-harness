/**
 * Typed failures of the chat-channel seam, and the one place a failure is
 * classified.
 *
 * Classification is by type at a named catch site, never by matching message
 * text: a connector's prose is platform copy that changes without notice, while
 * the class it throws is a declared contract. A site that tells the chat what
 * happened and a typed refusal the sender can act on together make a failure
 * `expected`; anything else is `unexpected` and belongs on the panel's status
 * line rather than in a chat bubble.
 *
 * @module @deepseek-ai/dsh-channel
 */

/** One chat-channel failure, tagged with a stable machine code. */
export class ChatChannelError extends Error {
  /** Stable machine code for consumers that map this to their own taxonomy. */
  readonly code: string

  /**
   * @param code - stable machine code.
   * @param message - the reason, safe to show a chat: no credential, URL, or token.
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ChatChannelError'
    this.code = code
  }
}

/** A transfer refused because it would exceed the caller's byte cap. */
export class ChatMediaTooLargeError extends ChatChannelError {
  /** The ceiling the transfer was refused at, which is what the notice names. */
  readonly maxBytes: number

  /**
   * @param maxBytes - the ceiling that refused the transfer.
   */
  constructor(maxBytes: number) {
    super('CHAT_MEDIA_TOO_LARGE', `attachment exceeds ${String(maxBytes)} bytes`)
    this.name = 'ChatMediaTooLargeError'
    this.maxBytes = maxBytes
  }
}

/**
 * The platform refused the rendered form of a message. The bridge answers it by
 * resending the same text plainly, so an ordinary occurrence never reaches a
 * user; only a plain send that also fails is reported.
 */
export class ChatFormatRejectedError extends ChatChannelError {
  /**
   * @param message - the platform's own refusal reason.
   */
  constructor(message: string) {
    super('CHAT_FORMAT_REJECTED', message)
    this.name = 'ChatFormatRejectedError'
  }
}

/** The platform structurally cannot carry this, and will refuse the next one identically. */
export class ChatUnsupportedError extends ChatChannelError {
  /**
   * @param message - what the platform cannot carry.
   */
  constructor(message: string) {
    super('CHAT_UNSUPPORTED', message)
    this.name = 'ChatUnsupportedError'
  }
}

/** The platform refused because the bot's application lacks a permission. */
export class ChatPermissionError extends ChatChannelError {
  /** The scopes that would satisfy the call. */
  readonly scopes: readonly string[]
  /** The platform console page that grants them, or null when it has none. */
  readonly grantUrl: string | null

  /**
   * @param message - the platform's own refusal reason.
   * @param scopes - the scopes that would satisfy the call.
   * @param grantUrl - the console page that grants them, or null.
   */
  constructor(message: string, scopes: readonly string[], grantUrl: string | null) {
    super('CHAT_PERMISSION', message)
    this.name = 'ChatPermissionError'
    this.scopes = scopes
    this.grantUrl = grantUrl
  }
}

/**
 * The configuration cannot build a client or a connection: a required field or
 * a referenced credential is missing or unusable. The one failure a panel user
 * fixes directly, so the message names the field that needs attention.
 */
export class ChatConfigError extends ChatChannelError {
  /** The configuration field or credential reference that needs attention. */
  readonly field: string

  /**
   * @param field - the field or credential reference that needs attention.
   * @param message - what is wrong with it.
   */
  constructor(field: string, message: string) {
    super('CHAT_CONFIG', message)
    this.name = 'ChatConfigError'
    this.field = field
  }
}

/**
 * Where a failure was caught. Named because the same failure type is classified
 * differently at different sites: only the sites that answer the chat can make
 * a permission refusal `expected`.
 */
export type ChatErrorSite =
  | 'inbound-image'
  | 'inbound-file'
  | 'outbound-text'
  | 'outbound-file'
  | 'connect'
  | 'probe'

/** Whether a failure needs a human, or is the system working as designed. */
export type ChatErrorKind = 'expected' | 'unexpected'

/**
 * The capture points that put the refusal in front of the person in the chat.
 * A permission failure caught anywhere else leaves the chat hearing nothing, so
 * it is still something an operator has to notice.
 */
const SITES_TELLING_THE_CHAT = new Set<ChatErrorSite>(['inbound-image', 'inbound-file', 'outbound-file'])

/**
 * How one channel failure should be filed.
 *
 * `expected` needs both halves: a typed refusal this code understands, caught
 * somewhere the chat is told about it. A size refusal is the sender's to fix
 * and the chat says so; an unsupported message will be refused identically
 * forever, so counting it as a defect only teaches people to ignore the count;
 * a permission refusal names the scope to grant and where to grant it; a
 * configuration refusal names the field to fix.
 *
 * Everything else — a network failure, a platform 5xx, a defect here — stays
 * `unexpected`, which is the safe direction: a real fault miscounted as routine
 * is invisible, while routine noise miscounted as a fault is merely loud.
 * @param error - what the capture site caught.
 * @param site - the named capture point.
 * @returns `expected` for a typed refusal the person in the chat can act on, `unexpected` otherwise.
 */
export function chatErrorKind(error: unknown, site: ChatErrorSite): ChatErrorKind {
  if (error instanceof ChatMediaTooLargeError || error instanceof ChatUnsupportedError) return 'expected'
  if (error instanceof ChatConfigError) return 'expected'
  if (error instanceof ChatPermissionError) {
    return SITES_TELLING_THE_CHAT.has(site) ? 'expected' : 'unexpected'
  }
  return 'unexpected'
}

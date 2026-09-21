/**
 * Type surface of the chat-channel connector seam. Types only, so a provider's
 * schema declaration and a consumer's wire declaration read one module without
 * loading Host runtime code.
 *
 * A provider extends {@link ChatChannelIdMap} from this module
 * (`@deepseek-ai/dsh-channel/types`) rather than editing this package, and the
 * inbound message source this seam contributes to `MessageSourceMap` names the
 * channel, conversation, and sender so the model learns where a prompt came
 * from.
 *
 * @module @deepseek-ai/dsh-channel/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type Schema from '@deepseek-ai/schemastery'
// Import the module so the declaration at the end of this file augments its
// source map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-llm'

/**
 * Every chat platform this build knows, keyed by its id.
 *
 * Merge-extensible: a provider adds its own key from its `./types` module, so
 * adding a platform never edits the seam Definition. The map is seeded with the
 * one channel this repository ships.
 */
export interface ChatChannelIdMap {
  /** Tuitui (推推). */
  tuitui: 'tuitui'
}

/**
 * The id of one chat platform, derived from {@link ChatChannelIdMap}. Switch on
 * it and fall through an unrecognized value: the map is merge-extensible, so a
 * build that does not know a platform still reads the type.
 */
export type ChatChannelId = ChatChannelIdMap[keyof ChatChannelIdMap]

/** Opaque, platform-scoped conversation id. The bridge never interprets it. */
export type ChatId = Branded<'chat-id'>

/**
 * Opaque, platform-scoped message identity, minted by the connector and
 * consumed by `replyText`. Empty opts the channel out of deduplication, which
 * is the honest answer for a platform with no message identity.
 */
export type ChatMessageId = Branded<'chat-message-id'>

/**
 * A lazily fetched inbound attachment. Bytes are never transferred until the
 * bridge has admitted the message, and the byte cap rides into the transfer so
 * an oversized attachment is refused at the byte that crosses it rather than
 * buffered whole and measured afterwards.
 */
export interface ChatInboundFile {
  /**
   * The sender's own file name, extension included — channel text, neither
   * trusted nor pre-sanitized here. A channel with no name for a file says so
   * with a plain fallback rather than inventing an extension.
   */
  readonly fileName: string
  /**
   * Download the file, refusing anything past `maxBytes`.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the file's exact bytes.
   * @throws ChatMediaTooLargeError when the transfer would exceed `maxBytes`.
   * @throws Error with the platform's own reason when no transfer could be made.
   */
  fetch(maxBytes: number): Promise<Uint8Array>
}

/** A lazily fetched inbound image; see {@link ChatInboundFile} for why it is a handle. */
export interface ChatInboundImage {
  /**
   * Download the image, refusing anything past `maxBytes`.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the image bytes and the media type the bridge validates them as.
   * @throws ChatMediaTooLargeError when the transfer would exceed `maxBytes`.
   * @throws Error with the platform's own reason when no transfer could be made.
   */
  fetch(maxBytes: number): Promise<{ readonly data: Uint8Array; readonly mime: string }>
}

/** One normalized inbound chat message. Media is a lazy handle, never a URL or bytes. */
export interface ChatInboundMessage {
  /** Channel-scoped conversation id; the reply target for a direct chat. Opaque to the bridge. */
  readonly chatId: ChatId
  /** Direct chat with the bot, or a group chat (groups prefer a reply-to-message). */
  readonly chatKind: 'direct' | 'group'
  /** The platform's message identity: the dedupe key. Empty opts out of dedupe. */
  readonly messageId: ChatMessageId
  /**
   * The message text, or null when the message carries no text. An image or file
   * sent with a caption puts the caption here: the caption IS this message's
   * text, so a channel needs no second field for it.
   */
  readonly text: string | null
  /** Images attached to this message, in the order the user sees them. */
  readonly images?: readonly ChatInboundImage[]
  /** Non-image files attached to this message, in the order the user sees them. */
  readonly files?: readonly ChatInboundFile[]
  /** Sender display name when the platform's event carries one. */
  readonly senderName?: string
}

/** One outbound file: the bytes, plus the name the chat should show. */
export interface ChatOutboundFile {
  /** Display name — the base name of the workspace-relative path the reply named. */
  readonly fileName: string
  /** The file's exact bytes. */
  readonly data: Uint8Array
}

/** How one outbound text should be rendered. Absent throughout means plain text. */
export interface ChatSendOptions {
  /**
   * Read the text as Markdown and render it in whatever this platform's markup
   * is. A REQUEST, not an instruction: the connector owns what its platform can
   * show and must fall back to sending the same text plainly rather than let a
   * formatting failure cost the message.
   */
  readonly markdown?: boolean
}

/**
 * Outbound operations one platform client offers. Every method rejects on
 * failure with a readable reason; a connector keeps credentials out of that
 * reason, because it reaches the chat.
 */
export interface ChatClient {
  /**
   * Probe the credentials and describe the account.
   * @returns the account facts the platform can state, or null when it offers none.
   * @throws ChatConfigError when the configuration cannot sign in.
   */
  checkCredentials(): Promise<ChatAccountInfo | null>
  /**
   * Send one text message into a chat.
   * @param chatId - the conversation to send to.
   * @param text - the message body.
   * @param options - rendering request; see {@link ChatSendOptions}.
   */
  sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void>
  /**
   * Reply to one inbound message, which threads correctly in a group chat.
   * @param messageId - the inbound message being answered.
   * @param text - the message body.
   * @param options - rendering request; see {@link ChatSendOptions}.
   */
  replyText(messageId: ChatMessageId, text: string, options?: ChatSendOptions): Promise<void>
  /**
   * Send one file into a chat. Required even on a platform that carries no
   * files: such a connector reports `capabilities.outbound.files: false`, the
   * bridge then never calls this, and the method rejects with
   * {@link ChatUnsupportedError} if some other caller does.
   * @param chatId - the conversation to send to.
   * @param file - the bytes and display name.
   */
  sendFile(chatId: ChatId, file: ChatOutboundFile): Promise<void>
}

/** What a successful credential probe learned about the account. */
export interface ChatAccountInfo {
  /** Short human-readable label of the account the credentials sign in as. */
  readonly accountLabel?: string
  /** Additional account facts the panel shows, one line each. */
  readonly details?: readonly string[]
}

/** Handlers the connector reports through. `connect` resolves once the connection is CONSTRUCTED. */
export interface ChatConnectorHandlers {
  /** One normalized inbound message. A synchronous handler must not throw. */
  readonly onMessage: (message: ChatInboundMessage) => void
  /** The connection completed a handshake; may fire again after an automatic reconnect. */
  readonly onReady?: () => void
  /** The connection failed and the platform gave up, or the initial connect failed. */
  readonly onError?: (error: unknown) => void
}

/**
 * What a platform cannot do, declared by its connector so the panel states the
 * limits instead of letting a user discover them from silence.
 */
export interface ChatChannelCapabilities {
  /** Whether `replyText` can quote the inbound message on this platform. */
  readonly quoting: boolean
  /** Which attachment kinds the platform delivers inbound. */
  readonly inbound: {
    /** Whether the platform hands over images. */
    readonly images: boolean
    /** Whether the platform hands over non-image files. */
    readonly files: boolean
  }
  /** Which attachment kinds the platform accepts outbound. */
  readonly outbound: {
    /** Whether the platform accepts an image upload. */
    readonly images: boolean
    /** Whether the platform accepts a non-image file upload. */
    readonly files: boolean
  }
  /** Whether the platform renders any markdown subset from `markdown: true`. */
  readonly markdown: boolean
  /** Largest outbound text the platform accepts in one message; absent when the platform caps none. */
  readonly maxTextChars?: number
  /** Largest inbound attachment the platform will hand over; absent when the platform caps none. */
  readonly maxInboundBytes?: number
  /** Largest outbound attachment the platform accepts; absent when the platform caps none. */
  readonly maxOutboundBytes?: number
}

/**
 * One channel's configuration surface. The connector owns the channel-specific
 * section; the bridge composes the shared `enabled` and `sessionId` fields
 * around it and registers the namespace, so one channel means one namespace.
 */
export interface ChatChannelSettings {
  /** The `dsh-settings` namespace holding this channel's configuration, matching `^[a-z][a-z0-9-]*$`. */
  readonly namespace: string
  /**
   * The channel-specific section's schema, which the bridge registers around
   * the shared fields it owns and the configuration panel renders. Unparameterized
   * because a schema's own value type appears in a contravariant position, so no
   * concrete `Schema<T>` is assignable to a wider parameterization; the resolved
   * section is narrowed where the bridge reads it.
   */
  readonly schema: Schema
  /**
   * The composition layer the bridge registers under the user's section: the
   * connector's own cordis.yml `config`, so a deployment's defaults come from
   * the file that configures the plugin while the user's edits layer over them.
   */
  readonly base?: ChatChannelConfig
  /** Section field names whose value is a `dsh-credentials` reference NAME, never a secret. */
  readonly credentialFields: readonly string[]
}

/**
 * One channel's resolved configuration document, exactly as its settings
 * namespace resolved it. Opaque to the bridge: the connector validates its own
 * fields and throws {@link ChatConfigError} on a document it cannot use.
 */
export type ChatChannelConfig = Readonly<Record<string, unknown>>

/**
 * One platform's lifecycle and configuration seam. One provider package per
 * channel.
 */
export interface ChatChannelConnector {
  /** The platform this connector serves. */
  readonly channel: ChatChannelId
  /** Max outbound messages per ONE inbound message; absent means the platform caps none. */
  readonly replyBudget?: number
  /** The capabilities the panel must surface as hints. */
  readonly capabilities: ChatChannelCapabilities
  /** This channel's configuration namespace, schema, and credential fields. */
  readonly settings: ChatChannelSettings
  /**
   * Build the outbound client for one resolved config.
   * @param config - the channel's resolved settings section.
   * @returns a client whose every method rejects on failure.
   * @throws ChatConfigError when the document cannot build a client.
   */
  createClient(config: ChatChannelConfig): Promise<ChatClient>
  /**
   * Open the inbound event stream for one resolved config. Resolves as soon as
   * the connection is CONSTRUCTED and connecting — the platform reconnects on
   * its own, so lifecycle arrives only through the handlers and a caller that
   * awaited "connected" would hang forever.
   * @param config - the channel's resolved settings section.
   * @param handlers - the inbound message, ready, and failure callbacks.
   * @returns the live connection whose `close` ends it (idempotent).
   */
  connect(config: ChatChannelConfig, handlers: ChatConnectorHandlers): Promise<{ close(): void }>
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * A user prompt admitted from a chat platform by the channel bridge. The
     * source names the platform, conversation, and sender so the model knows
     * where its input came from, and carries the platform message id so the
     * bridge's durable dedupe watermark is derivable from the session log.
     */
    channel: {
      readonly kind: 'channel'
      readonly channel: ChatChannelId
      readonly chatId: ChatId
      readonly chatKind: 'direct' | 'group'
      readonly messageId: ChatMessageId
      readonly senderName?: string
    }
  }
}

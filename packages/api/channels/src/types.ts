/**
 * Wire types of the `channels` Remote namespace. Types only: the generated
 * Remote client consumes this module without Host runtime code.
 *
 * The capability vocabulary is the channel seam's own, re-exported rather than
 * restated, so the connector that declares a limit and the panel that shows it
 * name the same declaration. Everything else here is what a configuration
 * surface needs and the seam does not carry: whether the connection is up, why
 * it last failed, which conversation is bound, and whether the credentials the
 * configuration names are actually configured.
 *
 * Credential status is reported by reference NAME and never by value, and the
 * reference names come from the channel's own settings section — this endpoint
 * reads them through the settings provider rather than holding a copy.
 *
 * @module @deepseek-ai/dsh-api-channels/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'

import type { ChatChannelCapabilities } from '@deepseek-ai/dsh-channel'

export type { ChatChannelCapabilities }

/** Presence of one credential reference a channel's configuration names. */
export interface ChannelCredentialView {
  /** The configuration field holding the reference name. */
  readonly field: string
  /** The reference name the field currently holds; empty while unset. */
  readonly ref: string
  /** Whether resolving the reference would currently return a value. */
  readonly configured: boolean
  /** The layer supplying the value; absent while unconfigured. */
  readonly source?: string
  /** Whether this Host could store a value for the reference. */
  readonly writable: boolean
}

/** One channel as the configuration panel reads it. */
export interface ChannelView {
  /** The channel id, which every other method here addresses it by. */
  readonly channel: string
  /** Whether the connection is configured to be open. */
  readonly enabled: boolean
  /** The Session this channel drives; empty while unbound. */
  readonly sessionId: string
  /** Where the connection currently stands. */
  readonly connection: 'stopped' | 'connecting' | 'connected' | 'failed'
  /** The most recent failure's text; never cleared by a later success. */
  readonly lastError?: string
  /** When the most recent failure was recorded, as an ISO timestamp. */
  readonly lastErrorAt?: string
  /** When this channel last admitted a message, as an ISO timestamp. */
  readonly lastInboundAt?: string
  /** The conversation this channel answers; absent until one has spoken. */
  readonly lockedChatId?: string
  /** The platform's per-inbound-message reply budget; absent when it caps none. */
  readonly replyBudget?: number
  /** What the platform can carry, as its connector declares it. */
  readonly capabilities: ChatChannelCapabilities
  /** The `dsh-settings` namespace holding this channel's configuration. */
  readonly settingsNamespace: string
  /** One entry per credential reference this channel's configuration names. */
  readonly credentials: readonly ChannelCredentialView[]
}

/** Every channel this Host serves. */
export interface ChannelsStatus {
  /** One entry per registered channel, in registration order. */
  readonly channels: readonly ChannelView[]
}

/** What one probe of a channel found. */
export interface ChannelProbe {
  /** Whether the channel is usable with the configured credentials. */
  readonly ok: boolean
  /** The actionable failure; present only when `ok` is false. */
  readonly message?: string
  /** The account the credentials identify, when the platform reports one. */
  readonly accountLabel?: string
  /** Supporting lines the platform returned, when it returned any. */
  readonly details?: readonly string[]
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named channel is not registered in this Host. */
    'channels/unknown': {}
    /** The requested change was refused or could not be stored; the message names why. */
    'channels/failed': {}
  }
}

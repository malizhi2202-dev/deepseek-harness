/**
 * Wire types of the `sources` Remote namespace. Types only: the generated
 * Remote client consumes this module without Host runtime code.
 *
 * The capability vocabulary is the resource seam's own, re-exported rather than
 * restated, so the provider that declares what a source can answer and the panel
 * that shows it name one declaration. Everything else here is what a
 * configuration surface needs and the seam does not carry: where one instance
 * stands, why its last probe failed, which settings namespace configures it, and
 * whether the credentials that configuration names are actually configured.
 *
 * Credential status is reported by reference NAME and never by value, and the
 * reference names come from the instance's own settings section — this endpoint
 * reads them through the settings provider rather than holding a copy.
 *
 * @module @deepseek-ai/dsh-api-sources/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'

import type { SourceCapabilities } from './seam.ts'

export type { SourceCapabilities } from './seam.ts'

/** Presence of one credential reference an instance's configuration names. */
export interface SourceCredentialView {
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

/**
 * Where one source instance stands, as this Host last observed it.
 *
 * A source builds no connection of its own, so the state is derived rather than
 * reported by a transport: `unconfigured` when its provider reports the
 * instance's settings incomplete, `unchecked` while a configured instance has
 * not been probed at its kind's current settings revision, and `usable` or
 * `unusable` from the last probe.
 */
export type SourceState = 'unconfigured' | 'unchecked' | 'usable' | 'unusable'

/** One source instance as the configuration panel reads it. */
export interface SourceView {
  /**
   * The instance's identity for the panel, unique across kinds because an
   * instance id is unique only inside its kind. Opaque: a caller passes it back
   * to `probe` and never parses it.
   */
  readonly key: string
  /** The kind's discriminator; a kind this build does not name stays verbatim. */
  readonly kind: string
  /** The instance's id inside its kind's settings namespace, as the provider declares it. */
  readonly id: string
  /** The `dsh-settings` namespace holding this kind's configuration. */
  readonly namespace: string
  /** Where the instance stands. */
  readonly state: SourceState
  /** The most recent probe failure's text; never cleared by a later success. */
  readonly lastError?: string
  /** When the most recent failure was recorded, as an ISO timestamp. */
  readonly lastErrorAt?: string
  /** What the source can answer, as its provider declares it. */
  readonly capabilities: SourceCapabilities
  /** One entry per credential reference this instance's configuration names. */
  readonly credentials: readonly SourceCredentialView[]
}

/** Every source instance this Host serves, in provider registration order. */
export interface SourcesStatus {
  /** One entry per declared instance, kinds and instances both in their own order. */
  readonly sources: readonly SourceView[]
}

/** What one probe of a source instance found. */
export interface SourceProbe {
  /** Whether the source is usable with the configured settings and credentials. */
  readonly ok: boolean
  /** The actionable failure; present only when `ok` is false. */
  readonly message?: string
  /** The target the probe resolved, such as the authenticated account; present only on success. */
  readonly label?: string
  /** One line of detail the probe established; present only when it established one. */
  readonly detail?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named source instance is not registered in this Host. */
    'sources/unknown': {}
  }
}

/**
 * Typed failures of the remote source seam. Every code is a stable,
 * machine-routable string; a consumer routes on `code`, never on the message
 * text or the class identity.
 *
 * @module @deepseek-ai/dsh-resource/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** The instance's settings lack a required value, so no connection was opened. */
export const SOURCE_UNCONFIGURED = 'SOURCE_UNCONFIGURED'

/** The backend refused, failed, or answered something the provider could not use. */
export const SOURCE_PROVIDER_ERROR = 'SOURCE_PROVIDER_ERROR'

/** The handle names nothing the caller may see, including anything outside a granted view. */
export const SOURCE_NOT_FOUND = 'SOURCE_NOT_FOUND'

/** A kind's provider is already registered. */
export const SOURCE_DUPLICATE_PROVIDER = 'SOURCE_DUPLICATE_PROVIDER'

/** The operation is outside what the source permits, and nothing was sent to the backend. */
export const SOURCE_DENIED = 'SOURCE_DENIED'

/** Every failure code this seam raises. */
export type SourceErrorCode =
  | typeof SOURCE_UNCONFIGURED
  | typeof SOURCE_PROVIDER_ERROR
  | typeof SOURCE_NOT_FOUND
  | typeof SOURCE_DUPLICATE_PROVIDER
  | typeof SOURCE_DENIED

/**
 * A remote source failure. Providers raise it with a {@link SourceErrorCode};
 * `cause` carries the backend's own error when one exists. The message is
 * human-readable failure text, safe to show a model or a configuration surface.
 */
export class SourceError extends HarnessError {}

/**
 * The failure line one Remote code deserves.
 *
 * Kept apart from the component so the mapping is testable on its own. Codes
 * this reader does not name fall to the generic line carrying the carrier's
 * message. A save reads the same vocabulary with two of its own lines: the two
 * refusals that mean something different when the reader has text in hand.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Render a byte count the way a person reads one. */
function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Say what went wrong, in terms of the file rather than of the transport.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the file.
 */
export function failureLine(t: TranslateNS<'sidebarTextpreview'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/too-large':
      return t('error.tooLarge', { limit: humanBytes(failure.details.limit) })
    case 'workspace-file/not-text': return t('error.notText')
    case 'workspace-file/not-regular-file': return t('error.notRegularFile')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this panel knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/**
 * Say why a save was refused.
 *
 * The reader still holds the text they typed, so the line answers "did I lose
 * it?" first: a stale version says the file moved on and names the reload
 * beside it, and an oversized write says the content was too big to send.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the editor.
 */
export function saveFailureLine(t: TranslateNS<'sidebarTextpreview'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/stale-version': return t('save.stale')
    case 'workspace-file/too-large':
      return t('save.tooLarge', { limit: humanBytes(failure.details.limit) })
    default: return failureLine(t, failure)
  }
}

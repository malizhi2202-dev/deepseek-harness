/**
 * The fold that turns successive bounded scrollback pages into the frames one
 * output stream carries.
 *
 * The PTY seam offers no push stream: output is consumed by reading a bounded
 * page of retained scrollback, so a stream is a poll. This module owns the one
 * decision that poll needs — what the panel has not seen yet — and it is exact
 * in both of its branches rather than heuristic:
 *
 * - When the page still begins with everything already sent, the remainder is
 *   new output, and appending it is exact.
 * - Otherwise the seam cannot bridge the gap (the backend's byte or line bound
 *   dropped retained text from the head), so the whole page is sent as a
 *   replacement. The panel's view is then exactly the seam's retained window,
 *   which is a truthful answer instead of a silently spliced one.
 *
 * @module @deepseek-ai/dsh-api-terminal-console/output-window
 */

/** What one output stream has already sent to its panel. */
export interface ConsoleOutputWindow {
  /** The exact page text last sent; the empty string before the first frame. */
  readonly text: string
}

/** The window an output stream starts from. */
export const EMPTY_OUTPUT_WINDOW: ConsoleOutputWindow = { text: '' }

/** One poll's outcome: nothing new, an appended tail, or a replacement view. */
export type ConsoleOutputAdvance =
  | { readonly kind: 'idle'; readonly window: ConsoleOutputWindow }
  | { readonly kind: 'append'; readonly window: ConsoleOutputWindow; readonly text: string }
  | { readonly kind: 'replace'; readonly window: ConsoleOutputWindow; readonly text: string }

/**
 * Advance one output window over a freshly read page of retained scrollback.
 * @param current - what this stream has already sent.
 * @param page - the retained page read now, oldest line first.
 * @returns the frame to send and the window the next poll starts from.
 */
export function advanceConsoleOutput(
  current: ConsoleOutputWindow,
  page: string,
): ConsoleOutputAdvance {
  if (page === current.text) return { kind: 'idle', window: current }
  if (page.startsWith(current.text)) {
    return { kind: 'append', window: { text: page }, text: page.slice(current.text.length) }
  }
  return { kind: 'replace', window: { text: page }, text: page }
}

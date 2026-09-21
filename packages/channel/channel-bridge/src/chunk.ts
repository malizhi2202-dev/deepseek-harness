/**
 * Outbound chunking for one chat message.
 *
 * A platform's text cap is a hard refusal, so a reply longer than it must be
 * split; the split is format-aware because a cut through a code fence or a
 * link costs the construct everywhere the message is read, and on a strict
 * renderer costs the whole message's formatting.
 *
 * @module @deepseek-ai/dsh-channel-bridge
 */

/**
 * Characters per outbound message, under the tightest hard cap this build
 * serves. It is a protocol constant rather than a tunable: the bridge's own
 * `chunkChars` config carries the deployment's value, and this is what that
 * value defaults to.
 */
export const DEFAULT_CHUNK_CHARS = 4000

/** Named HTML entities and numeric references are short; a longer run is prose. */
const ENTITY_MAX_CHARS = 12

/**
 * Split one reply into chunks the platform will accept.
 * @param text - the complete reply text.
 * @param max - the per-chunk character budget, at least 1.
 * @returns the reply split into at least one chunk, in order.
 */
export function chunkChatText(text: string, max = DEFAULT_CHUNK_CHARS): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const cut = safeCut(rest, max)
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.length > 0) out.push(rest)
  return out
}

/**
 * Fit one reply's chunks inside a platform's per-inbound-message reply budget.
 *
 * Past the budget the remaining chunks are COMBINED into the last message
 * rather than dropped: silently losing the tail of a reply is the worst failure
 * available here, and the platform refusing one oversized message is a smaller
 * loss than the user never learning what the Agent answered.
 * @param chunks - the reply's chunks, in order.
 * @param budget - the largest number of messages the platform accepts, or undefined for no limit.
 * @returns the chunks to send, never more than `budget` of them.
 */
export function capToReplyBudget(chunks: readonly string[], budget: number | undefined): string[] {
  if (budget === undefined || budget <= 0 || chunks.length <= budget) return [...chunks]
  return [...chunks.slice(0, budget - 1), chunks.slice(budget - 1).join('\n\n')]
}

/**
 * The position to cut one over-long body at: the last newline in the window's
 * back half when there is one, otherwise the window itself, then walked back
 * until the cut damages no construct. A construct longer than a whole message
 * cannot be preserved by any cut, so the walk stops at the window.
 * @param text - the body being split.
 * @param max - the character budget.
 * @returns a position in `(0, max]`.
 */
function safeCut(text: string, max: number): number {
  const newline = text.lastIndexOf('\n', max)
  let cut = newline > max / 2 ? newline : max
  while (cut > 0 && !isSafeCut(text, cut)) cut -= 1
  return cut > 0 ? cut : max
}

/**
 * Whether cutting `text` at `cut` leaves every construct whole.
 * @param text - the body being split.
 * @param cut - the candidate position.
 * @returns true when the prefix ends outside a code fence, link, and entity.
 */
function isSafeCut(text: string, cut: number): boolean {
  const before = text.slice(0, cut)
  if (countFenceOpeners(before) % 2 !== 0) return false
  if (insideLink(before)) return false
  return !insideEntity(before)
}

/** How many fenced-code openers the prefix starts; an odd count means a fence is open. */
function countFenceOpeners(before: string): number {
  return before.match(/(?:^|\n) {0,3}(?:```|~~~)/g)?.length ?? 0
}

/** Whether the prefix ends inside a link's text or its destination. */
function insideLink(before: string): boolean {
  if (before.lastIndexOf('[') > before.lastIndexOf(']')) return true
  const destination = before.lastIndexOf('](')
  return destination !== -1 && before.indexOf(')', destination) === -1
}

/** Whether the prefix ends inside a character entity, which a cut would truncate. */
function insideEntity(before: string): boolean {
  const amp = before.lastIndexOf('&')
  if (amp === -1) return false
  const tail = before.slice(amp)
  if (tail.includes(';') || tail.length > ENTITY_MAX_CHARS) return false
  return !/[\s]/.test(tail)
}

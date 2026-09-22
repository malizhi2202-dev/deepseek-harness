/**
 * Byte bounds shared by every source provider. A provider applies the limit to
 * the complete document it returns, and a cut result carries a marker so the
 * model reads a truncated document as truncated instead of as the whole item.
 *
 * @module @deepseek-ai/dsh-resource/bounds
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Marker appended to a document the provider cut at the declared read cap. The
 * marker's own bytes count against the cap, so the complete returned text never
 * exceeds it.
 */
export const SOURCE_TRUNCATION_MARKER = '\n\n[truncated: this source returns at most its declared read limit]'

/**
 * Cut text to at most `maxBytes` UTF-8 bytes without splitting a code point, so
 * the result is always valid text and always within the limit.
 *
 * @param text - the text to bound.
 * @param maxBytes - the byte budget; a non-positive budget yields the empty string.
 * @returns the bounded text and whether anything was dropped.
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = encoder.encode(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  const limit = Math.max(0, Math.floor(maxBytes))
  let end = limit
  // `bytes[end]` is the first byte past the prefix. A continuation byte there
  // means the prefix stops inside a code point, so back up to its lead byte.
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end -= 1
  return { text: decoder.decode(bytes.subarray(0, end)), truncated: true }
}

/**
 * Bound one document's text to `maxBytes` including the truncation marker. Text
 * that already fits is returned unchanged; anything longer keeps as much of the
 * original as the budget allows and ends with the marker. A budget smaller than
 * the marker returns the marker's own prefix, so a cut is never silent.
 *
 * @param content - the document text.
 * @param maxBytes - the declared read cap in bytes.
 * @returns the bounded text and whether it was cut.
 */
export function boundDocumentContent(content: string, maxBytes: number): { content: string; truncated: boolean } {
  if (encoder.encode(content).length <= maxBytes) return { content, truncated: false }
  const budget = Math.floor(maxBytes) - encoder.encode(SOURCE_TRUNCATION_MARKER).length
  if (budget <= 0) return { content: truncateUtf8(SOURCE_TRUNCATION_MARKER, maxBytes).text, truncated: true }
  return { content: `${truncateUtf8(content, budget).text}${SOURCE_TRUNCATION_MARKER}`, truncated: true }
}

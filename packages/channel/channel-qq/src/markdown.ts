/**
 * QQ's own Markdown downgrade and text chunking.
 *
 * A group or single-chat message is sent as plain text, so Markdown is reduced
 * to the text it decorates. A fenced code block loses its fence and keeps its
 * code, because the platform renders no monospace and the fence markers would
 * arrive as punctuation; an image keeps its description and its URL, because a
 * plain-text reader can still follow the link.
 *
 * Chunking packs whole paragraphs into one message and splits only a paragraph
 * that is itself longer than the budget, so a cut lands between paragraphs
 * wherever the text allows one.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

/** A fenced code block, captured so its fence can be removed as a unit. */
const FENCE = /(```[^\n]*\n[\s\S]*?```)/g

/** A heading's leading hashes and a block quote's leading marker, which QQ renders as punctuation. */
const BLOCK_MARKER = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?)/

/**
 * The inline constructs QQ does not render, each paired with what replaces it.
 *
 * An image and a link keep their target, because a reader of plain text can
 * still follow it. The inline-code marker is a run of up to three backticks on
 * either side, so an unterminated fence's leftover marker run is removed as one
 * decoration rather than left as a stray character.
 */
const INLINE: ReadonlyArray<readonly [RegExp, string]> = [
  [/!\[([^\]]*)\]\(([^)\s]*)\)/g, '$1 ($2)'],
  [/\[([^\]]*)\]\(([^)\s]*)\)/g, '$1 ($2)'],
  [/(\*\*|__)([\s\S]*?)\1/g, '$2'],
  [/(\*|_)([\s\S]*?)\1/g, '$2'],
  [/~~([\s\S]*?)~~/g, '$1'],
  [/`{1,3}([^`]*)`{1,3}/g, '$1'],
]

/**
 * Remove a fenced block's opening and closing fence lines.
 * @param block - the complete fenced block, fence lines included.
 * @returns the code the block carried.
 */
function stripFence(block: string): string {
  return block.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trimEnd()
}

/**
 * Reduce one span of Markdown to the text it decorates.
 * @param text - the span, which contains no complete fenced block.
 * @returns the downgraded text.
 */
function downgradeSpan(text: string): string {
  const inlined = INLINE.reduce((carried, [pattern, replacement]) => carried.replace(pattern, replacement), text)
  return inlined
    .split('\n')
    .map(line => line.replace(BLOCK_MARKER, ''))
    .join('\n')
}

/**
 * Downgrade one reply's Markdown to the plain text QQ renders.
 * @param text - the reply body.
 * @returns the same content with the platform's unsupported markers removed.
 */
export function downgradeQqMarkdown(text: string): string {
  return text
    .split(FENCE)
    .map((part, index) => index % 2 === 1 ? stripFence(part) : downgradeSpan(part))
    .join('')
}

/**
 * Split one message into chunks the platform accepts.
 *
 * A paragraph longer than the budget is cut at the budget, because no paragraph
 * boundary inside it exists to cut at.
 * @param text - the message body, already rendered for this platform.
 * @param limit - the most characters one chunk may carry.
 * @returns the chunks, or none when the text carries nothing to send.
 */
export function chunkQqText(text: string, limit: number): string[] {
  if (text.trim() === '') return []
  const chunks: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    const candidate = current === '' ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length <= limit) {
      current = candidate
      continue
    }
    if (current !== '') chunks.push(current)
    let rest = paragraph
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }
    current = rest
  }
  if (current !== '') chunks.push(current)
  return chunks
}

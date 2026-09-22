/**
 * WeChat's own Markdown downgrade and text chunking.
 *
 * The platform renders plain text only, so a reply's Markdown is reduced to the
 * text it decorates rather than sent with its markers. Fenced code keeps its
 * fence because the fence is what tells a reader where the code starts, and an
 * image is dropped because the platform has nowhere to show it.
 *
 * Chunking belongs here rather than in the bridge because the downgrade changes
 * the length: the platform's cap applies to what is actually sent.
 *
 * @module @deepseek-ai/dsh-channel-wechat
 */

/** A fenced code block, captured so the downgrade leaves it alone. */
const FENCE = /(```[\s\S]*?```)/g

/** A heading's leading hashes. */
const HEADING = /^[ \t]*#{1,6}[ \t]+/gm

/** A block quote's leading marker. */
const QUOTE = /^[ \t]*>[ \t]?/gm

/** An image, which the platform has nowhere to render. */
const IMAGE = /!\[[^\]]*\]\([^)\s]*\)/g

/** A link, reduced to its text and its target. */
const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g

/** Bold emphasis, in either marker spelling. */
const STRONG = /(\*\*|__)([\s\S]*?)\1/g

/** Italic emphasis, in either marker spelling. */
const EMPHASIS = /(\*|_)([\s\S]*?)\1/g

/** Strikethrough. */
const STRIKE = /~~([\s\S]*?)~~/g

/** Inline code, which keeps its content and loses its backticks. */
const INLINE_CODE = /`([^`]*)`/g

/**
 * Reduce one span of Markdown to the text it decorates.
 * @param text - the span, which contains no complete fenced block.
 * @returns the downgraded text.
 */
function downgradeSpan(text: string): string {
  return text
    .replace(HEADING, '')
    .replace(QUOTE, '')
    .replace(IMAGE, '')
    .replace(LINK, '$1 ($2)')
    .replace(STRONG, '$2')
    .replace(EMPHASIS, '$2')
    .replace(STRIKE, '$1')
    .replace(INLINE_CODE, '$1')
}

/**
 * Downgrade one reply's Markdown to the plain text WeChat renders.
 * @param text - the reply body.
 * @returns the same content with the platform's unsupported markers removed.
 */
export function downgradeWechatMarkdown(text: string): string {
  return text
    .split(FENCE)
    .map((part, index) => index % 2 === 1 ? part : downgradeSpan(part))
    .join('')
}

/**
 * Split one message into chunks the platform accepts.
 *
 * A chunk ends at a blank line, then at a line break, then at the cap, so a
 * split lands between paragraphs wherever the text allows one. A boundary is
 * taken only from the window's back half: cutting at one earlier than that
 * spends a whole message on a few words and leaves the next chunk as long as it
 * would have been anyway.
 * @param text - the message body, already rendered for this platform.
 * @param limit - the most characters one chunk may carry.
 * @returns the chunks, or none when the text carries nothing to send.
 */
export function chunkWechatText(text: string, limit: number): string[] {
  if (text.trim() === '') return []
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text.replace(/^\n+/, '')
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = window.lastIndexOf('\n\n')
    if (cut <= limit / 2) cut = window.lastIndexOf('\n')
    if (cut <= limit / 2) cut = limit
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest !== '') chunks.push(rest)
  return chunks
}

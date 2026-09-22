/**
 * Feishu's Markdown downgrade: the subset of Markdown a `lark_md` card element
 * renders, and the bound the platform's message ceiling puts on the result.
 *
 * Feishu renders `lark_md` inside an interactive card, and that subset has no
 * headings and no fenced code blocks. A heading becomes a bold line, and a
 * fence's delimiter lines are dropped while its content is kept verbatim, so a
 * code block reaches the reader as plain lines rather than as literal
 * backticks.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import { ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'

/** One ATX heading, whose text becomes a bold line. */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/

/** One fenced code block delimiter, which `lark_md` cannot render. */
const FENCE = /^ {0,3}(?:```|~~~)/

/**
 * Convert Markdown into the subset a Feishu card renders.
 *
 * Text outside a heading or a fence passes through unchanged, so emphasis,
 * links, and lists keep whatever `lark_md` already understands and everything
 * else stays readable as written.
 * @param text - the Markdown to render.
 * @returns the same content in the `lark_md` subset.
 */
export function toLarkMarkdown(text: string): string {
  const lines: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    const heading = inFence ? null : HEADING.exec(line)
    lines.push(heading === null ? line : `**${heading[1] ?? ''}**`)
  }
  return lines.join('\n')
}

/**
 * Render one message as `lark_md`, refusing a result past the channel's ceiling.
 *
 * The conversion can lengthen the text, so a chunk the bridge sized to the
 * platform's limit may no longer fit. Refusing here is what makes the bridge
 * resend the same chunk plainly, which always fits because the bridge chunked
 * it to this same ceiling.
 * @param text - the Markdown to render.
 * @param maxChars - the largest rendered message this channel accepts.
 * @returns the rendered message.
 * @throws {ChatFormatRejectedError} when the rendered message exceeds `maxChars`.
 */
export function renderLarkMarkdown(text: string, maxChars: number): string {
  const rendered = toLarkMarkdown(text)
  if (rendered.length > maxChars) {
    throw new ChatFormatRejectedError(
      `the rendered message is ${String(rendered.length)} characters, past the ${String(maxChars)} this channel accepts`,
    )
  }
  return rendered
}

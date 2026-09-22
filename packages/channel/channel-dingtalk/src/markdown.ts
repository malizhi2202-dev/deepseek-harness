/**
 * DingTalk's Markdown downgrade and its two bounds.
 *
 * DingTalk renders a Markdown message, but its ceiling is a **byte** count
 * rather than a character count, so the same text costs more of the ceiling in
 * Chinese than in English and a chunk the bridge sized in characters can still
 * be too long. The bound is therefore measured on the rendered UTF-8 bytes.
 *
 * The rendered subset has no fenced code block, so a fence's delimiter lines
 * are removed and its content is kept verbatim; headings, lists, emphasis, and
 * links pass through because DingTalk renders them.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

import { Buffer } from 'node:buffer'
import { ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'

/**
 * One complete fenced code block, delimiter lines included.
 *
 * An unterminated fence matches nothing, so its delimiter stays as written
 * rather than swallowing the rest of the message.
 */
const FENCE_BLOCK = /^ {0,3}(?:```|~~~)[^\n]*\n([\s\S]*?)\n?^ {0,3}(?:```|~~~)[^\n]*(?=\n|$)/gm

/**
 * Convert Markdown into the subset a DingTalk Markdown message renders.
 * @param text - the Markdown to render.
 * @returns the same content with code-fence delimiters removed.
 */
export function toDingTalkMarkdown(text: string): string {
  return text.replace(FENCE_BLOCK, (_block, code: string) => code)
}

/**
 * Render one message as DingTalk Markdown, refusing a result past the byte ceiling.
 *
 * Refusing here is what makes the bridge resend the same chunk plainly, which
 * fits because the bridge chunked it to a character count that cannot exceed
 * this ceiling in any UTF-8 encoding.
 * @param text - the Markdown to render.
 * @param maxBytes - the largest rendered message this channel accepts.
 * @returns the rendered message.
 * @throws {ChatFormatRejectedError} when the rendered message exceeds `maxBytes`.
 */
export function renderDingTalkMarkdown(text: string, maxBytes: number): string {
  const rendered = toDingTalkMarkdown(text)
  const bytes = Buffer.byteLength(rendered, 'utf8')
  if (bytes > maxBytes) {
    throw new ChatFormatRejectedError(
      `the rendered message is ${String(bytes)} bytes, past the ${String(maxBytes)} this channel accepts`,
    )
  }
  return rendered
}

/**
 * The notification title one Markdown message carries.
 *
 * DingTalk requires a title on a Markdown message and shows it in the push
 * notification, so the message's first non-empty line serves as it, truncated
 * to the platform's short preview.
 * @param text - the message being sent.
 * @param maxChars - the largest title this channel accepts.
 * @returns the title.
 */
export function titleOf(text: string, maxChars: number): string {
  const first = text.split('\n').find(line => line.trim() !== '') ?? ''
  return first.trim().slice(0, maxChars)
}

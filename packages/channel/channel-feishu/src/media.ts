/**
 * Feishu's lazily fetched inbound attachments.
 *
 * An attachment is a handle over the message it arrived on, never a URL or
 * bytes: the bridge admits a message before it transfers anything, and the byte
 * cap rides into the download so an oversized attachment is refused at the byte
 * that crosses the cap rather than buffered whole and measured afterwards.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import { Buffer } from 'node:buffer'
import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'
import type { ChatInboundFile, ChatInboundImage } from '@deepseek-ai/dsh-channel'
import type { FeishuApi } from './types.ts'

/** The response header naming an attachment's declared size. */
const CONTENT_LENGTH = 'content-length'

/** The response header naming an attachment's media type. */
const CONTENT_TYPE = 'content-type'

/** The media type reported when Feishu declares none. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream'

/** One response header's value, when Feishu sent it as a string. */
function header(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** The declared body size, when Feishu declared a numeric one. */
function declaredLength(headers: Record<string, unknown>): number | undefined {
  const raw = header(headers, CONTENT_LENGTH)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Download one message attachment under a byte cap.
 * @param api - the SDK view the download goes through.
 * @param messageId - the message the attachment arrived on.
 * @param fileKey - the platform's key for the attachment.
 * @param type - which attachment kind the key names, as Feishu's download requires.
 * @param maxBytes - the largest transfer this call may make.
 * @returns the attachment's bytes and the media type Feishu declared.
 * @throws {ChatMediaTooLargeError} when the transfer would exceed `maxBytes`.
 */
async function readResource(
  api: FeishuApi,
  messageId: string,
  fileKey: string,
  type: 'image' | 'file',
  maxBytes: number,
): Promise<{ readonly data: Uint8Array; readonly mime: string }> {
  const response = await api.im.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type },
  })
  const declared = declaredLength(response.headers)
  if (declared !== undefined && declared > maxBytes) throw new ChatMediaTooLargeError(maxBytes)
  const stream = response.getReadableStream()
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = chunk as Buffer
    total += bytes.byteLength
    if (total > maxBytes) {
      stream.destroy()
      throw new ChatMediaTooLargeError(maxBytes)
    }
    chunks.push(bytes)
  }
  return {
    data: new Uint8Array(Buffer.concat(chunks)),
    mime: header(response.headers, CONTENT_TYPE) ?? UNKNOWN_MEDIA_TYPE,
  }
}

/** One lazily fetched inbound image, keyed by the message it arrived on. */
export class FeishuInboundImage implements ChatInboundImage {
  /**
   * @param api - the SDK view the download goes through.
   * @param messageId - the message the image arrived on.
   * @param imageKey - the platform's key for the image.
   */
  constructor(
    private readonly api: FeishuApi,
    private readonly messageId: string,
    private readonly imageKey: string,
  ) {}

  /**
   * Download the image, refusing anything past `maxBytes`.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the image bytes and the media type Feishu declared for them.
   * @throws {ChatMediaTooLargeError} when the transfer would exceed `maxBytes`.
   */
  fetch(maxBytes: number): Promise<{ readonly data: Uint8Array; readonly mime: string }> {
    return readResource(this.api, this.messageId, this.imageKey, 'image', maxBytes)
  }
}

/** One lazily fetched inbound file, keyed by the message it arrived on. */
export class FeishuInboundFile implements ChatInboundFile {
  /**
   * @param api - the SDK view the download goes through.
   * @param messageId - the message the file arrived on.
   * @param fileKey - the platform's key for the file.
   * @param fileName - the sender's own file name, as the event carried it.
   */
  constructor(
    private readonly api: FeishuApi,
    private readonly messageId: string,
    private readonly fileKey: string,
    readonly fileName: string,
  ) {}

  /**
   * Download the file, refusing anything past `maxBytes`.
   * @param maxBytes - the largest transfer this call may make.
   * @returns the file's exact bytes.
   * @throws {ChatMediaTooLargeError} when the transfer would exceed `maxBytes`.
   */
  async fetch(maxBytes: number): Promise<Uint8Array> {
    const { data } = await readResource(this.api, this.messageId, this.fileKey, 'file', maxBytes)
    return data
  }
}

import { describe, expect, it } from 'vitest'
import { ChatMediaTooLargeError } from '@deepseek-ai/dsh-channel'
import { FeishuInboundFile, FeishuInboundImage } from '../src/media.ts'
import { StubFeishuApi } from './stub.ts'

/** Build one event body carrying a single attachment key. */
function resource(
  body: Uint8Array,
  headers: Record<string, unknown>,
): StubFeishuApi {
  const api = new StubFeishuApi()
  api.resourceBody = body
  api.resourceHeaders = headers
  return api
}

describe('FeishuInboundImage', () => {
  it('downloads the image under its message and reports the declared media type', async () => {
    const api = resource(new Uint8Array([1, 2, 3]), { 'content-type': 'image/png' })

    const image = await new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(1024)

    expect(image.mime).toBe('image/png')
    expect([...image.data]).toEqual([1, 2, 3])
    expect(api.downloaded).toEqual([{ messageId: 'msg-1', fileKey: 'img-key', type: 'image' }])
  })

  it('reports the generic media type when Feishu declared none', async () => {
    const api = resource(new Uint8Array([1]), {})

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(1024))
      .resolves.toMatchObject({ mime: 'application/octet-stream' })
  })

  it('reports the generic media type when the declared one is not a string', async () => {
    const api = resource(new Uint8Array([1]), { 'content-type': 42 })

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(1024))
      .resolves.toMatchObject({ mime: 'application/octet-stream' })
  })

  it('accepts a body exactly at the byte cap', async () => {
    const api = resource(new Uint8Array([1, 2, 3, 4]), { 'content-length': '4' })

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(4))
      .resolves.toMatchObject({ data: new Uint8Array([1, 2, 3, 4]) })
  })

  it('refuses a declared body past the cap without reading it', async () => {
    const api = resource(new Uint8Array([1, 2, 3, 4]), { 'content-length': '5' })

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(4))
      .rejects.toThrow(ChatMediaTooLargeError)
  })

  it('refuses a body that crosses the cap while streaming when the length was absent', async () => {
    const api = resource(new Uint8Array([1, 2, 3, 4]), {})

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(3))
      .rejects.toThrow(ChatMediaTooLargeError)
  })

  it('refuses a body that crosses the cap while streaming when the length was not numeric', async () => {
    const api = resource(new Uint8Array([1, 2, 3, 4]), { 'content-length': 'unknown' })

    await expect(new FeishuInboundImage(api, 'msg-1', 'img-key').fetch(3))
      .rejects.toThrow(ChatMediaTooLargeError)
  })
})

describe('FeishuInboundFile', () => {
  it('downloads the file under its message and keeps the name the event carried', async () => {
    const api = resource(new Uint8Array([9, 8, 7]), { 'content-type': 'application/pdf' })

    const file = new FeishuInboundFile(api, 'msg-2', 'file-key', 'report.pdf')

    expect(file.fileName).toBe('report.pdf')
    expect([...await file.fetch(1024)]).toEqual([9, 8, 7])
    expect(api.downloaded).toEqual([{ messageId: 'msg-2', fileKey: 'file-key', type: 'file' }])
  })

  it('refuses a file past the cap', async () => {
    const api = resource(new Uint8Array([1, 2, 3, 4]), { 'content-length': '4' })

    await expect(new FeishuInboundFile(api, 'msg-2', 'file-key', 'report.pdf').fetch(3))
      .rejects.toThrow(ChatMediaTooLargeError)
  })
})

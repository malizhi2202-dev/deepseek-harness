/**
 * The Feishu SDK stub the provider suites drive: every call is recorded and
 * every response is programmable, so no socket or HTTP request is made.
 */
import { Readable } from 'node:stream'
import type {
  FeishuApi,
  FeishuMessageResponse,
  FeishuResourceResponse,
  FeishuTokenResponse,
  FeishuUploadResponse,
} from '../src/index.ts'

/** One recorded `im.message.create` call. */
export interface CreatedMessage {
  readonly receiveId: string
  readonly msgType: string
  readonly content: string
}

/** One recorded `im.message.reply` call. */
export interface RepliedMessage {
  readonly messageId: string
  readonly msgType: string
  readonly content: string
}

/** One recorded `im.file.create` call. */
export interface UploadedFile {
  readonly fileName: string
  readonly fileType: string
  readonly bytes: number
}

/** One recorded attachment download. */
export interface DownloadedResource {
  readonly messageId: string
  readonly fileKey: string
  readonly type: string
}

/** A programmable `FeishuApi`. */
export class StubFeishuApi implements FeishuApi {
  readonly created: CreatedMessage[] = []
  readonly replied: RepliedMessage[] = []
  readonly uploaded: UploadedFile[] = []
  readonly downloaded: DownloadedResource[] = []
  readonly tokenRequests: Array<{ appId: string; appSecret: string }> = []

  /** The response the credential probe receives. */
  tokenResponse: FeishuTokenResponse = { code: 0, msg: 'ok', data: { expire: 7200 } }

  /** The response every message send receives. */
  createResponse: FeishuMessageResponse = { code: 0, msg: 'ok' }

  /** The response every reply receives. */
  replyResponse: FeishuMessageResponse = { code: 0, msg: 'ok' }

  /** The response every file upload receives. */
  uploadResponse: FeishuUploadResponse | null = { file_key: 'file-key' }

  /** The bytes and headers every attachment download receives. */
  resourceBody: Uint8Array = new Uint8Array([1, 2, 3])
  resourceHeaders: Record<string, unknown> = { 'content-type': 'image/png' }

  readonly auth = {
    tenantAccessToken: {
      internal: (payload: { readonly data: { readonly app_id: string; readonly app_secret: string } }) => {
        this.tokenRequests.push({ appId: payload.data.app_id, appSecret: payload.data.app_secret })
        return Promise.resolve(this.tokenResponse)
      },
    },
  }

  readonly im = {
    message: {
      create: (payload: {
        readonly data: { readonly receive_id: string; readonly msg_type: string; readonly content: string }
      }) => {
        this.created.push({
          receiveId: payload.data.receive_id,
          msgType: payload.data.msg_type,
          content: payload.data.content,
        })
        return Promise.resolve(this.createResponse)
      },
      reply: (payload: {
        readonly path: { readonly message_id: string }
        readonly data: { readonly msg_type: string; readonly content: string }
      }) => {
        this.replied.push({
          messageId: payload.path.message_id,
          msgType: payload.data.msg_type,
          content: payload.data.content,
        })
        return Promise.resolve(this.replyResponse)
      },
    },
    file: {
      create: (payload: {
        readonly data: { readonly file_type: string; readonly file_name: string; readonly file: Buffer }
      }) => {
        this.uploaded.push({
          fileName: payload.data.file_name,
          fileType: payload.data.file_type,
          bytes: payload.data.file.byteLength,
        })
        return Promise.resolve(this.uploadResponse)
      },
    },
    messageResource: {
      get: (payload: {
        readonly path: { readonly message_id: string; readonly file_key: string }
        readonly params: { readonly type: 'image' | 'file' }
      }) => {
        this.downloaded.push({
          messageId: payload.path.message_id,
          fileKey: payload.path.file_key,
          type: payload.params.type,
        })
        const response: FeishuResourceResponse = {
          getReadableStream: () => Readable.from([Buffer.from(this.resourceBody)]),
          headers: this.resourceHeaders,
        }
        return Promise.resolve(response)
      },
    },
  }
}

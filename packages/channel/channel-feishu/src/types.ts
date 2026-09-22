/**
 * Feishu's contribution to the chat-channel seam's type surface: the channel id
 * this provider registers, the wire declarations its JSON is read through, and
 * the narrow view of the official SDK this package depends on.
 *
 * The wire declarations name only the fields this connector reads. A Feishu
 * event carries many more and the platform adds fields without notice, so
 * `./events.ts` validates the ones it depends on instead of trusting these
 * declarations.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import type { Buffer } from 'node:buffer'
import type { Readable } from 'node:stream'
// Import the module so the declaration below augments the seam's map rather
// than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-channel/types'

declare module '@deepseek-ai/dsh-channel/types' {
  interface ChatChannelIdMap {
    /** Feishu (飞书) and its international Lark deployment. */
    feishu: 'feishu'
  }
}

/** The deployment whose Open Platform endpoints this connector signs in to. */
export type FeishuDomain = 'feishu' | 'lark'

/** One `im/v1/messages` response envelope, as far as this connector reads it. */
export interface FeishuMessageResponse {
  /** The platform's result code; zero means the call succeeded. */
  readonly code?: number | undefined
  /** The platform's own reason, present on a refusal. */
  readonly msg?: string | undefined
}

/** One `auth/v3/tenant_access_token/internal` response envelope. */
export interface FeishuTokenResponse {
  /** The platform's result code; zero means the credentials signed in. */
  readonly code?: number | undefined
  /** The platform's own reason, present on a refusal. */
  readonly msg?: string | undefined
  /** The token facts, present only when `code` is zero. */
  readonly data?: {
    /** How many seconds the token stays valid. */
    readonly expire?: number | undefined
  } | undefined
}

/** One `im/v1/files` response body, already unwrapped by the SDK. */
export interface FeishuUploadResponse {
  /** The uploaded file's key, present on success. */
  readonly file_key?: string | undefined
}

/** One `im/v1/messages/:message_id/resources/:file_key` download. */
export interface FeishuResourceResponse {
  /** The response body stream. Readable exactly once. */
  getReadableStream(): Readable
  /** The response headers, which carry the declared length and media type. */
  readonly headers: Record<string, unknown>
}

/**
 * The slice of `@larksuiteoapi/node-sdk` this package calls.
 *
 * Declared structurally rather than imported so a test can drive the connector
 * against a stub, and so this package's own modules never name the SDK's
 * generated request and response types.
 */
export interface FeishuApi {
  /** Credential exchange. */
  readonly auth: {
    /** The tenant access token endpoint. */
    readonly tenantAccessToken: {
      /**
       * Exchange the application credentials for a tenant access token.
       * @param payload - the application id and secret.
       * @returns the platform's response envelope.
       */
      internal(payload: {
        readonly data: { readonly app_id: string; readonly app_secret: string }
      }): Promise<FeishuTokenResponse>
    }
  }
  /** Instant messaging. */
  readonly im: {
    /** Message send and reply. */
    readonly message: {
      /**
       * Send one message into a conversation.
       * @param payload - the receive id, message type, and JSON content.
       * @returns the platform's response envelope.
       */
      create(payload: {
        readonly params: { readonly receive_id_type: 'chat_id' }
        readonly data: {
          readonly receive_id: string
          readonly msg_type: string
          readonly content: string
        }
      }): Promise<FeishuMessageResponse>
      /**
       * Reply to one message.
       * @param payload - the message being answered and the reply body.
       * @returns the platform's response envelope.
       */
      reply(payload: {
        readonly path: { readonly message_id: string }
        readonly data: { readonly msg_type: string; readonly content: string }
      }): Promise<FeishuMessageResponse>
    }
    /** File upload. */
    readonly file: {
      /**
       * Upload one file and receive its key.
       * @param payload - the file name, type, and bytes.
       * @returns the unwrapped upload body, or null when the platform refused it.
       */
      create(payload: {
        readonly data: {
          readonly file_type: 'stream'
          readonly file_name: string
          readonly file: Buffer
        }
      }): Promise<FeishuUploadResponse | null>
    }
    /** Attachment download. */
    readonly messageResource: {
      /**
       * Download one attachment of one message.
       * @param payload - the message, the attachment key, and which kind it is.
       * @returns the body stream and its headers.
       */
      get(payload: {
        readonly path: { readonly message_id: string; readonly file_key: string }
        readonly params: { readonly type: 'image' | 'file' }
      }): Promise<FeishuResourceResponse>
    }
  }
}

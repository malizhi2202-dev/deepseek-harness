/**
 * DingTalk's contribution to the chat-channel seam's type surface: the channel
 * id this provider registers, the robot-callback JSON it reads, and the narrow
 * view of the official `dingtalk-stream` SDK this package depends on.
 *
 * The callback declaration names only the fields this connector reads. The
 * platform's robot callback carries many more and adds fields without notice,
 * so `./events.ts` validates the ones it depends on instead of trusting this
 * declaration.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

// Import the module so the declaration below augments the seam's map rather
// than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-channel/types'

declare module '@deepseek-ai/dsh-channel/types' {
  interface ChatChannelIdMap {
    /** DingTalk (钉钉). */
    dingtalk: 'dingtalk'
  }
}

/** One Stream message as the SDK hands it over: an envelope plus a JSON body. */
export interface DingTalkDownstream {
  /** The envelope headers, whose message id is the deduplication key. */
  readonly headers: { readonly messageId: string }
  /** The JSON body, which is the platform's robot callback. */
  readonly data: string
}

/**
 * The slice of `dingtalk-stream` this package calls.
 *
 * Declared structurally rather than imported so a test can drive the connector
 * against a stub, and so this package's own modules never name the SDK's
 * generated types.
 */
export interface DingTalkStream {
  /** Whether the socket is open right now. */
  readonly connected: boolean
  /**
   * Exchange the application credentials for an access token.
   * @returns the token the SDK obtained.
   */
  getAccessToken(): Promise<unknown>
  /**
   * Receive every Stream message, returning the acknowledgement the SDK sends back.
   * @param handler - the callback invoked for each message.
   */
  registerAllEventListener(handler: (message: DingTalkDownstream) => { readonly status: string }): void
  /**
   * Open the Stream connection and resolve once the socket is open.
   * @returns a promise that settles after the connection attempt.
   */
  connect(): Promise<void>
  /** Close the Stream connection. Idempotent. */
  disconnect(): void
}

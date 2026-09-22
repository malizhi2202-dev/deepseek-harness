/**
 * WeChat (微信) as a chat-channel provider: it declares the platform's
 * configuration namespace, implements the official bot channel's plain-JSON
 * protocol, and turns its long-poll message stream into a connector the bridge
 * can drive.
 *
 * The plugin owns no cross-platform decision. Deduplication, the chat lock,
 * admission, and replies belong to the bridge; this module resolves the
 * credential reference the configuration names, opens the message stream, and
 * exposes the QR sign-in a deployment establishes its account with.
 *
 * @module @deepseek-ai/dsh-channel-wechat
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatConnectorHandlers } from '@deepseek-ai/dsh-channel'
import { WECHAT_CAPABILITIES, WechatChatClient, WechatConversations, readInboundMessage, readWechatConfig, readWechatHost } from './client.ts'
import type { WechatChannelConfig } from './client.ts'
import { WechatSignIn } from './signin.ts'
import type { WechatSignInOptions } from './signin.ts'
import { WechatWire } from './wire.ts'
import type { ChatChannelConnector } from '@deepseek-ai/dsh-channel'
// Publishes and loads the declaration merging that registers this provider's
// channel id. A re-export keeps the module in every program that reaches this
// entry, which an empty type-only import does not.
export type * from './types.ts'

/** The plugin name the Cordis Loader registers this module under. */
export const name = 'channel-wechat'

/** The services this plugin reads: the registry it contributes to and the credential store. */
export const inject = ['chatChannels', 'credentials']

/** How many conversations one connector remembers the tokens for. */
const CONVERSATION_LIMIT = 1024

/** The pause between two polls of a held-open window. */
const POLL_GAP_MS = 1_000

/** The pause after a poll that failed. */
const RETRY_GAP_MS = 2_000

/** The pause after several consecutive failures. */
const BACKOFF_GAP_MS = 30_000

/** How many consecutive failures precede the longer pause. */
const FAILURES_BEFORE_BACKOFF = 3

/** The WeChat channel's configuration fields. */
export interface Config {
  /** The bot API host the QR sign-in's confirmation recorded; empty uses the official host. */
  baseUrl?: string
  /** Name of the `dsh-credentials` reference holding the bot token, never the token. */
  tokenRef?: string
  /** The value sent as `bot_agent`; empty uses this provider's own name. */
  botAgent?: string
}

/**
 * The channel configuration schema.
 *
 * Every field defaults to empty rather than to a working value: the account's
 * token and host come from a sign-in this repository cannot perform on a
 * deployment's behalf, and an empty field fails at the first connection with a
 * message naming it.
 */
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default(''),
  tokenRef: Schema.string().default(''),
  botAgent: Schema.string().default(''),
})

/**
 * Resolve the credential reference one configuration section names.
 *
 * Resolution happens per call rather than once at load, which is what lets a
 * rotated token reach the next connection without a restart.
 * @param ctx - the plugin context carrying the credential provider.
 * @param refName - the reference NAME the configuration holds.
 * @returns the token value.
 * @throws {ChatConfigError} when the name is not a credential reference, or nothing is stored behind it.
 */
async function resolveToken(ctx: Context, refName: string): Promise<string> {
  if (!isCredentialRefName(refName)) {
    throw new ChatConfigError('tokenRef', `tokenRef must name a credential reference, got ${JSON.stringify(refName)}`)
  }
  const stored = await ctx.credentials.resolve(credentialRef(refName))
  if (stored === undefined) {
    throw new ChatConfigError('tokenRef', `tokenRef names ${refName}, which no credential store holds`)
  }
  return stored.value
}

/** The WeChat connector, including the sign-in flow this channel's account is established through. */
export interface WechatConnector extends ChatChannelConnector {
  /**
   * Build the QR sign-in flow for one configuration section.
   *
   * The QR endpoints are unauthenticated, so the flow is available before any
   * token is stored, which is the only order that lets a deployment sign in.
   * @param section - the resolved channel configuration section naming the host.
   * @param options - the platform's timings, overridable by an interactive caller.
   * @returns the flow whose `start` requests a challenge and whose `wait` polls it.
   */
  signIn(section: ChatChannelConfig, options?: WechatSignInOptions): WechatSignIn
}

/**
 * Build the WeChat connector.
 *
 * Exported so a composition can register it without this module's `apply`, and
 * so a test can drive the connector against a stubbed transport.
 * @param ctx - the plugin context carrying the credential provider.
 * @param base - the plugin's own configuration, used as the namespace's composition layer.
 * @returns the connector the channel registry registers.
 */
export function createWechatConnector(ctx: Context, base: Config = {}): WechatConnector {
  const conversations = new WechatConversations(CONVERSATION_LIMIT)
  const accountOf = (settings: WechatChannelConfig, token: string): WechatWire =>
    new WechatWire({ baseUrl: settings.baseUrl, token, botAgent: settings.botAgent })
  return {
    channel: 'wechat',
    capabilities: WECHAT_CAPABILITIES,
    settings: {
      namespace: 'chat-channel-wechat',
      schema: Config,
      base,
      credentialFields: ['tokenRef'],
    },
    signIn(section: ChatChannelConfig, options?: WechatSignInOptions) {
      const host = readWechatHost(section)
      return new WechatSignIn(new WechatWire({ ...host, token: '' }), options)
    },
    async createClient(section: ChatChannelConfig) {
      const settings = readWechatConfig(section)
      return new WechatChatClient(accountOf(settings, await resolveToken(ctx, settings.tokenRef)), conversations, settings)
    },
    async connect(section: ChatChannelConfig, handlers: ChatConnectorHandlers) {
      const settings = readWechatConfig(section)
      const wire = accountOf(settings, await resolveToken(ctx, settings.tokenRef))
      return openInboundStream(wire, conversations, handlers)
    },
  }
}

/**
 * Open the platform's long-poll message stream.
 *
 * The loop reports ready once the platform has answered a poll, and again after
 * it recovers from a failure, because a held-open window that closes empty is
 * how this platform says the connection is healthy.
 * @param wire - the client the stream is read through.
 * @param conversations - the table the token of each conversation's last message is recorded in.
 * @param handlers - the inbound message, ready, and failure callbacks.
 * @returns the live connection whose `close` ends it.
 */
function openInboundStream(
  wire: WechatWire,
  conversations: WechatConversations,
  handlers: ChatConnectorHandlers,
): { close(): void } {
  const controller = new AbortController()
  // The controller is the one record of the connection's life, and reading it
  // through a call keeps the loop's own checks from being narrowed to the value
  // the first check established.
  const stopped = (): boolean => controller.signal.aborted
  let cursor = ''
  let pollMs: number | undefined
  void (async () => {
    let connected = false
    let failures = 0
    while (!stopped()) {
      try {
        const updates = await wire.getUpdates(cursor, {
          signal: controller.signal,
          ...pollMs === undefined ? {} : { timeoutMs: pollMs },
        })
        cursor = updates.cursor
        pollMs = updates.longPollMs ?? pollMs
        for (const raw of updates.messages) {
          const inbound = readInboundMessage(raw, wire)
          if (inbound === null) continue
          conversations.remember(inbound.message.chatId, inbound.contextToken)
          handlers.onMessage(inbound.message)
        }
        failures = 0
        if (!connected) {
          connected = true
          handlers.onReady?.()
        }
        await sleep(POLL_GAP_MS)
      } catch (error: unknown) {
        if (stopped()) break
        connected = false
        failures += 1
        handlers.onError?.(error)
        await sleep(failures >= FAILURES_BEFORE_BACKOFF ? BACKOFF_GAP_MS : RETRY_GAP_MS)
      }
    }
  })()
  return {
    close: () => {
      controller.abort()
    },
  }
}

/**
 * Wait one poll gap.
 * @param ms - the pause in milliseconds.
 * @returns a promise that settles after the pause.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Register the WeChat connector with the channel registry.
 * @param ctx - the plugin context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.chatChannels.register(createWechatConnector(ctx, config))
}

export * from './client.ts'
export * from './markdown.ts'
export * from './signin.ts'
export * from './wire.ts'

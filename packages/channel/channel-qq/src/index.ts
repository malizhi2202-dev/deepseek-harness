/**
 * QQ as a chat-channel provider: it declares the platform's configuration
 * namespace, implements the official bot open-platform API v2 over the channel
 * seam, and turns the gateway's event stream into a connector the bridge can
 * drive.
 *
 * The plugin owns no cross-platform decision. Deduplication, the chat lock,
 * admission, and replies belong to the bridge; this module resolves the
 * credential reference the configuration names, opens the gateway, and keeps the
 * ledger that lets an outbound message ride on a message the bot received.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatChannelConnector, ChatConnectorHandlers } from '@deepseek-ai/dsh-channel'
import { QqApi, QqGateway } from './api.ts'
import { QQ_CAPABILITIES, QqChatClient, readInboundMessage, readQqConfig } from './client.ts'
import type { QqChannelConfig } from './client.ts'
import { PassiveReplies } from './replies.ts'
// Publishes and loads the declaration merging that registers this provider's
// channel id. A re-export keeps the module in every program that reaches this
// entry, which an empty type-only import does not.
export type * from './types.ts'

/** The plugin name the Cordis Loader registers this module under. */
export const name = 'channel-qq'

/** The services this plugin reads: the registry it contributes to and the credential store. */
export const inject = ['chatChannels', 'credentials']

/**
 * Outbound messages one received message may carry.
 *
 * The platform allows four replies to a single-chat message and five to a group
 * message, so this connector reports the tighter of the two: the bridge caps a
 * reply's chunks at the reported budget, and a single number that never exceeds
 * what any conversation accepts is the honest declaration.
 */
export const QQ_REPLY_BUDGET = 4

/** How many received messages one connector keeps replyable. */
const REPLY_LEDGER_LIMIT = 1024

/** The QQ channel's configuration fields. */
export interface Config {
  /** The application id from the QQ bot developer console. */
  appId?: string
  /** Name of the `dsh-credentials` reference holding the application secret, never the secret. */
  appSecretRef?: string
  /** The API host; empty uses the host the current platform documentation names. */
  apiBaseUrl?: string
}

/**
 * The channel configuration schema.
 *
 * Every field defaults to empty rather than to a working value: there is no
 * application id or secret this repository can guess, and an empty field fails
 * at the first connection with a message naming it.
 */
export const Config: Schema<Config> = Schema.object({
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default(''),
  apiBaseUrl: Schema.string().default(''),
})

/**
 * Resolve the credential reference one configuration section names.
 *
 * Resolution happens per call rather than once at load, which is what lets a
 * rotated secret reach the next connection without a restart.
 * @param ctx - the plugin context carrying the credential provider.
 * @param refName - the reference NAME the configuration holds.
 * @returns the secret value.
 * @throws {ChatConfigError} when the name is not a credential reference, or nothing is stored behind it.
 */
async function resolveAppSecret(ctx: Context, refName: string): Promise<string> {
  if (!isCredentialRefName(refName)) {
    throw new ChatConfigError('appSecretRef', `appSecretRef must name a credential reference, got ${JSON.stringify(refName)}`)
  }
  const stored = await ctx.credentials.resolve(credentialRef(refName))
  if (stored === undefined) {
    throw new ChatConfigError('appSecretRef', `appSecretRef names ${refName}, which no credential store holds`)
  }
  return stored.value
}

/**
 * Build the QQ connector.
 *
 * Exported so a composition can register it without this module's `apply`, and
 * so a test can drive the connector against a stubbed transport.
 * @param ctx - the plugin context carrying the credential provider.
 * @param base - the plugin's own configuration, used as the namespace's composition layer.
 * @returns the connector the channel registry registers.
 */
export function createQqConnector(ctx: Context, base: Config = {}): ChatChannelConnector {
  const replies = new PassiveReplies(REPLY_LEDGER_LIMIT)
  const apiFor = async (settings: QqChannelConfig): Promise<QqApi> =>
    new QqApi({ appId: settings.appId, clientSecret: await resolveAppSecret(ctx, settings.appSecretRef) }, settings.apiBaseUrl)
  return {
    channel: 'qq',
    replyBudget: QQ_REPLY_BUDGET,
    capabilities: QQ_CAPABILITIES,
    settings: {
      namespace: 'chat-channel-qq',
      schema: Config,
      base,
      credentialFields: ['appSecretRef'],
    },
    async createClient(section: ChatChannelConfig) {
      const settings = readQqConfig(section)
      return new QqChatClient(await apiFor(settings), replies, settings)
    },
    async connect(section: ChatChannelConfig, handlers: ChatConnectorHandlers) {
      const settings = readQqConfig(section)
      const api = await apiFor(settings)
      const gateway = new QqGateway(api, {
        onDispatch(event, data) {
          const message = readInboundMessage(event, data, api)
          if (message === null) return
          replies.remember(message.chatId, message.messageId)
          handlers.onMessage(message)
        },
        onReady() {
          handlers.onReady?.()
        },
        onError(error) {
          handlers.onError?.(error)
        },
      })
      await gateway.open()
      return {
        close: () => {
          gateway.close()
        },
      }
    },
  }
}

/**
 * Register the QQ connector with the channel registry.
 * @param ctx - the plugin context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.chatChannels.register(createQqConnector(ctx, config))
}

export * from './api.ts'
export * from './client.ts'
export * from './json.ts'
export * from './markdown.ts'
export * from './replies.ts'
export * from './token.ts'

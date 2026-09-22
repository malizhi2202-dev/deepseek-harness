/**
 * DingTalk (钉钉) as a chat-channel provider: it declares the platform's
 * configuration namespace and adapts the official `dingtalk-stream` SDK into a
 * connector the bridge can drive.
 *
 * The official SDK owns the Stream protocol this package would otherwise
 * hand-roll: gateway discovery, the WebSocket connection, the per-message
 * acknowledgement, and reconnection. What this plugin owns is the seam — the
 * settings namespace, the credential reference, the normalized inbound message,
 * the session webhook a reply goes through, and the outbound client — so every
 * cross-platform decision stays in the bridge.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

import { DWClient, EventAck } from 'dingtalk-stream'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatChannelConnector } from '@deepseek-ai/dsh-channel'
import { DINGTALK_CAPABILITIES, DingTalkChatClient, DingTalkWebhooks, readDingTalkConfig } from './client.ts'
import type { DingTalkChannelConfig } from './client.ts'
import { parseRobotCallback, toInboundMessage } from './events.ts'
import type { DingTalkStream } from './types.ts'

/** The plugin name the Cordis Loader registers this module under. */
export const name = 'channel-dingtalk'

/** The services this plugin reads: the registry it contributes to and the credential store. */
export const inject = ['chatChannels', 'credentials']

/** The DingTalk channel's configuration fields. */
export interface Config {
  /** The internal application's Client ID, which DingTalk also calls the AppKey. */
  clientId?: string
  /** Name of a `dsh-credentials` reference holding the Client Secret, never the secret. */
  clientSecretRef?: string
}

/**
 * The channel configuration schema.
 *
 * Every field defaults to empty rather than to a working value: there is no
 * application this repository can guess, and an empty field fails at the first
 * connection with a message naming it.
 */
export const Config: Schema<Config> = Schema.object({
  clientId: Schema.string().default(''),
  clientSecretRef: Schema.string().default(''),
})

/**
 * Open one Stream client for a settings section, resolving the Client Secret
 * the section names.
 *
 * Resolution happens per operation rather than once at load, which is what lets
 * a rotated secret reach the next connection without a restart. The section's
 * own fields are checked by {@link readDingTalkConfig}.
 * @param ctx - the plugin context carrying the credential provider.
 * @param section - the channel's resolved settings section.
 * @returns the validated fields and the Stream client built from the secret.
 * @throws {ChatConfigError} naming the first field the section cannot supply.
 */
async function openStream(ctx: Context, section: ChatChannelConfig): Promise<{
  readonly settings: DingTalkChannelConfig
  readonly stream: DingTalkStream
}> {
  const settings = readDingTalkConfig(section)
  const resolved = await ctx.credentials.resolve(credentialRef(settings.clientSecretRef))
  if (resolved === undefined) {
    throw new ChatConfigError('clientSecretRef', `no credential is configured for ${settings.clientSecretRef}`)
  }
  return { settings, stream: new DWClient({ clientId: settings.clientId, clientSecret: resolved.value }) }
}

/**
 * Build the DingTalk connector.
 *
 * The connector owns the session webhooks because they are the one fact both
 * halves need: `connect` records the URL each inbound message carries, and the
 * client `createClient` builds posts replies to it.
 * @param ctx - the plugin context carrying the credential provider.
 * @param base - the plugin's own configuration, used as the namespace's composition layer.
 * @returns the connector the channel registry registers.
 */
export function createDingTalkConnector(ctx: Context, base: Config = {}): ChatChannelConnector {
  const webhooks = new DingTalkWebhooks()
  return {
    channel: 'dingtalk',
    capabilities: DINGTALK_CAPABILITIES,
    settings: {
      namespace: 'chat-channel-dingtalk',
      schema: Config,
      base,
      credentialFields: ['clientSecretRef'],
    },
    async createClient(section: ChatChannelConfig) {
      const { settings, stream } = await openStream(ctx, section)
      return new DingTalkChatClient(settings, stream, webhooks)
    },
    async connect(section: ChatChannelConfig, handlers) {
      const { stream } = await openStream(ctx, section)
      stream.registerAllEventListener((message) => {
        const event = parseRobotCallback(message.data)
        if (event !== null) {
          webhooks.record(event.chatId, event.webhook, event.webhookExpiresAt)
          handlers.onMessage(toInboundMessage(event))
        }
        return { status: EventAck.SUCCESS }
      })
      await stream.connect()
      // The SDK swallows a failed initial connect and retries on its own, so
      // the socket's own state is the only report available here.
      if (stream.connected) handlers.onReady?.()
      else handlers.onError?.(new Error('DingTalk refused the Stream connection'))
      return {
        close: () => { stream.disconnect() },
      }
    },
  }
}

/**
 * Register the DingTalk connector with the channel registry.
 * @param ctx - the plugin context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.chatChannels.register(createDingTalkConnector(ctx, config))
}

export * from './client.ts'
export * from './events.ts'
export * from './json.ts'
export * from './markdown.ts'
export * from './types.ts'

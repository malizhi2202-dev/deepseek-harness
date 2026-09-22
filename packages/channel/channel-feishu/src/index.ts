/**
 * Feishu (飞书) as a chat-channel provider: it declares the platform's
 * configuration namespace and adapts the official `@larksuiteoapi/node-sdk`
 * into a connector the bridge can drive.
 *
 * The official SDK owns the protocol this package would otherwise hand-roll:
 * endpoint discovery, the WebSocket long connection, event parsing, heartbeats,
 * and reconnection. What this plugin owns is the seam — the settings namespace,
 * the credential reference, the normalized inbound message, and the outbound
 * client — so every cross-platform decision stays in the bridge.
 *
 * @module @deepseek-ai/dsh-channel-feishu
 */

import * as lark from '@larksuiteoapi/node-sdk'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatChannelConnector } from '@deepseek-ai/dsh-channel'
import { FEISHU_CAPABILITIES, FeishuChatClient, readFeishuConfig } from './client.ts'
import type { FeishuChannelConfig } from './client.ts'
import { parseMessageEvent, toInboundMessage } from './events.ts'
import type { FeishuApi, FeishuDomain } from './types.ts'

/** The plugin name the Cordis Loader registers this module under. */
export const name = 'channel-feishu'

/** The services this plugin reads: the registry it contributes to and the credential store. */
export const inject = ['chatChannels', 'credentials']

/** The Feishu channel's configuration fields. */
export interface Config {
  /** The self-built application's id from the Feishu Open Platform console. */
  appId?: string
  /** The deployment whose endpoints the application signs in to. */
  domain?: FeishuDomain
  /** Name of a `dsh-credentials` reference holding the application secret, never the secret. */
  appSecretRef?: string
}

/**
 * The channel configuration schema.
 *
 * Every field defaults to empty rather than to a working value: there is no
 * application id this repository can guess, and an empty field fails at the
 * first connection with a message naming it. The one field with a working
 * default is the deployment, because a self-built application is registered on
 * one Open Platform console and its events arrive from there.
 */
export const Config: Schema<Config> = Schema.object({
  appId: Schema.string().default(''),
  domain: Schema.union(['feishu', 'lark']).default('feishu'),
  appSecretRef: Schema.string().default(''),
})

/**
 * Resolve one settings section into everything an operation needs: the
 * validated fields, the application secret, and the SDK view the outbound calls
 * and the attachment downloads go through.
 *
 * Resolution happens per operation rather than once at load, which is what lets
 * a rotated secret reach the next connection without a restart. The application
 * id's form is checked by {@link readFeishuConfig}, because the SDK declines a
 * malformed one by logging and returning rather than by failing.
 * @param ctx - the plugin context carrying the credential provider.
 * @param section - the channel's resolved settings section.
 * @returns the validated fields, the secret, and the SDK client.
 * @throws {ChatConfigError} naming the first field the section cannot supply.
 */
async function openFeishu(ctx: Context, section: ChatChannelConfig): Promise<{
  readonly settings: FeishuChannelConfig
  readonly appSecret: string
  readonly api: FeishuApi
}> {
  const settings = readFeishuConfig(section)
  const resolved = await ctx.credentials.resolve(credentialRef(settings.appSecretRef))
  if (resolved === undefined) {
    throw new ChatConfigError('appSecretRef', `no credential is configured for ${settings.appSecretRef}`)
  }
  const appSecret = resolved.value
  return {
    settings,
    appSecret,
    api: new lark.Client({
      appId: settings.appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: settings.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
    }),
  }
}

/**
 * Build the Feishu connector.
 *
 * Exported so a composition can register it without this module's `apply`, and
 * so a test can drive the connector against an SDK stub.
 * @param ctx - the plugin context carrying the credential provider.
 * @param base - the plugin's own configuration, used as the namespace's composition layer.
 * @returns the connector the channel registry registers.
 */
export function createFeishuConnector(ctx: Context, base: Config = {}): ChatChannelConnector {
  return {
    channel: 'feishu',
    capabilities: FEISHU_CAPABILITIES,
    settings: {
      namespace: 'chat-channel-feishu',
      schema: Config,
      base,
      credentialFields: ['appSecretRef'],
    },
    async createClient(section: ChatChannelConfig) {
      const { settings, appSecret, api } = await openFeishu(ctx, section)
      return new FeishuChatClient(api, settings, appSecret)
    },
    async connect(section: ChatChannelConfig, handlers) {
      const { settings, appSecret, api } = await openFeishu(ctx, section)
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': (payload) => {
          const event = parseMessageEvent(payload)
          if (event !== null) handlers.onMessage(toInboundMessage(api, event))
        },
      })
      const socket = new lark.WSClient({
        appId: settings.appId,
        appSecret,
        domain: settings.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.error,
        onReady: () => { handlers.onReady?.() },
        onReconnected: () => { handlers.onReady?.() },
        onError: (error: Error) => { handlers.onError?.(error) },
      })
      await socket.start({ eventDispatcher: dispatcher })
      return {
        close: () => { socket.close() },
      }
    },
  }
}

/**
 * Register the Feishu connector with the channel registry.
 * @param ctx - the plugin context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.chatChannels.register(createFeishuConnector(ctx, config))
}

export * from './client.ts'
export * from './events.ts'
export * from './markdown.ts'
export * from './types.ts'

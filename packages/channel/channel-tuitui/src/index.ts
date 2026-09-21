/**
 * Tuitui as a chat-channel provider: it declares the platform's configuration
 * namespace and turns the existing `@deepseek-ai/dsh-tuitui` transport into a
 * connector the bridge can drive.
 *
 * The plugin owns no protocol. It resolves the credential reference the
 * configuration names, builds the transport this repository already ships, and
 * hands the bridge a normalized message stream; every decision about
 * deduplication, admission, and replies belongs to the bridge.
 *
 * @module @deepseek-ai/dsh-channel-tuitui
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatChannelConnector } from '@deepseek-ai/dsh-channel'
import { TuituiClient } from '@deepseek-ai/dsh-tuitui'
import { TUITUI_CAPABILITIES, TuituiChatClient, readTuituiConfig, toInboundMessage } from './client.ts'

/** The plugin name the Cordis Loader registers this module under. */
export const name = 'channel-tuitui'

/** The services this plugin reads: the registry it contributes to and the credential store. */
export const inject = ['chatChannels', 'credentials']

/** The Tuitui channel's configuration fields. */
export interface Config {
  /** Tuitui IM server host, without a scheme or port. */
  host?: string
  /** The bot application's id from the Tuitui developer console. */
  appId?: string
  /** Name of the `dsh-credentials` reference holding the bot application's secret, never the secret. */
  appSecretRef?: string
}

/**
 * The channel configuration schema.
 *
 * Every field defaults to empty rather than to a working value: there is no
 * host or application id this repository can guess, and an empty field fails at
 * the first connection with a message naming it.
 */
export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default(''),
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default(''),
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
    throw new ChatConfigError('appSecretRef', `${refName} is not a credential reference name`)
  }
  const resolved = await ctx.credentials.resolve(credentialRef(refName))
  if (resolved === undefined) {
    throw new ChatConfigError('appSecretRef', `no credential is configured for ${refName}`)
  }
  return resolved.value
}

/**
 * Build the Tuitui connector.
 *
 * Exported so a composition can register it without this module's `apply`, and
 * so a test can drive the connector against a transport stub.
 * @param ctx - the plugin context carrying the credential provider.
 * @param base - the plugin's own configuration, used as the namespace's composition layer.
 * @returns the connector the channel registry registers.
 */
export function createTuituiConnector(ctx: Context, base: Config = {}): ChatChannelConnector {
  return {
    channel: 'tuitui',
    capabilities: TUITUI_CAPABILITIES,
    settings: {
      namespace: 'chat-channel-tuitui',
      schema: Config,
      base: { ...base },
      credentialFields: ['appSecretRef'],
    },
    async createClient(section: ChatChannelConfig) {
      const settings = readTuituiConfig(section)
      const appSecret = await resolveAppSecret(ctx, settings.appSecretRef)
      return new TuituiChatClient(new TuituiClient(settings.appId, appSecret, settings.host), settings)
    },
    async connect(section: ChatChannelConfig, handlers) {
      const settings = readTuituiConfig(section)
      const appSecret = await resolveAppSecret(ctx, settings.appSecretRef)
      const transport = new TuituiClient(settings.appId, appSecret, settings.host)
      transport.onMessage((message) => {
        handlers.onMessage(toInboundMessage(message))
      })
      await transport.connect()
      // The transport's receive loop reports no handshake, so the furthest this
      // connector can honestly say is that the loop is running.
      handlers.onReady?.()
      return {
        close: () => {
          void transport.disconnect()
        },
      }
    },
  }
}

/**
 * Register the Tuitui connector with the channel registry.
 * @param ctx - the plugin context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.chatChannels.register(createTuituiConnector(ctx, config))
}

export * from './client.ts'

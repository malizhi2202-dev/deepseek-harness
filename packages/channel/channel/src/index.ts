/**
 * The chat-channel registry service (`ctx.chatChannels`): the one place the
 * generic bridge and the configuration panel read which platforms this build
 * can drive.
 *
 * The registry holds connectors, not connections. A connector is a
 * platform's lifecycle and configuration seam; the bridge owns the one live
 * connection per enabled channel, so a registry entry costs nothing until the
 * bridge opens it.
 *
 * @module @deepseek-ai/dsh-channel
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ChatChannelConnector, ChatChannelId } from './types.ts'

export type * from './types.ts'
export * from './errors.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registry of the chat platforms this build can drive. */
    chatChannels: ChatChannels
  }
}

/** Registry of chat-channel connectors, keyed by platform id. */
export class ChatChannels extends Service {
  private readonly connectors = new Map<ChatChannelId, ChatChannelConnector>()

  /**
   * @param ctx - owning context; the registry's entries unwind with its fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'chatChannels')
  }

  /**
   * Register one platform's connector. Registration is an effect: the entry
   * disappears when the returned disposer runs or the owning fiber unloads.
   * @param connector - the platform's lifecycle and configuration seam.
   * @returns the disposer removing this entry.
   * @throws when a connector for the same platform is already registered, which
   *   is a composition mistake rather than a race: two connectors for one
   *   platform would leave the panel showing whichever registered last.
   */
  register(connector: ChatChannelConnector): () => void {
    const channel = connector.channel
    const dispose = this.ctx.effect(() => {
      if (this.connectors.has(channel)) {
        throw new Error(`a connector for chat channel "${channel}" is already registered`)
      }
      this.connectors.set(channel, connector)
      return () => { this.connectors.delete(channel) }
    }, `chatChannels.register(${channel})`)
    return () => { void dispose() }
  }

  /**
   * Every registered connector, in registration order.
   * @returns a detached array; later registrations do not change it.
   */
  list(): readonly ChatChannelConnector[] {
    return [...this.connectors.values()]
  }

  /**
   * The connector for one platform.
   * @param channel - the platform to look up.
   * @returns the connector, or `undefined` when this build has none.
   */
  get(channel: ChatChannelId): ChatChannelConnector | undefined {
    return this.connectors.get(channel)
  }
}

export default ChatChannels

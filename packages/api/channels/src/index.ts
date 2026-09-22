/**
 * The `channels` Remote namespace: the configuration panel's whole view of the
 * chat platforms this Host serves, and the two operations that change a binding.
 *
 * The seam this endpoint rides (`ctx.chatChannels` and `ctx.chatBridge`) owns
 * every rule — what a channel can carry, whether its connection is up, which
 * conversation it answers — and this service adds none of its own. It reports,
 * and it forwards one enable or disable; it never admits a message and never
 * reaches a model request.
 *
 * Two facts are assembled here rather than in the bridge because only a
 * configuration surface needs them: the channel's resolved settings section,
 * read through the settings provider, and the presence of each credential
 * reference that section names. Credential status is reported by reference name
 * and never by value, so this endpoint cannot leak a secret even by accident.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { ChatChannelId } from '@deepseek-ai/dsh-channel'
import type {} from '@deepseek-ai/dsh-channel-bridge'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ChannelCredentialView, ChannelProbe, ChannelsStatus, ChannelView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `channels` Remote namespace. */
    channels: Channels
  }
}

/** Host Remote service reporting the chat channels and moving one binding. */
export class Channels extends TypertRemoteService {
  static inject = ['chatBridge', 'credentials', 'settings', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'channels')
  }

  /**
   * Read every channel's status.
   *
   * The bridge binds connectors that registered after it mounted, so this call
   * settles the registry first: a channel a plugin added a moment ago is
   * reported rather than missing.
   * @returns one view per registered channel, in registration order.
   */
  @Remote
  async status(): Promise<ChannelsStatus> {
    return await this.readStatus()
  }

  /**
   * Test whether one channel can build a client with its configured credentials.
   *
   * A channel that cannot is answered, not rejected: `ok: false` with the
   * reason is what the panel shows, and only an unregistered channel is an
   * error.
   * @param channel - the channel id to probe, as the panel knows it.
   * @returns what the probe found.
   * @throws {RemoteError} with code `channels/unknown` when no such channel is registered.
   */
  @Remote
  async probe(channel: string): Promise<ChannelProbe> {
    return await this.ctx.chatBridge.probe(this.requireChannel(channel))
  }

  /**
   * Point one channel at the calling Session and open its connection.
   *
   * The Session is the wire identity, so a panel cannot bind a channel to a
   * Session it is not addressing.
   * @param channel - the channel id to bind.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @returns the status after the change.
   * @throws {RemoteError} with code `channels/unknown` or `channels/failed`, whose message names what to fix.
   */
  @Remote
  async enable(channel: string, agent: Agent): Promise<ChannelsStatus> {
    const known = this.requireChannel(channel)
    try {
      await this.ctx.chatBridge.enable(known, agent.id)
    } catch (error: unknown) {
      throw new RemoteError('channels/failed', failureText(error), {}, { cause: error })
    }
    return await this.readStatus()
  }

  /**
   * Close one channel's connection, leaving its configuration otherwise intact.
   * @param channel - the channel id to close.
   * @returns the status after the change.
   * @throws {RemoteError} with code `channels/unknown` or `channels/failed`.
   */
  @Remote
  async disable(channel: string): Promise<ChannelsStatus> {
    const known = this.requireChannel(channel)
    try {
      await this.ctx.chatBridge.disable(known)
    } catch (error: unknown) {
      throw new RemoteError('channels/failed', failureText(error), {}, { cause: error })
    }
    return await this.readStatus()
  }

  /** Assemble the panel's view from the bridge and the settings provider. */
  private async readStatus(): Promise<ChannelsStatus> {
    this.ctx.chatBridge.sync()
    const descriptors = new Map(
      this.ctx.settings.describe({ redactSecrets: true }).map(descriptor => [String(descriptor.ns), descriptor]),
    )
    const channels: ChannelView[] = []
    for (const status of this.ctx.chatBridge.statuses()) {
      const descriptor = descriptors.get(status.settingsNamespace)
      channels.push({
        channel: status.channel,
        enabled: status.enabled,
        sessionId: status.sessionId,
        connection: status.connection,
        ...status.lastError === undefined ? {} : { lastError: status.lastError },
        ...status.lastErrorAt === undefined ? {} : { lastErrorAt: status.lastErrorAt },
        ...status.lastInboundAt === undefined ? {} : { lastInboundAt: status.lastInboundAt },
        ...status.lockedChatId === undefined ? {} : { lockedChatId: status.lockedChatId },
        ...status.replyBudget === undefined ? {} : { replyBudget: status.replyBudget },
        capabilities: status.capabilities,
        settingsNamespace: status.settingsNamespace,
        credentials: await this.credentialsOf(descriptor, status.credentialFields),
      })
    }
    return { channels }
  }

  /**
   * Resolve one channel's configured reference names to presence facts.
   *
   * The reference names are read from the channel's own settings section, which
   * is why a reference the user changed a moment ago is reported at its new
   * value without this endpoint caching anything.
   */
  private async credentialsOf(
    descriptor: SettingsDescriptor | undefined,
    fields: readonly string[],
  ): Promise<readonly ChannelCredentialView[]> {
    const section = descriptor?.value
    const record = typeof section === 'object' && section !== null
      ? section as Record<string, unknown>
      : {}
    const views: ChannelCredentialView[] = []
    for (const field of fields) {
      const value = record[field]
      const ref = typeof value === 'string' ? value : ''
      if (!isCredentialRefName(ref)) {
        views.push({ field, ref, configured: false, writable: false })
        continue
      }
      const info = await this.ctx.credentials.describe(credentialRef(ref))
      views.push({
        field,
        ref,
        configured: info.configured,
        writable: info.writable,
        ...info.source === undefined ? {} : { source: info.source },
      })
    }
    return views
  }

  /** The registered channel one wire string names, or a loud refusal. */
  private requireChannel(value: string): ChatChannelId {
    const known = this.ctx.chatBridge.statuses().map(status => status.channel).find(channel => channel === value)
    if (known === undefined) {
      throw new RemoteError('channels/unknown', `no channel named ${value} is registered`, {})
    }
    return known
  }
}

/** The failure text of anything the bridge refused with. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default Channels

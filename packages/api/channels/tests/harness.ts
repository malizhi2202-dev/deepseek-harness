/**
 * Shared harness for the `channels` Remote endpoint suite.
 *
 * A bare Cordis Context carries scripted chat-bridge, credential-provider, and
 * settings-provider doubles at exactly the boundary the endpoint reads them
 * through, so every assertion observes what the endpoint asked the seam for and
 * what it assembled from the answer. The endpoint is constructed directly
 * rather than mounted as a plugin, because mounting it would wait on the
 * Gateway's `typert` service, which a bare test Context does not carry.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ChatChannelCapabilities, ChatChannelId } from '@deepseek-ai/dsh-channel'
import type { ChatChannelStatus, ChatProbeResult } from '@deepseek-ai/dsh-channel-bridge'
import type { CredentialInfo, CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  SettingsDescribeOptions,
  SettingsDescriptor,
  SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import Channels from '../src/index.ts'

/** The one channel id this suite addresses. */
export const CHANNEL = 'tuitui'

/** The channel id one scripted refusal names as already serving a Session. */
export const OTHER_CHANNEL = 'tuitui-other'

/** The settings namespace the channel above keeps its configuration in. */
export const NAMESPACE = 'channel-tuitui'

/** The Session one scripted binding points a channel at. */
export const SESSION = 'session-test'

/** The Agent identity the Gateway resolves for {@link SESSION}. */
export const AGENT = { id: SESSION } as unknown as Agent

/** Capabilities of a channel that carries plain text and nothing else. */
export const CAPABILITIES: ChatChannelCapabilities = {
  quoting: false,
  inbound: { images: false, files: false },
  outbound: { images: false, files: false },
  markdown: false,
}

/** One settings descriptor, carrying only the fields this endpoint reads. */
export function descriptor(ns: string, value: unknown): SettingsDescriptor {
  return { ns: ns as SettingsNamespace, schema: {}, value, revision: 1, applies: 'live' }
}

/** The fields one scripted channel status may carry. */
export interface ChannelStatusFields {
  /** The channel this status describes; defaults to {@link CHANNEL}. */
  readonly channel?: string
  /** The settings namespace holding its configuration. */
  readonly settingsNamespace: string
  /** Whether its connection is configured open. */
  readonly enabled?: boolean
  /** The Session it drives. */
  readonly sessionId?: string
  /** Where its connection stands. */
  readonly connection?: ChatChannelStatus['connection']
  /** What its platform can carry. */
  readonly capabilities?: ChatChannelCapabilities
  /** Configuration fields whose values name credential references. */
  readonly credentialFields?: readonly string[]
  /** The most recent failure's text. */
  readonly lastError?: string
  /** When that failure was recorded. */
  readonly lastErrorAt?: string
  /** When the channel last admitted a message. */
  readonly lastInboundAt?: string
  /** The conversation the channel answers. */
  readonly lockedChatId?: string
  /** The platform's per-inbound-message reply budget. */
  readonly replyBudget?: number
}

/** Build one bridge status, carrying an optional fact only when a test names it. */
export function channelStatus(fields: ChannelStatusFields): ChatChannelStatus {
  return {
    channel: (fields.channel ?? CHANNEL) as ChatChannelId,
    enabled: fields.enabled ?? false,
    sessionId: fields.sessionId ?? '',
    connection: fields.connection ?? 'stopped',
    capabilities: fields.capabilities ?? CAPABILITIES,
    settingsNamespace: fields.settingsNamespace,
    credentialFields: fields.credentialFields ?? [],
    ...fields.lastError === undefined ? {} : { lastError: fields.lastError },
    ...fields.lastErrorAt === undefined ? {} : { lastErrorAt: fields.lastErrorAt },
    ...fields.lastInboundAt === undefined ? {} : { lastInboundAt: fields.lastInboundAt },
    ...fields.lockedChatId === undefined ? {} : { lockedChatId: fields.lockedChatId },
    ...fields.replyBudget === undefined ? {} : { replyBudget: fields.replyBudget },
  }
}

/** The chat-bridge double, recording every call the endpoint made. */
export interface ScriptedBridge {
  /** Channel ids the endpoint probed, in order. */
  readonly probes: string[]
  /** Channel and Session pairs the endpoint enabled, in order. */
  readonly enables: Array<{ readonly channel: string; readonly sessionId: string }>
  /** Channel ids the endpoint disabled, in order. */
  readonly disables: string[]
  sync(): void
  statuses(): readonly ChatChannelStatus[]
  probe(channel: ChatChannelId): Promise<ChatProbeResult>
  enable(channel: ChatChannelId, sessionId: string): Promise<void>
  disable(channel: ChatChannelId): Promise<void>
}

/** The credential-provider double, recording every reference it was asked about. */
export interface ScriptedCredentials {
  /** Reference names the endpoint asked about, in order. */
  readonly described: string[]
  describe(ref: CredentialRef): Promise<CredentialInfo>
}

/** The settings-provider double, recording every describe call it served. */
export interface ScriptedSettings {
  /** Options each `describe` call carried, in order. */
  readonly describeOptions: Array<SettingsDescribeOptions | undefined>
  describe(options?: SettingsDescribeOptions): SettingsDescriptor[]
}

/** What a test scripts into the harness, each entry defaulting to an inert answer. */
export interface HarnessOptions {
  /** Descriptors the settings provider reports. */
  readonly descriptors?: readonly SettingsDescriptor[]
  /** Statuses the bridge reports, read fresh on every call. */
  readonly statuses?: () => readonly ChatChannelStatus[]
  /** What the bridge's probe answers. */
  readonly probe?: (channel: ChatChannelId) => Promise<ChatProbeResult>
  /** What the bridge's enable does; rejecting scripts a refusal. */
  readonly enable?: (channel: ChatChannelId, sessionId: string) => Promise<void>
  /** What the bridge's disable does; rejecting scripts a refusal. */
  readonly disable?: (channel: ChatChannelId) => Promise<void>
  /** Presence facts the credential provider reports. */
  readonly credentialInfo?: (ref: CredentialRef) => Promise<CredentialInfo>
}

/** The doubles and the endpoint over them, plus the ordered boundary call log. */
export interface Harness {
  readonly endpoint: Channels
  readonly bridge: ScriptedBridge
  readonly credentials: ScriptedCredentials
  readonly settings: ScriptedSettings
  /** Boundary calls the endpoint made, in order, named by the service that served them. */
  readonly log: string[]
}

/** The chat-bridge double: reports the scripted statuses, and fails loud on an unscripted probe. */
function scriptedBridge(log: string[], options: HarnessOptions): ScriptedBridge {
  const probes: string[] = []
  const enables: Array<{ channel: string; sessionId: string }> = []
  const disables: string[] = []
  return {
    probes,
    enables,
    disables,
    sync: () => {
      log.push('chatBridge.sync')
    },
    statuses: () => {
      log.push('chatBridge.statuses')
      return options.statuses?.() ?? []
    },
    probe: async (channel) => {
      log.push('chatBridge.probe')
      probes.push(channel)
      if (options.probe === undefined) throw new Error(`no probe was scripted for ${channel}`)
      return await options.probe(channel)
    },
    enable: async (channel, sessionId) => {
      log.push('chatBridge.enable')
      enables.push({ channel, sessionId })
      await options.enable?.(channel, sessionId)
    },
    disable: async (channel) => {
      log.push('chatBridge.disable')
      disables.push(channel)
      await options.disable?.(channel)
    },
  }
}

/** The credential-provider double: unconfigured and unwritable unless a test scripts presence facts. */
function scriptedCredentials(log: string[], options: HarnessOptions): ScriptedCredentials {
  const described: string[] = []
  return {
    described,
    describe: async (ref) => {
      log.push(`credentials.describe(${ref})`)
      described.push(ref)
      return await options.credentialInfo?.(ref) ?? { configured: false, writable: false }
    },
  }
}

/** The settings-provider double: reports the scripted descriptors, in order. */
function scriptedSettings(log: string[], options: HarnessOptions): ScriptedSettings {
  const describeOptions: Array<SettingsDescribeOptions | undefined> = []
  return {
    describeOptions,
    describe: (given) => {
      log.push('settings.describe')
      describeOptions.push(given)
      return [...options.descriptors ?? []]
    },
  }
}

/** Build the endpoint over a bare Context carrying the scripted boundary doubles. */
export function harness(options: HarnessOptions = {}): Harness {
  const log: string[] = []
  const ctx = new Context()
  const bridge = scriptedBridge(log, options)
  const credentials = scriptedCredentials(log, options)
  const settings = scriptedSettings(log, options)
  // Each double carries only the members this endpoint reads, so it is cast to
  // the service slot it fills; `ctx.provide` takes the value as given.
  ctx.provide('chatBridge', bridge as never)
  ctx.provide('credentials', credentials as never)
  ctx.provide('settings', settings as never)
  const disposeTypert = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => disposeTypert },
    contexts: { configureHost: () => disposeTypert },
  } as never)
  return { endpoint: new Channels(ctx), bridge, credentials, settings, log }
}

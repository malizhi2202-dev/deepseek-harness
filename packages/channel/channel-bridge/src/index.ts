/**
 * The generic half of the remote-control seam: everything about driving an
 * Agent Session from a chat platform that is not specific to a platform.
 *
 * A connector moves bytes and knows its own protocol; this plugin owns the
 * decisions that must be identical everywhere — what counts as a duplicate,
 * which conversation one Session answers, what reaches the model, what leaves
 * it, and which files may leave it. A provider that re-implemented any of those
 * would be a second place for them to be wrong.
 *
 * Three of those decisions are security properties rather than conveniences,
 * and each is enforced in the operation that makes it:
 *
 * - The chat lock is the conversation recorded on the first admitted message,
 *   read from the Session's own log. A second conversation that finds the bot
 *   reaches the same Agent but never receives a reply, so a bot in a public
 *   group cannot leak one conversation into another.
 * - Outbound files are the intersection of what a reply NAMED and what the
 *   round WROTE, resolved inside the Session workspace. Naming a path proves
 *   nothing, so a reply talked into naming `~/.ssh/id_rsa` delivers nothing.
 * - Deduplication runs before admission and the durable record is the admitted
 *   message's own `user/message` event, so a platform replay cannot become a
 *   second run.
 *
 * @module @deepseek-ai/dsh-channel-bridge
 */

import { basename } from 'node:path'
import { stat } from 'node:fs/promises'
import { Service, type Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  ChatConfigError,
  ChatFormatRejectedError,
  ChatMediaTooLargeError,
  ChatPermissionError,
  ChatUnsupportedError,
  chatErrorKind,
} from '@deepseek-ai/dsh-channel'
import type {
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatChannelConnector,
  ChatChannelId,
  ChatClient,
  ChatErrorSite,
  ChatId,
  ChatInboundFile,
  ChatInboundImage,
  ChatInboundMessage,
  ChatMessageId,
} from '@deepseek-ai/dsh-channel'
import { capToReplyBudget, chunkChatText } from './chunk.ts'
import { channelLogMemory, RecentInboundIds } from './dedupe.ts'
import { replyFileMentions } from './mentions.ts'
import { CHAT_NOTICES } from './notices.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Loads the `approval/asked` session event this bridge mirrors into the chat.
import type {} from '@deepseek-ai/dsh-user-approval/types'

/**
 * Bridge configuration: the bounds and cut-offs that vary by deployment.
 *
 * Every field is here rather than in a constant because a self-hosted bridge
 * and a hosted one disagree about them, and none of them is a platform fact.
 */
export interface Config {
  /** Characters per outbound message; keep it under the tightest platform cap this deployment serves. */
  chunkChars?: number
  /** Recently processed inbound ids one binding remembers beyond its durable watermark. */
  dedupeSize?: number
  /** Files one reply may deliver; the remainder is counted in a notice. */
  maxReplyFiles?: number
  /** How far before a run's start a file may have been written and still count as its output. */
  mtimeGraceMs?: number
  /** Largest inbound attachment the bridge will transfer into the Session. */
  maxInboundFileBytes?: number
  /** Largest outbound file the bridge will read out of the Session workspace. */
  maxOutboundFileBytes?: number
}

/** Validated bridge configuration. */
export const Config: Schema<Config> = z.object({
  chunkChars: z.natural().min(200).default(4000),
  dedupeSize: z.natural().min(1).default(64),
  maxReplyFiles: z.natural().min(1).default(5),
  mtimeGraceMs: z.natural().default(2000),
  maxInboundFileBytes: z.natural().default(30 * 1024 * 1024),
  maxOutboundFileBytes: z.natural().default(30 * 1024 * 1024),
})

/** Bridge configuration with every default resolved. */
export interface ResolvedConfig {
  /** Characters per outbound message. */
  readonly chunkChars: number
  /** Recently processed inbound ids one binding remembers. */
  readonly dedupeSize: number
  /** Files one reply may deliver. */
  readonly maxReplyFiles: number
  /** Milliseconds before a run's start that a written file still counts as that run's output. */
  readonly mtimeGraceMs: number
  /** Largest inbound attachment transferred into the Session. */
  readonly maxInboundFileBytes: number
  /** Largest outbound file read out of the Session workspace. */
  readonly maxOutboundFileBytes: number
}

/**
 * Resolve every default of one bridge configuration.
 * @param config - the plugin's configuration.
 * @returns the configuration with every field present.
 */
export function resolveBridgeConfig(config: Config): ResolvedConfig {
  return {
    chunkChars: config.chunkChars ?? 4000,
    dedupeSize: config.dedupeSize ?? 64,
    maxReplyFiles: config.maxReplyFiles ?? 5,
    mtimeGraceMs: config.mtimeGraceMs ?? 2000,
    maxInboundFileBytes: config.maxInboundFileBytes ?? 30 * 1024 * 1024,
    maxOutboundFileBytes: config.maxOutboundFileBytes ?? 30 * 1024 * 1024,
  }
}

/** The fields every channel's configuration section carries, owned by the bridge. */
export interface BindingFields {
  /** Whether this channel's connection is open. */
  readonly enabled: boolean
  /** The Session this channel drives; empty while unbound. */
  readonly sessionId: string
  /** Whether outbound text is sent as Markdown. */
  readonly markdown: boolean
  /** Whether only the run's final message is sent, rather than each completed one. */
  readonly finalReplyOnly: boolean
}

/**
 * The shared section schema every channel's configuration is composed around.
 *
 * `enabled` and `sessionId` are binding state rather than user configuration:
 * the panel binds a channel to the tab's own Session through
 * `chatBridge.enable()`, and reports the bound Session it gets back. Both are
 * therefore hidden from form renderers while staying in the schema, which the
 * stored binding and the write path both need.
 */
const BINDING_FIELDS = z.object({
  enabled: z.boolean().default(false).hidden(),
  sessionId: z.string().default('').hidden(),
  markdown: z.boolean().default(true),
  finalReplyOnly: z.boolean().default(false),
})

/** The image media types the attachment service accepts everywhere. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** The filesystem error code a read over its cap reports. */
const FS_TOO_LARGE = 'FS_TOO_LARGE'

/**
 * Narrow one resolved configuration section to the fields the bridge owns.
 *
 * The section is `unknown` here because the connector's own fields are opaque
 * to this plugin, and a configuration document is a validated boundary. A
 * section missing a shared field means the provider did not compose the shared
 * schema, which is a defect that must fail loud rather than resolve to a
 * default nobody chose.
 * @param section - the resolved configuration section.
 * @returns the shared fields it carries.
 * @throws {ChatConfigError} when the section is not an object or omits a shared field.
 */
export function readBindingFields(section: unknown): BindingFields {
  if (typeof section !== 'object' || section === null) {
    throw new ChatConfigError('enabled', 'the configuration section is not an object')
  }
  const fields = section as Record<string, unknown>
  const enabled = fields['enabled']
  const sessionId = fields['sessionId']
  const markdown = fields['markdown']
  const finalReplyOnly = fields['finalReplyOnly']
  if (typeof enabled !== 'boolean') throw new ChatConfigError('enabled', 'expected a boolean')
  if (typeof sessionId !== 'string') throw new ChatConfigError('sessionId', 'expected a session id string')
  if (typeof markdown !== 'boolean') throw new ChatConfigError('markdown', 'expected a boolean')
  if (typeof finalReplyOnly !== 'boolean') throw new ChatConfigError('finalReplyOnly', 'expected a boolean')
  return { enabled, sessionId, markdown, finalReplyOnly }
}

/** One channel as the configuration panel reads it. */
export interface ChatChannelStatus {
  /** The channel this status describes. */
  readonly channel: ChatChannelId
  /** Whether the connection is configured to be open. */
  readonly enabled: boolean
  /** The Session this channel drives, or the empty string while unbound. */
  readonly sessionId: string
  /** Where the connection currently stands. */
  readonly connection: 'stopped' | 'connecting' | 'connected' | 'failed'
  /** The most recent failure's text; never cleared by a later success. */
  readonly lastError?: string
  /** When the most recent failure was recorded, as an ISO timestamp. */
  readonly lastErrorAt?: string
  /** When this channel last admitted a message, as an ISO timestamp. */
  readonly lastInboundAt?: string
  /** The conversation this binding answers, once one has spoken. */
  readonly lockedChatId?: string
  /** The platform's per-inbound-message reply budget, when it has one. */
  readonly replyBudget?: number
  /** What the platform can carry. */
  readonly capabilities: ChatChannelCapabilities
  /** The `dsh-settings` namespace holding this channel's configuration. */
  readonly settingsNamespace: string
  /** Configuration fields whose values name credential references. */
  readonly credentialFields: readonly string[]
}

/** What one probe of a channel found. */
export interface ChatProbeResult {
  /** Whether the channel is usable with the configured credentials. */
  readonly ok: boolean
  /** The actionable failure, present only when `ok` is false. */
  readonly message?: string
  /** The account the credentials identify, when the platform reports one. */
  readonly accountLabel?: string
  /** Supporting lines the platform returned, when it returned any. */
  readonly details?: readonly string[]
}

/** Everything one bound channel is doing right now. */
interface Binding {
  readonly channel: ChatChannelId
  readonly connector: ChatChannelConnector
  readonly scope: SettingsScope<ChatChannelConfig>
  unwatch: () => void
  /** Serializes open/close transitions so a configuration edit cannot interleave one. */
  tail: Promise<void>
  connection: { close(): void } | undefined
  client: ChatClient | undefined
  state: ChatChannelStatus['connection']
  sessionId: SessionId | undefined
  recent: RecentInboundIds
  watermark: ChatMessageId | undefined
  lockedChatId: ChatId | undefined
  lockedChatIsDirect: boolean
  lastError: string | undefined
  lastErrorAt: string | undefined
  lastInboundAt: string | undefined
  readonly inflight: Set<string>
}

/** Everything one Session's admitted turns are doing right now. */
interface SessionEntry {
  readonly sessionId: SessionId
  readonly agent: Agent
  readonly channel: ChatChannelId
  /** Admitted messages whose turn has not opened yet. */
  pendingTurns: number
  /** The admitted turn currently being mirrored, or undefined between turns. */
  armedTurn: number | undefined
  /** When that turn opened: the cut-off for the files it wrote. */
  runStartedAt: number
  /** The completed texts of that turn, scanned for the files it names. */
  relayed: string[]
  /** The last completed text held back by `finalReplyOnly`. */
  held: string | undefined
  /** Whether this turn's first group reply has taken the quote. */
  threaded: boolean
  /** The inbound message this turn answers, quoted once in a group. */
  replyTo: ChatMessageId | undefined
  /** Serializes every outbound message for this Session. */
  sendChain: Promise<void>
}

/**
 * Compose the schema for one channel's configuration namespace.
 * @param spec - the connector's settings declaration.
 * @returns the shared fields composed around the connector's own.
 */
function bindingSchema(spec: ChatChannelConnector['settings']): Schema<ChatChannelConfig> {
  return z.intersect([BINDING_FIELDS, spec.schema]) as Schema<ChatChannelConfig>
}

/**
 * The image media type one platform MIME string denotes, when it denotes one.
 * @param mime - the MIME type the platform reported.
 * @returns the accepted media type, or null when the attachment service cannot store it.
 */
function imageMediaType(mime: string): ImageMediaType | null {
  return IMAGE_MEDIA_TYPES.find(candidate => candidate === mime) ?? null
}

/**
 * The failure text of anything caught at a named site.
 * @param error - what the site caught.
 * @returns a message safe to show a chat.
 */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether one caught error is a filesystem read that exceeded its cap. */
function isTooLargeRead(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === FS_TOO_LARGE
}

/** The text of one assistant message, with non-text blocks dropped. */
function assistantText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The generic chat-channel bridge. */
    chatBridge: ChatBridge
  }
}

/**
 * The generic bridge: it binds connectors to Sessions, admits what arrives, and
 * relays what those Sessions produce.
 */
export class ChatBridge extends Service {
  static inject = ['agents', 'attachments', 'chatChannels', 'fs', 'sandboxPolicy', 'settings']

  /** Bridge configuration with every default resolved. */
  readonly resolved: ResolvedConfig

  /**
   * This plugin's own context. A Cordis service reached through a caller's
   * context reports the CALLER as `this.ctx`, so effects this plugin owns must
   * be created from the context it was constructed with; otherwise a binding
   * opened by a configuration-panel read would be torn down with that reader.
   */
  private readonly own: Context

  private readonly bindings = new Map<ChatChannelId, Binding>()
  private readonly entries = new Map<SessionId, SessionEntry>()

  /**
   * @param ctx - the plugin context carrying the injected services.
   * @param config - the plugin's configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'chatBridge')
    this.own = ctx
    this.resolved = resolveBridgeConfig(config)
    this.own.on('session/event', (session, event) => {
      this.observe(session, event)
    })
    this.sync()
  }

  /**
   * Bind every registered connector that is not bound yet, and drop the
   * bindings whose connector left the registry. Idempotent; the configuration
   * panel calls it before reading a status so a connector that registered after
   * this plugin mounted is not invisible.
   */
  sync(): void {
    for (const [channel, binding] of [...this.bindings]) {
      if (this.ctx.chatChannels.get(channel) !== binding.connector) this.unbind(channel)
    }
    for (const connector of this.ctx.chatChannels.list()) {
      if (!this.bindings.has(connector.channel)) this.bind(connector)
    }
  }

  /**
   * Every registered channel's status, in registration order.
   * @returns one status per bound channel.
   */
  statuses(): readonly ChatChannelStatus[] {
    return [...this.bindings.values()].map(binding => this.statusOf(binding))
  }

  /**
   * One channel's status.
   * @param channel - the channel to read.
   * @returns its status, or undefined while the channel is unregistered.
   */
  status(channel: ChatChannelId): ChatChannelStatus | undefined {
    const binding = this.bindings.get(channel)
    return binding === undefined ? undefined : this.statusOf(binding)
  }

  /**
   * Point one channel at one Session and open its connection.
   * @param channel - the channel to bind.
   * @param sessionId - the Session the channel drives.
   * @throws {Error} when the channel is unregistered, the Session does not exist,
   *   or another channel already serves that Session.
   */
  async enable(channel: ChatChannelId, sessionId: string): Promise<void> {
    this.sync()
    const binding = this.requireBinding(channel)
    this.assertSessionFree(channel, sessionId)
    if (this.ctx.agents.get(brandString<SessionId>(sessionId)) === undefined) {
      throw new Error(`session ${sessionId} does not exist; open it before binding a channel to it`)
    }
    await binding.scope.update({ enabled: true, sessionId })
    await this.scheduleReconfigure(binding)
  }

  /**
   * Close one channel's connection and leave its configuration otherwise intact.
   * @param channel - the channel to close.
   * @throws {Error} when the channel is unregistered.
   */
  async disable(channel: ChatChannelId): Promise<void> {
    this.sync()
    const binding = this.requireBinding(channel)
    await binding.scope.update({ enabled: false })
    await this.scheduleReconfigure(binding)
  }

  /**
   * Test whether one channel can build a client with its configured credentials.
   *
   * The probe never opens a connection: it asks the platform nothing a client
   * cannot answer from its own configuration, which is what makes it safe to
   * run while the channel is live.
   * @param channel - the channel to probe.
   * @returns what the probe found; a failure is a value, not a rejection.
   * @throws {Error} when the channel is unregistered.
   */
  async probe(channel: ChatChannelId): Promise<ChatProbeResult> {
    this.sync()
    const binding = this.requireBinding(channel)
    try {
      const client = await binding.connector.createClient(this.configOf(binding))
      const info = await client.checkCredentials()
      return {
        ok: true,
        ...info?.accountLabel === undefined ? {} : { accountLabel: info.accountLabel },
        ...info?.details === undefined ? {} : { details: info.details },
      }
    } catch (error: unknown) {
      this.recordFailure(binding, 'probe', error)
      return { ok: false, message: failureText(error) }
    }
  }

  /** Register one connector: its settings namespace, its watcher, and its lifetime. */
  private bind(connector: ChatChannelConnector): void {
    const scope = this.own.settings.register(connector.settings.namespace, bindingSchema(connector.settings), {
      // The connector declares its section as its own interface, which the
      // settings namespace's schema validates as it composes this layer.
      ...connector.settings.base === undefined
        ? {}
        : { base: connector.settings.base },
      applies: 'live',
    })
    const binding: Binding = {
      channel: connector.channel,
      connector,
      scope,
      unwatch: scope.watch(() => {
        void this.scheduleReconfigure(binding)
      }),
      tail: Promise.resolve(),
      connection: undefined,
      client: undefined,
      state: 'stopped',
      sessionId: undefined,
      recent: new RecentInboundIds(this.resolved.dedupeSize),
      watermark: undefined,
      lockedChatId: undefined,
      lockedChatIsDirect: false,
      lastError: undefined,
      lastErrorAt: undefined,
      lastInboundAt: undefined,
      inflight: new Set(),
    }
    this.bindings.set(connector.channel, binding)
    this.own.effect(() => () => {
      this.unbind(connector.channel)
    }, `chatBridge.bind(${connector.channel})`)
    void this.scheduleReconfigure(binding)
  }

  /** Retire one binding and everything it owns. Idempotent. */
  private unbind(channel: ChatChannelId): void {
    const binding = this.bindings.get(channel)
    if (binding === undefined) return
    this.bindings.delete(channel)
    binding.unwatch()
    this.closeBinding(binding)
  }

  /** Serialize one open/close transition behind the binding's previous one. */
  private scheduleReconfigure(binding: Binding): Promise<void> {
    binding.tail = binding.tail.then(async () => this.reconfigure(binding))
    return binding.tail
  }

  /** Make the connection match the configuration. */
  private async reconfigure(binding: Binding): Promise<void> {
    const shared = readBindingFields(binding.scope.get())
    const sessionId = shared.sessionId === '' ? undefined : brandString<SessionId>(shared.sessionId)
    if (!shared.enabled || sessionId === undefined) {
      this.closeBinding(binding)
      return
    }
    if (binding.sessionId === sessionId && binding.connection !== undefined) return
    this.closeBinding(binding)
    await this.openBinding(binding, sessionId)
  }

  /** Open one channel's connection against one Session and seed its memory. */
  private async openBinding(binding: Binding, sessionId: SessionId): Promise<void> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      binding.state = 'stopped'
      return
    }
    const memory = channelLogMemory(agent.session, binding.channel)
    binding.sessionId = sessionId
    binding.recent = new RecentInboundIds(this.resolved.dedupeSize)
    if (memory.watermark !== undefined) binding.recent.remember(memory.watermark)
    binding.watermark = memory.watermark
    binding.lockedChatId = memory.lockedChatId
    binding.lockedChatIsDirect = memory.lockedChatIsDirect
    this.entries.set(sessionId, {
      sessionId,
      agent,
      channel: binding.channel,
      pendingTurns: 0,
      armedTurn: undefined,
      runStartedAt: 0,
      relayed: [],
      held: undefined,
      threaded: false,
      replyTo: undefined,
      sendChain: Promise.resolve(),
    })
    binding.state = 'connecting'
    try {
      binding.client = await binding.connector.createClient(this.configOf(binding))
      binding.connection = await binding.connector.connect(this.configOf(binding), {
        onMessage: (message) => {
          void this.onMessage(binding, message)
        },
        onReady: () => {
          binding.state = 'connected'
        },
        onError: (error: unknown) => {
          this.recordFailure(binding, 'connect', error)
          binding.state = 'failed'
        },
      })
    } catch (error: unknown) {
      this.recordFailure(binding, 'connect', error)
      binding.state = 'failed'
      this.closeBinding(binding)
    }
  }

  /** Close one binding's connection and forget the Session it drove. */
  private closeBinding(binding: Binding): void {
    if (binding.sessionId !== undefined) this.entries.delete(binding.sessionId)
    binding.connection?.close()
    binding.connection = undefined
    binding.client = undefined
    binding.sessionId = undefined
    binding.state = 'stopped'
  }

  /** One channel's current status. */
  private statusOf(binding: Binding): ChatChannelStatus {
    const shared = readBindingFields(binding.scope.get())
    return {
      channel: binding.channel,
      enabled: shared.enabled,
      sessionId: shared.sessionId,
      connection: binding.state,
      ...binding.lastError === undefined ? {} : { lastError: binding.lastError },
      ...binding.lastErrorAt === undefined ? {} : { lastErrorAt: binding.lastErrorAt },
      ...binding.lastInboundAt === undefined ? {} : { lastInboundAt: binding.lastInboundAt },
      ...binding.lockedChatId === undefined ? {} : { lockedChatId: binding.lockedChatId },
      ...binding.connector.replyBudget === undefined ? {} : { replyBudget: binding.connector.replyBudget },
      capabilities: binding.connector.capabilities,
      settingsNamespace: binding.connector.settings.namespace,
      credentialFields: binding.connector.settings.credentialFields,
    }
  }

  /** The resolved configuration section one binding's connector reads. */
  private configOf(binding: Binding): ChatChannelConfig {
    return binding.scope.get()
  }

  /** The binding for one channel, or a loud refusal. */
  private requireBinding(channel: ChatChannelId): Binding {
    const binding = this.bindings.get(channel)
    if (binding === undefined) throw new Error(`channel ${channel} is not registered`)
    return binding
  }

  /** Refuse a binding that would make one Session answer two channels at once. */
  private assertSessionFree(channel: ChatChannelId, sessionId: string): void {
    // Compared as an opaque string: this build's channel map has one member, so
    // comparing the union with itself would narrow the loop body to nothing.
    const wanted: string = channel
    for (const binding of this.bindings.values()) {
      if (binding.channel === wanted) continue
      const shared = readBindingFields(binding.scope.get())
      if (shared.enabled && shared.sessionId === sessionId) {
        throw new Error(
          `channel ${binding.channel} already serves session ${sessionId}; disable it before binding another channel to the same session`,
        )
      }
    }
  }

  /** Admit one inbound message, or say why it was not admitted. */
  private async onMessage(binding: Binding, message: ChatInboundMessage): Promise<void> {
    const client = binding.client
    const sessionId = binding.sessionId
    if (client === undefined || sessionId === undefined) return
    const entry = this.entries.get(sessionId)
    if (entry === undefined) return
    const id = message.messageId
    if (binding.recent.check(id) || binding.inflight.has(id)) return
    binding.recent.remember(id)
    binding.inflight.add(id)
    let admitted = false
    try {
      if (binding.lockedChatId === undefined) {
        binding.lockedChatId = message.chatId
        binding.lockedChatIsDirect = message.chatKind === 'direct'
      }
      if (binding.lockedChatId !== message.chatId) return
      admitted = await this.admit(binding, entry, client, message)
    } finally {
      binding.inflight.delete(id)
      if (!admitted) binding.recent.forget(id)
    }
  }

  /**
   * Turn one inbound message into content blocks and queue it.
   * @returns whether the message reached the Session.
   */
  private async admit(
    binding: Binding,
    entry: SessionEntry,
    client: ChatClient,
    message: ChatInboundMessage,
  ): Promise<boolean> {
    const text = message.text?.trim() ?? ''
    const images = message.images ?? []
    const files = message.files ?? []
    if (text === '' && images.length === 0 && files.length === 0) {
      await this.notice(binding, client, message.chatId, CHAT_NOTICES.unsupportedMessage)
      return false
    }
    const content: ContentBlock[] = []
    if (text !== '') content.push({ type: 'text', text })
    const media = await this.inboundMedia(binding, client, message.chatId, images, files)
    if (media === null) return false
    content.push(...media)
    const busy = entry.agent.status === 'running'
    entry.pendingTurns += 1
    entry.replyTo = message.messageId === '' ? undefined : message.messageId
    entry.threaded = false
    entry.agent.followup(createUserMessage({
      content,
      source: {
        kind: 'channel',
        channel: binding.channel,
        chatId: message.chatId,
        chatKind: message.chatKind,
        messageId: message.messageId,
        ...message.senderName === undefined ? {} : { senderName: message.senderName },
      },
    }))
    binding.watermark = message.messageId
    binding.lastInboundAt = new Date(this.now()).toISOString()
    if (busy && !this.sharedOf(binding).finalReplyOnly) {
      await this.notice(binding, client, message.chatId, CHAT_NOTICES.queued)
    }
    return true
  }

  /**
   * Transfer one message's attachments into the Session, telling the chat about
   * each one that could not make it.
   * @returns the content blocks to admit, or null when the message was refused entirely.
   */
  private async inboundMedia(
    binding: Binding,
    client: ChatClient,
    chatId: ChatId,
    images: readonly ChatInboundImage[],
    files: readonly ChatInboundFile[],
  ): Promise<ContentBlock[] | null> {
    const parts: ContentBlock[] = []
    const cap = Math.min(
      this.resolved.maxInboundFileBytes,
      binding.connector.capabilities.maxInboundBytes ?? Number.POSITIVE_INFINITY,
      this.ctx.attachments.imageLimits.maxImageBytes,
    )
    for (const image of images) {
      const stored = await this.inboundImage(binding, client, chatId, image, cap)
      if (stored === null) return null
      parts.push(stored)
    }
    for (const file of files) {
      const stored = await this.inboundFile(binding, client, chatId, file, cap)
      if (stored === null) return null
      parts.push(stored)
    }
    return parts
  }

  /** Store one inbound image, or tell the chat why it was not stored. */
  private async inboundImage(
    binding: Binding,
    client: ChatClient,
    chatId: ChatId,
    image: ChatInboundImage,
    cap: number,
  ): Promise<ContentBlock | null> {
    try {
      const fetched = await image.fetch(cap)
      const mediaType = imageMediaType(fetched.mime)
      if (mediaType === null) throw new ChatUnsupportedError(`image type ${fetched.mime} cannot be attached`)
      const attachment = await this.ctx.attachments.saveImage({ data: fetched.data, mediaType })
      return { type: 'image', attachment }
    } catch (error: unknown) {
      await this.reportInbound(binding, client, chatId, 'inbound-image', error, cap, '')
      return null
    }
  }

  /** Store one inbound file, or tell the chat why it was not stored. */
  private async inboundFile(
    binding: Binding,
    client: ChatClient,
    chatId: ChatId,
    file: ChatInboundFile,
    cap: number,
  ): Promise<ContentBlock | null> {
    try {
      const data = await file.fetch(cap)
      const attachment = await this.ctx.attachments.saveFile({ data, name: file.fileName })
      return { type: 'file', attachment }
    } catch (error: unknown) {
      await this.reportInbound(binding, client, chatId, 'inbound-file', error, cap, file.fileName)
      return null
    }
  }

  /** Tell the chat about one refused inbound attachment, and record it. */
  private async reportInbound(
    binding: Binding,
    client: ChatClient,
    chatId: ChatId,
    site: ChatErrorSite,
    error: unknown,
    cap: number,
    fileName: string,
  ): Promise<void> {
    this.recordFailure(binding, site, error)
    if (site === 'inbound-image') {
      await this.notice(binding, client, chatId, this.inboundNotice(error, cap, fileName, false))
      return
    }
    await this.notice(binding, client, chatId, this.inboundNotice(error, cap, fileName, true))
  }

  /** The notice one refused inbound attachment earns. */
  private inboundNotice(error: unknown, cap: number, fileName: string, isFile: boolean): string {
    if (error instanceof ChatMediaTooLargeError) {
      return isFile ? CHAT_NOTICES.fileTooLarge(fileName, cap) : CHAT_NOTICES.imageTooLarge(cap)
    }
    if (error instanceof ChatPermissionError) {
      return isFile
        ? CHAT_NOTICES.filePermission(fileName, error.scopes, error.grantUrl)
        : CHAT_NOTICES.imagePermission(error.scopes, error.grantUrl)
    }
    if (error instanceof ChatUnsupportedError) return CHAT_NOTICES.unsupportedMessage
    return isFile
      ? CHAT_NOTICES.fileFailed(fileName, failureText(error))
      : CHAT_NOTICES.imageFailed(failureText(error))
  }

  /** Mirror one Session event into the chat it is bound to. */
  private observe(session: Session, event: SessionEvent): void {
    const entry = this.entries.get(session.id)
    if (entry === undefined) return
    const binding = this.bindings.get(entry.channel)
    if (binding === undefined) return
    switch (event.type) {
      case 'turn/start': {
        if (entry.pendingTurns === 0) return
        entry.pendingTurns -= 1
        entry.armedTurn = event.data.turn
        entry.runStartedAt = this.now()
        entry.relayed = []
        entry.held = undefined
        entry.threaded = false
        return
      }
      case 'assistant/message': {
        if (entry.armedTurn !== event.data.turn) return
        const text = assistantText(event.data.message.content)
        if (text === '') return
        entry.relayed.push(text)
        if (this.sharedOf(binding).finalReplyOnly) {
          entry.held = text
          return
        }
        this.queueSend(entry, binding, text)
        return
      }
      case 'turn/end': {
        if (entry.armedTurn !== event.data.turn) return
        entry.armedTurn = undefined
        if (entry.held !== undefined) {
          const held = entry.held
          entry.held = undefined
          this.queueSend(entry, binding, held)
        } else if (event.data.reason.kind === 'error' && entry.relayed.length === 0) {
          this.queueSend(entry, binding, CHAT_NOTICES.runFailed(event.data.reason.error.message))
        }
        this.queueFiles(entry, binding)
        return
      }
      case 'approval/asked': {
        if (entry.armedTurn === undefined) return
        this.queueSend(entry, binding, CHAT_NOTICES.approvalWaiting)
        return
      }
      default:
        return
    }
  }

  /** The binding's shared configuration fields. */
  private sharedOf(binding: Binding): BindingFields {
    return readBindingFields(binding.scope.get())
  }

  /** Append one outbound message to the Session's single send tail. */
  private queueSend(entry: SessionEntry, binding: Binding, text: string): void {
    entry.sendChain = entry.sendChain.then(async () => this.deliverText(entry, binding, text))
  }

  /** Append one reply's file delivery to the Session's single send tail. */
  private queueFiles(entry: SessionEntry, binding: Binding): void {
    const text = entry.relayed.join('\n\n')
    entry.sendChain = entry.sendChain.then(async () => this.deliverFiles(entry, binding, text))
  }

  /** Send one reply, chunked to the platform's text cap and reply budget. */
  private async deliverText(entry: SessionEntry, binding: Binding, text: string): Promise<void> {
    const chatId = binding.lockedChatId
    const client = binding.client
    if (chatId === undefined || client === undefined) return
    const markdown = this.sharedOf(binding).markdown
    const chars = Math.min(this.resolved.chunkChars, binding.connector.capabilities.maxTextChars ?? Number.POSITIVE_INFINITY)
    const chunks = capToReplyBudget(chunkChatText(text, chars), binding.connector.replyBudget)
    for (const chunk of chunks) {
      const quote = this.quoteFor(entry, binding)
      try {
        await this.sendOne(client, chatId, quote, chunk, markdown)
        if (quote !== undefined) entry.threaded = true
      } catch (error: unknown) {
        this.recordFailure(binding, 'outbound-text', error)
      }
    }
  }

  /** The message one outbound chunk answers, quoted only once per turn in a group. */
  private quoteFor(entry: SessionEntry, binding: Binding): ChatMessageId | undefined {
    if (binding.lockedChatIsDirect || entry.threaded || entry.replyTo === undefined) return undefined
    return binding.connector.capabilities.quoting ? entry.replyTo : undefined
  }

  /** Send one chunk as Markdown, falling back once to plain text. */
  private async sendOne(
    client: ChatClient,
    chatId: ChatId,
    quote: ChatMessageId | undefined,
    text: string,
    markdown: boolean,
  ): Promise<void> {
    if (!markdown) {
      await this.sendPlain(client, chatId, quote, text)
      return
    }
    try {
      await this.sendFormatted(client, chatId, quote, text)
    } catch (error: unknown) {
      if (!(error instanceof ChatFormatRejectedError)) throw error
      await this.sendPlain(client, chatId, quote, text)
    }
  }

  /** Send one chunk with the platform's Markdown rendering. */
  private sendFormatted(
    client: ChatClient,
    chatId: ChatId,
    quote: ChatMessageId | undefined,
    text: string,
  ): Promise<void> {
    return quote === undefined
      ? client.sendText(chatId, text, { markdown: true })
      : client.replyText(quote, text, { markdown: true })
  }

  /** Send one chunk with no rendering at all. */
  private sendPlain(
    client: ChatClient,
    chatId: ChatId,
    quote: ChatMessageId | undefined,
    text: string,
  ): Promise<void> {
    return quote === undefined ? client.sendText(chatId, text) : client.replyText(quote, text)
  }

  /**
   * Deliver the files a reply named AND its turn wrote.
   *
   * The two conditions are separate on purpose. Membership comes from the
   * Session workspace, which the reply cannot leave, and freshness comes from
   * the file's own timestamp, so a reply that names a pre-existing file
   * delivers nothing however it was phrased.
   */
  private async deliverFiles(entry: SessionEntry, binding: Binding, text: string): Promise<void> {
    const chatId = binding.lockedChatId
    const client = binding.client
    if (chatId === undefined || client === undefined || text === '') return
    if (!binding.connector.capabilities.outbound.files) return
    const workspaceRoot = this.ctx.sandboxPolicy.resolve({ session: entry.agent.session }).workspaceRoot
    const root = await this.ctx.fs.resolve(workspaceRoot)
    const written: WorkspaceFile[] = []
    const unwritten: string[] = []
    for (const mention of replyFileMentions(text)) {
      if (mention.rel === null) continue
      const file = await this.writtenFile(root, workspaceRoot, mention.rel, entry.runStartedAt)
      if (file === null) {
        unwritten.push(mention.rel)
        continue
      }
      written.push(file)
    }
    if (unwritten.length > 0) {
      this.ctx.logger.debug(
        `channel bridge: reply named ${String(unwritten.length)} file(s) this turn did not write: ${unwritten.join(', ')}`,
      )
    }
    const deliverable = written.slice(0, this.resolved.maxReplyFiles)
    for (const file of deliverable) await this.deliverFile(binding, client, chatId, file)
    const skipped = written.length - deliverable.length
    if (skipped > 0) await this.notice(binding, client, chatId, CHAT_NOTICES.filesSkipped(skipped))
  }

  /**
   * Resolve one named path to a file inside the Session workspace that this
   * turn wrote.
   * @returns the readable file, or null when it is outside the workspace, is not
   *   a file, does not exist, or predates the turn.
   */
  private async writtenFile(
    root: FsTarget,
    workspaceRoot: string,
    rel: string,
    runStartedAt: number,
  ): Promise<WorkspaceFile | null> {
    const target = await this.resolveInside(root, workspaceRoot, rel)
    if (target === null) return null
    try {
      const info = await stat(this.ctx.fs.processPath(target))
      if (!info.isFile()) return null
      if (info.mtimeMs < runStartedAt - this.resolved.mtimeGraceMs) return null
      return { rel, target, size: info.size }
    } catch {
      // The file vanished between resolution and stat; a reply may name a path
      // it deleted, so this is a miss rather than a fault.
      return null
    }
  }

  /** Resolve one relative path, or null when it leaves the Session workspace. */
  private async resolveInside(root: FsTarget, workspaceRoot: string, rel: string): Promise<FsTarget | null> {
    try {
      const target = await this.ctx.fs.resolve(rel, { cwd: workspaceRoot })
      return this.ctx.fs.contains(root, target) ? target : null
    } catch {
      // Only an unparseable path or an unreachable backend throws here, and both
      // mean this candidate cannot be delivered.
      return null
    }
  }

  /** Read one produced file out of the workspace and send it. */
  private async deliverFile(
    binding: Binding,
    client: ChatClient,
    chatId: ChatId,
    file: WorkspaceFile,
  ): Promise<void> {
    const name = basename(file.rel)
    const cap = Math.min(
      this.resolved.maxOutboundFileBytes,
      binding.connector.capabilities.maxOutboundBytes ?? Number.POSITIVE_INFINITY,
    )
    if (file.size !== undefined && file.size > cap) {
      await this.notice(binding, client, chatId, CHAT_NOTICES.fileSendTooLarge(name, cap))
      return
    }
    try {
      const data = await this.ctx.fs.readBytes(file.target, undefined, cap)
      await client.sendFile(chatId, { fileName: name, data })
    } catch (error: unknown) {
      this.recordFailure(binding, 'outbound-file', error)
      await this.notice(binding, client, chatId, this.outboundFileNotice(error, name, cap))
    }
  }

  /** The notice one refused outbound file earns. */
  private outboundFileNotice(error: unknown, name: string, cap: number): string {
    if (error instanceof ChatMediaTooLargeError || isTooLargeRead(error)) {
      return CHAT_NOTICES.fileSendTooLarge(name, cap)
    }
    if (error instanceof ChatPermissionError) return CHAT_NOTICES.fileSendPermission(name, error.scopes, error.grantUrl)
    if (error instanceof ChatUnsupportedError) return CHAT_NOTICES.fileSendFailed(name, failureText(error))
    return CHAT_NOTICES.fileSendFailed(name, failureText(error))
  }

  /** Send one notice through the binding's client. */
  private async notice(binding: Binding, client: ChatClient, chatId: ChatId, text: string): Promise<void> {
    try {
      await client.sendText(chatId, text)
    } catch (error: unknown) {
      this.recordFailure(binding, 'outbound-text', error)
    }
  }

  /** Record one failure against the binding's status line. */
  private recordFailure(binding: Binding, site: ChatErrorSite, error: unknown): void {
    binding.lastError = failureText(error)
    binding.lastErrorAt = new Date(this.now()).toISOString()
    if (chatErrorKind(error, site) === 'unexpected') {
      this.ctx.logger.warn(`chat channel ${binding.channel} failed at ${site}: ${failureText(error)}`)
    }
  }

  /** The current time, read through one point so tests can pin it. */
  private now(): number {
    return Date.now()
  }
}

/** One workspace file a turn wrote and a reply named. */
interface WorkspaceFile {
  /** Its path relative to the Session workspace. */
  readonly rel: string
  /** Its resolved target inside the workspace. */
  readonly target: FsTarget
  /** Its byte size when the filesystem reported one. */
  readonly size: number | undefined
}

export * from './chunk.ts'
export * from './dedupe.ts'
export * from './mentions.ts'
export * from './notices.ts'
export default ChatBridge

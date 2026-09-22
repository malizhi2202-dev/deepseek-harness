/**
 * Tests for the generic chat-channel bridge: binding lifecycle and the
 * configuration panel's reads, admission and its refusals, the chat lock and
 * deduplication, outbound relay, reply file delivery, failure classification,
 * and the disposal contract that keeps a reloaded plugin from leaking
 * connections.
 *
 * The bridge is mounted over the real `ChatChannels` registry, a real
 * in-memory settings provider, and scripted doubles for the five other
 * injected services. The filesystem double answers over real files under one
 * fixture root this suite creates per test and removes afterwards, so the
 * `stat` the bridge imports directly sees real timestamps.
 */
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import ChatChannels from '@deepseek-ai/dsh-channel'
import {
  ChatConfigError,
  ChatFormatRejectedError,
  ChatMediaTooLargeError,
  ChatPermissionError,
  ChatUnsupportedError,
} from '@deepseek-ai/dsh-channel'
import type {
  ChatAccountInfo,
  ChatChannelCapabilities,
  ChatChannelConfig,
  ChatChannelConnector,
  ChatChannelId,
  ChatChannelSettings,
  ChatClient,
  ChatConnectorHandlers,
  ChatId,
  ChatInboundFile,
  ChatInboundImage,
  ChatInboundMessage,
  ChatMessageId,
  ChatOutboundFile,
  ChatSendOptions,
} from '@deepseek-ai/dsh-channel'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveFileAttachment,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { FsTarget, FsTargetKey } from '@deepseek-ai/dsh-fs'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type Schema from '@deepseek-ai/schemastery'
import z from '@deepseek-ai/schemastery'
import ChatBridge, { CHAT_NOTICES } from '../src/index.ts'
import type { ChatChannelStatus, Config } from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

/**
 * The channel every connector in this suite serves. The id map is
 * merge-extensible — a provider extends it from its own `./types` module — so a
 * test that needs a second platform casts one the way such a provider would,
 * rather than editing the seam Definition.
 */
const CHANNEL: ChatChannelId = 'tuitui'

/** The second platform, used only where two channels must contend for one Session. */
const OTHER_CHANNEL = 'tuitui-other' as ChatChannelId

/** The settings namespace the default connector registers. */
const NAMESPACE = 'channel-test'

/** The Session the default harness makes reachable through the agents double. */
const SESSION = 's-1'

/** The image media types the attachment double accepts. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** The image byte cap the attachment double declares. */
const MAX_IMAGE_BYTES = 1_000_000

/** The fixture root the current test owns; created in `beforeEach`. */
let workspaceRoot = ''

/** Every context this suite opened; disposed in `afterEach`. */
const opened: Context[] = []

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-channel-bridge-'))
})

afterEach(async () => {
  for (const ctx of opened.splice(0)) await ctx.fiber.dispose()
  await rm(workspaceRoot, { recursive: true, force: true })
})

/** One outbound call a scripted client attempted. */
interface OutboundCall {
  readonly kind: 'sendText' | 'replyText' | 'sendFile'
  readonly chatId: string
  readonly messageId: string
  readonly text: string
  readonly markdown: boolean | undefined
  readonly fileName: string
}

/** The outbound client double: it records every call and fails only where a test says so. */
class TestClient implements ChatClient {
  /** Every call that started, in start order, including ones that then failed. */
  readonly attempts: OutboundCall[] = []
  /** Every call that returned normally, in completion order. */
  readonly completed: OutboundCall[] = []
  /** What `checkCredentials` answers; null reports no account facts. */
  account: ChatAccountInfo | null = null
  /** Thrown by `checkCredentials` instead of answering, when set. */
  credentialError: Error | undefined
  /** Awaited before one call settles, so a test can hold the send chain open. */
  gate: Promise<void> | undefined
  /** Runs before one text call settles; throwing fails that call. */
  beforeText: ((call: OutboundCall) => void) | undefined
  /** Runs before one file call settles; throwing fails that call. */
  beforeFile: ((call: OutboundCall) => void) | undefined

  checkCredentials(): Promise<ChatAccountInfo | null> {
    return this.credentialError === undefined
      ? Promise.resolve(this.account)
      : Promise.reject(this.credentialError)
  }

  sendText(chatId: ChatId, text: string, options?: ChatSendOptions): Promise<void> {
    return this.text({ kind: 'sendText', chatId, messageId: '', text, markdown: options?.markdown, fileName: '' })
  }

  replyText(messageId: ChatMessageId, text: string, options?: ChatSendOptions): Promise<void> {
    return this.text({ kind: 'replyText', chatId: '', messageId, text, markdown: options?.markdown, fileName: '' })
  }

  sendFile(chatId: ChatId, file: ChatOutboundFile): Promise<void> {
    return this.file({ kind: 'sendFile', chatId, messageId: '', text: '', markdown: undefined, fileName: file.fileName })
  }

  /** Record one text call, run its injected failure, and settle it past the gate. */
  private async text(call: OutboundCall): Promise<void> {
    this.attempts.push(call)
    this.beforeText?.(call)
    await this.hold()
    this.completed.push(call)
  }

  /** Record one file call, run its injected failure, and settle it past the gate. */
  private async file(call: OutboundCall): Promise<void> {
    this.attempts.push(call)
    this.beforeFile?.(call)
    await this.hold()
    this.completed.push(call)
  }

  /** Wait for the one gate a test set, consuming it so only that call is held. */
  private async hold(): Promise<void> {
    const gate = this.gate
    if (gate === undefined) return
    this.gate = undefined
    await gate
  }
}

/** One connection a scripted connector opened. */
interface TestConnection {
  readonly config: ChatChannelConfig
  readonly handlers: ChatConnectorHandlers
  /** How many times the bridge closed this connection. */
  closes: number
}

/** The capability fields one test may narrow; every other kind stays carried. */
interface CapabilityOverrides {
  readonly quoting?: boolean
  readonly inbound?: { readonly images?: boolean; readonly files?: boolean }
  readonly outbound?: { readonly images?: boolean; readonly files?: boolean }
  readonly markdown?: boolean
  readonly maxTextChars?: number
  readonly maxInboundBytes?: number
  readonly maxOutboundBytes?: number
}

/** Every capability carried, with only the named fields narrowed. */
function capabilities(overrides: CapabilityOverrides = {}): ChatChannelCapabilities {
  return {
    quoting: overrides.quoting ?? true,
    inbound: { images: overrides.inbound?.images ?? true, files: overrides.inbound?.files ?? true },
    outbound: { images: overrides.outbound?.images ?? true, files: overrides.outbound?.files ?? true },
    markdown: overrides.markdown ?? true,
    ...overrides.maxTextChars === undefined ? {} : { maxTextChars: overrides.maxTextChars },
    ...overrides.maxInboundBytes === undefined ? {} : { maxInboundBytes: overrides.maxInboundBytes },
    ...overrides.maxOutboundBytes === undefined ? {} : { maxOutboundBytes: overrides.maxOutboundBytes },
  }
}

/** Options one scripted connector is built from; every field defaults to a working platform. */
interface ConnectorOptions {
  readonly channel?: ChatChannelId
  readonly replyBudget?: number
  readonly capabilities?: CapabilityOverrides
  readonly namespace?: string
  readonly schema?: Schema
  readonly base?: ChatChannelConfig
  readonly credentialFields?: readonly string[]
  /** Thrown by `createClient`. */
  readonly clientError?: unknown
  /** Thrown by `connect`. */
  readonly connectError?: unknown
  /** Whether `connect` reports the handshake as ready. */
  readonly ready?: boolean
  /** Reported through the connection's error handler when set. */
  readonly onError?: unknown
}

/** The connector double: a scripted platform whose client, connection, and schema a test owns. */
class TestConnector implements ChatChannelConnector {
  readonly channel: ChatChannelId
  readonly capabilities: ChatChannelCapabilities
  readonly settings: ChatChannelSettings
  readonly replyBudget?: number
  /** Thrown by `createClient` while set. */
  clientError: unknown
  /** Thrown by `connect` while set. */
  connectError: unknown
  /** Whether the next `connect` reports ready. */
  ready: boolean
  /** Reported through the error handler by the next `connect` while set. */
  onError: unknown
  /** Awaited by `createClient` before it answers, so a test can hold an open in flight. */
  gate: Promise<void> | undefined
  /** Every config handed to `createClient`, in order. */
  readonly clientConfigs: ChatChannelConfig[] = []
  /** Every connection opened, in order. */
  readonly connections: TestConnection[] = []

  constructor(readonly client: TestClient, options: ConnectorOptions = {}) {
    this.channel = options.channel ?? CHANNEL
    if (options.replyBudget !== undefined) this.replyBudget = options.replyBudget
    this.capabilities = capabilities(options.capabilities)
    this.settings = {
      namespace: options.namespace ?? NAMESPACE,
      schema: options.schema ?? z.object({ token: z.string().default('') }),
      credentialFields: options.credentialFields ?? ['token'],
      ...options.base === undefined ? {} : { base: options.base },
    }
    this.clientError = options.clientError
    this.connectError = options.connectError
    this.ready = options.ready ?? false
    this.onError = options.onError
  }

  async createClient(config: ChatChannelConfig): Promise<ChatClient> {
    this.clientConfigs.push(config)
    const gate = this.gate
    if (gate !== undefined) {
      this.gate = undefined
      await gate
    }
    if (this.clientError !== undefined) throw this.clientError
    return this.client
  }

  async connect(config: ChatChannelConfig, handlers: ChatConnectorHandlers): Promise<{ close(): void }> {
    const connection: TestConnection = { config, handlers, closes: 0 }
    this.connections.push(connection)
    if (this.connectError !== undefined) throw this.connectError
    if (this.ready) handlers.onReady?.()
    if (this.onError !== undefined) handlers.onError?.(this.onError)
    return { close: () => { connection.closes += 1 } }
  }
}

/** A promise plus its resolver, for holding one asynchronous step open. */
interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

/** One promise a test can release by hand. */
function deferred(): Deferred {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => { release = resolvePromise })
  return { promise, resolve: release }
}

/** The filesystem error code a read over its cap reports; the bridge classifies it by code alone. */
class TooLargeReadError extends Error {
  readonly code = 'FS_TOO_LARGE'
}

type ResolvePath = (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<FsTarget>
type Contains = (parent: FsTarget, child: FsTarget) => boolean
type ProcessPath = (target: FsTarget) => string
type ReadBytes = (target: FsTarget, signal: AbortSignal | undefined, maxBytes: number) => Promise<Uint8Array>

/** The filesystem double: the four calls the bridge makes, over real files under the fixture root. */
interface FsDouble {
  readonly resolve: Mock<ResolvePath>
  readonly contains: Mock<Contains>
  readonly processPath: Mock<ProcessPath>
  readonly readBytes: Mock<ReadBytes>
  /** Relative paths this double refuses to resolve, standing in for an unparseable one. */
  readonly unresolvable: Set<string>
}

/** One resolved target for a real absolute path. */
function fsTarget(path: string): FsTarget {
  return { targetKey: brandString<FsTargetKey>(path), displayPath: path }
}

/** Build the filesystem double over one workspace root. */
function createFsDouble(root: string): FsDouble {
  const unresolvable = new Set<string>()
  return {
    unresolvable,
    resolve: vi.fn<ResolvePath>(async (path, opts) => {
      if (unresolvable.has(path)) throw new Error(`cannot resolve ${path}`)
      return fsTarget(resolve(opts?.cwd ?? root, path))
    }),
    contains: vi.fn<Contains>((parent, child) =>
      child.displayPath === parent.displayPath || child.displayPath.startsWith(parent.displayPath + sep)),
    processPath: vi.fn<ProcessPath>(target => target.displayPath),
    readBytes: vi.fn<ReadBytes>(async (target, _signal, maxBytes) => {
      const data = await readFile(target.displayPath)
      if (data.byteLength > maxBytes) throw new TooLargeReadError(`file exceeds ${String(maxBytes)} bytes`)
      return new Uint8Array(data)
    }),
  }
}

type SaveImage = (input: SaveImageAttachment) => Promise<ImageAttachmentRef>
type SaveFile = (input: SaveFileAttachment) => Promise<FileAttachmentRef>

/** The attachment double: the declared image limits plus both save calls. */
interface AttachmentsDouble {
  readonly imageLimits: ImageAttachmentLimits
  readonly saveImage: Mock<SaveImage>
  readonly saveFile: Mock<SaveFile>
}

/** Build the attachment double. */
function createAttachmentsDouble(): AttachmentsDouble {
  return {
    imageLimits: {
      maxImageBytes: MAX_IMAGE_BYTES,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 4 * MAX_IMAGE_BYTES,
      maxImagePixels: 1_000_000,
      maxImageDimension: 10_000,
      mediaTypes: IMAGE_MEDIA_TYPES,
    },
    saveImage: vi.fn<SaveImage>(async input => ({
      attachmentId: AttachmentId('att-image'),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    })),
    saveFile: vi.fn<SaveFile>(async input => ({
      attachmentId: AttachmentId('att-file'),
      name: input.name ?? 'file',
      bytes: input.data.byteLength,
    })),
  }
}

/** The Agent the bridge reads: only its status, Session, and follow-up entry point are used. */
class TestAgent {
  status: 'idle' | 'running' = 'idle'
  /** Every message the bridge queued for this agent, in order. */
  readonly followups: UserMessage[] = []

  constructor(readonly session: Session) {}

  followup(message: UserMessage): void {
    this.followups.push(message)
  }
}

/** Options one harness is built from. */
interface HarnessOptions {
  /** Configuration handed to the bridge plugin; omitted means the constructor default. */
  readonly config?: Config
  /** Connectors registered before the bridge mounts; defaults to one plain connector. */
  readonly connectors?: readonly TestConnector[]
  /** Session ids reachable through the agents double; defaults to one. */
  readonly sessions?: readonly string[]
}

/** Everything one test drives the bridge through. */
interface Harness {
  readonly ctx: Context
  readonly bridge: ChatBridge
  readonly bridgeFiber: Fiber
  readonly client: TestClient
  readonly connector: TestConnector
  readonly connectors: readonly TestConnector[]
  readonly agents: Map<string, TestAgent>
  readonly agent: TestAgent
  readonly session: Session
  readonly fs: FsDouble
  readonly attachments: AttachmentsDouble
  /** Registration disposers, in registration order. */
  readonly registrations: Array<() => void>
}

/** Mount the registry, the doubles, and the bridge in one context. */
async function openBridge(options: HarnessOptions = {}): Promise<Harness> {
  const sessions = (options.sessions ?? [SESSION]).map(id => Session.create(SessionId(id)))
  const agents = new Map<string, TestAgent>(sessions.map(session => [session.id, new TestAgent(session)]))
  const connectors = options.connectors ?? [new TestConnector(new TestClient())]
  const first = connectors[0]
  const agent = agents.get(SESSION)
  const session = sessions[0]
  if (first === undefined || agent === undefined || session === undefined) {
    throw new Error('the harness needs at least one connector and one session')
  }
  const ctx = new Context()
  opened.push(ctx)
  await ctx.plugin(ChatChannels)
  await ctx.plugin(MemorySettings)
  // Each double implements exactly the members the bridge reads, not the whole
  // abstract service, so the provide boundary is the one documented cast.
  ctx.provide('agents', { get: (id: SessionId) => agents.get(id) } as never)
  const attachments = createAttachmentsDouble()
  ctx.provide('attachments', attachments as never)
  const fs = createFsDouble(workspaceRoot)
  ctx.provide('fs', fs as never)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot }) } as never)
  const registrations = connectors.map(connector => ctx.chatChannels.register(connector))
  const bridgeFiber = await ctx.plugin(ChatBridge, options.config)
  const bridge = ctx.get('chatBridge')
  if (bridge === undefined) throw new Error('the bridge did not register ctx.chatBridge')
  return {
    ctx,
    bridge,
    bridgeFiber,
    client: first.client,
    connector: first,
    connectors,
    agents,
    agent,
    session,
    fs,
    attachments,
    registrations,
  }
}

/** One channel's status, failing the test when the channel is unbound. */
function statusOf(bridge: ChatBridge, channel: ChatChannelId): ChatChannelStatus {
  const status = bridge.status(channel)
  if (status === undefined) throw new Error(`channel ${channel} has no status`)
  return status
}

/** Write one channel's configuration section through the settings service. */
async function configure(h: Harness, patch: Record<string, unknown>, connector: TestConnector = h.connector): Promise<void> {
  await h.ctx.settings.update(connector.settings.namespace, patch)
}

/** One normalized inbound message: a direct chat carrying text, unless a test says otherwise. */
function inbound(overrides: Partial<ChatInboundMessage> = {}): ChatInboundMessage {
  return {
    chatId: brandString<ChatId>('chat-1'),
    chatKind: 'direct',
    messageId: brandString<ChatMessageId>('m-1'),
    text: 'hello',
    ...overrides,
  }
}

/** One inbound image handle that answers with bytes and a MIME, or fails. */
function inboundImage(options: { mime?: string; data?: Uint8Array; error?: Error } = {}): ChatInboundImage {
  return {
    fetch: () => options.error === undefined
      ? Promise.resolve({ data: options.data ?? new Uint8Array([1, 2, 3]), mime: options.mime ?? 'image/png' })
      : Promise.reject(options.error),
  }
}

/** One inbound file handle that answers with bytes, or fails. */
function inboundFile(fileName: string, options: { data?: Uint8Array; error?: Error } = {}): ChatInboundFile {
  return {
    fileName,
    fetch: () => options.error === undefined
      ? Promise.resolve(options.data ?? new Uint8Array([1, 2, 3]))
      : Promise.reject(options.error),
  }
}

/** Hand one message to the binding's live connection, as the platform would. */
function deliver(connector: TestConnector, message: ChatInboundMessage): void {
  const connection = connector.connections.at(-1)
  if (connection === undefined) throw new Error('the connector opened no connection')
  connection.handlers.onMessage(message)
}

/** Publish one session event on the firehose the bridge observes. */
function publish(ctx: Context, session: Session, event: SessionEvent): void {
  ctx.emit('session/event', session, event)
}

/** Append one turn opener and publish it. */
function startTurn(ctx: Context, session: Session, turn: number): void {
  publish(ctx, session, session.append('turn/start', { turn }))
}

/** Append one turn closer and publish it. */
function endTurn(ctx: Context, session: Session, turn: number, reason: TurnEndReason): void {
  publish(ctx, session, session.append('turn/end', { turn, reason }))
}

/** Append one assistant message carrying `blocks` and publish it. */
function say(ctx: Context, session: Session, turn: number, blocks: ContentBlock[]): void {
  publish(ctx, session, session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({ content: blocks, source: { provider: 'test', model: 'test' } }),
    stream: [],
  }, { surfaceOp: 'append' }))
}

/** Append one assistant message carrying a single text block. */
function assistant(ctx: Context, session: Session, turn: number, text: string): void {
  say(ctx, session, turn, [{ type: 'text', text }])
}

/** Append one approval question and publish it. */
function approvalAsked(ctx: Context, session: Session, id: string): void {
  publish(ctx, session, session.append('approval/asked', {
    id: brandString<ApprovalRequestId>(id),
    toolName: 'bash',
  }))
}

/**
 * Write one already-admitted channel message into a Session log, as a previous
 * process would have left it: the binding derives its durable memory from these
 * events rather than from state stored beside the log.
 */
function seedChannelMessage(session: Session, chatId: string, messageId: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'admitted before this process started' }],
    source: {
      kind: 'channel',
      channel: CHANNEL,
      chatId: brandString<ChatId>(chatId),
      chatKind: 'group',
      messageId: brandString<ChatMessageId>(messageId),
    },
  }), { surfaceOp: 'append' })
}

/** Let every already-queued microtask and timer callback run. */
async function settle(): Promise<void> {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
}

/** Write one fixture file and stamp its modification time. */
async function writeFixture(rel: string, content: string, mtime?: Date): Promise<string> {
  const path = join(workspaceRoot, rel)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  if (mtime !== undefined) await utimes(path, mtime, mtime)
  return path
}

/** Bind the default channel to a Session and open its connection. */
async function connect(h: Harness, sessionId = SESSION): Promise<void> {
  await h.bridge.enable(CHANNEL, sessionId)
}

/** Hand one message to the binding and wait until the agent received it. */
async function admit(h: Harness, message: ChatInboundMessage, connector: TestConnector = h.connector): Promise<void> {
  deliver(connector, message)
  await vi.waitFor(() => { expect(h.agent.followups).toHaveLength(1) })
}

/** Run one complete turn whose reply text is `text`, with `during` running after the turn opens. */
async function runTurn(h: Harness, text: string, during: () => Promise<void> = async () => {}): Promise<void> {
  startTurn(h.ctx, h.session, 1)
  await during()
  assistant(h.ctx, h.session, 1, text)
  endTurn(h.ctx, h.session, 1, { kind: 'completed' })
}

/** Every file the client sent, in completion order. */
function sentFiles(client: TestClient): OutboundCall[] {
  return client.completed.filter(call => call.kind === 'sendFile')
}

describe('mounting and sync', () => {
  it('registers ctx.chatBridge and resolves every default without a config argument', async () => {
    const h = await openBridge()

    expect(h.ctx.get('chatBridge')).toBeDefined()
    expect(h.bridge.resolved).toEqual({
      chunkChars: 4000,
      dedupeSize: 64,
      maxReplyFiles: 5,
      mtimeGraceMs: 2000,
      maxInboundFileBytes: 30 * 1024 * 1024,
      maxOutboundFileBytes: 30 * 1024 * 1024,
    })
  })

  it('hides the binding fields from form renderers, which cannot supply a Session', async () => {
    const h = await openBridge()

    const described = h.ctx.settings.describe().find(row => row.ns === NAMESPACE)
    if (described === undefined) throw new Error('the connector settings namespace was not registered')
    const rehydrated = new z(described.schema as Schema) as unknown as {
      list?: Array<{ dict?: Record<string, { meta: { hidden?: boolean } }> }>
    }
    // A channel's section is `intersect([shared binding fields, the connector's
    // own])`, so the shared fields sit in whichever member declares them.
    const shared = (rehydrated.list ?? []).find(member => member.dict?.['sessionId'] !== undefined)

    // `enabled` and `sessionId` are binding state the panel writes through
    // `chatBridge.enable()` from the tab's own Session; a form field for either
    // would ask a person for a Session id, and `enabled` alone cannot bind one.
    expect(shared?.dict?.['enabled']?.meta.hidden).toBe(true)
    expect(shared?.dict?.['sessionId']?.meta.hidden).toBe(true)
    expect(shared?.dict?.['markdown']?.meta.hidden).toBeUndefined()
    expect(shared?.dict?.['finalReplyOnly']?.meta.hidden).toBeUndefined()
  })

  it('binds every registered connector exactly once, in registration order', async () => {
    const second = new TestConnector(new TestClient(), { channel: OTHER_CHANNEL, namespace: 'channel-other' })
    const h = await openBridge({ connectors: [new TestConnector(new TestClient()), second] })

    expect(h.bridge.statuses().map(status => status.channel)).toEqual([CHANNEL, OTHER_CHANNEL])
    h.bridge.sync()
    expect(h.bridge.statuses()).toHaveLength(2)
    expect(h.ctx.settings.describe().map(row => String(row.ns))).toEqual([NAMESPACE, 'channel-other'])
  })

  it('drops a binding whose connector left the registry', async () => {
    const h = await openBridge()
    expect(h.bridge.status(CHANNEL)).toBeDefined()

    h.registrations[0]?.()
    h.bridge.sync()

    expect(h.bridge.statuses()).toEqual([])
    expect(h.bridge.status(CHANNEL)).toBeUndefined()
  })

  it('hands the connector its own base layer when it declares one', async () => {
    const connector = new TestConnector(new TestClient(), { base: { token: 'from-composition' } })
    const h = await openBridge({ connectors: [connector] })

    expect(h.ctx.settings.describe()[0]?.base).toEqual({ token: 'from-composition' })
    expect(h.bridge.statuses()[0]?.settingsNamespace).toBe(NAMESPACE)
  })
})

describe('statuses', () => {
  it('reports the required fields and omits every optional one that is unknown', async () => {
    const h = await openBridge()

    const status = statusOf(h.bridge, CHANNEL)

    expect(status).toEqual({
      channel: CHANNEL,
      enabled: false,
      sessionId: '',
      connection: 'stopped',
      capabilities: h.connector.capabilities,
      settingsNamespace: NAMESPACE,
      credentialFields: ['token'],
    })
  })

  it('reports the failure, the lock, the admission time, and the reply budget once they exist', async () => {
    const connector = new TestConnector(new TestClient(), { replyBudget: 3, ready: true })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    expect(statusOf(h.bridge, CHANNEL).connection).toBe('connected')

    await admit(h, inbound())
    connector.clientError = new Error('credentials expired')
    await h.bridge.probe(CHANNEL)

    const status = statusOf(h.bridge, CHANNEL)
    expect(status.lockedChatId).toBe('chat-1')
    expect(status.replyBudget).toBe(3)
    expect(status.lastError).toBe('credentials expired')
    expect(status.lastInboundAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(status.lastErrorAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('enable and disable', () => {
  it('refuses a channel this build does not register', async () => {
    const h = await openBridge()

    await expect(h.bridge.enable(OTHER_CHANNEL, SESSION)).rejects.toThrow(`channel ${OTHER_CHANNEL} is not registered`)
    await expect(h.bridge.disable(OTHER_CHANNEL)).rejects.toThrow(`channel ${OTHER_CHANNEL} is not registered`)
    await expect(h.bridge.probe(OTHER_CHANNEL)).rejects.toThrow(`channel ${OTHER_CHANNEL} is not registered`)
  })

  it('refuses a Session that does not exist', async () => {
    const h = await openBridge()

    await expect(h.bridge.enable(CHANNEL, 's-missing')).rejects.toThrow('session s-missing does not exist')
  })

  it('refuses a Session another channel already serves', async () => {
    const second = new TestConnector(new TestClient(), { channel: OTHER_CHANNEL, namespace: 'channel-other' })
    const h = await openBridge({ connectors: [new TestConnector(new TestClient()), second] })
    await connect(h)

    await expect(h.bridge.enable(OTHER_CHANNEL, SESSION)).rejects
      .toThrow(`channel ${CHANNEL} already serves session ${SESSION}`)
  })

  it('re-enables the channel it already serves without reopening it', async () => {
    const h = await openBridge()
    await connect(h)
    await connect(h)

    expect(h.connector.connections).toHaveLength(1)
    expect(statusOf(h.bridge, CHANNEL).enabled).toBe(true)
  })

  it('closes the connection on disable and leaves the configuration otherwise intact', async () => {
    const h = await openBridge()
    await connect(h)

    await h.bridge.disable(CHANNEL)

    const status = statusOf(h.bridge, CHANNEL)
    expect(status.enabled).toBe(false)
    expect(status.sessionId).toBe(SESSION)
    expect(status.connection).toBe('stopped')
    expect(h.connector.connections[0]?.closes).toBe(1)
  })

  it('serializes a close behind an open that is still in flight', async () => {
    const connector = new TestConnector(new TestClient())
    const h = await openBridge({ connectors: [connector] })
    const gate = deferred()
    connector.gate = gate.promise

    const enabling = h.bridge.enable(CHANNEL, SESSION)
    await vi.waitFor(() => { expect(connector.clientConfigs).toHaveLength(1) })
    const disabling = h.bridge.disable(CHANNEL)
    gate.resolve()
    await Promise.all([enabling, disabling])

    expect(statusOf(h.bridge, CHANNEL).connection).toBe('stopped')
    expect(connector.connections).toHaveLength(1)
    expect(connector.connections[0]?.closes).toBe(1)
  })
})

describe('probe', () => {
  it('reports a client that states no account facts', async () => {
    const h = await openBridge()

    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: true })
  })

  it('reports the account label, the details, and both', async () => {
    const h = await openBridge()
    h.client.account = { accountLabel: 'bot@example' }
    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: true, accountLabel: 'bot@example' })

    h.client.account = { details: ['workspace one'] }
    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: true, details: ['workspace one'] })

    h.client.account = { accountLabel: 'bot@example', details: ['workspace one'] }
    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: true, accountLabel: 'bot@example', details: ['workspace one'] })
  })

  it('reports a client that cannot be built as a value rather than a rejection', async () => {
    const connector = new TestConnector(new TestClient(), { clientError: new Error('network is down') })
    const h = await openBridge({ connectors: [connector] })
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)

    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: false, message: 'network is down' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(statusOf(h.bridge, CHANNEL).lastError).toBe('network is down')
  })

  it('reports a sign-in that cannot complete', async () => {
    const h = await openBridge()
    h.client.credentialError = new Error('signature rejected')

    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: false, message: 'signature rejected' })
  })

  it('reports a non-Error failure as its text', async () => {
    const connector = new TestConnector(new TestClient(), { clientError: 'socket closed' })
    const h = await openBridge({ connectors: [connector] })

    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: false, message: 'socket closed' })
  })

  it('stays quiet about a configuration refusal, which the panel fixes', async () => {
    const connector = new TestConnector(new TestClient(), {
      clientError: new ChatConfigError('token', 'the token is missing'),
    })
    const h = await openBridge({ connectors: [connector] })
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => undefined)

    expect(await h.bridge.probe(CHANNEL)).toEqual({ ok: false, message: 'the token is missing' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('inbound admission', () => {
  it('admits text as a channel-sourced user message', async () => {
    const h = await openBridge()
    await connect(h)

    await admit(h, inbound({ text: 'hello', senderName: 'Ada' }))

    const message = h.agent.followups[0]
    expect(message?.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(message?.source).toEqual({
      kind: 'channel',
      channel: CHANNEL,
      chatId: 'chat-1',
      chatKind: 'direct',
      messageId: 'm-1',
      senderName: 'Ada',
    })
    expect(h.connector.clientConfigs.at(-1)).toMatchObject({ enabled: true, sessionId: SESSION })
  })

  it('leaves the sender unnamed when the platform reports none', async () => {
    const h = await openBridge()
    await connect(h)

    await admit(h, inbound())

    expect(h.agent.followups[0]?.source).not.toHaveProperty('senderName')
  })

  it('admits images and files as attachment blocks', async () => {
    const h = await openBridge()
    await connect(h)

    await admit(h, inbound({
      text: 'look',
      chatKind: 'group',
      senderName: 'Ada',
      images: [inboundImage()],
      files: [inboundFile('notes.txt')],
    }))

    const content = h.agent.followups[0]?.content ?? []
    expect(content.map(block => block.type)).toEqual(['text', 'image', 'file'])
    expect(h.attachments.saveImage).toHaveBeenCalledWith({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })
    expect(h.attachments.saveFile).toHaveBeenCalledWith({ data: new Uint8Array([1, 2, 3]), name: 'notes.txt' })
  })

  it('sends the unsupported notice for a message that carries nothing', async () => {
    const h = await openBridge()
    await connect(h)

    deliver(h.connector, inbound({ text: null }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.unsupportedMessage)
    expect(h.agent.followups).toHaveLength(0)
  })

  it('queues a notice for a message that arrives while the agent runs', async () => {
    const h = await openBridge()
    await connect(h)
    h.agent.status = 'running'

    deliver(h.connector, inbound())
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe(CHAT_NOTICES.queued)
    expect(h.agent.followups).toHaveLength(1)
  })

  it('skips the queued notice when only the final reply is relayed', async () => {
    const h = await openBridge()
    await configure(h, { finalReplyOnly: true })
    await connect(h)
    h.agent.status = 'running'

    await admit(h, inbound())
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('restores the locked conversation and the watermark a previous process logged', async () => {
    const h = await openBridge()
    seedChannelMessage(h.session, 'chat-7', 'm-7')

    await connect(h)

    expect(statusOf(h.bridge, CHANNEL).lockedChatId).toBe('chat-7')
    deliver(h.connector, inbound({
      chatId: brandString<ChatId>('chat-7'),
      messageId: brandString<ChatMessageId>('m-7'),
    }))
    await settle()

    expect(h.agent.followups).toHaveLength(0)
  })

  it('admits a message that carries attachments and no text', async () => {
    const h = await openBridge()
    await connect(h)

    await admit(h, inbound({ text: null, images: [inboundImage()] }))

    expect(h.agent.followups[0]?.content.map(block => block.type)).toEqual(['image'])
    expect(h.attachments.saveImage).toHaveBeenCalledTimes(1)
  })

  it('admits the same platform id once', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    deliver(h.connector, inbound())
    await settle()

    expect(h.agent.followups).toHaveLength(1)
  })

  it('admits a replayed message whose id the platform withheld', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound({ messageId: brandString<ChatMessageId>('') }))

    await admit(h, inbound({ messageId: brandString<ChatMessageId>(''), text: 'again' }))

    expect(h.agent.followups).toHaveLength(2)
  })

  it('forgets a refused message so the platform replay is admitted', async () => {
    const h = await openBridge()
    await connect(h)
    deliver(h.connector, inbound({ text: null }))
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })
    // The refusal is forgotten only once its own notice settled, so a replay
    // that arrives while that notice is still in flight is still a duplicate.
    await settle()

    await admit(h, inbound({ text: 'now with text' }))

    expect(h.agent.followups).toHaveLength(1)
  })

  it('answers only the conversation that spoke first', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound({ chatId: brandString<ChatId>('chat-1') }))

    deliver(h.connector, inbound({ chatId: brandString<ChatId>('chat-2'), messageId: brandString<ChatMessageId>('m-2') }))
    await settle()

    expect(h.agent.followups).toHaveLength(1)
  })

  it('ignores a message once its channel is unbound', async () => {
    const h = await openBridge()
    await connect(h)
    const handlers = h.connector.connections[0]?.handlers
    await h.bridge.disable(CHANNEL)

    handlers?.onMessage(inbound())
    await settle()

    expect(h.agent.followups).toHaveLength(0)
    expect(h.client.attempts).toEqual([])
  })

  it('ignores a message for a Session whose entry another binding took away', async () => {
    const second = new TestConnector(new TestClient(), { channel: OTHER_CHANNEL, namespace: 'channel-other' })
    const h = await openBridge({ connectors: [new TestConnector(new TestClient()), second] })
    await connect(h)
    await configure(h, { enabled: true, sessionId: SESSION }, second)
    await vi.waitFor(() => { expect(second.connections).toHaveLength(1) })

    // The first channel closing removes the entry the second channel opened.
    await h.bridge.disable(CHANNEL)

    deliver(second, inbound({ chatId: brandString<ChatId>('chat-9'), messageId: brandString<ChatMessageId>('m-9') }))
    await settle()

    expect(h.agent.followups).toHaveLength(0)
  })

  it('ignores a session event for a Session no channel drives', async () => {
    const h = await openBridge()
    const stranger = Session.create(SessionId('s-stranger'))

    startTurn(h.ctx, stranger, 1)
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('ignores a session event whose channel left the registry', async () => {
    // A configuration edit queued behind an open in flight still runs after the
    // connector unregisters, which leaves the bridge holding an entry for a
    // channel it no longer binds. The event must be dropped rather than throw.
    const connector = new TestConnector(new TestClient())
    const h = await openBridge({ connectors: [connector] })
    const gate = deferred()
    connector.gate = gate.promise

    const enabling = h.bridge.enable(CHANNEL, SESSION)
    await vi.waitFor(() => { expect(connector.clientConfigs).toHaveLength(1) })
    h.registrations[0]?.()
    h.bridge.sync()
    gate.resolve()
    await enabling
    await vi.waitFor(() => { expect(connector.clientConfigs).toHaveLength(2) })
    await settle()

    startTurn(h.ctx, h.session, 1)

    expect(h.bridge.status(CHANNEL)).toBeUndefined()
  })
})

describe('inbound media refusals', () => {
  it('names the transfer cap an oversized image crossed', async () => {
    const h = await openBridge()
    await connect(h)

    deliver(h.connector, inbound({ images: [inboundImage({ error: new ChatMediaTooLargeError(MAX_IMAGE_BYTES) })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.imageTooLarge(MAX_IMAGE_BYTES))
    expect(h.agent.followups).toHaveLength(0)
  })

  it('uses the platform own inbound cap when it is the tightest', async () => {
    const connector = new TestConnector(new TestClient(), { capabilities: { maxInboundBytes: 5 } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)

    deliver(connector, inbound({ files: [inboundFile('notes.txt', { error: new ChatMediaTooLargeError(5) })] }))
    await vi.waitFor(() => { expect(connector.client.attempts).toHaveLength(1) })

    expect(connector.client.attempts[0]?.text).toBe(CHAT_NOTICES.fileTooLarge('notes.txt', 5))
    expect(h.agent.followups).toHaveLength(0)
  })

  it('names the scope an image needs', async () => {
    const h = await openBridge()
    await connect(h)
    const error = new ChatPermissionError('denied', ['im:message'], 'https://console.invalid/scope')

    deliver(h.connector, inbound({ images: [inboundImage({ error })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.imagePermission(['im:message'], 'https://console.invalid/scope'))
  })

  it('names the scope a file needs', async () => {
    const h = await openBridge()
    await connect(h)
    const error = new ChatPermissionError('denied', ['im:file'], null)

    deliver(h.connector, inbound({ files: [inboundFile('notes.txt', { error })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.filePermission('notes.txt', ['im:file'], null))
  })

  it('refuses an image whose media type this deployment cannot store', async () => {
    const h = await openBridge()
    await connect(h)

    deliver(h.connector, inbound({ images: [inboundImage({ mime: 'image/tiff' })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.unsupportedMessage)
    expect(h.attachments.saveImage).not.toHaveBeenCalled()
  })

  it('reports an image that could not be transferred', async () => {
    const h = await openBridge()
    await connect(h)

    deliver(h.connector, inbound({ images: [inboundImage({ error: new Error('socket closed') })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.imageFailed('socket closed'))
  })

  it('reports a file that could not be transferred', async () => {
    const h = await openBridge()
    await connect(h)

    deliver(h.connector, inbound({ files: [inboundFile('notes.txt', { error: new Error('socket closed') })] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.fileFailed('notes.txt', 'socket closed'))
  })

  it('refuses the whole message when one of its attachments cannot be stored', async () => {
    const h = await openBridge()
    await connect(h)
    h.attachments.saveImage.mockRejectedValueOnce(new Error('disk full'))

    deliver(h.connector, inbound({ text: 'see this', images: [inboundImage()] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.imageFailed('disk full'))
    expect(h.agent.followups).toHaveLength(0)
  })

  it('refuses the whole message when a file cannot be stored', async () => {
    const h = await openBridge()
    await connect(h)
    h.attachments.saveFile.mockRejectedValueOnce(new Error('disk full'))

    deliver(h.connector, inbound({ text: 'see this', files: [inboundFile('notes.txt')] }))
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(1) })

    expect(h.client.attempts[0]?.text).toBe(CHAT_NOTICES.fileFailed('notes.txt', 'disk full'))
    expect(h.agent.followups).toHaveLength(0)
  })
})

describe('outbound relay', () => {
  it('sends the completed text of an assistant message, with no quote in a direct chat', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'the answer')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]).toMatchObject({
      kind: 'sendText',
      chatId: 'chat-1',
      text: 'the answer',
      markdown: true,
    })
  })

  it('drops non-text blocks and ignores a foreign turn', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    startTurn(h.ctx, h.session, 1)
    // A step that produced no text mirrors nothing, so it leaves no reply to send.
    say(h.ctx, h.session, 1, [{ type: 'reasoning', text: 'thinking' }])
    say(h.ctx, h.session, 2, [{ type: 'reasoning', text: 'thinking' }])
    say(h.ctx, h.session, 1, [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'only the text' }])
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe('only the text')
  })

  it('sends nothing for a turn that opened with no admitted message', async () => {
    const h = await openBridge()
    await connect(h)
    startTurn(h.ctx, h.session, 1)
    endTurn(h.ctx, h.session, 1, { kind: 'completed' })
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('holds every message but the last when only the final reply is relayed', async () => {
    const h = await openBridge()
    await configure(h, { finalReplyOnly: true })
    await connect(h)
    await admit(h, inbound())

    startTurn(h.ctx, h.session, 1)
    assistant(h.ctx, h.session, 1, 'first draft')
    await settle()
    expect(h.client.attempts).toEqual([])

    assistant(h.ctx, h.session, 1, 'final answer')
    endTurn(h.ctx, h.session, 1, { kind: 'completed' })
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe('final answer')
  })

  it('reports a failed run that relayed nothing', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    startTurn(h.ctx, h.session, 1)
    endTurn(h.ctx, h.session, 1, { kind: 'error', error: { message: 'provider refused', code: 'UNKNOWN' } })
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe(CHAT_NOTICES.runFailed('provider refused'))
  })

  it('does not report a failed run that already relayed text', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    startTurn(h.ctx, h.session, 1)
    assistant(h.ctx, h.session, 1, 'partial answer')
    endTurn(h.ctx, h.session, 1, { kind: 'error', error: { message: 'provider refused', code: 'UNKNOWN' } })
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe('partial answer')
  })

  it('ignores a turn end that belongs to no armed turn', async () => {
    const h = await openBridge()
    await connect(h)

    endTurn(h.ctx, h.session, 1, { kind: 'completed' })
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('announces an approval that is asked during an armed turn', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    startTurn(h.ctx, h.session, 1)

    approvalAsked(h.ctx, h.session, 'a-1')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]?.text).toBe(CHAT_NOTICES.approvalWaiting)
  })

  it('ignores an approval asked between turns', async () => {
    const h = await openBridge()
    await connect(h)

    approvalAsked(h.ctx, h.session, 'a-1')
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('ignores an event type it does not mirror', async () => {
    const h = await openBridge()
    await connect(h)

    publish(h.ctx, h.session, h.session.append('step/start', { turn: 1, step: 1 }))
    await settle()

    expect(h.client.attempts).toEqual([])
  })

  it('splits a reply at the deployment chunk size', async () => {
    const h = await openBridge({ config: { chunkChars: 200 } })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'x'.repeat(250))
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(2) })

    expect(h.client.completed.map(call => call.text.length)).toEqual([200, 50])
  })

  it('splits a reply at the platform cap when it is tighter', async () => {
    const connector = new TestConnector(new TestClient(), { capabilities: { maxTextChars: 100 } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'y'.repeat(250))
    await vi.waitFor(() => { expect(connector.client.completed).toHaveLength(3) })

    expect(connector.client.completed.map(call => call.text.length)).toEqual([100, 100, 50])
  })

  it('folds the chunks past the platform reply budget into the last message', async () => {
    const connector = new TestConnector(new TestClient(), { replyBudget: 1, capabilities: { maxTextChars: 100 } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'z'.repeat(250))
    await vi.waitFor(() => { expect(connector.client.completed).toHaveLength(1) })

    expect(connector.client.completed[0]?.text).toBe(`${'z'.repeat(100)}\n\n${'z'.repeat(100)}\n\n${'z'.repeat(50)}`)
  })

  it('quotes the answered message once, for the first group reply only', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound({ chatKind: 'group' }))
    startTurn(h.ctx, h.session, 1)

    assistant(h.ctx, h.session, 1, 'first')
    assistant(h.ctx, h.session, 1, 'second')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(2) })

    expect(h.client.completed[0]).toMatchObject({ kind: 'replyText', messageId: 'm-1', markdown: true })
    expect(h.client.completed[1]).toMatchObject({ kind: 'sendText', markdown: true })
  })

  it('sends plainly when the deployment turns markdown off', async () => {
    const h = await openBridge()
    await configure(h, { markdown: false })
    await connect(h)
    await admit(h, inbound({ chatKind: 'group' }))

    await runTurn(h, 'plain answer')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]).toMatchObject({ kind: 'replyText', markdown: undefined })
  })

  it('does not quote when the platform cannot thread a reply', async () => {
    const connector = new TestConnector(new TestClient(), { capabilities: { quoting: false } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    await admit(h, inbound({ chatKind: 'group' }))

    await runTurn(h, 'answer')
    await vi.waitFor(() => { expect(connector.client.completed).toHaveLength(1) })

    expect(connector.client.completed[0]).toMatchObject({ kind: 'sendText' })
  })

  it('does not quote when the platform gave the message no id', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound({ chatKind: 'group', messageId: brandString<ChatMessageId>('') }))

    await runTurn(h, 'answer')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.completed[0]).toMatchObject({ kind: 'sendText' })
  })

  it('resends once, plainly, when the platform refuses the rendered form', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.client.beforeText = (call) => {
      if (call.markdown === true) throw new ChatFormatRejectedError('markdown is not accepted here')
    }

    await runTurn(h, '**bold**')
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(1) })

    expect(h.client.attempts.map(call => call.markdown)).toEqual([true, undefined])
    expect(h.client.completed[0]).toMatchObject({ kind: 'sendText', text: '**bold**' })
  })

  it('reports any other send failure without resending', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.client.beforeText = () => { throw new ChatConfigError('token', 'the token expired') }

    await runTurn(h, 'answer')
    await vi.waitFor(() => { expect(statusOf(h.bridge, CHANNEL).lastError).toBe('the token expired') })

    expect(h.client.attempts).toHaveLength(1)
    expect(h.client.completed).toEqual([])
  })

  it('serializes every reply through one send chain', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    const gate = deferred()
    h.client.gate = gate.promise
    startTurn(h.ctx, h.session, 1)

    assistant(h.ctx, h.session, 1, 'first')
    assistant(h.ctx, h.session, 1, 'second')
    await settle()
    expect(h.client.attempts.map(call => call.text)).toEqual(['first'])

    gate.resolve()
    await vi.waitFor(() => { expect(h.client.completed).toHaveLength(2) })
    expect(h.client.completed.map(call => call.text)).toEqual(['first', 'second'])
  })

  it('drops a reply queued before its binding closed', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    const gate = deferred()
    h.client.gate = gate.promise
    startTurn(h.ctx, h.session, 1)

    assistant(h.ctx, h.session, 1, 'first')
    assistant(h.ctx, h.session, 1, 'second')
    await settle()
    await h.bridge.disable(CHANNEL)

    gate.resolve()
    await settle()

    expect(h.client.attempts.map(call => call.text)).toEqual(['first'])
  })

  it('reports a notice the platform would not carry', async () => {
    const h = await openBridge()
    await connect(h)
    h.client.beforeText = () => { throw new Error('notice refused') }

    deliver(h.connector, inbound({ text: null }))
    await vi.waitFor(() => { expect(statusOf(h.bridge, CHANNEL).lastError).toBe('notice refused') })

    expect(h.agent.followups).toHaveLength(0)
  })

  it('reports a connection that was refused and one that failed on the wire', async () => {
    const refusing = new TestConnector(new TestClient(), { connectError: new Error('handshake refused') })
    const first = await openBridge({ connectors: [refusing] })
    await connect(first)
    // A refused handshake leaves the channel stopped, with the failure on its
    // status line, because there is no connection to keep open.
    expect(statusOf(first.bridge, CHANNEL).connection).toBe('stopped')
    expect(statusOf(first.bridge, CHANNEL).lastError).toBe('handshake refused')

    const failing = new TestConnector(new TestClient(), { onError: new Error('connection dropped') })
    const second = await openBridge({ connectors: [failing] })
    await connect(second)
    expect(statusOf(second.bridge, CHANNEL).connection).toBe('failed')
    expect(statusOf(second.bridge, CHANNEL).lastError).toBe('connection dropped')
  })

  it('reports an outbound client that cannot be built', async () => {
    const connector = new TestConnector(new TestClient(), { clientError: new Error('no credentials') })
    const h = await openBridge({ connectors: [connector] })

    await connect(h)

    expect(statusOf(h.bridge, CHANNEL).connection).toBe('stopped')
    expect(statusOf(h.bridge, CHANNEL).lastError).toBe('no credentials')
  })

  it('leaves a channel stopped when its configured Session has no agent', async () => {
    const h = await openBridge()

    await configure(h, { enabled: true, sessionId: 's-vanished' })
    await settle()

    expect(statusOf(h.bridge, CHANNEL).connection).toBe('stopped')
    expect(h.connector.clientConfigs).toEqual([])
  })
})

describe('reply file delivery', () => {
  it('delivers a file the turn wrote and the reply named', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(sentFiles(h.client)).toHaveLength(1) })

    expect(sentFiles(h.client)[0]).toMatchObject({ kind: 'sendFile', chatId: 'chat-1', fileName: 'report.txt' })
  })

  it('carries a copy the deployment sends from the connector base layer', async () => {
    const connector = new TestConnector(new TestClient(), { base: { token: 'from-composition' } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)

    expect(connector.clientConfigs[0]).toMatchObject({ token: 'from-composition', enabled: true })
  })

  it('skips a named file that never existed', async () => {
    const h = await openBridge()
    const debug = vi.spyOn(h.ctx.logger, 'debug').mockImplementation(() => undefined)
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `missing.txt`.')
    await vi.waitFor(() => { expect(debug).toHaveBeenCalledTimes(1) })

    expect(sentFiles(h.client)).toEqual([])
  })

  it('skips a named path that does not denote a workspace file', async () => {
    const h = await openBridge()
    const debug = vi.spyOn(h.ctx.logger, 'debug').mockImplementation(() => undefined)
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Read `/etc/passwd` and `~/.ssh/id_rsa`.')
    await settle()

    expect(sentFiles(h.client)).toEqual([])
    expect(h.fs.contains).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
  })

  it('skips a named path the filesystem cannot resolve', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.unresolvable.add('broken.txt')

    await runTurn(h, 'Wrote `broken.txt`.')
    await settle()

    expect(sentFiles(h.client)).toEqual([])
  })

  it('skips a named path that is a directory', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `bundle.txt`.', async () => { await mkdir(join(workspaceRoot, 'bundle.txt')) })
    await settle()

    expect(sentFiles(h.client)).toEqual([])
  })

  it('skips a named file the filesystem reports outside the workspace', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.contains.mockReturnValue(false)

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await settle()

    expect(sentFiles(h.client)).toEqual([])
  })

  it('skips a named file that predates the run beyond the grace window', async () => {
    const h = await openBridge()
    const debug = vi.spyOn(h.ctx.logger, 'debug').mockImplementation(() => undefined)
    await connect(h)
    await admit(h, inbound())
    await writeFixture('old.txt', 'an old report', new Date(Date.now() - 30_000))

    await runTurn(h, 'Wrote `old.txt`.')
    await vi.waitFor(() => { expect(debug).toHaveBeenCalledTimes(1) })

    expect(sentFiles(h.client)).toEqual([])
  })

  it('delivers a named file written shortly before the run when the grace window covers it', async () => {
    const h = await openBridge({ config: { mtimeGraceMs: 60_000 } })
    await connect(h)
    await admit(h, inbound())
    await writeFixture('recent.txt', 'a recent report', new Date(Date.now() - 30_000))

    await runTurn(h, 'Wrote `recent.txt`.')
    await vi.waitFor(() => { expect(sentFiles(h.client)).toHaveLength(1) })

    expect(sentFiles(h.client)[0]?.fileName).toBe('recent.txt')
  })

  it('sends the too-large notice instead of reading a file over the deployment cap', async () => {
    const h = await openBridge({ config: { maxOutboundFileBytes: 4 } })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `big.txt`.', async () => { await writeFixture('big.txt', 'more than four bytes') })
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(2) })

    expect(h.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendTooLarge('big.txt', 4))
    expect(h.fs.readBytes).not.toHaveBeenCalled()
  })

  it('sends the too-large notice instead of reading a file over the platform cap', async () => {
    const connector = new TestConnector(new TestClient(), { capabilities: { maxOutboundBytes: 4 } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `big.txt`.', async () => { await writeFixture('big.txt', 'more than four bytes') })
    await vi.waitFor(() => { expect(connector.client.attempts).toHaveLength(2) })

    expect(connector.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendTooLarge('big.txt', 4))
  })

  it('reports a read the filesystem refused as too large', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.readBytes.mockRejectedValueOnce(new TooLargeReadError('too large'))

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(2) })

    expect(h.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendTooLarge('report.txt', 30 * 1024 * 1024))
  })

  it('names the scope an outbound file needs', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.readBytes.mockRejectedValueOnce(new ChatPermissionError('denied', ['im:file'], null))

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(2) })

    expect(h.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendPermission('report.txt', ['im:file'], null))
  })

  it('reports a file the filesystem cannot carry as a send failure', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.readBytes.mockRejectedValueOnce(new ChatUnsupportedError('no binary files here'))

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(h.client.attempts).toHaveLength(2) })

    expect(h.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendFailed('report.txt', 'no binary files here'))
  })

  it('reports any other outbound file failure', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.fs.readBytes.mockRejectedValueOnce(new Error('the backend went away'))

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(statusOf(h.bridge, CHANNEL).lastError).toBe('the backend went away') })

    expect(h.client.attempts[1]?.text).toBe(CHAT_NOTICES.fileSendFailed('report.txt', 'the backend went away'))
  })

  it('reports a file the platform refused to accept', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())
    h.client.beforeFile = () => { throw new Error('upload rejected') }

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await vi.waitFor(() => { expect(statusOf(h.bridge, CHANNEL).lastError).toBe('upload rejected') })

    expect(h.client.attempts.at(-1)?.text).toBe(CHAT_NOTICES.fileSendFailed('report.txt', 'upload rejected'))
    expect(h.client.attempts.at(-2)).toMatchObject({ kind: 'sendFile', fileName: 'report.txt' })
  })

  it('delivers only the first files a reply may carry and counts the rest', async () => {
    const h = await openBridge({ config: { maxReplyFiles: 1 } })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `first.txt` and `second.txt`.', async () => {
      await writeFixture('first.txt', 'one')
      await writeFixture('second.txt', 'two')
    })
    await vi.waitFor(() => { expect(sentFiles(h.client)).toHaveLength(1) })

    expect(sentFiles(h.client)[0]?.fileName).toBe('first.txt')
    expect(h.client.completed.map(call => call.text)).toContain(CHAT_NOTICES.filesSkipped(1))
  })

  it('delivers nothing when the platform carries no files', async () => {
    const connector = new TestConnector(new TestClient(), { capabilities: { outbound: { files: false } } })
    const h = await openBridge({ connectors: [connector] })
    await connect(h)
    await admit(h, inbound())

    await runTurn(h, 'Wrote `report.txt`.', async () => { await writeFixture('report.txt', 'the report') })
    await settle()

    expect(sentFiles(connector.client)).toEqual([])
    expect(h.fs.resolve).not.toHaveBeenCalled()
  })

  it('delivers no files for a reply that relayed nothing', async () => {
    const h = await openBridge()
    await connect(h)
    await admit(h, inbound())

    startTurn(h.ctx, h.session, 1)
    endTurn(h.ctx, h.session, 1, { kind: 'error', error: { message: 'provider refused', code: 'UNKNOWN' } })
    await settle()

    expect(h.fs.resolve).not.toHaveBeenCalled()
  })
})

describe('disposal', () => {
  it('closes every binding when the bridge fiber unloads', async () => {
    const h = await openBridge()
    await connect(h)
    expect(statusOf(h.bridge, CHANNEL).connection).toBe('connecting')

    await h.bridgeFiber.dispose()

    expect(h.bridge.statuses()).toEqual([])
    expect(h.bridge.status(CHANNEL)).toBeUndefined()
    expect(h.connector.connections[0]?.closes).toBe(1)
    expect(h.ctx.get('chatBridge')).toBeUndefined()
  })
})

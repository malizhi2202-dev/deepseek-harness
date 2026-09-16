/**
 * Tuitui (推推) IM bridge plugin.
 *
 * Connects one Tuitui robot to DeepSeek Harness agent sessions: inbound chat
 * messages become `agent.followup` user turns, replies stream back through the
 * Tuitui HTTP send API, and per-chat conversations continue on one Agent
 * session until `/new` or `/cd` resets them. A `/tree` command opens an
 * in-place-updatable interactive file-tree card.
 *
 * The transport seam (`config.transport`) is runtime-only and lets tests inject
 * a stub in place of the real WebSocket + HTTP client.
 *
 * @module @deepseek-ai/dsh-tuitui
 */
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent, SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import { TuituiClient } from './client.ts'
import { asString } from './parse.ts'
import {
  CONFIRM_KINDS,
  DEFAULT_IGNORE,
  TreeCardStore,
  TreeWorkspace,
  VIEW_CLOSED,
  VIEW_CONFIRM,
  VIEW_ERROR,
  VIEW_FOCUS,
  VIEW_HINT,
  VIEW_LIST,
  VIEW_RESULT,
  WorkspaceStore,
  formatSize,
  parseIntent,
  resolvePath,
  type Intent,
} from './tree.ts'
import type { IncomingCallback, IncomingMessage, TuituiTransport } from './types.ts'

export const name = 'tuitui'
export const inject = ['agents', 'agentDefaultModel', 'agentPresets', 'llm', 'permissionPresets']

/** Plugin config: Tuitui credentials, access control, agent route, and tree options. */
export interface TuituiConfig {
  /** Tuitui application id. */
  appId?: string
  /** Tuitui application secret. */
  appSecret?: string
  /** Tuitui IM server host. */
  host?: string
  /** Agent working directory; empty uses the process cwd. */
  cwd?: string
  /** Agent preset id; empty uses the deployment default preset. */
  agentPreset?: string
  /** Permission preset id; empty uses the deployment default permission preset. */
  permissionPreset?: string
  /** Optional explicit provider route override. */
  provider?: string
  /** Optional explicit model override. */
  model?: string
  /** Tuitui accounts allowed to DM the bot; `*` allows all. */
  allowFrom?: string[]
  /** Group / team ids allowed to use the bot. */
  groupAllowFrom?: string[]
  /** Require an @-mention in groups and channels. */
  requireMention?: boolean
  /** React to inbound messages with an emoji. */
  emojiReaction?: boolean
  /** Reaction emoji text. */
  reactionEmoji?: string
  /** Send a "thinking" placeholder while the agent runs. */
  showThinking?: boolean
  /** Data directory for per-chat cwd and tree-card persistence. */
  dataDir?: string
  /** Enable the /tree file-tree workbench. */
  treeEnabled?: boolean
  /** Entries per tree page. */
  treePageSize?: number
  /** Show hidden files in tree listings. */
  treeShowHidden?: boolean
  /** Extra names to hide in tree listings (added to the built-in ignore set). */
  treeIgnore?: string[]
  /** Allow rename / delete / copy through the tree card (always confirmed). */
  treeAllowWrite?: boolean
  /** Persist tree-card bindings so /tree resumes the same message after restart. */
  treePersist?: boolean
  /** Runtime-only transport override for tests; production uses the WebSocket client. */
  transport?: TuituiTransport
}

export const Config: Schema<TuituiConfig> = Schema.object({
  appId: Schema.string(),
  appSecret: Schema.string().role('secret'),
  host: Schema.string(),
  cwd: Schema.string(),
  agentPreset: Schema.string(),
  permissionPreset: Schema.string(),
  provider: Schema.string(),
  model: Schema.string(),
  allowFrom: Schema.array(Schema.string()).default([]),
  groupAllowFrom: Schema.array(Schema.string()).default([]),
  requireMention: Schema.boolean().default(true),
  emojiReaction: Schema.boolean().default(true),
  reactionEmoji: Schema.string().default('收到'),
  showThinking: Schema.boolean().default(true),
  dataDir: Schema.string().default('~/.dsh-tuitui'),
  treeEnabled: Schema.boolean().default(true),
  treePageSize: Schema.natural().min(1).max(12).default(5),
  treeShowHidden: Schema.boolean().default(false),
  treeIgnore: Schema.array(Schema.string()).default([]),
  treeAllowWrite: Schema.boolean().default(true),
  treePersist: Schema.boolean().default(true),
})

/** One chat's live Agent session and its in-flight reply state. */
interface ChatSession {
  readonly chatId: string
  readonly sessionId: SessionId
  readonly agent: Agent
  readonly handle: AgentHandle
  readonly cwd: string
  readonly selection: ModelSelectionRef
  busy: boolean
  awaitingTurnStart: boolean
  activeTurn: number | null
  accumulated: string[]
}

/** Send one message from a slash command or agent reply. */
interface ResolvedConfig {
  readonly appId: string
  readonly appSecret: string
  readonly host: string
  readonly cwd: string
  readonly dataDir: string
  readonly requireMention: boolean
  readonly allowFrom: string[]
  readonly groupAllowFrom: string[]
  readonly emojiReaction: boolean
  readonly reactionEmoji: string
  readonly showThinking: boolean
  readonly agentPreset: string | undefined
  readonly permissionPreset: string
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly treeEnabled: boolean
  readonly treeAllowWrite: boolean
  readonly treePersist: boolean
  readonly treeConfig: { pageSize: number; showHidden: boolean; ignore: Set<string> }
}

export function apply(ctx: Context, config: TuituiConfig): void {
  // The live settings section once the settings provider attaches, and the
  // composition entry before/without one.
  let current: () => TuituiConfig = () => config
  // The bridge, its transport, and the config they were built from. The
  // previous resolved value decides whether an identity change reconnects.
  let bridge: TuituiBridge | undefined
  let transport: TuituiTransport | undefined
  let resolved: ResolvedConfig | undefined

  // The transport seam stays runtime-only: tests inject `config.transport`,
  // production builds a real client from the resolved credentials and host.
  const buildTransport = (next: ResolvedConfig): TuituiTransport =>
    config.transport ?? new TuituiClient(next.appId, next.appSecret, next.host)

  const wire = (nextTransport: TuituiTransport, nextBridge: TuituiBridge): void => {
    nextTransport.onMessage((message) => { void nextBridge.handleMessage(message) })
    nextTransport.onCallback((callback) => { void nextBridge.handleCallback(callback) })
    void nextTransport.connect().catch((error: unknown) => {
      ctx.logger.warn(`tuitui connect failed: ${errorChain(error)}`)
    })
  }

  const applyResolved = (next: ResolvedConfig): void => {
    const identityChanged = resolved !== undefined && (
      next.appId !== resolved.appId || next.appSecret !== resolved.appSecret || next.host !== resolved.host
    )
    resolved = next
    if (bridge === undefined || transport === undefined) {
      const nextTransport = buildTransport(next)
      bridge = new TuituiBridge(ctx, next, nextTransport)
      transport = nextTransport
      wire(nextTransport, bridge)
      return
    }
    if (identityChanged) {
      const nextTransport = buildTransport(next)
      void transport.disconnect()
      bridge.reconfigure(next, nextTransport)
      transport = nextTransport
      wire(nextTransport, bridge)
    } else {
      bridge.reconfigure(next)
    }
  }

  // An unconfigured plugin still serves its settings namespace so the GUI card
  // can collect appId/appSecret/host; it builds a transport and connects only
  // once all three resolve.
  if (config.appId && config.appSecret && config.host) {
    applyResolved(resolveConfig(config, config.appId, config.appSecret))
  } else {
    ctx.logger.info('dsh-tuitui: appId, appSecret, and host are not configured — set them in Settings → Plugins → Plugin configuration to start the bridge')
  }

  ctx.on('session/event', (session, event) => {
    bridge?.onSessionEvent(session, event)
  })
  ctx.effect(() => () => {
    void bridge?.dispose()
  }, 'tuitui.lifecycle()')

  ctx.inject(['settings'], (settingsCtx) => {
    // The runtime-only transport never belongs in the section: the provider
    // resolves and deep-freezes the base, so a function-bearing value would
    // break `describe` and freeze an injected stub.
    const { transport: _transport, ...base } = config
    settingsCtx.settings.installSection(ctx, 'tuitui', Config, base, {
      setSource: (source) => { current = source },
      onChange: () => {
        const section = current()
        let next: ResolvedConfig
        try {
          next = resolveConfig(section, section.appId ?? '', section.appSecret ?? '')
        } catch (error: unknown) {
          ctx.logger.warn(`tuitui config did not resolve: ${errorChain(error)}`)
          return
        }
        applyResolved(next)
      },
    })
  })
}

function resolveConfig(config: TuituiConfig, appId: string, appSecret: string): ResolvedConfig {
  const host = config.host ?? ''
  if (!host) throw new Error('dsh-tuitui: host is required')
  const cwd = resolveCwd(config.cwd ?? '')
  const dataDir = expandHome(config.dataDir ?? '~/.dsh-tuitui')
  mkdirSync(dataDir, { recursive: true })
  return {
    appId,
    appSecret,
    host,
    cwd,
    dataDir,
    requireMention: config.requireMention ?? true,
    allowFrom: config.allowFrom ?? [],
    groupAllowFrom: config.groupAllowFrom ?? [],
    emojiReaction: config.emojiReaction ?? true,
    reactionEmoji: config.reactionEmoji ?? '收到',
    showThinking: config.showThinking ?? true,
    agentPreset: config.agentPreset || undefined,
    permissionPreset: config.permissionPreset || '',
    provider: config.provider || undefined,
    model: config.model || undefined,
    treeEnabled: config.treeEnabled ?? true,
    treeAllowWrite: config.treeAllowWrite ?? true,
    treePersist: config.treePersist ?? true,
    treeConfig: {
      pageSize: Math.max(1, config.treePageSize ?? 5),
      showHidden: config.treeShowHidden ?? false,
      ignore: new Set([...DEFAULT_IGNORE, ...(config.treeIgnore ?? [])]),
    },
  }
}

function resolveCwd(raw: string): string {
  const base = process.cwd()
  let p = raw.trim()
  if (!p) return base
  p = expandHome(p)
  if (!isAbsolute(p)) p = join(base, p)
  if (!existsSync(p) || !statSync(p).isDirectory()) {
    throw new Error(`dsh-tuitui: cwd is not a directory: ${p}`)
  }
  return p
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

class TuituiBridge {
  private readonly sessions = new Map<SessionId, ChatSession>()
  private readonly chatToSession = new Map<string, SessionId>()
  private readonly treeCards = new Map<string, TreeWorkspace>()
  private readonly chatActiveTree = new Map<string, string>()
  private readonly workspaceStore: WorkspaceStore
  private readonly treeStore: TreeCardStore | undefined
  private readonly owner = new AbortController()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private config: ResolvedConfig,
    private transport: TuituiTransport,
  ) {
    this.workspaceStore = new WorkspaceStore(join(config.dataDir, 'workspaces.json'))
    this.treeStore = config.treePersist ? new TreeCardStore(join(config.dataDir, 'tree_cards.json')) : undefined
    if (this.treeStore) {
      for (const [msgid, data] of Object.entries(this.treeStore.loadAll())) {
        const chatId = asString(data['chat_id'])
        if (!chatId) continue
        const ws = TreeWorkspace.fromDict(chatId, data, config.treeConfig)
        if (ws.msgid) this.treeCards.set(msgid, ws)
        if (ws.active) this.chatActiveTree.set(chatId, ws.msgid)
      }
    }
  }

  /**
   * Adopt a freshly resolved config, and a replacement transport when the
   * credentials or host changed. Behavioral fields then govern subsequent
   * messages; the tree workbench and chat sessions carry over unchanged.
   * @param next - the next resolved config.
   * @param nextTransport - replacement transport on an identity change.
   */
  reconfigure(next: ResolvedConfig, nextTransport?: TuituiTransport): void {
    this.config = next
    if (nextTransport !== undefined) this.transport = nextTransport
  }

  /**
   * Resolve the model route for a new chat session. An explicit card route must
   * name a registered provider; a card that sets neither falls back to the
   * deployment default, because an absent `options.model` fails strict persona
   * templates that reference `{{model}}`.
   * @returns the provider and model for the new Agent.
   */
  private async resolveAgentOptions(): Promise<{ provider: string; model: string }> {
    const provider = this.config.provider
    const model = this.config.model
    if (provider === undefined && model === undefined) {
      const selected = this.ctx.agentDefaultModel.currentSelection()
      return { provider: selected.provider, model: selected.model }
    }
    if (provider === undefined || model === undefined) {
      throw new Error('tuitui: set both "provider" and "model", or leave both empty to use the deployment default')
    }
    const known = this.ctx.llm.listProviders()
    if (!known.some(entry => entry.id === provider)) {
      const byName = known.find(entry => entry.name === provider)
      const suggestion = byName === undefined ? '' : ` — did you mean "${byName.id}"?`
      const listed = known.map(entry => entry.name === entry.id ? entry.id : `${entry.id} (${entry.name})`).join(', ')
      throw new Error(
        `tuitui: provider "${provider}" is not registered${suggestion}; registered providers: ${listed || '(none)'}`,
      )
    }
    let catalog: readonly { id: string; name: string }[]
    try {
      catalog = await this.ctx.llm.listModels(provider)
    } catch {
      // A route that cannot list its catalog is left to the request, which
      // reports the unknown model itself.
      return { provider, model }
    }
    if (catalog.length === 0 || catalog.some(entry => entry.id === model)) return { provider, model }
    const byName = catalog.find(entry => entry.name === model)
    const suggestion = byName === undefined ? '' : ` — did you mean "${byName.id}"?`
    throw new Error(
      `tuitui: provider "${provider}" has no model "${model}"${suggestion}`
      + `; configured models: ${catalog.map(entry => entry.id).join(', ')}`,
    )
  }

  /** Dispose and forget every chat session, keeping the bridge itself live. */
  private async disposeSessions(): Promise<void> {
    const chats = [...this.sessions.values()]
    this.sessions.clear()
    this.chatToSession.clear()
    await Promise.allSettled(chats.map(chat => chat.handle.dispose()))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.owner.abort(new Error('dsh-tuitui disposed'))
    await this.transport.disconnect()
    await this.disposeSessions()
  }

  // -- inbound routing -----------------------------------------------------

  async handleMessage(msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim()
    if (!text) return
    if (text.startsWith('/')) {
      if (!this.isAllowed(msg)) return
      if (await this.handleCommand(msg, text)) return
    }
    await this.handleAgentMessage(msg)
  }

  async handleAgentMessage(msg: IncomingMessage): Promise<void> {
    if ((msg.chatType === 'group' || msg.chatType === 'channel') && this.config.requireMention && !atMe(msg)) return
    if (!this.isAllowed(msg)) return
    if (this.config.emojiReaction) void this.transport.sendReaction(msg.chatId, msg.messageId, this.config.reactionEmoji)

    let chat: ChatSession
    try {
      chat = await this.getOrCreateChat(msg.chatId)
      // The card owns the route for its chats. Re-resolving per message is what
      // carries a saved change into a Session that already recorded a route.
      chat.selection.current = await this.resolveAgentOptions()
    } catch (error: unknown) {
      // A route the card misconfigured fails here, before any turn exists.
      await this.transport.sendMessage(msg.chatId, `[错误] ${errorChain(error)}`)
      return
    }
    if (chat.busy) {
      await this.transport.sendMessage(msg.chatId, '上一条还在处理中，请稍等。发送 /new 可中断当前任务。')
      return
    }
    chat.busy = true
    chat.awaitingTurnStart = true
    chat.activeTurn = null
    chat.accumulated = []
    if (this.config.showThinking) void this.transport.sendMessage(msg.chatId, '正在思考...')
    try {
      chat.agent.followup(createUserMessage({
        content: [{ type: 'text', text: msg.text }],
        source: { kind: 'tuitui', chatId: msg.chatId, chatType: msg.chatType, senderId: msg.userId, senderName: msg.userName },
      }))
    } catch (error: unknown) {
      chat.busy = false
      chat.awaitingTurnStart = false
      await this.transport.sendMessage(msg.chatId, `[错误] ${errorChain(error)}`)
    }
  }

  async handleCommand(msg: IncomingMessage, text: string): Promise<boolean> {
    const [rawCmd, args] = splitCommand(text)
    const cmd = rawCmd.toLowerCase()

    if (cmd === 'new') {
      await this.resetSession(msg.chatId)
      await this.transport.sendMessage(msg.chatId, '已重置会话。文件树工作台不受影响，可继续使用。')
      return true
    }
    if (cmd === 'help') {
      await this.transport.sendMessage(msg.chatId, [
        'DSH 推推桥命令：',
        '/new — 重置当前会话',
        '/cd <路径> — 切换工作目录（如 /cd ~/app，支持相对路径）',
        '/pwd — 显示当前工作目录',
        '/tree [路径] — 打开文件树工作台，默认当前目录',
        '/help — 显示帮助',
        '/status — 显示当前状态',
        '',
        `工作目录: ${this.cwdFor(msg.chatId)}`,
      ].join('\n'))
      return true
    }
    if (cmd === 'status') {
      const sessionId = this.chatToSession.get(msg.chatId)
      const chat = sessionId ? this.sessions.get(sessionId) : undefined
      const status = [
        `工作目录: ${this.cwdFor(msg.chatId)}`,
        `会话: ${chat ? chat.sessionId : '（无会话）'}`,
        `状态: ${chat?.busy ? '忙碌' : '空闲'}`,
      ].join('\n')
      await this.transport.sendMessage(msg.chatId, status)
      return true
    }
    if (cmd === 'cd') {
      await this.handleCdCommand(msg, args)
      return true
    }
    if (cmd === 'tree') {
      await this.handleTreeCommand(msg, args)
      return true
    }
    if (cmd === 'pwd') {
      await this.transport.sendMessage(msg.chatId, `当前工作目录：${this.cwdFor(msg.chatId)}`)
      return true
    }

    // Unknown command: fall through to the agent as ordinary text.
    return false
  }

  async handleCdCommand(msg: IncomingMessage, args: string): Promise<void> {
    const arg = args.trim()
    if (!arg) {
      await this.transport.sendMessage(msg.chatId, '用法：/cd <路径>（绝对路径、~/xxx 或相对路径）')
      return
    }
    const path = resolvePath(this.cwdFor(msg.chatId), arg)
    if (!path || !isDir(path)) {
      await this.transport.sendMessage(msg.chatId, `目录不存在：${arg}`)
      return
    }
    await this.resetSession(msg.chatId)
    this.workspaceStore.setCwd(msg.chatId, path)
    const ws = this.activeWorkspace(msg.chatId)
    if (ws) {
      ws.root = path
      ws.path = path
      ws.page = 1
      ws.query = ''
      ws.focus = ''
      ws.view = VIEW_LIST
      await this.sendOrUpdateCard(ws)
    }
    await this.transport.sendMessage(msg.chatId, `已切换工作目录到：${path}\n（会话已重置）`)
  }

  // -- session lifecycle ---------------------------------------------------

  async getOrCreateChat(chatId: string): Promise<ChatSession> {
    const existingId = this.chatToSession.get(chatId)
    if (existingId) {
      const existing = this.sessions.get(existingId)
      if (existing) return existing
    }
    const cwd = this.cwdFor(chatId)
    const sessionId = brandString<SessionId>(`tuitui-${randomUUID()}`)
    const preset = await this.ctx.agentPresets.resolve(this.config.agentPreset)
    await this.ctx.agentPresets.standingKeyFor(preset.id)
    const permissionPreset = this.config.permissionPreset || this.ctx.permissionPresets.defaultPreset
    this.ctx.permissionPresets.resolve(permissionPreset)
    const agentOptions = await this.resolveAgentOptions()
    // A Session keeps the route it recorded, so creation options alone cannot
    // move a resumed chat off it; the selection ref is the live override.
    const selection: ModelSelectionRef = { current: agentOptions, assembled: undefined }
    const handle = await this.ctx.agents.create({
      sessionId,
      signal: this.owner.signal,
      meta: { cwd, agentPreset: preset.id },
      agentOptions,
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
        installModelSelection(agentCtx, selection)
      },
    })
    this.ctx.permissionPresets.set(handle.agent.session, permissionPreset)
    // An IM chat has no interactive answerer: a `'ask'` request would hold the
    // turn open until someone answered a prompt nobody can see, so every later
    // message would be told the chat is still busy. Rejecting deterministically
    // ends the turn with a denial the model can adapt to, and the approval
    // plugin states that stance in the system prompt.
    setApprovalPolicy(handle.agent.session, 'never')
    const chat: ChatSession = {
      chatId,
      sessionId,
      agent: handle.agent,
      handle,
      cwd,
      selection,
      busy: false,
      awaitingTurnStart: false,
      activeTurn: null,
      accumulated: [],
    }
    this.sessions.set(sessionId, chat)
    this.chatToSession.set(chatId, sessionId)
    return chat
  }

  async resetSession(chatId: string): Promise<void> {
    const sessionId = this.chatToSession.get(chatId)
    if (sessionId) {
      const chat = this.sessions.get(sessionId)
      if (chat) {
        try {
          await chat.handle.dispose()
        } catch (error: unknown) {
          this.ctx.logger.warn(`tuitui session disposal failed: ${errorChain(error)}`)
        }
        this.sessions.delete(sessionId)
      }
      this.chatToSession.delete(chatId)
    }
  }

  onSessionEvent(session: Session, event: SessionEvent): void {
    const chat = this.sessions.get(session.header.id)
    if (!chat) return
    if (event.type === 'turn/start' && chat.awaitingTurnStart) {
      chat.awaitingTurnStart = false
      chat.activeTurn = event.data.turn
    } else if (event.type === 'assistant/message' && chat.activeTurn !== null && event.data.turn === chat.activeTurn) {
      for (const block of event.data.message.content) {
        if (block.type === 'text') chat.accumulated.push(block.text)
      }
    } else if (event.type === 'turn/end' && chat.activeTurn !== null && event.data.turn === chat.activeTurn) {
      void this.finishTurn(chat, event.data.reason)
    }
  }

  async finishTurn(chat: ChatSession, reason: TurnEndReason): Promise<void> {
    const reply = chat.accumulated.join('').trim()
    chat.activeTurn = null
    chat.busy = false
    chat.accumulated = []
    if (reason.kind === 'error' && !reply) {
      await this.transport.sendMessage(chat.chatId, `[错误] ${reason.error.message}`)
      return
    }
    if (reply) await this.transport.sendMessage(chat.chatId, reply)
  }

  // -- access control and cwd ----------------------------------------------

  cwdFor(chatId: string): string {
    return this.workspaceStore.cwdFor(chatId) || this.config.cwd
  }

  isAllowed(msg: IncomingMessage): boolean {
    if (msg.chatType === 'dm') {
      return this.config.allowFrom.includes('*') || this.config.allowFrom.includes(msg.userId)
    }
    return this.config.groupAllowFrom.includes('*') || this.config.groupAllowFrom.includes(msg.chatId)
  }

  // -- file-tree workbench --------------------------------------------------

  activeWorkspace(chatId: string): TreeWorkspace | undefined {
    const msgid = this.chatActiveTree.get(chatId)
    if (!msgid) return undefined
    const ws = this.treeCards.get(msgid)
    return ws && ws.active ? ws : undefined
  }

  async handleTreeCommand(msg: IncomingMessage, args: string): Promise<void> {
    if (!this.config.treeEnabled) {
      await this.transport.sendMessage(msg.chatId, '文件树未启用（配置 treeEnabled=false）。')
      return
    }
    const arg = args.trim()
    if (['off', '关闭', 'close', 'exit'].includes(arg)) {
      const ws = this.activeWorkspace(msg.chatId)
      if (ws) {
        ws.active = false
        ws.pending = null
        ws.view = VIEW_CLOSED
        await this.sendOrUpdateCard(ws)
        this.chatActiveTree.delete(msg.chatId)
      } else {
        await this.transport.sendMessage(msg.chatId, '文件树当前未开启。发送 /tree 开启。')
      }
      return
    }
    const base = this.cwdFor(msg.chatId)
    let path = base
    if (arg) {
      const resolved = resolvePath(base, arg)
      if (!resolved || !existsSync(resolved)) {
        await this.transport.sendMessage(msg.chatId, `路径不存在：${arg}`)
        return
      }
      path = resolved
    }
    const ws = new TreeWorkspace(msg.chatId, '', this.config.treeConfig)
    ws.root = isDir(path) ? path : dirname(path)
    ws.active = true
    ws.pending = null
    ws.query = ''
    if (isDir(path)) {
      ws.path = path
      ws.focus = ''
      ws.view = VIEW_LIST
      ws.page = 1
    } else {
      ws.path = dirname(path)
      ws.focus = path
      ws.view = VIEW_FOCUS
      ws.page = 1
    }
    await this.sendOrUpdateCard(ws, true)
    if (!ws.msgid) return
    this.treeCards.set(ws.msgid, ws)
    this.chatActiveTree.set(msg.chatId, ws.msgid)
    this.persistTree()
  }

  async handleCallback(cb: IncomingCallback): Promise<void> {
    const ws = this.treeCards.get(cb.messageId)
    if (!ws) return
    if (!this.isAllowed({ chatId: cb.chatId, chatType: cb.chatType, chatName: '', userId: cb.userId, userName: cb.userName, messageId: cb.messageId, text: '', mediaUrls: [], raw: cb.raw })) return

    let val: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(cb.actionValue) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) val = parsed as Record<string, unknown>
    } catch {
      // Non-JSON action value falls back to the raw string below.
    }
    if (Object.keys(val).length === 0) val = { t: cb.actionValue }

    if (ws.active) this.chatActiveTree.set(cb.chatId, ws.msgid)
    if (!ws.active && val['t'] !== 'reopen') return
    if (ws.busy) return
    ws.busy = true
    try {
      if (val['t'] === 'submit') {
        const text = (cb.fieldsText || '').trim()
        if (!text) {
          ws.view = VIEW_HINT
          ws.message = '输入框为空。请输入文件树操作，如：打开 src。'
          await this.sendOrUpdateCard(ws)
          return
        }
        await this.applyTreeText(ws, text)
        return
      }
      const intent = intentFromAction(val)
      if (!intent) return
      await this.applyTreeIntent(ws, intent)
    } finally {
      ws.busy = false
    }
  }

  async applyTreeText(ws: TreeWorkspace, text: string): Promise<void> {
    let intent = parseIntent(text, ws.path, ws.focus)
    if (!intent) {
      const rawN = text.trim().replace(/[.、)．。]$/, '')
      if (/^\d+$/.test(rawN)) {
        const n = Number(rawN)
        const entries = ws.pageEntries()
        if (n >= 1 && n <= entries.length) {
          const e = entries[n - 1]
          if (e) intent = { kind: e.isDir ? 'enter' : 'focus', path: e.path, target: '', page: 0, query: '', text: '', desc: '', needsConfirm: false }
        }
      }
    }
    if (!intent && ws.pending && ws.pending.kind === 'rename' && !ws.pending.target && isBareName(text)) {
      const target = resolvePath(ws.path, text, false)
      if (target) {
        intent = { kind: 'rename', path: ws.pending.path, target, page: 0, query: '', text: '', desc: `重命名 ${basename(ws.pending.path)} → ${text}`, needsConfirm: true }
      }
    }
    if (!intent) {
      ws.view = VIEW_HINT
      ws.message = '无法识别为文件树操作。试试：打开 src、查看 README.md、复制 config.yaml 为 a.yaml、删除 tmp、搜索 server、第 2 页。'
      await this.sendOrUpdateCard(ws)
      return
    }
    await this.applyTreeIntent(ws, intent)
  }

  async applyTreeIntent(ws: TreeWorkspace, intent: Intent): Promise<void> {
    const kind = intent.kind
    if (kind === 'close') {
      ws.active = false
      ws.pending = null
      ws.view = VIEW_CLOSED
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'reopen') {
      ws.active = true
      ws.pending = null
      ws.view = VIEW_LIST
      ws.page = 1
      this.chatActiveTree.set(ws.chatId, ws.msgid)
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'confirm') {
      await this.confirmPending(ws)
      return
    }
    if (kind === 'cancel') {
      ws.pending = null
      ws.view = VIEW_LIST
      ws.message = ''
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'back') {
      ws.view = VIEW_LIST
      ws.focus = ''
      ws.pending = null
      ws.message = ''
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'back_focus') {
      ws.view = VIEW_FOCUS
      ws.pending = null
      ws.message = ''
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'refresh') {
      ws.view = VIEW_LIST
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'page') {
      if (intent.page === -1) ws.page = Math.max(1, ws.page - 1)
      else if (intent.page === -2) ws.page = Math.min(ws.totalPages, ws.page + 1)
      else ws.page = Math.max(1, Math.min(intent.page, ws.totalPages))
      ws.view = VIEW_LIST
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'up') {
      const parent = dirname(ws.path)
      if (parent !== ws.path && isDir(parent)) {
        ws.path = parent
        ws.page = 1
        ws.query = ''
        ws.view = VIEW_LIST
      }
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'root') {
      ws.path = ws.root
      ws.page = 1
      ws.query = ''
      ws.view = VIEW_LIST
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'search') {
      ws.query = intent.query
      ws.page = 1
      ws.view = VIEW_LIST
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'enter' || kind === 'focus') {
      if (isDir(intent.path)) {
        ws.path = intent.path
        ws.page = 1
        ws.query = ''
        ws.view = VIEW_LIST
      } else {
        ws.focus = intent.path
        ws.view = VIEW_FOCUS
      }
      ws.pending = null
      await this.sendOrUpdateCard(ws)
      return
    }
    if (kind === 'copy_name') {
      const name = basename(intent.path)
      ws.view = VIEW_RESULT
      ws.message = `已复制文件名：${name}（上方已发送一条文本，请长按复制）`
      await this.sendOrUpdateCard(ws)
      await this.transport.sendMessage(ws.chatId, name)
      return
    }
    if (kind === 'preview_full') {
      const content = readTextFile(intent.path)
      if (content === null) {
        ws.view = VIEW_ERROR
        ws.message = `无法读取：${intent.path}`
        await this.sendOrUpdateCard(ws)
        return
      }
      ws.view = VIEW_RESULT
      const size = lstatSafe(intent.path)?.size ?? 0
      ws.message = `文件内容已发送（${formatSize(size)}）`
      await this.sendOrUpdateCard(ws)
      await this.transport.sendMessage(ws.chatId, content)
      return
    }
    if (CONFIRM_KINDS.has(kind)) {
      if (['copy', 'rename', 'delete'].includes(kind) && !this.config.treeAllowWrite) {
        ws.view = VIEW_ERROR
        ws.message = '写操作未启用（配置 treeAllowWrite=false）。'
        await this.sendOrUpdateCard(ws)
        return
      }
      ws.pending = intent
      ws.view = VIEW_CONFIRM
      ws.message = ''
      await this.sendOrUpdateCard(ws)
      return
    }
    ws.view = VIEW_HINT
    ws.message = `未支持的操作：${kind}`
    await this.sendOrUpdateCard(ws)
  }

  async confirmPending(ws: TreeWorkspace): Promise<void> {
    const intent = ws.pending
    if (!intent) return
    if (intent.kind === 'rename' && !intent.target) {
      ws.pending = null
      ws.view = VIEW_ERROR
      ws.message = '❌ 缺少新名称。请在输入框输入新名称后点「提交」，例如：main2.py'
      await this.sendOrUpdateCard(ws)
      return
    }
    ws.pending = null
    if (intent.kind === 'set_cwd') {
      await this.resetSession(ws.chatId)
      this.workspaceStore.setCwd(ws.chatId, intent.path)
      ws.root = intent.path
      ws.path = intent.path
      ws.focus = ''
      ws.page = 1
      ws.view = VIEW_RESULT
      ws.message = `✅ 已切换工作目录到 ${intent.path}（会话已重置）`
      await this.sendOrUpdateCard(ws)
      return
    }
    try {
      const message = execIntent(intent)
      ws.view = VIEW_RESULT
      ws.message = `✅ ${message}`
    } catch (error: unknown) {
      ws.view = VIEW_ERROR
      ws.message = `❌ 执行失败：${errorChain(error)}`
    }
    await this.sendOrUpdateCard(ws)
  }

  async sendOrUpdateCard(ws: TreeWorkspace, forceNew = false): Promise<void> {
    const payload = ws.render()
    let updated = false
    if (ws.msgid && !forceNew) updated = await this.transport.updateInteractive(ws.chatId, ws.msgid, payload)
    if (!updated) {
      const newId = await this.transport.sendInteractive(ws.chatId, payload)
      if (newId) {
        ws.msgid = newId
      } else {
        await this.transport.sendMessage(ws.chatId, '❌ 文件树卡片发送失败，请稍后重试或重新发送 /tree。')
        return
      }
    }
    this.persistTree()
  }

  persistTree(): void {
    if (!this.treeStore) return
    this.treeStore.saveAll(this.treeCards)
  }
}

function splitCommand(text: string): [string, string] {
  const body = text.slice(1)
  const space = body.search(/\s/)
  if (space === -1) return [body, '']
  return [body.slice(0, space), body.slice(space + 1)]
}

function atMe(msg: IncomingMessage): boolean {
  const data = msg.raw['data'] as Record<string, unknown> | undefined
  return data?.['at_me'] === true || data?.['at_me'] === 1
}

function isBareName(text: string): boolean {
  const t = text.trim()
  return Boolean(t) && !t.includes('/') && !t.includes('\\') && !t.includes(' ')
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Unstatable path is not a directory.
    return false
  }
}

function lstatSafe(path: string): { size: number } | undefined {
  try {
    return statSync(path)
  } catch {
    // Unstatable path has no size.
    return undefined
  }
}

function readTextFile(path: string, maxBytes = 100_000): string | null {
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch {
    // Unreadable or missing file returns null.
    return null
  }
  let text = raw.subarray(0, maxBytes).toString('utf8')
  if (raw.length > maxBytes) text += '\n…(文件过大，已截断)'
  return text
}

function intentFromAction(val: Record<string, unknown>): Intent | null {
  const t = asString(val['t'])
  const p = asString(val['p'])
  const mk = (kind: string, extra: Partial<Intent> = {}): Intent => ({ kind, path: '', target: '', page: 0, query: '', text: '', desc: '', needsConfirm: false, ...extra })
  if (t === 'go') {
    if (p && isDir(p)) return mk('enter', { path: p })
    if (p && lstatSafe(p) && !isDir(p)) return mk('focus', { path: p })
    return null
  }
  if (t === 'up') return mk('up')
  if (t === 'root') return mk('root')
  if (t === 'page') return mk('page', { page: Number(val['n'] ?? 1) || 1 })
  if (t === 'refresh') return mk('refresh')
  if (t === 'close') return mk('close')
  if (t === 'reopen') return mk('reopen')
  if (t === 'back') return mk('back')
  if (t === 'back_focus') return mk('back_focus')
  if (t === 'confirm') return mk('confirm')
  if (t === 'cancel') return mk('cancel')
  if (t === 'copy_name' && p) return mk('copy_name', { path: p })
  if (t === 'preview_full' && p) return mk('preview_full', { path: p })
  if (t === 'rename' && p) return mk('rename', { path: p, needsConfirm: true, desc: `重命名 ${basename(p)} → ？(在输入框输入新名称后提交)` })
  if (t === 'delete' && p) return mk('delete', { path: p, needsConfirm: true, desc: `删除 ${p}` })
  if (t === 'set_cwd' && p) return mk('set_cwd', { path: p, needsConfirm: true, desc: `切换 agent 工作目录到 ${p}（会重置会话）` })
  return null
}

/** Execute a confirmed file-tree intent and return a human result message. */
function execIntent(intent: Intent): string {
  if (intent.kind === 'copy') {
    let dst = intent.target
    const src = intent.path
    if (isDir(dst)) dst = join(dst, basename(src))
    mkdirSync(dirname(dst), { recursive: true })
    if (isDir(src)) cpSync(src, dst, { recursive: true })
    else copyFileSync(src, dst)
    return `已复制 ${basename(src)} → ${dst}`
  }
  if (intent.kind === 'rename') {
    renameSync(intent.path, intent.target)
    return `已重命名 → ${basename(intent.target)}`
  }
  if (intent.kind === 'delete') {
    if (isDir(intent.path)) rmSync(intent.path, { recursive: true, force: true })
    else rmSync(intent.path, { force: true })
    return `已删除 ${intent.path}`
  }
  throw new Error(`unknown intent kind: ${intent.kind}`)
}

/**
 * Real Tuitui transport: WebSocket receiver plus HTTP sender.
 *
 * Receives on `wss://{host}:8282/robot/callback/ws?auth={app_id}.{app_secret}`,
 * sends through `POST https://{host}:8282/robot{path}?appid={app_id}&secret={app_secret}`.
 * Ported from `tui_coding_agent_bridge/bridge/tuitui_client.py`.
 */
import type { ChatType, IncomingCallback, IncomingMessage, TuituiTransport } from './types.ts'
import { asArray, asNumber, asRecord, asString } from './parse.ts'

const RECONNECT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000]
const DEFAULT_MAX_MESSAGE_LENGTH = 20_000
const MAX_DEDUP_EVENTS = 2_000

/**
 * Classify a Tuitui conversation id into its conversation scope.
 * @param chatId - the Tuitui conversation id (a user account, 16-digit group id, or `teams_` thread).
 * @returns `'channel'` for teams threads, `'group'` for 16-digit ids, else `'dm'`.
 */
export function guessChatType(chatId: string): ChatType {
  if (chatId.startsWith('teams_')) return 'channel'
  if (/^\d{16}$/.test(chatId)) return 'group'
  return 'dm'
}

/**
 * Split one long message into chunks, preferring paragraph and code-fence boundaries.
 * @param content - the full message text.
 * @param maxLength - the per-chunk byte/codepoint budget.
 * @returns the message split into at least one chunk.
 */
export function splitMessage(content: string, maxLength = DEFAULT_MAX_MESSAGE_LENGTH): string[] {
  if (content.length <= maxLength) return [content]
  const chunks: string[] = []
  let remaining = content
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf('\n\n', maxLength)
    if (cut === -1) cut = remaining.lastIndexOf('\n', maxLength)
    if (cut === -1) cut = maxLength
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).replace(/^\n+/, '')
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

/** Normalize one inbound message body's text and media URLs by its `msg_type`. */
function parseMessageBody(data: Record<string, unknown>): { text: string; mediaUrls: string[] } {
  const msgType = asString(data['msg_type'])
  const images = asStringArray(data['images'])
  switch (msgType) {
    case 'mixed': {
      const text = asString(data['text'])
      return { text: text || images.map(() => '[图片]').join('\n'), mediaUrls: images }
    }
    case 'image':
      return { text: images.map(url => `[图片] ${url}`).join('\n'), mediaUrls: images }
    case 'voice': {
      const url = asString(data['voice'])
      return { text: url ? `[语音] ${url}` : '[语音]', mediaUrls: url ? [url] : [] }
    }
    case 'video': {
      const url = asString(data['video'])
      return { text: url ? `[视频] ${url}` : '[视频]', mediaUrls: url ? [url] : [] }
    }
    case 'file': {
      const file = asRecord(data['file'])
      const url = asString(file?.['url'])
      const name = asString(file?.['name']) || 'unknown'
      return { text: url ? `[文件] ${name} : ${url}` : `[文件] ${name}`, mediaUrls: url ? [url] : [] }
    }
    case 'link': {
      const link = asRecord(data['link'])
      return { text: `[网页链接]\n${asString(link?.['title'])}\n${asString(link?.['url'])}`, mediaUrls: [] }
    }
    case 'text':
    default:
      return { text: asString(data['text']), mediaUrls: [] }
  }
}

/**
 * Parse one inbound event body into a normalized message, or null for unsupported events.
 * @param eventType - the Tuitui event kind (`single_chat`, `group_chat`, `teams_post_create`, `teams_post_modify`).
 * @param body - the raw event body.
 * @returns a normalized `IncomingMessage`, or `null` for keepalive/unsupported events.
 */
export function parseEvent(
  eventType: string,
  body: Record<string, unknown>,
): IncomingMessage | null {
  const msgData = asRecord(body['data']) ?? {}
  const userAccount = asString(body['user_account'])
  const userName = asString(body['user_name'])

  let chatId: string
  let chatType: ChatType
  let chatName: string
  let text: string
  let mediaUrls: string[]

  if (eventType === 'single_chat') {
    chatId = userAccount
    chatType = 'dm'
    chatName = userName
  } else if (eventType === 'group_chat') {
    chatId = asString(msgData['group_id'])
    chatType = 'group'
    chatName = asString(msgData['group_name'])
  } else if (eventType === 'teams_post_create' || eventType === 'teams_post_modify') {
    const teamId = asString(msgData['team_id'])
    const channelId = asString(msgData['channel_id'])
    const postId = asString(msgData['post_id'])
    const parentId = asString(msgData['parent_id'])
    const threadId = parentId && parentId !== '0' ? parentId : postId
    chatId = `teams_${teamId}_${channelId}${threadId ? `_${threadId}` : ''}`
    chatType = 'channel'
    chatName = asString(msgData['channel_name'])
  } else {
    return null
  }
  if (!chatId) return null

  if (eventType === 'teams_post_create' || eventType === 'teams_post_modify') {
    text = asString(msgData['content'])
    mediaUrls = asStringArray(msgData['images']).concat(asStringArray(msgData['files']))
  } else {
    const parsed = parseMessageBody(msgData)
    text = parsed.text
    mediaUrls = parsed.mediaUrls
    const ref = asRecord(msgData['ref'])
    if (ref && ref['msgid']) {
      text += `\n\n[引用来自 ${asString(ref['user_name'])} 的消息]\n${asString(ref['content'])}`
    }
  }

  const messageId = asString(msgData['msgid']) || asString(msgData['post_id']) || randomHex()
  const ref = asRecord(msgData['ref'])
  return {
    chatId,
    chatType,
    chatName,
    userId: userAccount,
    userName,
    messageId,
    text,
    mediaUrls,
    ...(ref && ref['is_me'] && ref['msgid'] ? { replyToMessageId: asString(ref['msgid']) } : {}),
    raw: body,
  }
}

/**
 * Parse one interactive-button callback body, or null when the event is not a callback.
 * @param body - the raw callback event body.
 * @returns a normalized `IncomingCallback`, or `null` when the event has no actionable button.
 */
export function parseInteractiveCallback(body: Record<string, unknown>): IncomingCallback | null {
  const data = asRecord(body['data']) ?? {}
  const message = asRecord(data['message']) ?? asRecord(body['message']) ?? (Object.keys(data).length > 0 ? data : body)

  const rawAction = message['action']
  if (rawAction === undefined) return null
  const action: unknown[] = Array.isArray(rawAction) ? asArray(rawAction) : [rawAction]
  if (action.length === 0) return null

  const msgid = asString(message['msgid']) || asString(data['msgid']) || asString(body['msgid'])
  if (!msgid) return null

  const user = asRecord(message['user']) ?? {}
  const conv = asRecord(message['conversation']) ?? {}
  const sender = asRecord(message['sender']) ?? {}
  const ctype = asString(conv['type']) || 'single'
  const targeted = asString(conv['targeted'])
  const account = asString(user['account']) || asString(body['user_account']) || asString(sender['account'])
  const uid = asString(user['uid']) || asString(body['uid'])

  let chatId: string
  let chatType: ChatType
  if (ctype === 'group') {
    chatId = targeted
    chatType = 'group'
  } else if (ctype === 'app') {
    return null
  } else {
    chatId = account || uid || targeted
    chatType = 'dm'
  }
  if (!chatId) return null

  let fieldsText = ''
  for (const field of asArray(message['fields'])) {
    const f = asRecord(field)
    const raw = asRecord(f?.['input']) ?? {}
    const value = asString(raw['combox']) || asString(raw['text']) || asString(f?.['text']) || asString(f?.['value'])
    if (value) {
      fieldsText = value
      break
    }
  }

  const first = asRecord(action[0])
  const actionValue = asString(first?.['value']) || asString(first?.['text']) || asString(first?.['name'])
  return {
    chatId,
    chatType,
    userId: account || uid,
    userName: asString(user['name']) || asString(body['user_name']),
    messageId: msgid,
    actionValue,
    fieldsText,
    raw: body,
  }
}

/** The real Tuitui wire client, kept behind the transport seam. */
export class TuituiClient implements TuituiTransport {
  private ws: WebSocket | undefined
  private running = false
  private readonly seenEvents = new Set<string>()
  private messageHandler: ((message: IncomingMessage) => void) | undefined
  private callbackHandler: ((callback: IncomingCallback) => void) | undefined

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly host: string,
  ) {}

  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  onCallback(handler: (callback: IncomingCallback) => void): void {
    this.callbackHandler = handler
  }

  /** The authenticated WebSocket receiver URL for this robot. */
  get wsUrl(): string {
    return `wss://${this.host}:8282/robot/callback/ws?auth=${this.appId}.${this.appSecret}`
  }

  connect(): Promise<void> {
    if (this.running) return Promise.resolve()
    this.running = true
    void this.runStream()
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    this.running = false
    this.ws?.close()
    this.ws = undefined
    this.seenEvents.clear()
    return Promise.resolve()
  }

  /** Reconnecting WebSocket receive loop. */
  private async runStream(): Promise<void> {
    let backoffIndex = 0
    while (this.running) {
      let opened = false
      try {
        await this.connectOnce()
        opened = true
      } catch (error: unknown) {
        console.debug('[dsh-tuitui] WebSocket error:', String(error))
      }
      if (opened) backoffIndex = 0
      const maxDelay = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] ?? 60_000
      const delay = RECONNECT_BACKOFF_MS[Math.min(backoffIndex, RECONNECT_BACKOFF_MS.length - 1)] ?? maxDelay
      await sleep(delay)
      backoffIndex += 1
    }
  }

  /** Open one WebSocket and resolve only once it closes (so the loop reconnects). */
  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl)
      this.ws = ws
      let opened = false
      let settled = false
      const done = (error: Error | undefined): void => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }
      ws.addEventListener('open', () => {
        opened = true
      })
      ws.addEventListener('message', (event) => {
        this.handleRaw(String(event.data))
      })
      ws.addEventListener('error', () => {
        if (!opened) done(new Error('Tuitui WebSocket failed to open'))
      })
      ws.addEventListener('close', () => {
        this.ws = undefined
        if (opened) done(undefined)
        else done(new Error('Tuitui WebSocket closed before opening'))
      })
    })
  }

  private handleRaw(rawData: string): void {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawData) as Record<string, unknown>
    } catch (error: unknown) {
      console.debug('[dsh-tuitui] invalid WS JSON:', String(error))
      return
    }
    const eventId = asString(data['event_id'])
    if (!eventId) return
    this.ws?.send(JSON.stringify({ ack: eventId }))
    if (this.seenEvents.has(eventId)) return
    this.seenEvents.add(eventId)
    if (this.seenEvents.size > MAX_DEDUP_EVENTS) {
      const kept = [...this.seenEvents].slice(-MAX_DEDUP_EVENTS / 2)
      this.seenEvents.clear()
      for (const id of kept) this.seenEvents.add(id)
    }

    const body = asRecord(data['body']) ?? {}
    const eventType = asString(body['event'])
    if (eventType === 'keepalive') return
    const callback = parseInteractiveCallback(body)
    if (callback) {
      this.callbackHandler?.(callback)
      return
    }
    if (body['data'] === undefined) return
    const message = parseEvent(eventType, body)
    if (message) this.messageHandler?.(message)
  }

  private get apiBase(): string {
    return `https://${this.host}:8282/robot`
  }

  private async apiRequest(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.apiBase}${path}?appid=${this.appId}&secret=${this.appSecret}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`Tuitui API status ${response.status}`)
    const data = (await response.json()) as Record<string, unknown>
    if (asNumber(data['errcode']) !== 0) throw new Error(`Tuitui API error: ${JSON.stringify(data)}`)
    return data
  }

  async sendMessage(chatId: string, content: string): Promise<boolean> {
    if (content.trim() === '') return true
    for (const chunk of splitMessage(content)) {
      if (!await this.sendOne(chatId, chunk)) return false
    }
    return true
  }

  private async sendOne(chatId: string, content: string): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = {}
      if (chatId.startsWith('teams_')) {
        const parts = chatId.replace('teams_', '').split('_')
        if (parts.length < 2) return false
        payload['toteams'] = [{ team_id: parts[0], channel_id: parts[1], parent_id: parts[2] ?? '' }]
        payload['msgtype'] = 'richtext/markdown'
        payload['richtext'] = { markdown: content }
      } else {
        payload['msgtype'] = 'text'
        payload['text'] = { content }
        if (guessChatType(chatId) === 'dm') payload['tousers'] = [chatId]
        else payload['togroups'] = [chatId]
      }
      await this.apiRequest('/message/custom/send', payload)
      return true
    } catch (error: unknown) {
      console.debug('[dsh-tuitui] send error:', String(error))
      return false
    }
  }

  async sendReaction(chatId: string, messageId: string, emoji = '收到'): Promise<boolean> {
    if (!chatId || !messageId) return false
    try {
      const payload: Record<string, unknown> = { msgtype: 'emoji_reaction', emoji_reaction: { emoji, cancel: false } }
      if (chatId.startsWith('teams_')) {
        const parts = chatId.replace('teams_', '').split('_')
        if (parts.length < 2) return false
        payload['toteams'] = [{ team_id: parts[0], channel_id: parts[1], parent_id: parts[2] ?? '', post_id: messageId }]
      } else if (guessChatType(chatId) === 'dm') {
        payload['tousers'] = [{ user: chatId, msgid: messageId }]
      } else {
        payload['togroups'] = [{ group: chatId, msgid: messageId }]
      }
      await this.apiRequest('/message/custom/modify', payload)
      return true
    } catch (error: unknown) {
      console.debug('[dsh-tuitui] send reaction error:', String(error))
      return false
    }
  }

  async sendInteractive(chatId: string, interactive: Record<string, unknown>): Promise<string | undefined> {
    if (chatId.startsWith('teams_')) return undefined
    try {
      const payload: Record<string, unknown> = { msgtype: 'interactive', interactive }
      if (guessChatType(chatId) === 'dm') payload['tousers'] = [chatId]
      else payload['togroups'] = [chatId]
      const data = await this.apiRequest('/message/custom/send', payload)
      const msgid = asString(data['msgid'])
      if (msgid) return msgid
      for (const item of asArray(data['msgids'])) {
        if (typeof item === 'string' && item) return item
        const id = asString(asRecord(item)?.['msgid'])
        if (id) return id
      }
      return undefined
    } catch (error: unknown) {
      console.debug('[dsh-tuitui] send interactive error:', String(error))
      return undefined
    }
  }

  async updateInteractive(chatId: string, messageId: string, interactive: Record<string, unknown>): Promise<boolean> {
    if (!chatId || !messageId || chatId.startsWith('teams_')) return false
    try {
      const payload: Record<string, unknown> = { msgtype: 'interactive', interactive }
      if (guessChatType(chatId) === 'dm') payload['tousers'] = [{ user: chatId, msgid: messageId }]
      else payload['togroups'] = [{ group: chatId, msgid: messageId }]
      await this.apiRequest('/message/custom/modify', payload)
      return true
    } catch (error: unknown) {
      console.debug('[dsh-tuitui] update interactive error:', String(error))
      return false
    }
  }
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map(item => asString(asRecord(item)?.['url'])).filter(Boolean)
}

function randomHex(): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

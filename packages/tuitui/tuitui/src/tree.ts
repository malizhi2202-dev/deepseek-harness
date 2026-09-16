/**
 * Interactive file-tree workspace card (/tree), ported from
 * `tui_coding_agent_bridge/bridge/workspace.py`.
 *
 * Each `/tree` opens one independent, in-place-updatable interactive card. The
 * workspace holds its directory position, pagination, focus, a pending
 * confirmation intent, and the card binding (`msgid`) used to update it in
 * place. Filesystem helpers are synchronous — card rendering is low-concurrency
 * and mirrors the deterministic behavior of the reference bridge.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { asNumber, asString } from './parse.ts'

/** Directory and file names hidden from every file-tree listing by default. */
export const DEFAULT_IGNORE = new Set([
  '.git', '.hg', '.svn', '.DS_Store', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode',
])

/** Number of directory entries rendered per list page. */
export const PAGE_SIZE = 5
/** Upper bound on buttons per interactive card payload. */
export const MAX_BUTTONS = 12

/** Card view discriminant value: directory listing. */
export const VIEW_LIST = 'list'
/** Card view discriminant value: focused file/directory detail. */
export const VIEW_FOCUS = 'focus'
/** Card view discriminant value: pending audit confirmation. */
export const VIEW_CONFIRM = 'confirm'
/** Card view discriminant value: in-flight operation. */
export const VIEW_BUSY = 'busy'
/** Card view discriminant value: completed operation. */
export const VIEW_RESULT = 'result'
/** Card view discriminant value: failed operation. */
export const VIEW_ERROR = 'error'
/** Card view discriminant value: unrecognized input hint. */
export const VIEW_HINT = 'hint'
/** Card view discriminant value: closed card. */
export const VIEW_CLOSED = 'closed'
/** The set of card views a `TreeWorkspace` can be in. */
export type View = 'list' | 'focus' | 'confirm' | 'busy' | 'result' | 'error' | 'hint' | 'closed'

/** Intent kinds that must pass the audit (confirm) view before executing. */
export const CONFIRM_KINDS = new Set(['copy', 'rename', 'delete', 'set_cwd', 'agent'])

/** One directory entry rendered onto a list view. */
export interface FileEntry {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly size: number
  readonly mtime: number
}

/** A parsed action against a file tree, from text rules, a button, or AI JSON. */
export interface Intent {
  readonly kind: string
  readonly path: string
  readonly target: string
  readonly page: number
  readonly query: string
  readonly text: string
  readonly desc: string
  readonly needsConfirm: boolean
}

/**
 * Format a byte count as a compact `B`/`KB`/`MB` string.
 * @param n - the byte count.
 * @returns a human-readable size label.
 */
export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/**
 * Resolve a `~`-prefixed or relative path against `base`. `mustExist=false` keeps a normalized target.
 * @param base - the directory relative paths are joined against.
 * @param raw - the user/JSON-provided path string.
 * @param mustExist - when true, returns `''` unless the resolved path exists.
 * @returns the absolute normalized path, or `''` when empty or missing.
 */
export function resolvePath(base: string, raw: string, mustExist = true): string {
  let p = raw.trim().replace(/^["']+|["']+$/g, '')
  if (!p) return ''
  if (p === '~' || p.startsWith('~/')) p = join(homedir(), p.slice(1))
  if (!isAbsolute(p)) p = join(base, p)
  p = normalize(p)
  if (mustExist && !existsSync(p)) return ''
  return p
}

/**
 * List one directory, applying hidden, ignore, and query filters, directories first.
 * @param path - the directory to list.
 * @param showHidden - when true, include dot-files.
 * @param ignore - names to exclude from the listing.
 * @param query - case-insensitive substring filter on names.
 * @returns the filtered entries, directories before files.
 */
export function listEntries(path: string, showHidden = false, ignore: Set<string> = DEFAULT_IGNORE, query = ''): FileEntry[] {
  let names: string[]
  try {
    names = readdirSync(path).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  } catch {
    // Unreadable or missing directory lists as empty.
    return []
  }
  const out: FileEntry[] = []
  for (const name of names) {
    if (!showHidden && name.startsWith('.')) continue
    if (ignore.has(name)) continue
    if (query && !name.toLowerCase().includes(query.toLowerCase())) continue
    const full = join(path, name)
    let isDir = false
    let size = 0
    let mtime = 0
    try {
      const stat = statSync(full)
      isDir = stat.isDirectory()
      size = stat.size
      mtime = stat.mtimeMs
    } catch {
      // Entry vanished between readdir and stat; skip it.
      continue
    }
    out.push({ name, path: full, isDir, size, mtime })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.isDir ? -1 : 1))
  return out
}

function emptyIntent(): Intent {
  return { kind: '', path: '', target: '', page: 0, query: '', text: '', desc: '', needsConfirm: false }
}

/**
 * Deterministic text → intent rules; returns null when unrecognized (caller may fall back to AI).
 * @param text - the raw user text.
 * @param base - the directory relative paths resolve against.
 * @param focus - the currently focused file/directory, used for name-only actions.
 * @returns a parsed `Intent`, or `null` when no deterministic rule matched.
 */
export function parseIntent(text: string, base: string, focus = ''): Intent | null {
  const t = text.trim()
  if (!t) return null
  const low = t.toLowerCase()

  if (['刷新', 'refresh', 'reload'].includes(low)) return { ...emptyIntent(), kind: 'refresh' }
  if (['返回', '上一级', '上级', 'back', '..', 'up', 'cd ..'].includes(low)) return { ...emptyIntent(), kind: 'up' }
  if (['关闭', '关闭文件树', '退出', 'close', 'exit', 'off'].includes(low)) return { ...emptyIntent(), kind: 'close' }
  if (['下一页', 'next', '下页'].includes(low)) return { ...emptyIntent(), kind: 'page', page: -2 }
  if (['上一页', 'prev', '上页'].includes(low)) return { ...emptyIntent(), kind: 'page', page: -1 }

  let m = /^第\s*(\d+)\s*页$/.exec(t)
  if (m) return { ...emptyIntent(), kind: 'page', page: Number(m[1] ?? '0') }

  m = /(?:搜索|查找|find|search)\s+(.+)$/i.exec(t)
  if (m) return { ...emptyIntent(), kind: 'search', query: (m[1] ?? '').trim() }

  m = /^(?:复制名称|复制文件名|copy\s+name)\s*(.*)$/i.exec(t)
  if (m) {
    const raw = (m[1] ?? '').trim()
    const p = raw ? resolvePath(base, raw) : (focus ? resolvePath(base, focus) : '')
    if (p && lstatSafeIsFile(p)) return { ...emptyIntent(), kind: 'copy_name', path: p }
  }

  m = /^(?:打开|进入|进|浏览|open|cd|ls|tree)\s+(.+)$/i.exec(t)
  if (m) {
    const p = resolvePath(base, (m[1] ?? '').trim())
    if (p) return isDir(p) ? { ...emptyIntent(), kind: 'enter', path: p } : { ...emptyIntent(), kind: 'focus', path: p }
  }

  m = /^(?:查看|打开内容|看|view|read|cat|preview)\s+(.+)$/i.exec(t)
  if (m) {
    const p = resolvePath(base, (m[1] ?? '').trim())
    if (p) return isDir(p) ? { ...emptyIntent(), kind: 'enter', path: p } : { ...emptyIntent(), kind: 'focus', path: p }
  }

  m = /^复制\s+(.+?)\s+(?:为|成|到)\s+(.+)$/.exec(t)
  if (m) {
    const src = resolvePath(base, (m[1] ?? '').trim())
    const dst = resolvePath(base, (m[2] ?? '').trim(), false)
    if (src && dst) return { ...emptyIntent(), kind: 'copy', path: src, target: dst, needsConfirm: true, desc: `复制 ${basename(src)} → ${dst}` }
  }

  m = /^重命名\s+(.+?)\s+(?:为|成)\s+(.+)$/.exec(t)
  if (m) {
    const src = resolvePath(base, (m[1] ?? '').trim())
    const dst = resolvePath(base, (m[2] ?? '').trim(), false)
    if (src && dst) return { ...emptyIntent(), kind: 'rename', path: src, target: dst, needsConfirm: true, desc: `重命名 ${basename(src)} → ${basename(dst)}` }
  }

  m = /^(?:删除|移除|rm|delete)\s+(.+)$/i.exec(t)
  if (m) {
    const p = resolvePath(base, (m[1] ?? '').trim())
    if (p) return { ...emptyIntent(), kind: 'delete', path: p, needsConfirm: true, desc: `删除 ${p}` }
  }

  m = /^(?:设为工作目录|切到|cd)\s+(.+)$/i.exec(t)
  if (m) {
    const p = resolvePath(base, (m[1] ?? '').trim())
    if (p && isDir(p)) return { ...emptyIntent(), kind: 'set_cwd', path: p, needsConfirm: true, desc: `切换 agent 工作目录到 ${p}（会重置会话）` }
  }

  if (t.startsWith('/') || t.startsWith('~') || t.startsWith('./') || t.startsWith('../') || existsSync(join(base, t))) {
    const p = resolvePath(base, t)
    if (p) return isDir(p) ? { ...emptyIntent(), kind: 'enter', path: p } : { ...emptyIntent(), kind: 'focus', path: p }
  }

  return null
}

/** System prompt for the AI fallback that parses free-form text into a file-tree intent. */
export const AI_PARSE_PROMPT = `你是文件树操作解析器。把用户输入解析成一个 JSON 意图，只输出 JSON，不要解释。
当前目录：{base}
当前聚焦文件：{focus}
用户输入：{text}

可用的 kind：
- "enter"：进入目录（path 必须是目录）
- "focus"：聚焦/查看文件（path 必须是文件）
- "copy_name"：复制文件名（path 必须是文件）
- "preview_full"：查看文件完整内容（path 必须是文件）
- "copy"：复制文件（path=源，target=目标）
- "rename"：重命名（path=源，target=目标）
- "delete"：删除（path）
- "set_cwd"：设为 agent 工作目录（path 必须是目录）
- "search"：搜索当前目录（query）
- "agent"：其他需要 agent 处理的请求（text 保留原输入）

输出示例：{"kind": "enter", "path": "/abs/path"}
所有 path/target 必须是绝对路径（可基于 {base} 解析），不存在则输出 {"kind": "agent", "text": "..."}。
`

/**
 * Parse an AI intent answer (JSON, possibly wrapped) back into an Intent.
 * @param raw - the model output string.
 * @param base - the directory relative paths resolve against.
 * @returns a parsed `Intent`, or `null` for malformed or unrecognized JSON.
 */
export function intentFromAiJson(raw: string, base: string): Intent | null {
  const m = /\{.*\}/s.exec(raw)
  if (!m) return null
  let obj: unknown
  try {
    obj = JSON.parse(m[0])
  } catch {
    // Malformed model JSON falls back to the hint view.
    return null
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
  const record = obj as Record<string, unknown>
  const kind = asString(record['kind']).trim()
  if (kind === 'agent') {
    return { ...emptyIntent(), kind: 'agent', text: asString(record['text']).trim(), needsConfirm: true }
  }
  if (!['enter', 'focus', 'copy_name', 'preview_full', 'copy', 'rename', 'delete', 'set_cwd', 'search'].includes(kind)) return null
  const path = resolvePath(base, asString(record['path']))
  const target = record['target'] ? resolvePath(base, asString(record['target']), false) : ''
  if (kind === 'search') return { ...emptyIntent(), kind: 'search', query: asString(record['query']) }
  if (kind === 'delete') return path ? { ...emptyIntent(), kind: 'delete', path, needsConfirm: true, desc: `删除 ${path}` } : null
  if (kind === 'set_cwd') return path && isDir(path) ? { ...emptyIntent(), kind: 'set_cwd', path, needsConfirm: true, desc: `切换 agent 工作目录到 ${path}（会重置会话）` } : null
  if (kind === 'copy') return path && target ? { ...emptyIntent(), kind: 'copy', path, target, needsConfirm: true, desc: `复制 ${basename(path)} → ${target}` } : null
  if (kind === 'rename') return path && target ? { ...emptyIntent(), kind: 'rename', path, target, needsConfirm: true, desc: `重命名 ${basename(path)} → ${basename(target)}` } : null
  if (!path) return null
  if (kind === 'enter' && isDir(path)) return { ...emptyIntent(), kind: 'enter', path }
  if (kind === 'focus' && lstatSafeIsFile(path)) return { ...emptyIntent(), kind: 'focus', path }
  if ((kind === 'copy_name' || kind === 'preview_full') && lstatSafeIsFile(path)) return { ...emptyIntent(), kind, path }
  return null
}

/**
 * Serialize one pending Intent for card persistence.
 * @param intent - the pending intent, or `null`.
 * @returns a JSON-ready object, or `null` when `intent` is null.
 */
export function pendingToDict(intent: Intent | null): Record<string, unknown> | null {
  if (intent === null) return null
  return {
    kind: intent.kind, path: intent.path, target: intent.target, page: intent.page,
    query: intent.query, text: intent.text, desc: intent.desc, needs_confirm: intent.needsConfirm,
  }
}

/**
 * Deserialize a persisted pending Intent.
 * @param data - the persisted object, possibly null/undefined.
 * @returns the restored `Intent`, or `null` when absent.
 */
export function pendingFromDict(data: Record<string, unknown> | null | undefined): Intent | null {
  if (!data) return null
  return {
    kind: asString(data['kind']),
    path: asString(data['path']),
    target: asString(data['target']),
    page: asNumber(data['page']),
    query: asString(data['query']),
    text: asString(data['text']),
    desc: asString(data['desc']),
    needsConfirm: Boolean(data['needs_confirm']),
  }
}

/** A button in the interactive payload's `action` array. */
interface TreeButton {
  readonly text: string
  readonly name: 'tree'
  readonly value: string
  readonly color: string
  readonly bgcolor: string
  readonly bordercolor?: string
}

interface TreeConfig {
  pageSize: number
  showHidden: boolean
  ignore: Set<string>
}

/** Per-card interactive file-tree state and its rendering. */
export class TreeWorkspace {
  /** The chat this card belongs to. */
  readonly chatId: string
  /** Opaque per-card id echoed in the interactive payload so button callbacks can be matched. */
  token: string
  /** Entries per list page. */
  readonly pageSize: number
  /** Whether dot-files are listed. */
  readonly showHidden: boolean
  /** Names excluded from listings. */
  readonly ignore: Set<string>

  /** The fixed top directory the card is rooted at. */
  root: string
  /** The Tuitui message id bound to this card, for in-place updates. */
  msgid = ''
  /** Whether this card is the active tree for its chat. */
  active = false
  /** Current card view. */
  view: View = VIEW_LIST
  /** Currently listed directory. */
  path: string
  /** 1-based list page. */
  page = 1
  /** Active name filter. */
  query = ''
  /** Currently focused file or directory. */
  focus = ''
  /** An action awaiting audit confirmation. */
  pending: Intent | null = null
  /** Guards one in-flight card operation per card. */
  busy = false
  /** Card-specific status line rendered by the current view. */
  message = ''

  constructor(chatId: string, root: string, config: TreeConfig) {
    this.chatId = chatId
    this.root = root || process.cwd()
    this.token = randomToken()
    this.pageSize = config.pageSize
    this.showHidden = config.showHidden
    this.ignore = config.ignore
    this.path = this.root
  }

  /** The filtered entries for the current directory and query. */
  get entries(): FileEntry[] {
    return listEntries(this.path, this.showHidden, this.ignore, this.query)
  }

  /** The number of list pages for the current entries, at least 1. */
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.entries.length / this.pageSize))
  }

  /**
   * The entries on the current page.
   * @returns the current page's directory entries.
   */
  pageEntries(): FileEntry[] {
    const start = (this.page - 1) * this.pageSize
    return this.entries.slice(start, start + this.pageSize)
  }

  /**
   * Build the `interactive` payload (without the `msgtype` wrapper).
   * @returns a Tuitui `interactive` payload object.
   */
  render(): Record<string, unknown> {
    return {
      id: this.token,
      value: JSON.stringify({ v: 1, view: this.view, path: this.path, page: this.page, tok: this.token }),
      head: { text: this.headText() },
      body: { title: truncate(this.focus || this.path, 300), content: this.content() },
      footer: this.footer(),
      action: this.buttons(),
    }
  }

  /**
   * Serialize the card state for persistence.
   * @returns a JSON-ready object.
   */
  toDict(): Record<string, unknown> {
    return {
      chat_id: this.chatId, msgid: this.msgid, active: this.active, token: this.token, root: this.root,
      view: this.view, path: this.path, page: this.page, query: this.query, focus: this.focus,
      message: this.message, pending: pendingToDict(this.pending),
    }
  }

  /**
   * Restore a card from its persisted object.
   * @param chatId - the chat the card belongs to.
   * @param data - the persisted object.
   * @param config - the tree configuration to apply.
   * @returns a restored `TreeWorkspace`.
   */
  static fromDict(chatId: string, data: Record<string, unknown>, config: TreeConfig): TreeWorkspace {
    const ws = new TreeWorkspace(chatId, asString(data['root']), config)
    ws.msgid = asString(data['msgid'])
    ws.active = Boolean(data['active'])
    ws.token = asString(data['token']) || ws.token
    ws.view = (asString(data['view']) || VIEW_LIST) as View
    ws.path = asString(data['path']) || ws.root
    ws.page = asNumber(data['page']) || 1
    ws.query = asString(data['query'])
    ws.focus = asString(data['focus'])
    ws.message = asString(data['message'])
    ws.pending = pendingFromDict(data['pending'] as Record<string, unknown> | null)
    return ws
  }

  private headText(): string {
    if (this.view === VIEW_CONFIRM) return '⚠️ 操作确认'
    if (this.view === VIEW_BUSY) return '⏳ 处理中'
    if (this.view === VIEW_RESULT) return '✅ 完成'
    if (this.view === VIEW_ERROR) return '❌ 失败'
    if (this.view === VIEW_HINT) return '❓ 无法识别'
    if (this.view === VIEW_CLOSED) return '🗙 文件树已关闭'
    if (this.view === VIEW_FOCUS) {
      const name = basename(this.focus || this.path)
      return (isDir(this.focus) ? '📁 ' : '📄 ') + name
    }
    const name = basename(this.path) || this.path
    return '📁 文件树 · ' + name
  }

  private preview(path: string, limit = 480): string {
    let head: Buffer
    try {
      const fd = readFileSync(path)
      head = fd.subarray(0, 20_000)
    } catch (error) {
      return `(无法读取：${String(error)})`
    }
    const text = head.toString('utf8')
    const lines = text.split(/\r?\n/).slice(0, 8)
    return truncate(lines.join('\n'), limit)
  }

  private content(): string {
    if (this.view === VIEW_LIST) {
      const parts: string[] = []
      if (this.query) parts.push(`🔍 搜索：${this.query}`)
      const entries = this.pageEntries()
      if (entries.length === 0) parts.push('（空目录，或没有匹配项）')
      entries.forEach((e, i) => {
        parts.push(e.isDir ? `${i + 1}. 📁 ${e.name}/` : `${i + 1}. 📄 ${e.name} (${formatSize(e.size)})`)
      })
      return truncate(parts.join('\n'), 600)
    }
    if (this.view === VIEW_FOCUS) {
      if (isDir(this.focus)) {
        const subs = listEntries(this.focus, this.showHidden, this.ignore)
        return truncate(`📁 目录，共 ${subs.length} 项。点击 [📂 进入] 查看。`, 600)
      }
      return this.preview(this.focus)
    }
    if (this.view === VIEW_CONFIRM) {
      const p = this.pending
      const lines = [p?.desc || p?.kind || '']
      if (p?.path) lines.push(`路径：${p.path}`)
      if (p?.target) lines.push(`目标：${p.target}`)
      if (p?.query) lines.push(`关键词：${p.query}`)
      if (p?.text) lines.push(`原文：${truncate(p.text, 100)}`)
      lines.push('确认后将执行；取消则返回。')
      return truncate(lines.join('\n'), 600)
    }
    if (this.view === VIEW_CLOSED) return '文件树已关闭。直接发消息将走普通 agent 对话；发送 /tree 可重新打开。'
    return truncate(this.message || '', 600)
  }

  private footer(): Array<{ text: string; rtext: string }> {
    if (this.view === VIEW_LIST) {
      return [{ text: `第 ${this.page}/${this.totalPages} 页`, rtext: `共 ${this.entries.length} 项` }]
    }
    if (this.view === VIEW_FOCUS && lstatSafeIsFile(this.focus)) {
      try {
        const stat = statSync(this.focus)
        const d = new Date(stat.mtimeMs)
        const pad = (n: number): string => String(n).padStart(2, '0')
        return [{ text: formatSize(stat.size), rtext: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }]
      } catch {
        // Focused file vanished; fall through to the default footer.
      }
    }
    if (this.view === VIEW_CONFIRM) return [{ text: '审核', rtext: this.message || '请确认操作' }]
    return []
  }

  private buttons(): TreeButton[] {
    const btn = (text: string, t: string, extra: Record<string, unknown> = {}): TreeButton => ({
      text,
      name: 'tree',
      value: JSON.stringify({ t, ...extra }),
      color: '#FFFFFF',
      bgcolor: '#3873FA',
    })

    if (this.view === VIEW_LIST) {
      const entryButtons = this.pageEntries().map((e, i) => ({
        text: String(i + 1),
        name: 'tree',
        value: JSON.stringify({ t: 'go', p: e.path }),
        color: '#3873FA',
        bgcolor: '#FFFFFF',
        bordercolor: '#3873FA',
      })) as TreeButton[]
      const controls: TreeButton[] = []
      if (this.path !== this.root) controls.push(btn('根', 'root'))
      if (dirname(this.path) !== this.path) controls.push(btn('上级', 'up'))
      if (this.page > 1) controls.push(btn('首页', 'page', { n: 1 }))
      if (this.page > 2) controls.push(btn('上一页', 'page', { n: this.page - 1 }))
      if (this.page + 1 < this.totalPages) controls.push(btn('下一页', 'page', { n: this.page + 1 }))
      if (this.page < this.totalPages) controls.push(btn('末页', 'page', { n: this.totalPages }))
      return entryButtons.concat(controls)
    }

    if (this.view === VIEW_FOCUS) {
      const out: TreeButton[] = []
      if (isDir(this.focus)) {
        out.push(btn('📂 进入', 'go', { p: this.focus }))
        out.push(btn('📌 设为工作目录', 'set_cwd', { p: this.focus }))
      } else {
        out.push(btn('📋 复制名称', 'copy_name', { p: this.focus }))
        out.push(btn('👀 全文', 'preview_full', { p: this.focus }))
      }
      out.push(btn('✏️ 重命名', 'rename', { p: this.focus }))
      out.push(btn('🗑 删除', 'delete', { p: this.focus }))
      out.push(btn('⬅ 返回', 'back'))
      return out.slice(0, MAX_BUTTONS)
    }

    if (this.view === VIEW_CONFIRM) {
      return [
        { text: '✅ 确认执行', name: 'tree', value: JSON.stringify({ t: 'confirm' }), color: '#FFFFFF', bgcolor: '#0E8A3C' },
        { text: '❌ 取消', name: 'tree', value: JSON.stringify({ t: 'cancel' }), color: '#FFFFFF', bgcolor: '#FA5151' },
      ]
    }

    if (this.view === VIEW_CLOSED) {
      return [{ text: '🔄 重新打开', name: 'tree', value: JSON.stringify({ t: 'reopen' }), color: '#FFFFFF', bgcolor: '#3873FA' }]
    }

    const out: TreeButton[] = [btn('⬅ 返回目录', 'back')]
    if (this.focus && existsSync(this.focus)) out.push(btn('📄 文件操作', 'back_focus'))
    return out
  }
}

interface TreeCardData { [msgid: string]: Record<string, unknown> }

/**
 * A JSON-file-backed card store seam; `TreeCardStore` is the on-disk implementation
 * holding msgid → card state.
 */
export interface JsonFileStore {
  loadAll(): TreeCardData
  saveAll(workspaces: ReadonlyMap<string, TreeWorkspace>): void
}

/** Disk-backed tree-card bindings (msgid → card state) so cards survive restarts. */
export class TreeCardStore implements JsonFileStore {
  private data: TreeCardData

  constructor(readonly filePath: string) {
    this.data = {}
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = parsed as TreeCardData
    } catch {
      // Missing or corrupt card file starts empty.
    }
  }

  loadAll(): TreeCardData {
    return this.data
  }

  saveAll(workspaces: ReadonlyMap<string, TreeWorkspace>): void {
    const data: TreeCardData = {}
    for (const ws of workspaces.values()) {
      if (!ws.msgid) continue
      data[ws.msgid] = ws.toDict()
    }
    this.data = data
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileAtomic(this.filePath, JSON.stringify(data, null, 2) + '\n')
  }
}

/** Per-chat cwd persistence, mirroring the bridge's `WorkspaceStore`. */
export class WorkspaceStore {
  private data: Record<string, string>

  constructor(readonly filePath: string) {
    this.data = {}
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = parsed as Record<string, string>
    } catch {
      // Missing or corrupt cwd file starts empty.
    }
  }

  /**
   * Recover the persisted working directory for a chat.
   * @param chatId - the chat whose cwd is looked up.
   * @returns the persisted cwd, or `''` when none was saved.
   */
  cwdFor(chatId: string): string {
    return this.data[chatId] ?? ''
  }

  /**
   * Persist (and atomically write) a chat's working directory.
   * @param chatId - the chat whose cwd is saved.
   * @param cwd - the absolute working directory.
   */
  setCwd(chatId: string, cwd: string): void {
    this.data[chatId] = cwd
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileAtomic(this.filePath, JSON.stringify(this.data, null, 2) + '\n')
  }
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

function truncate(s: string, limit: number): string {
  const trimmed = s.trim()
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit) + '…(已截断)'
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Unstatable path is not a directory.
    return false
  }
}

function lstatSafeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    // Unstatable path is not a file.
    return false
  }
}

function randomToken(): string {
  return Math.random().toString(16).slice(2, 14)
}

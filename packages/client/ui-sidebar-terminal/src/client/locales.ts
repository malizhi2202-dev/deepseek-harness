/**
 * `sidebarTerminal` namespace dictionaries, and the namespace's declaration.
 *
 * One failure line per declared console code, because a refused install, a
 * missing backend, and a busy shell suggest different next steps. Two of the
 * lines are the panel's honesty about what it is: a bounded sanitized-text
 * surface rather than a terminal, and a channel that belongs to the person
 * rather than to the model.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarTerminal'>` or `PropsLocale<'sidebarTerminal'>` needs
 * only this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Terminal panel type name, guide entry, shell controls, stream states, and failure lines. */
    sidebarTerminal: SidebarTerminalKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '终端',
  'guide.title': '终端',
  'guide.description': '在这个会话的工作区里运行 shell 命令，并实时查看输出。',
  loading: '正在连接终端…',
  newShell: '新建终端',
  closeShell: '关闭终端',
  shell: '终端 {index}',
  command: '输入命令',
  output: '输出',
  placeholder: '输入命令，回车运行',
  run: '运行',
  busy: '上一条命令还在运行，等它结束或关闭这个终端。',
  ended: '这个终端已退出。',
  empty: '还没有终端。新建一个开始使用。',
  notTerminal: '这里是纯文本输出，不是完整终端：没有颜色、光标控制和全屏程序。',
  notModel: '这个终端只属于你：输出不会进入会话记录，也不会成为模型输入。',
  'error.refused': '这个安装允许网络可达的设备访问，因此终端面板已被拒绝。',
  'error.unavailable': '这个主机没有注册可用的 shell 后端：{message}',
  'error.busy': '这个终端正忙：{message}',
  'error.limit': '同时打开的终端数量已达上限：{message}',
  'error.unknownShell': '这个终端已经不在了：{message}',
  'error.failed': '终端操作失败：{message}',
} satisfies Record<string, string>

/** Terminal dictionary key union. */
export type SidebarTerminalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Terminal',
  'guide.title': 'Terminal',
  'guide.description': 'Run shell commands in this session\'s workspace and watch their output live.',
  loading: 'Connecting to the terminal…',
  newShell: 'New terminal',
  closeShell: 'Close terminal',
  shell: 'Terminal {index}',
  command: 'Command',
  output: 'Output',
  placeholder: 'Type a command and press Enter',
  run: 'Run',
  busy: 'The previous command is still running. Wait for it, or close this terminal.',
  ended: 'This terminal has exited.',
  empty: 'No terminal yet. Create one to get started.',
  notTerminal: 'This is plain text output, not a full terminal: no colors, cursor control, or full-screen programs.',
  notModel: 'This terminal is yours alone: its output never enters the session log or a model request.',
  'error.refused': 'This install serves a surface a network can reach, so the terminal panel is refused.',
  'error.unavailable': 'This host has no usable shell backend registered: {message}',
  'error.busy': 'This terminal is busy: {message}',
  'error.limit': 'The open-terminal limit for this session is reached: {message}',
  'error.unknownShell': 'This terminal is gone: {message}',
  'error.failed': 'The terminal operation failed: {message}',
} satisfies Record<SidebarTerminalKey, string>

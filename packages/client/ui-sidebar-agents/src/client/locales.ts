/**
 * `sidebarAgents` namespace dictionaries, and the namespace's declaration.
 *
 * The copy covers the type name, the guide box, the tree's accessible name,
 * the three catalog states, the three diagnostic reasons, and the reason a row
 * cannot be opened. Every state word is the panel's own wording for a wire
 * fact, so it lives here rather than being derived from a discriminant.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarAgents'>` or `PropsLocale<'sidebarAgents'>` needs only
 * this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Derivation type name, guide entry, tree states, and disabled-row reasons. */
    sidebarAgents: SidebarAgentsKey
  }
}

/** This package's copy namespace. */
export const NS = 'sidebarAgents'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '派生',
  'guide.title': '智能体派生面板',
  'guide.description': '查看这个会话派生出的子代理树。',
  'tree.aria': '智能体派生',
  'tree.empty': '这个会话还没有派生子代理。',
  'tree.awaiting': '正在等待这个会话出现在会话列表中。',
  'catalog.unloaded': '子代理目录尚未加载。',
  'catalog.loading': '正在读取子代理目录…',
  'catalog.error': '无法读取子代理目录。',
  'catalog.retry': '重试',
  'row.aria': '{label}，{state}',
  'row.blocked': '{label}，不可打开：{reason}',
  'row.diagnostic': '{id}，诊断：{reason}',
  'row.notListed': '父会话的子代理目录中没有这个条目。',
  'row.parentUnavailable': '父会话当前不在线，重新打开父会话后才能继续。',
  'row.depthLimit': '已达到 {depth} 层深度上限，更深的派生未展开。',
  'state.running': '正在运行',
  'state.inactive': '未运行',
  'branch.expand': '展开 {label} 的派生',
  'branch.collapse': '收起 {label} 的派生',
  'diagnostic.corrupt': '会话记录损坏',
  'diagnostic.unsupported': '记录版本不受支持',
  'diagnostic.unavailable': '记录暂不可用',
} satisfies Record<string, string>

/** Derivation panel dictionary key union. */
export type SidebarAgentsKey = keyof typeof zh

/** English dictionary, keyed by the Chinese dictionary's keys. */
export const en = {
  'type.label': 'Derivations',
  'guide.title': 'Agent derivations',
  'guide.description': 'The subagent forest this session derived.',
  'tree.aria': 'Agent derivations',
  'tree.empty': 'This session has derived no subagents.',
  'tree.awaiting': 'Waiting for this session to appear in the session list.',
  'catalog.unloaded': 'The subagent catalog has not been read yet.',
  'catalog.loading': 'Reading the subagent catalog…',
  'catalog.error': 'Unable to read the subagent catalog.',
  'catalog.retry': 'Retry',
  'row.aria': '{label}, {state}',
  'row.blocked': '{label}, cannot open: {reason}',
  'row.diagnostic': '{id}, diagnostic: {reason}',
  'row.notListed': 'The parent session\'s subagent catalog holds no entry for this row.',
  'row.parentUnavailable': 'The parent session is offline; reopen it to continue this subagent.',
  'row.depthLimit': 'Stopped at the depth limit of {depth}; deeper derivations are not shown.',
  'state.running': 'running',
  'state.inactive': 'not running',
  'branch.expand': 'Expand {label} derivations',
  'branch.collapse': 'Collapse {label} derivations',
  'diagnostic.corrupt': 'corrupted session record',
  'diagnostic.unsupported': 'unsupported record version',
  'diagnostic.unavailable': 'record temporarily unavailable',
} satisfies Record<SidebarAgentsKey, string>

/**
 * `sidebarChannels` namespace dictionaries, and the namespace's declaration.
 *
 * The panel's copy is split by the surface that shows it: the type's name and
 * guide box, the channel card's own states and controls, the credential list,
 * and the settings form. Channel ids, field names, reference names, session
 * ids, and host failure messages are data rather than copy, so they travel
 * through these lines as parameters instead of becoming keys.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarChannels'>` or `PropsLocale<'sidebarChannels'>` needs
 * only this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chat-channel panel type name, guide entry, channel states, credential rows, and settings form copy. */
    sidebarChannels: SidebarChannelsKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '远端控制',
  'guide.title': '远端控制',
  'guide.description': '把聊天渠道接到这个会话：查看连接状态、凭据引用和设置，并启用或停用。',
  loading: '正在读取渠道状态…',
  reload: '重新读取',
  empty: '这个主机还没有注册任何聊天渠道。',
  'channel.tuitui': '推推',
  'state.stopped': '未连接',
  'state.connecting': '正在连接',
  'state.connected': '已连接',
  'state.failed': '连接失败',
  enable: '启用',
  disable: '停用',
  probe: '测试凭据',
  bound: '已绑定会话 {sessionId}',
  lastError: '最近一次失败：{message}',
  'probe.ok': '凭据可用。',
  'probe.account': '账号：{account}',
  'probe.failed': '测试失败：{message}',
  'capabilities.title': '平台能力',
  'capabilities.quoting': '引用回复',
  'capabilities.inboundImages': '接收图片',
  'capabilities.inboundFiles': '接收文件',
  'capabilities.outboundImages': '发送图片',
  'capabilities.outboundFiles': '发送文件',
  'capabilities.markdown': 'Markdown',
  'capabilities.maxText': '单条文本上限 {value} 字',
  'capabilities.maxInbound': '接收附件上限 {value} 字节',
  'capabilities.maxOutbound': '发送附件上限 {value} 字节',
  'credentials.title': '凭据',
  'credentials.configured': '已配置',
  'credentials.unset': '未配置',
  'credentials.source': '来源：{source}',
  'credentials.readonly': '不可写入',
  'credentials.note': '这里只显示引用名，不读取也不显示凭据值；值请在环境变量或凭据存储里提供。',
  'settings.title': '设置',
  'settings.loading': '正在读取设置…',
  'settings.unavailable': '这个渠道的设置没有暴露给这个客户端。',
  'settings.readonly': '这个部署的设置文档是只读的。',
  'settings.save': '保存',
  'settings.discard': '放弃修改',
  'settings.saving': '正在保存…',
  'settings.dirty': '有未保存的修改',
  'settings.failed': '保存没有生效：存储的设置可能已经改变，请再试一次。',
  'settings.resetField': '清除 {field} 的用户设置',
  'settings.secretSet': '已配置',
  'settings.secretUnset': '未配置',
  'settings.secretNote': '只能写入，不回显；留空表示不改动。',
  'settings.unsupported': '这个字段不能在面板里编辑。',
  'settings.credentialHint': '凭据引用名，不是密钥本身。',
  'layer.user': '用户设置',
  'layer.base': '部署默认',
  'layer.default': '结构默认',
  'error.unknown': '这个主机没有注册名为 {channel} 的渠道。',
  'error.failed': '渠道操作失败：{message}',
} satisfies Record<string, string>

/** Channel panel dictionary key union. */
export type SidebarChannelsKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Remote control',
  'guide.title': 'Remote control',
  'guide.description': 'Connect chat platforms to this session: see each channel\'s connection, credentials, and settings, and enable or disable it.',
  loading: 'Reading channel status…',
  reload: 'Reload',
  empty: 'This host has no chat channel registered.',
  'channel.tuitui': 'Tuitui',
  'state.stopped': 'Not connected',
  'state.connecting': 'Connecting',
  'state.connected': 'Connected',
  'state.failed': 'Connection failed',
  enable: 'Enable',
  disable: 'Disable',
  probe: 'Test credentials',
  bound: 'Bound to session {sessionId}',
  lastError: 'Last failure: {message}',
  'probe.ok': 'The credentials work.',
  'probe.account': 'Account: {account}',
  'probe.failed': 'The test failed: {message}',
  'capabilities.title': 'Platform capabilities',
  'capabilities.quoting': 'Quoted replies',
  'capabilities.inboundImages': 'Inbound images',
  'capabilities.inboundFiles': 'Inbound files',
  'capabilities.outboundImages': 'Outbound images',
  'capabilities.outboundFiles': 'Outbound files',
  'capabilities.markdown': 'Markdown',
  'capabilities.maxText': 'At most {value} characters per message',
  'capabilities.maxInbound': 'At most {value} bytes per inbound attachment',
  'capabilities.maxOutbound': 'At most {value} bytes per outbound attachment',
  'credentials.title': 'Credentials',
  'credentials.configured': 'Configured',
  'credentials.unset': 'Not set',
  'credentials.source': 'Source: {source}',
  'credentials.readonly': 'Read-only',
  'credentials.note': 'Only reference names appear here: this panel neither reads nor shows a credential value. Supply values through an environment variable or the credential store.',
  'settings.title': 'Settings',
  'settings.loading': 'Reading settings…',
  'settings.unavailable': 'This channel\'s settings are not exposed to this client.',
  'settings.readonly': 'This deployment\'s settings document is read-only.',
  'settings.save': 'Save',
  'settings.discard': 'Discard changes',
  'settings.saving': 'Saving…',
  'settings.dirty': 'Unsaved changes',
  'settings.failed': 'The save did not take effect: the stored settings may have moved. Try again.',
  'settings.resetField': 'Clear the user setting for {field}',
  'settings.secretSet': 'Configured',
  'settings.secretUnset': 'Not set',
  'settings.secretNote': 'Write-only; the stored value is never echoed. Leave it blank to keep it.',
  'settings.unsupported': 'This field is not editable in the panel.',
  'settings.credentialHint': 'A credential reference name, not the secret itself.',
  'layer.user': 'User setting',
  'layer.base': 'Deployment default',
  'layer.default': 'Schema default',
  'error.unknown': 'This host has no channel named {channel}.',
  'error.failed': 'The channel operation failed: {message}',
} satisfies Record<SidebarChannelsKey, string>

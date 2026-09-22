/**
 * `sidebarSources` namespace dictionaries, and the namespace's declaration.
 *
 * The panel's copy is split by the surface that shows it: the type's name and
 * guide box, one source's state and controls, the capability lines the seam
 * declares, the credential references, the settings form, and the two
 * explanatory blocks — the source's own hard limits, and the sources this
 * design deliberately does not build.
 *
 * A kind name, a field name, a credential reference name, and a host failure
 * message are data rather than copy, so they travel through these lines as
 * parameters instead of becoming keys.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarSources'>` or `PropsLocale<'sidebarSources'>` needs only
 * this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Resource-library panel type name, guide entry, source states, capability and limit lines, and settings form copy. */
    sidebarSources: SidebarSourcesKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '资源库',
  'guide.title': '资源库',
  'guide.description': '把远端资料源接到这个主机：查看每个源的配置状态、凭据引用、设置与硬限制。',
  loading: '正在读取源状态…',
  reload: '重新读取',
  empty: '这个主机还没有注册任何远端资料源。',
  'kind.github': 'GitHub 代码检索',
  'kind.mysql': 'MySQL 只读查询',
  'kind.mediawiki': 'MediaWiki 站点',
  'state.unconfigured': '未配置',
  'state.unchecked': '未测试',
  'state.usable': '可用',
  'state.unusable': '不可用',
  probe: '测试连接',
  lastError: '最近一次失败：{message}',
  'probe.ok': '连接测试通过。',
  'probe.failed': '连接测试失败：{message}',
  'capabilities.title': '这个源能做什么',
  'capabilities.search': '检索',
  'capabilities.browse': '列目录',
  'capabilities.read': '读取文档',
  'capabilities.maxReadBytes': '单篇上限 {value} 字节',
  'capabilities.maxListItems': '单次最多列出 {value} 项',
  'capabilities.none': '这个源没有声明任何能力。',
  'credentials.title': '凭据引用',
  'credentials.configured': '已配置',
  'credentials.unset': '未配置',
  'credentials.source': '来源：{source}',
  'credentials.readonly': '不可写入',
  'credentials.note': '这里只显示引用名，不读取也不显示凭据值；值请在环境变量或凭据存储里提供。',
  'settings.title': '设置',
  'settings.loading': '正在读取设置…',
  'settings.unavailable': '这个源的设置没有暴露给这个客户端。',
  'settings.readonly': '这个部署的设置文档是只读的。',
  'settings.save': '保存',
  'settings.discard': '放弃修改',
  'settings.saving': '正在保存…',
  'settings.dirty': '有未保存的修改',
  'settings.failed': '保存没有生效：存储的设置可能已经改变，请再试一次。',
  'settings.resetField': '清除 {field} 的用户设置',
  'settings.unsupported': '这个字段不能在面板里编辑。',
  'settings.credentialHint': '凭据引用名，不是密钥本身。',
  'layer.user': '用户设置',
  'layer.base': '部署默认',
  'layer.default': '结构默认',
  'limits.title': '硬限制',
  'limits.github': '代码检索走 GitHub 自己的搜索 API，受它的速率限制约束：配额按认证方式区分，另有二次限流，超限的请求会被拒绝。配额随 GitHub 的策略变化，以 GitHub 当时的文档为准。',
  'limits.mysql': '只读：只允许 SELECT 以及 SHOW、DESCRIBE 这类结构读取，其余语句在查询入口被拒绝。可见的库和表必须在配置里显式列出，未列出的一律不可见；返回的行数与字节数都有上限，超限会截断并标记。',
  'limits.mediawiki': '只对配置里写明的站点生效。公开维基不需要凭据；私有维基需要一个机器人账号的用户名与密码。',
  'limits.other': '这个源的硬限制由提供它的插件说明，面板不代为声明。',
  'absent.title': '没有接入的网盘',
  'absent.note': '下面是设计里明确不做的源和原因；面板不为它们提供任何控件。',
  'absent.360': '360云盘：产品已停服，2016-11-01 起停止写入，2017 年数据清空。',
  'absent.netease': '网易云盘：产品已关闭，2019-11-30 关闭、2023-07-19 文件中心下线；它与网易云音乐云盘不是同一个产品。',
  'absent.quark': '夸克云盘：没有官方 API，只有重放的 __pus cookie 和硬编码 SIGN_KEY，且 ToS 点名第三方客户端并允许冻结账号。',
  'absent.baidu': '百度云：有官方开放平台和设备码流程，但未审核应用被限制在单个应用目录、每小时 10 次请求、10 个用户，不构成资料库。',
  'absent.360ai': '360AI云盘：与已停服的 360云盘是不同的在用产品，有官方 Apache-2.0 CLI/MCP，但标注「限时体验／请勿商用」；设计记录为本次不做。',
  'absent.alternatives': '替代路径：WebDAV 或 S3 兼容存储，以及已经挂载的本地目录，fs 能力已经覆盖后者，不需要新代码。',
  'error.unknown': '这个主机没有注册名为 {kind} 的源。',
  'error.failed': '源操作失败：{message}',
} satisfies Record<string, string>

/** Resource-library panel dictionary key union. */
export type SidebarSourcesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Resource library',
  'guide.title': 'Resource library',
  'guide.description': 'Attach remote resource sources to this host: see each source\'s configuration state, credential references, settings, and hard limits.',
  loading: 'Reading source status…',
  reload: 'Reload',
  empty: 'This host has no remote resource source registered.',
  'kind.github': 'GitHub code search',
  'kind.mysql': 'MySQL read-only query',
  'kind.mediawiki': 'MediaWiki site',
  'state.unconfigured': 'Not configured',
  'state.unchecked': 'Not tested',
  'state.usable': 'Usable',
  'state.unusable': 'Unusable',
  probe: 'Test connection',
  lastError: 'Last failure: {message}',
  'probe.ok': 'The connection test passed.',
  'probe.failed': 'The connection test failed: {message}',
  'capabilities.title': 'What this source can answer',
  'capabilities.search': 'Search',
  'capabilities.browse': 'List a directory',
  'capabilities.read': 'Read a document',
  'capabilities.maxReadBytes': 'At most {value} bytes per document',
  'capabilities.maxListItems': 'At most {value} entries per listing',
  'capabilities.none': 'This source declares no capability.',
  'credentials.title': 'Credential references',
  'credentials.configured': 'Configured',
  'credentials.unset': 'Not set',
  'credentials.source': 'Source: {source}',
  'credentials.readonly': 'Read-only',
  'credentials.note': 'Only reference names appear here: this panel neither reads nor shows a credential value. Supply values through an environment variable or the credential store.',
  'settings.title': 'Settings',
  'settings.loading': 'Reading settings…',
  'settings.unavailable': 'This source\'s settings are not exposed to this client.',
  'settings.readonly': 'This deployment\'s settings document is read-only.',
  'settings.save': 'Save',
  'settings.discard': 'Discard changes',
  'settings.saving': 'Saving…',
  'settings.dirty': 'Unsaved changes',
  'settings.failed': 'The save did not take effect: the stored settings may have moved. Try again.',
  'settings.resetField': 'Clear the user setting for {field}',
  'settings.unsupported': 'This field is not editable in the panel.',
  'settings.credentialHint': 'A credential reference name, not the secret itself.',
  'layer.user': 'User setting',
  'layer.base': 'Deployment default',
  'layer.default': 'Schema default',
  'limits.title': 'Hard limits',
  'limits.github': 'Code search runs against GitHub\'s own search API and is bound by its rate limits: the quota depends on how the request authenticates, secondary limits apply on top, and requests over quota are refused. The quota follows GitHub\'s policy, so GitHub\'s documentation is the current number.',
  'limits.mysql': 'Read-only: only SELECT, plus structural reads such as SHOW and DESCRIBE, are allowed; every other statement is refused at the query entry. Visible databases and tables must be listed in the configuration and anything unlisted stays invisible; returned rows and bytes are both bounded, and a truncated answer is marked as such.',
  'limits.mediawiki': 'Only the sites named in the configuration are reachable. A public wiki needs no credential; a private wiki needs a bot account\'s user name and password.',
  'limits.other': 'The plugin that provides this source states its hard limits; the panel does not claim them on its behalf.',
  'absent.title': 'Cloud drives that are not attached',
  'absent.note': 'These sources are deliberately not built, with the recorded reason; the panel offers no control for them.',
  'absent.360': '360 Cloud Drive: the product was shut down, writing stopped on 2016-11-01 and its data was cleared in 2017.',
  'absent.netease': 'NetEase Cloud Drive: the product closed on 2019-11-30 and its file centre went offline on 2023-07-19; it is not the same product as the NetEase Cloud Music drive.',
  'absent.quark': 'Quark Drive: no official API exists, only a replayed __pus cookie and a hardcoded SIGN_KEY, and its terms of service name third-party clients and permit freezing the account.',
  'absent.baidu': 'Baidu Cloud: an official open platform and device-code flow exist, but an unaudited application is confined to one application directory, 10 requests per hour, and 10 users, which is not a resource library.',
  'absent.360ai': '360AI Cloud Drive: a different, live product from the discontinued 360 Cloud Drive, with an official Apache-2.0 CLI/MCP, but marked limited trial and not for commercial use; the design records it as not built.',
  'absent.alternatives': 'The alternative path: WebDAV or S3-compatible storage, and an already-mounted local directory, which the fs capability already covers without new code.',
  'error.unknown': 'This host has no source named {kind}.',
  'error.failed': 'The source operation failed: {message}',
} satisfies Record<SidebarSourcesKey, string>

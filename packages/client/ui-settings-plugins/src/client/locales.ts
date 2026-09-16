/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'
  | 'subagentModelSelectionTitle' | 'subagentModelSelectionDescription'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'
  | 'tuituiTitle' | 'tuituiDescription'
  | 'tuituiAppId' | 'tuituiAppIdHint'
  | 'tuituiAppSecret' | 'tuituiAppSecretHint' | 'tuituiAppSecretSet' | 'tuituiAppSecretUnset'
  | 'tuituiHost' | 'tuituiHostHint'
  | 'tuituiCwd' | 'tuituiCwdHint'
  | 'tuituiDataDir' | 'tuituiDataDirHint'
  | 'tuituiAgentPreset' | 'tuituiAgentPresetHint'
  | 'tuituiPermissionPreset' | 'tuituiPermissionPresetHint'
  | 'tuituiProvider' | 'tuituiProviderHint'
  | 'tuituiModel' | 'tuituiModelHint'
  | 'tuituiAllowFrom' | 'tuituiAllowFromHint'
  | 'tuituiGroupAllowFrom' | 'tuituiGroupAllowFromHint'
  | 'tuituiRequireMention' | 'tuituiRequireMentionHint'
  | 'tuituiEmojiReaction' | 'tuituiEmojiReactionHint'
  | 'tuituiReactionEmoji' | 'tuituiReactionEmojiHint'
  | 'tuituiShowThinking' | 'tuituiShowThinkingHint'
  | 'tuituiTreeEnabled' | 'tuituiTreeEnabledHint'
  | 'tuituiTreePageSize' | 'tuituiTreePageSizeHint'
  | 'tuituiTreeShowHidden' | 'tuituiTreeShowHiddenHint'
  | 'tuituiTreeIgnore' | 'tuituiTreeIgnoreHint'
  | 'tuituiTreeAllowWrite' | 'tuituiTreeAllowWriteHint'
  | 'tuituiTreePersist' | 'tuituiTreePersistHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
  subagentModelSelectionTitle: 'Subagent',
  subagentModelSelectionDescription: 'Control which models agents may choose for subagents.',
  subagentModelSelectionToggle: 'Allow agents to choose models for subagents',
  subagentModelSelectionChoose: 'When enabled, agents can choose a provider, model, and reasoning effort for each subagent from the authorized models below. Applies only to new sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
  tuituiTitle: 'Tuitui',
  tuituiDescription: 'The Tuitui IM robot that forwards chat messages to agent sessions.',
  tuituiAppId: 'App ID',
  tuituiAppIdHint: 'The Tuitui application id. Changes reconnect the robot.',
  tuituiAppSecret: 'App secret',
  tuituiAppSecretHint: 'Stored as a secret field. Leave blank to keep the current secret.',
  tuituiAppSecretSet: 'A secret is configured.',
  tuituiAppSecretUnset: 'No secret is configured.',
  tuituiHost: 'Server host',
  tuituiHostHint: 'The Tuitui IM server host. Changes reconnect the robot.',
  tuituiCwd: 'Working directory',
  tuituiCwdHint: 'Directory the agent runs in. Leave blank to use the process directory.',
  tuituiDataDir: 'Data directory',
  tuituiDataDirHint: 'Where the bridge stores per-chat working directories and tree cards.',
  tuituiAgentPreset: 'Agent preset',
  tuituiAgentPresetHint: 'Leave blank to use the deployment default preset.',
  tuituiPermissionPreset: 'Permission preset',
  tuituiPermissionPresetHint: 'Leave blank to use the deployment default permission preset.',
  tuituiProvider: 'Provider',
  tuituiProviderHint: 'Registered provider id, not its display name. Leave both this and the model blank to use the deployment default.',
  tuituiModel: 'Model',
  tuituiModelHint: 'Model id within that provider, not its display name. Leave both this and the provider blank to use the deployment default.',
  tuituiAllowFrom: 'Allowed senders',
  tuituiAllowFromHint: 'Accounts allowed to message the bot directly. Separate with commas or newlines; `*` allows all.',
  tuituiGroupAllowFrom: 'Allowed groups',
  tuituiGroupAllowFromHint: 'Groups or teams allowed to use the bot. Separate with commas or newlines; `*` allows all.',
  tuituiRequireMention: 'Require @-mention',
  tuituiRequireMentionHint: 'Require an @-mention in groups and channels before the bot replies.',
  tuituiEmojiReaction: 'React with emoji',
  tuituiEmojiReactionHint: 'React to inbound messages with the reaction emoji.',
  tuituiReactionEmoji: 'Reaction emoji',
  tuituiReactionEmojiHint: 'The emoji the bot reacts with.',
  tuituiShowThinking: 'Show thinking',
  tuituiShowThinkingHint: 'Send a placeholder while the agent runs.',
  tuituiTreeEnabled: 'Enable file tree',
  tuituiTreeEnabledHint: 'Enable the /tree file-tree workbench command.',
  tuituiTreePageSize: 'Tree page size',
  tuituiTreePageSizeHint: 'Entries shown per tree page (1 to 12).',
  tuituiTreeShowHidden: 'Show hidden files',
  tuituiTreeShowHiddenHint: 'Include hidden files in tree listings.',
  tuituiTreeIgnore: 'Ignored names',
  tuituiTreeIgnoreHint: 'Extra names to hide in tree listings. Separate with commas or newlines.',
  tuituiTreeAllowWrite: 'Allow tree writes',
  tuituiTreeAllowWriteHint: 'Allow rename, delete, and copy through the tree card. Always confirmed.',
  tuituiTreePersist: 'Persist trees',
  tuituiTreePersistHint: 'Resume the same tree card after a restart.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安装的插件。',
  tabs: '插件视图',
  configurableTab: '插件配置',
  empty: '本部署没有开放任何插件设置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  webSearchApiKeySet: '已配置密钥。',
  webSearchApiKeyUnset: '未配置密钥；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空则使用提供方默认地址。',
  webSearchMaxUses: '单次请求最多搜索次数',
  webSearchMaxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
  subagentModelSelectionTitle: 'Subagent',
  subagentModelSelectionDescription: '控制 Agent 为 Subagent 选择模型的权限。',
  subagentModelSelectionToggle: '允许 Agent 为 Subagent 选择模型',
  subagentModelSelectionChoose: '开启后，Agent 可以从下方授权模型中，为每个 Subagent 选择提供方、模型和推理强度。仅影响新会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，Subagent 使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
  tuituiTitle: '推推',
  tuituiDescription: '把聊天消息转发给 Agent 会话的推推 IM 机器人。',
  tuituiAppId: 'App ID',
  tuituiAppIdHint: '推推应用 ID。修改后会重连机器人。',
  tuituiAppSecret: 'App Secret',
  tuituiAppSecretHint: '以密钥字段存储。留空表示保持当前密钥。',
  tuituiAppSecretSet: '已配置密钥。',
  tuituiAppSecretUnset: '未配置密钥。',
  tuituiHost: '服务器地址',
  tuituiHostHint: '推推 IM 服务器地址。修改后会重连机器人。',
  tuituiCwd: '工作目录',
  tuituiCwdHint: 'Agent 运行目录。留空表示使用进程目录。',
  tuituiDataDir: '数据目录',
  tuituiDataDirHint: '桥接存储各会话工作目录与文件树卡片的位置。',
  tuituiAgentPreset: 'Agent 预设',
  tuituiAgentPresetHint: '留空使用部署默认预设。',
  tuituiPermissionPreset: '权限预设',
  tuituiPermissionPresetHint: '留空使用部署默认权限预设。',
  tuituiProvider: '提供方',
  tuituiProviderHint: '可选的显式提供方路由覆盖。',
  tuituiModel: '模型',
  tuituiModelHint: '可选的显式模型覆盖。',
  tuituiAllowFrom: '允许的发送者',
  tuituiAllowFromHint: '允许私聊机器人的账号。用逗号或换行分隔；`*` 表示全部允许。',
  tuituiGroupAllowFrom: '允许的群组',
  tuituiGroupAllowFromHint: '允许使用机器人的群组或团队。用逗号或换行分隔；`*` 表示全部允许。',
  tuituiRequireMention: '需要 @ 提及',
  tuituiRequireMentionHint: '在群聊和频道中必须 @ 机器人才会回复。',
  tuituiEmojiReaction: '表情回应',
  tuituiEmojiReactionHint: '对收到的消息用回应表情进行反馈。',
  tuituiReactionEmoji: '回应表情',
  tuituiReactionEmojiHint: '机器人用于回应的表情。',
  tuituiShowThinking: '显示思考中',
  tuituiShowThinkingHint: 'Agent 运行期间先发送一条占位消息。',
  tuituiTreeEnabled: '启用文件树',
  tuituiTreeEnabledHint: '启用 /tree 文件树工作台命令。',
  tuituiTreePageSize: '文件树每页条数',
  tuituiTreePageSizeHint: '文件树每页显示的条目数（1 到 12）。',
  tuituiTreeShowHidden: '显示隐藏文件',
  tuituiTreeShowHiddenHint: '文件树列表中包含隐藏文件。',
  tuituiTreeIgnore: '忽略的名称',
  tuituiTreeIgnoreHint: '文件树列表中额外隐藏的名称。用逗号或换行分隔。',
  tuituiTreeAllowWrite: '允许文件树写入',
  tuituiTreeAllowWriteHint: '允许通过文件树卡片重命名、删除和复制。操作始终需要确认。',
  tuituiTreePersist: '持久化文件树',
  tuituiTreePersistHint: '重启后恢复同一个文件树卡片。',
}

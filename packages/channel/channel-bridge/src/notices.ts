/**
 * The one table of chat notices the bridge sends.
 *
 * Every notice is bilingual in one string because the server has no locale for
 * an external chat: the person reading it in DingTalk, WeChat, or Tuitui is not
 * the person who chose this deployment's language, and a notice that guesses
 * wrong is a notice nobody can act on. Keeping them in one table is what makes
 * that policy reviewable in one place rather than at a dozen throw sites.
 *
 * @module @deepseek-ai/dsh-channel-bridge
 */

/** How much of a platform's own failure reason rides into the chat before it is cut. */
const REASON_MAX_CHARS = 200

/**
 * Bound one platform-supplied reason so a verbose failure cannot flood a chat.
 * @param reason - the platform's own failure text.
 * @returns the reason, ellipsized past {@link REASON_MAX_CHARS}.
 */
function bounded(reason: string): string {
  const flat = reason.replace(/\s+/g, ' ').trim()
  return flat.length <= REASON_MAX_CHARS ? flat : `${flat.slice(0, REASON_MAX_CHARS - 1)}…`
}

/**
 * One notice per way this bridge has something to say. Functions take the facts
 * that vary; the rest are fixed strings.
 */
export interface ChatNoticeTable {
  /** The message carried nothing this channel can admit. */
  readonly unsupportedMessage: string
  /** The Session was busy, so the message was queued rather than refused. */
  readonly queued: string
  /** A tool call is waiting for a decision that this chat cannot give. */
  readonly approvalWaiting: string
  /** The run ended in failure and delivered no text. */
  readonly runFailed: (reason: string) => string
  /** An inbound image exceeded the transfer cap. */
  readonly imageTooLarge: (maxBytes: number) => string
  /** An inbound image could not be transferred at all. */
  readonly imageFailed: (reason: string) => string
  /** An inbound image was refused for a permission the bot's application lacks. */
  readonly imagePermission: (scopes: readonly string[], grantUrl: string | null) => string
  /** An inbound file exceeded the transfer cap. */
  readonly fileTooLarge: (fileName: string, maxBytes: number) => string
  /** An inbound file could not be transferred at all. */
  readonly fileFailed: (fileName: string, reason: string) => string
  /** An inbound file was refused for a permission the bot's application lacks. */
  readonly filePermission: (fileName: string, scopes: readonly string[], grantUrl: string | null) => string
  /** An outbound file exceeded what the platform accepts. */
  readonly fileSendTooLarge: (fileName: string, maxBytes: number) => string
  /** An outbound file could not be sent. */
  readonly fileSendFailed: (fileName: string, reason: string) => string
  /** An outbound file was refused for a permission the bot's application lacks. */
  readonly fileSendPermission: (fileName: string, scopes: readonly string[], grantUrl: string | null) => string
  /** A reply named more files than one round may deliver. */
  readonly filesSkipped: (count: number) => string
}

/** Round a byte cap down to whole mebibytes for a notice, never below one. */
function mebibytes(maxBytes: number): number {
  return Math.max(1, Math.floor(maxBytes / (1024 * 1024)))
}

/** The scope list and console link one permission notice names. */
function permissionDetail(scopes: readonly string[], grantUrl: string | null): string {
  const named = scopes.length > 0 ? scopes.join(', ') : 'an application scope'
  return grantUrl === null ? named : `${named} (${grantUrl})`
}

/** Every notice this bridge sends. */
export const CHAT_NOTICES: ChatNoticeTable = {
  unsupportedMessage:
    'Only text, image and file messages are supported for now. 目前仅支持文本、图片和文件消息。',
  queued:
    'The Agent is busy, so this message is queued and will run next. 智能体正忙，此消息已排队，将在当前任务后处理。',
  approvalWaiting:
    'A tool call is waiting for your approval in the DeepSeek Harness Web App. 有工具调用正在等待你在 DeepSeek Harness 网页端批准。',
  runFailed: reason =>
    `The run failed: ${bounded(reason)} 运行失败：${bounded(reason)}`,
  imageTooLarge: maxBytes =>
    `That image is larger than the ${mebibytes(maxBytes)}MB limit, so it was not sent to the Agent. 该图片超过 ${mebibytes(maxBytes)}MB 上限，未发送给智能体。`,
  imageFailed: reason =>
    `That image could not be downloaded: ${bounded(reason)} 该图片下载失败：${bounded(reason)}`,
  imagePermission: (scopes, grantUrl) =>
    `The bot's application is missing a scope needed to read images: ${permissionDetail(scopes, grantUrl)}. 机器人应用缺少读取图片所需的权限：${permissionDetail(scopes, grantUrl)}。`,
  fileTooLarge: (fileName, maxBytes) =>
    `\`${fileName}\` is larger than the ${mebibytes(maxBytes)}MB limit, so it was not sent to the Agent. \`${fileName}\` 超过 ${mebibytes(maxBytes)}MB 上限，未发送给智能体。`,
  fileFailed: (fileName, reason) =>
    `\`${fileName}\` could not be downloaded: ${bounded(reason)} \`${fileName}\` 下载失败：${bounded(reason)}`,
  filePermission: (fileName, scopes, grantUrl) =>
    `\`${fileName}\` needs a scope the bot's application does not have: ${permissionDetail(scopes, grantUrl)}. \`${fileName}\` 需要机器人应用尚未授予的权限：${permissionDetail(scopes, grantUrl)}。`,
  fileSendTooLarge: (fileName, maxBytes) =>
    `\`${fileName}\` is larger than the ${mebibytes(maxBytes)}MB the chat accepts, so it was not sent. \`${fileName}\` 超过聊天可接收的 ${mebibytes(maxBytes)}MB，未发送。`,
  fileSendFailed: (fileName, reason) =>
    `\`${fileName}\` could not be sent: ${bounded(reason)} \`${fileName}\` 发送失败：${bounded(reason)}`,
  fileSendPermission: (fileName, scopes, grantUrl) =>
    `\`${fileName}\` needs a scope the bot's application does not have: ${permissionDetail(scopes, grantUrl)}. \`${fileName}\` 需要机器人应用尚未授予的权限：${permissionDetail(scopes, grantUrl)}。`,
  filesSkipped: count =>
    `${String(count)} more file(s) were not sent, over the per-reply limit. 还有 ${String(count)} 个文件超过单次回复上限，未发送。`,
}

/**
 * `sidebarTextpreview` namespace dictionaries.
 *
 * The failure lines are the point of this file: a preview that cannot show a
 * page has to say which of several different things went wrong, and each one
 * suggests a different next step for the reader. The edit keys follow the same
 * rule for a save: which refusal it was, and what the reader can do about it.
 */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  loading: '正在读取…',
  loadMore: '加载更多',
  changed: '文件已被修改，显示的还是旧内容。',
  reloadNow: '重新载入',
  reload: '重新读取文件',
  wrap: '自动换行',
  edit: '编辑',
  editor: '文件内容',
  save: '保存',
  cancel: '取消',
  saving: '正在保存…',
  saved: '已保存',
  'save.stale': '文件已在磁盘上被修改，你的编辑没有保存。',
  'save.tooLarge': '内容太大，超过 {limit}，没有保存。',
  'edit.refused.loading': '文件还在读取，读完才能编辑。',
  'edit.refused.failed': '这个文件读取失败，不能在这里编辑。',
  'edit.refused.partial': '这个文件分成多页读取，侧栏不编辑它：编辑会替换整个文件。',
  'error.notFound': '这个文件不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个文件在工作区之外，侧栏不会读取它。',
  'error.tooLarge': '这一页太大，侧栏不读取超过 {limit} 的页。',
  'error.notText': '这不是文本文件，没法在这里查看。',
  'error.notRegularFile': '这不是一个普通文件，没有可显示的文本。',
  'error.unavailable': '读取失败：{message}',
  retry: '重试',
} satisfies Record<string, string>

/** Text-preview dictionary key union. */
export type SidebarTextpreviewKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  loading: 'Reading…',
  loadMore: 'Load more',
  changed: 'The file has changed; this is the older text.',
  reloadNow: 'Reload',
  reload: 'Read the file again',
  wrap: 'Wrap lines',
  edit: 'Edit',
  editor: 'File content',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving…',
  saved: 'Saved',
  'save.stale': 'The file changed on disk, so your edit was not saved.',
  'save.tooLarge': 'That content is above {limit}, so it was not saved.',
  'edit.refused.loading': 'Still reading the file; editing opens once it is loaded.',
  'edit.refused.failed': 'That file could not be read, so it cannot be edited here.',
  'edit.refused.partial': 'This file is read in several pages, so the sidebar will not edit it: an edit replaces the whole file.',
  'error.notFound': 'That file is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That file is outside the workspace, so the sidebar will not read it.',
  'error.tooLarge': 'That page is too large; the sidebar does not read pages above {limit}.',
  'error.notText': 'That is not a text file, so it cannot be shown here.',
  'error.notRegularFile': 'That is not a regular file, so it has no text to show.',
  'error.unavailable': 'Read failed: {message}',
  retry: 'Retry',
} satisfies Record<SidebarTextpreviewKey, string>

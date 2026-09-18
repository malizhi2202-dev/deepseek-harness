/**
 * `sidebarGit` namespace dictionaries, and the namespace's declaration.
 *
 * The status lines name what the panel could not read, one code each, because
 * a host without git and an observation that failed suggest different next
 * steps. The change-kind words mirror the seam's `GitChangeKind` union, one key
 * per member, so a row never falls back to an untranslated kind.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarGit'>` or `PropsLocale<'sidebarGit'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git panel type name, guide entry, section titles, row states, and failure lines. */
    sidebarGit: SidebarGitKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': 'Git',
  'guide.title': 'Git 仓库',
  'guide.description': '查看这个工作区所在 git 仓库的分支、提交历史和工作区改动。',
  loading: '正在读取仓库状态…',
  absent: '这个会话的工作区不在 git 仓库里。',
  noWorkspace: '这个会话没有工作区目录。',
  reload: '重新读取',
  'section.head': '当前状态',
  'section.branches': '分支',
  'section.history': '提交历史',
  'section.worktree': '工作区改动',
  'head.detached': '分离头指针（不在线上分支）',
  'head.unborn': '这个分支还没有提交。',
  'head.upstream': '跟踪 {upstream}',
  'head.aheadBehind': '领先 {ahead} 个提交，落后 {behind} 个',
  'head.oid': '当前提交 {oid}',
  'head.root': '仓库根目录 {root}',
  'branches.current': '当前分支',
  'branches.empty': '还没有本地分支。',
  'branches.truncated': '分支太多，只显示了一部分。',
  'history.empty': '还没有提交。',
  'history.truncated': '提交太多，只显示最近的 {count} 条。',
  'worktree.empty': '工作区是干净的。',
  'worktree.truncated': '改动太多，只显示了一部分。',
  'worktree.counts': '已暂存 {staged} · 未暂存 {unstaged} · 未跟踪 {untracked}',
  'worktree.untracked': '未跟踪',
  'worktree.from': '← {from}',
  'side.staged': '已暂存',
  'side.unstaged': '未暂存',
  'change.modified': '修改',
  'change.added': '新增',
  'change.deleted': '删除',
  'change.renamed': '重命名',
  'change.copied': '复制',
  'change.type-changed': '类型变更',
  'change.unmerged': '未合并',
  'error.unavailable': '无法在这个主机上运行 git：{message}',
  'error.failed': '读取仓库状态失败：{message}',
} satisfies Record<string, string>

/** Git dictionary key union. */
export type SidebarGitKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Git',
  'guide.title': 'Git repository',
  'guide.description': 'See the branches, commit history, and working-tree changes of the repository containing this workspace.',
  loading: 'Reading repository state…',
  absent: 'This session\'s workspace is not inside a git repository.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  'section.head': 'Current state',
  'section.branches': 'Branches',
  'section.history': 'Commit history',
  'section.worktree': 'Working-tree changes',
  'head.detached': 'Detached HEAD (not on a branch)',
  'head.unborn': 'This branch has no commits yet.',
  'head.upstream': 'Tracks {upstream}',
  'head.aheadBehind': '{ahead} ahead, {behind} behind',
  'head.oid': 'At commit {oid}',
  'head.root': 'Repository root {root}',
  'branches.current': 'current branch',
  'branches.empty': 'No local branches yet.',
  'branches.truncated': 'Too many branches; showing only some of them.',
  'history.empty': 'No commits yet.',
  'history.truncated': 'Too many commits; showing the most recent {count}.',
  'worktree.empty': 'The working tree is clean.',
  'worktree.truncated': 'Too many changes; showing only some of them.',
  'worktree.counts': '{staged} staged · {unstaged} unstaged · {untracked} untracked',
  'worktree.untracked': 'untracked',
  'worktree.from': '← {from}',
  'side.staged': 'staged',
  'side.unstaged': 'unstaged',
  'change.modified': 'modified',
  'change.added': 'added',
  'change.deleted': 'deleted',
  'change.renamed': 'renamed',
  'change.copied': 'copied',
  'change.type-changed': 'type changed',
  'change.unmerged': 'unmerged',
  'error.unavailable': 'git cannot be run on this host: {message}',
  'error.failed': 'Reading repository state failed: {message}',
} satisfies Record<SidebarGitKey, string>

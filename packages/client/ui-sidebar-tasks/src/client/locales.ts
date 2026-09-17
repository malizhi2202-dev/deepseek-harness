/**
 * `sidebarTasks` namespace dictionaries, and the namespace's declaration.
 *
 * The copy covers the two sections, the three todo states, the five job states,
 * and the progress summary. Status words are the panel's own wording for wire
 * states, so they live here rather than being derived from the discriminant.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarTasks'>` or `PropsLocale<'sidebarTasks'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-observation type name, guide entry, section headings, and state words. */
    sidebarTasks: SidebarTasksKey
  }
}

/** This package's copy namespace. */
export const NS = 'sidebarTasks'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '任务',
  'guide.title': '任务观测',
  'guide.description': '查看这个会话的待办清单和后台任务。',
  'section.todos': '待办清单',
  'section.jobs': '后台任务',
  'todos.empty': '这个会话还没有待办清单。',
  'jobs.empty': '没有后台任务。',
  'todo.pending': '待办',
  'todo.in_progress': '进行中',
  'todo.completed': '已完成',
  'progress.label': '已完成 {done} / {total}',
  'progress.aria': '待办完成进度',
  'job.running': '运行中',
  'job.stopping': '停止中',
  'job.completed': '已完成',
  'job.killed': '已终止',
  'job.failed': '失败',
} satisfies Record<string, string>

/** Tasks dictionary key union. */
export type SidebarTasksKey = keyof typeof zh

/** English dictionary, keyed by the Chinese dictionary's keys. */
export const en = {
  'type.label': 'Tasks',
  'guide.title': 'Task observation',
  'guide.description': 'This session\'s todo list and background jobs, in one place.',
  'section.todos': 'Todo list',
  'section.jobs': 'Background jobs',
  'todos.empty': 'This session has no todo list yet.',
  'jobs.empty': 'No background jobs.',
  'todo.pending': 'Pending',
  'todo.in_progress': 'In progress',
  'todo.completed': 'Completed',
  'progress.label': '{done} of {total} done',
  'progress.aria': 'Todo completion progress',
  'job.running': 'Running',
  'job.stopping': 'Stopping',
  'job.completed': 'Completed',
  'job.killed': 'Killed',
  'job.failed': 'Failed',
} satisfies Record<SidebarTasksKey, string>

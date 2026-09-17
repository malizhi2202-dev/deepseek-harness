/**
 * The task panel's body: this session's todo list and background jobs.
 *
 * Both facts arrive through framework hooks, so the component holds no state and
 * issues no request: the todo list is the host-computed `todos` projection and
 * the jobs are the Session object layer's `jobsBySession` mirror, both already
 * live in the browser. The panel only decides what each entry reads as.
 *
 * The todo list is drawn in the model's own write order, because that order is
 * the plan; the counts above it are the aggregate view of the same list.
 */
import clsx from 'clsx'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { NS, type SidebarTasksKey } from './locales.ts'
import css from './TasksBody.module.css'

/** The body's composed props: the session's identity, its live facts, and copy. */
export type TasksBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>

/** Stable empty lists so a session with nothing to show keeps one array identity. */
const NO_TODOS: readonly TodoItem[] = []
const NO_JOBS: readonly JobView[] = []

/** The panel's words for the three todo states, exhaustive over the wire union. */
const TODO_STATE_KEY = {
  pending: 'todo.pending',
  in_progress: 'todo.in_progress',
  completed: 'todo.completed',
} as const satisfies Record<TodoItem['status'], SidebarTasksKey>

/** The panel's words for the five job states, exhaustive over the wire union. */
const JOB_STATE_KEY = {
  running: 'job.running',
  stopping: 'job.stopping',
  completed: 'job.completed',
  killed: 'job.killed',
  failed: 'job.failed',
} as const satisfies Record<JobView['status'], SidebarTasksKey>

/** How much of a todo list is done, and how much is left in each open state. */
export interface TodoCounts {
  /** Every entry the model has written. */
  readonly total: number
  /** Entries marked `completed`. */
  readonly done: number
  /** Entries marked `in_progress`. */
  readonly active: number
  /** Entries marked `pending`. */
  readonly pending: number
}

/**
 * Count a todo list by state.
 * @param todos - the list as the model last wrote it.
 * @returns the totals the summary line and the progress bar read.
 */
export function todoCounts(todos: readonly TodoItem[]): TodoCounts {
  let done = 0
  let active = 0
  let pending = 0
  for (const todo of todos) {
    switch (todo.status) {
      case 'completed': done += 1; break
      case 'in_progress': active += 1; break
      case 'pending': pending += 1; break
    }
  }
  return { total: todos.length, done, active, pending }
}

/**
 * The completed share of a counted list, as a whole percentage.
 * @param counts - the counted list.
 * @returns 0 for an empty list, otherwise the rounded completed share.
 */
export function progressPercent(counts: TodoCounts): number {
  return counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100)
}

/**
 * The marker a todo state draws.
 * @param status - the entry's wire state.
 * @returns the state marker for that entry.
 */
export function todoDot(status: TodoItem['status']): StateDotState {
  switch (status) {
    case 'completed': return 'done'
    case 'in_progress': return 'ongoing'
    case 'pending': return 'idle'
  }
}

/**
 * The marker a job state draws. `stopping` and `killed` share the attention
 * color: both mean the work ended, or is ending, on request.
 * @param status - the job's wire state.
 * @returns the state marker for that job.
 */
export function jobDot(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
  }
}

/** One todo entry: its marker, the model's line, and the state it is in. */
function TodoRow({ todo, t }: { todo: TodoItem; t: TranslateNS<typeof NS> }) {
  const settled = todo.status === 'completed'
  return (
    <li className={css.row} data-tasks-todo={todo.status}>
      <StateDot state={todoDot(todo.status)} className={css.dot} />
      <span className={clsx(css.text, settled && css.settled)}>{todo.content}</span>
      <span className={css.state}>{t(TODO_STATE_KEY[todo.status])}</span>
    </li>
  )
}

/** One background job: its marker, its label, its optional detail, and its state. */
function JobRow({ job, t }: { job: JobView; t: TranslateNS<typeof NS> }) {
  return (
    <li className={css.row} data-tasks-job={job.status}>
      <StateDot state={jobDot(job.status)} className={css.dot} />
      <span className={css.body}>
        <span className={css.text}>{job.label}</span>
        {job.detail === undefined ? null : <span className={css.detail}>{job.detail}</span>}
      </span>
      <span className={css.state}>{t(JOB_STATE_KEY[job.status])}</span>
    </li>
  )
}

/**
 * Draw the session's task panel.
 * @param props - the runtime share (session identity and live facts) and copy.
 * @returns the todo list with its progress summary, then the background jobs.
 */
export function TasksBody({ useProjection, useSessions, sessionId, t }: TasksBodyProps) {
  const todos = useProjection('todos') ?? NO_TODOS
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_JOBS
  const counts = todoCounts(todos)
  return (
    <div className={css.panel}>
      <section className={css.section} data-tasks-section="todos">
        <div className={css.head}>
          <h2 className={css.heading}>{t('section.todos')}</h2>
          {counts.total === 0 ? null : (
            <span className={css.summary}>{t('progress.label', { done: counts.done, total: counts.total })}</span>
          )}
        </div>
        {counts.total === 0 ? null : (
          <div
            className={css.track}
            role="progressbar"
            aria-label={t('progress.aria')}
            aria-valuemin={0}
            aria-valuemax={counts.total}
            aria-valuenow={counts.done}
          >
            <div className={css.bar} style={{ inlineSize: `${String(progressPercent(counts))}%` }} />
          </div>
        )}
        {todos.length === 0
          ? <p className={css.empty}>{t('todos.empty')}</p>
          : <ul className={css.list}>{todos.map((todo, index) => (
            // The list is replaced wholesale on every write and entries have no
            // identity of their own, so position and text together identify a row.
            <TodoRow key={`${String(index)}:${todo.content}`} todo={todo} t={t} />
          ))}</ul>}
      </section>
      <section className={css.section} data-tasks-section="jobs">
        <div className={css.head}>
          <h2 className={css.heading}>{t('section.jobs')}</h2>
        </div>
        {jobs.length === 0
          ? <p className={css.empty}>{t('jobs.empty')}</p>
          : <ul className={css.list}>{jobs.map(job => <JobRow key={job.id} job={job} t={t} />)}</ul>}
      </section>
    </div>
  )
}

/**
 * Mount the body over scripted session facts.
 *
 * The component reads four props — the session's identity, its two live facts,
 * and copy — and the rest of the standard kit is framework-injected and never
 * touched here, so one documented cast keeps the harness to what is actually
 * exercised. Both facts are handed over as plain values: `useProjection` and
 * `useSessions` are the framework's seats, and the panel only calls the first
 * for `todos` and the second for this session's jobs.
 */
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { TasksBody } from '../src/client/TasksBody.tsx'
import type { TasksBodyProps } from '../src/client/TasksBody.tsx'
import { zh } from '../src/client/locales.ts'

/** The session every mount reports facts for. */
export const SESSION = 's-test' as SessionId

/** The session facts one mount is driven with. */
export interface Facts {
  /** The `todos` projection value; `null` is the state before the model's first write. */
  readonly todos?: readonly TodoItem[] | null
  /** The session's background jobs; `null` is a job mirror with no entry for this session. */
  readonly jobs?: readonly SessionJob[] | null
}

/** What a spec holds after mounting. */
export interface Mounted {
  readonly view: RenderResult
}

/**
 * Build one job record, so each spec states only the fields it is about.
 * @param over - the fields that differ from a running, detail-free job.
 * @returns the job record.
 */
export function job(over: Partial<SessionJob> = {}): SessionJob {
  return {
    id: 'job-1' as SessionJob['id'],
    kind: 'bash',
    label: 'job',
    status: 'running',
    startedAt: 1,
    ...over,
  }
}

/**
 * Mount the body.
 * @param facts - the projection value and job list to drive it with.
 * @returns the rendered view.
 */
export function mountBody(facts: Facts = {}): Mounted {
  const { todos = null, jobs = [] } = facts
  const jobsBySession = jobs === null ? {} : { [SESSION]: jobs }
  const sessions = { jobsBySession } as unknown as SessionListState
  const shared = {
    sessionId: SESSION,
    useProjection: (key: string) => key === 'todos' ? todos : undefined,
    useSessions: <S,>(select: (state: SessionListState) => S): S => select(sessions),
    t: makeTranslate(zh),
  }
  return { view: render(<TasksBody {...shared as unknown as TasksBodyProps} />) }
}

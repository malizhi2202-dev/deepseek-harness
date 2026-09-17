// @vitest-environment jsdom
/**
 * The panel against scripted session facts.
 *
 * What is asserted is the reader's contract: the plan comes out in the model's
 * write order with each entry's state, the summary and progress bar aggregate
 * the same list, a job shows its label, its optional detail, and its state, and
 * a session with neither fact says so instead of drawing an empty frame. The
 * four pure helpers are checked on their own, including the empty list, which is
 * the one input that could divide by zero.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { jobDot, progressPercent, todoCounts, todoDot } from '../src/client/TasksBody.tsx'
import { zh } from '../src/client/locales.ts'
import { job, mountBody } from './mount.client.tsx'

const PLAN: readonly TodoItem[] = [
  { content: '读取配置', status: 'completed' },
  { content: '实现面板', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

afterEach(() => { cleanup() })

/** The todo rows, in document order, as their state attributes. */
function todoStates(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-tasks-todo]')].map(li => li.getAttribute('data-tasks-todo'))
}

describe('todoCounts', () => {
  it('counts every state and the total', () => {
    expect(todoCounts(PLAN)).toEqual({ total: 3, done: 1, active: 1, pending: 1 })
  })

  it('counts an empty list as all zero', () => {
    expect(todoCounts([])).toEqual({ total: 0, done: 0, active: 0, pending: 0 })
  })
})

describe('progressPercent', () => {
  it('reports the rounded completed share', () => {
    expect(progressPercent({ total: 3, done: 1, active: 1, pending: 1 })).toBe(33)
  })

  it('reports no progress for an empty list rather than dividing by zero', () => {
    expect(progressPercent({ total: 0, done: 0, active: 0, pending: 0 })).toBe(0)
  })
})

describe('todoDot', () => {
  it('marks a pending entry idle, a working entry ongoing, and a finished entry done', () => {
    expect([todoDot('pending'), todoDot('in_progress'), todoDot('completed')]).toEqual(['idle', 'ongoing', 'done'])
  })
})

describe('jobDot', () => {
  it('marks a running job ongoing, a finished one done, and every requested or failed end as attention', () => {
    const states: readonly SessionJob['status'][] = ['running', 'stopping', 'completed', 'killed', 'failed']
    expect(states.map(jobDot)).toEqual(['ongoing', 'warning', 'done', 'warning', 'error'])
  })
})

describe('TasksBody', () => {
  it('says the session has neither a todo list nor jobs, and draws no progress bar', () => {
    const { view } = mountBody()
    expect(view.container.querySelector('[data-tasks-section="todos"]')?.textContent)
      .toContain(zh['todos.empty'])
    expect(view.container.querySelector('[data-tasks-section="jobs"]')?.textContent)
      .toContain(zh['jobs.empty'])
    expect(view.container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('draws the plan in the model\'s write order with each entry\'s state word', () => {
    const { view } = mountBody({ todos: PLAN })
    expect(todoStates(view.container)).toEqual(['completed', 'in_progress', 'pending'])
    const rows = [...view.container.querySelectorAll('[data-tasks-todo]')].map(li => li.textContent)
    expect(rows).toEqual([
      `读取配置${zh['todo.completed']}`,
      `实现面板${zh['todo.in_progress']}`,
      `补测试${zh['todo.pending']}`,
    ])
  })

  it('summarizes the same list as a count and a bar', () => {
    const { view } = mountBody({ todos: PLAN })
    expect(view.container.querySelector('[data-tasks-section="todos"]')?.textContent)
      .toContain(zh['progress.label'].replace('{done}', '1').replace('{total}', '3'))
    const bar = view.container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-label')).toBe(zh['progress.aria'])
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe('3')
    expect(bar?.getAttribute('aria-valuenow')).toBe('1')
  })

  it('says there are no jobs when the job mirror carries no entry for the session', () => {
    const { view } = mountBody({ jobs: null })
    expect(view.container.querySelector('[data-tasks-section="jobs"]')?.textContent)
      .toContain(zh['jobs.empty'])
  })

  it('draws a job with its label, detail, and state', () => {
    const { view } = mountBody({ jobs: [job({ label: 'pnpm test', detail: 'suite 2 of 4' })] })
    const row = view.container.querySelector('[data-tasks-job="running"]')
    expect(row?.textContent).toBe(`pnpm test${'suite 2 of 4'}${zh['job.running']}`)
    expect(view.container.querySelector('[data-tasks-section="jobs"]')?.textContent)
      .not.toContain(zh['jobs.empty'])
  })

  it('draws a finished job without a detail line', () => {
    const { view } = mountBody({ jobs: [job({ label: 'pnpm build', status: 'completed', finishedAt: 2 })] })
    expect(view.container.querySelector('[data-tasks-job="completed"]')?.textContent)
      .toBe(`pnpm build${zh['job.completed']}`)
  })
})

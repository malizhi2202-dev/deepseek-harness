/**
 * Tests for the console's output stream: the bounded poll becomes an append or
 * a replacement frame, a shell that exits ends the stream and is reaped, a
 * shell that vanishes is reported as an exit with no code, a PTY failure keeps
 * its declared code, and cancellation ends the stream promptly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalError } from '@deepseek-ai/dsh-terminal'
import type { TerminalConsoleFrame } from '../src/types.ts'
import { createHarness, createOwner, type ConsoleHarness } from './harness.ts'
import type { FakeTerminalSession } from './fake-terminals.ts'

/** A shell id the console minted for the first open of one owner. */
const FIRST_SHELL = 'console-1'

afterEach(() => { vi.useRealTimers() })

/** The PTY session the console published for one harness's first shell. */
function sessionOf(harness: ConsoleHarness): FakeTerminalSession {
  const session = harness.terminals.sessions.get('pty-1')
  if (session === undefined) throw new Error('the console did not publish a PTY session')
  return session
}

/** Resume the stream after one poll interval, returning the frame it produced. */
async function poll(
  iterator: AsyncIterator<TerminalConsoleFrame>,
  intervalMs: number,
): Promise<IteratorResult<TerminalConsoleFrame>> {
  const pending = iterator.next()
  await vi.advanceTimersByTimeAsync(intervalMs)
  return await pending
}

describe('TerminalConsole.output', () => {
  it('attaches with the retained window and ends on cancellation', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-attach')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).text = 'ready\nprompt$ '
    const controller = new AbortController()
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, controller.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      // The attach frame is a replacement: a reconnecting consumer must not
      // append a window it may already hold.
      value: { kind: 'output', text: 'ready\nprompt$ ', replace: true },
    })
    controller.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await harness.dispose()
  })

  it('emits no frame while the retained page is unchanged', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ pollIntervalMs: 250 })
    const owner = await createOwner(harness.ctx, 'a-idle')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).text = 'ready'
    const controller = new AbortController()
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, controller.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { text: 'ready' } })
    const pending = iterator.next()
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.terminals.reads).toHaveLength(3)
    controller.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    await harness.dispose()
  })

  it('appends new output and replaces the view once the page slides', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ pollIntervalMs: 250 })
    const owner = await createOwner(harness.ctx, 'a-slide')
    await harness.console.open(owner.agent, new AbortController().signal)
    const session = sessionOf(harness)
    session.text = 'one\n'
    const controller = new AbortController()
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, controller.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'output', text: 'one\n', replace: true },
    })

    session.text = 'one\ntwo\n'
    await expect(poll(iterator, 250)).resolves.toEqual({
      done: false,
      value: { kind: 'output', text: 'two\n', replace: false },
    })

    // The backend's bound dropped `one` from the head, so the seam reports the
    // whole retained page rather than splicing an unseen gap.
    session.text = 'two\n'
    await expect(poll(iterator, 250)).resolves.toEqual({
      done: false,
      value: { kind: 'output', text: 'two\n', replace: true },
    })

    controller.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await harness.dispose()
  })

  it('ends with an exit frame and reaps the shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-exit')
    await harness.console.open(owner.agent, new AbortController().signal)
    const session = sessionOf(harness)
    session.text = 'bye\n'
    session.status = { kind: 'exited', exitCode: 0, signal: null }
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { kind: 'output', text: 'bye\n' } })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'exit', exitCode: 0, signal: null },
    })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(harness.terminals.kills).toEqual([{ id: 'pty-1', reason: 'console shell exited' }])
    expect(harness.console.list(owner.agent)).toEqual([])
    await harness.dispose()
  })

  it('reports the terminating signal of an exited shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-signal')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).status = { kind: 'exited', exitCode: null, signal: 'SIGKILL' }
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'exit', exitCode: null, signal: 'SIGKILL' },
    })
    await harness.dispose()
  })

  it('treats a PTY session that is already gone as reaped', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-reaped')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).status = { kind: 'exited', exitCode: 3, signal: null }
    harness.terminals.killError = new TerminalError('already gone', 'NO_SESSION')
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'exit', exitCode: 3, signal: null },
    })
    expect(harness.console.list(owner.agent)).toEqual([])
    await harness.dispose()
  })

  it('fails the stream when the shell cannot be reaped', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-reapfail')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).status = { kind: 'exited', exitCode: 0, signal: null }
    harness.terminals.killError = new Error('reap exploded')
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'terminal-console/failed',
      message: 'reap exploded',
    })
    await harness.dispose()
  })

  it('reports a shell that vanished under the stream as an exit with no code', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ pollIntervalMs: 250 })
    const owner = await createOwner(harness.ctx, 'a-vanish')
    await harness.console.open(owner.agent, new AbortController().signal)
    sessionOf(harness).text = 'ready'
    const controller = new AbortController()
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, controller.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { text: 'ready' } })
    harness.terminals.drop('pty-1' as never)
    await expect(poll(iterator, 250)).resolves.toEqual({
      done: false,
      value: { kind: 'exit', exitCode: null, signal: null },
    })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await harness.dispose()
  })

  it('keeps a PTY read failure on its declared code', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-readfail')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.readError = new TerminalError('no backend registered', 'NO_BACKEND')
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toMatchObject({ code: 'terminal-console/unavailable' })
    await harness.dispose()
  })

  it('carries a non-PTY read rejection as a generic failure', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-readthrew')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.readError = 'not an error'
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'terminal-console/failed',
      message: 'not an error',
    })
    await harness.dispose()
  })

  it('names an unknown shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-unknown-stream')
    const iterator = harness.console.output(owner.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'terminal-console/unknown-shell' })
    await harness.dispose()
  })

  it('produces nothing for a signal that is already aborted', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-preattached')
    await harness.console.open(owner.agent, new AbortController().signal)
    const controller = new AbortController()
    controller.abort()
    const frames: TerminalConsoleFrame[] = []
    for await (const frame of harness.console.output(owner.agent, FIRST_SHELL, controller.signal)) frames.push(frame)
    expect(frames).toEqual([])
    expect(harness.terminals.reads).toEqual([])
    await harness.dispose()
  })
})

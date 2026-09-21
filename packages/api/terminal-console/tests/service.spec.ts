/**
 * Tests for the `terminalConsole` Remote service: config defaults and load
 * failure, the network-surface refusal, the per-session shell authority, the
 * deployment bounds, write and close behavior, and both reap paths.
 *
 * The service is constructed directly over a real Cordis context and the PTY
 * registry double, as the bundle row constructs it.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TerminalError } from '@deepseek-ai/dsh-terminal'
import { TerminalConsole, type Config } from '../src/index.ts'
import { BASE_CONFIG, createHarness, createOwner, type ConsoleHarness } from './harness.ts'

/**
 * One documented cast: the reap registry is private, and this suite proves the
 * console registers exactly one owner reap no matter how often an owner opens.
 */
function reapsOf(console: TerminalConsole): Map<Agent, () => void> {
  return (console as unknown as { ownerReaps: Map<Agent, () => void> }).ownerReaps
}

/** One documented cast: the teardown path is private, and its failure report is the assertion. */
function disposeAllOf(console: TerminalConsole): () => Promise<void> {
  return (console as unknown as { disposeAll(): Promise<void> }).disposeAll.bind(console)
}

/** A shell id the console minted for the first open of one owner. */
const FIRST_SHELL = 'console-1'

describe('TerminalConsole.Config', () => {
  it('defaults every deployment bound and refuses the reachable surface', () => {
    expect(TerminalConsole.Config({})).toEqual({
      backendType: 'console-shell',
      maxShellsPerOwner: 2,
      maxFrameLines: 400,
      pollIntervalMs: 250,
      acceptReachableSurface: false,
    })
  })

  it('rejects a shell bound below one', () => {
    expect(() => TerminalConsole.Config({ maxShellsPerOwner: 0 })).toThrow()
  })
})

describe('TerminalConsole construction', () => {
  it('fails at load on an empty backend type', async () => {
    await expect(createHarness({ backendType: '' })).rejects.toThrow(/backendType must be non-empty/)
  })
})

describe('TerminalConsole surface refusal', () => {
  let refused: ConsoleHarness
  const agent = { id: 'a-refused', ctx: new Context() } as unknown as Agent

  beforeAll(async () => { refused = await createHarness({ acceptReachableSurface: false }) })

  it('refuses open, list, write, close, and the output stream', async () => {
    await expect(refused.console.open(agent, new AbortController().signal))
      .rejects.toMatchObject({ code: 'terminal-console/refused' })
    expect(() => refused.console.list(agent)).toThrow(expect.objectContaining({ code: 'terminal-console/refused' }))
    expect(() => refused.console.write(agent, FIRST_SHELL, { text: 'x', submit: true }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/refused' }))
    await expect(refused.console.close(agent, FIRST_SHELL))
      .rejects.toMatchObject({ code: 'terminal-console/refused' })
    await expect(refused.console.output(agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'terminal-console/refused' })
  })

  it('mints no PTY session while refusing', () => {
    expect(refused.terminals.sessions.size).toBe(0)
  })
})

describe('TerminalConsole.open', () => {
  it('mints an owner-scoped shell whose identity never came from the wire', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-open')
    const shell = await harness.console.open(owner.agent, new AbortController().signal)
    expect(shell).toEqual({
      shellId: FIRST_SHELL,
      index: 1,
      pid: 1001,
      status: { kind: 'running' },
    })
    const session = harness.terminals.sessions.get('pty-1')
    expect(session?.name).toBe(FIRST_SHELL)
    expect(session?.owner).toBe(owner.agent)
    await harness.dispose()
  })

  it('numbers each further shell and reaps the owner once', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-numbering')
    await harness.console.open(owner.agent, new AbortController().signal)
    const second = await harness.console.open(owner.agent, new AbortController().signal)
    expect(second).toMatchObject({ shellId: 'console-2', index: 2 })
    expect(reapsOf(harness.console).size).toBe(1)
    await owner.dispose()
    expect(harness.console.list(owner.agent)).toEqual([])
    await harness.dispose()
  })

  it('refuses a shell past the per-session bound', async () => {
    const harness = await createHarness({ maxShellsPerOwner: 1 })
    const owner = await createOwner(harness.ctx, 'a-limit')
    await harness.console.open(owner.agent, new AbortController().signal)
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .rejects.toMatchObject({ code: 'terminal-console/limit' })
    await harness.dispose()
  })

  it('counts a concurrent open against the bound before its shell is published', async () => {
    const harness = await createHarness({ maxShellsPerOwner: 1 })
    const owner = await createOwner(harness.ctx, 'a-race')
    let release = (): void => {}
    harness.terminals.spawnGate = new Promise((resolve) => { release = resolve })
    const first = harness.console.open(owner.agent, new AbortController().signal)
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .rejects.toMatchObject({ code: 'terminal-console/limit' })
    release()
    await expect(first).resolves.toMatchObject({ shellId: FIRST_SHELL })
    await harness.dispose()
  })

  it('releases the in-flight reservation of a second concurrent open', async () => {
    const harness = await createHarness({ maxShellsPerOwner: 2 })
    const owner = await createOwner(harness.ctx, 'a-pair')
    let release = (): void => {}
    harness.terminals.spawnGate = new Promise((resolve) => { release = resolve })
    const opens = [
      harness.console.open(owner.agent, new AbortController().signal),
      harness.console.open(owner.agent, new AbortController().signal),
    ]
    release()
    await expect(Promise.all(opens)).resolves.toMatchObject([{ index: 1 }, { index: 2 }])
    await harness.dispose()
  })

  it('maps a missing backend to unavailable and frees the reservation', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-nobackend')
    harness.terminals.spawnError = new TerminalError('no backend registered', 'NO_BACKEND')
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'terminal-console/unavailable',
        message: 'no PTY backend of type "console-shell" is registered on this Host',
      })
    harness.terminals.spawnError = undefined
    // A refused open still consumes its index, so a later shell is never
    // numbered as a shell that a panel may already have seen.
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .resolves.toMatchObject({ shellId: 'console-2', index: 2 })
    await harness.dispose()
  })

  it('maps an owner that is no longer live to a generic failure', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-dead')
    harness.terminals.spawnError = new TerminalError('owner is not live', 'OWNER_NOT_LIVE')
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .rejects.toMatchObject({ code: 'terminal-console/failed', message: 'owner is not live' })
    await harness.dispose()
  })

  it('carries a non-PTY rejection as a generic failure', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-thrown')
    harness.terminals.spawnError = 'not an error'
    await expect(harness.console.open(owner.agent, new AbortController().signal))
      .rejects.toMatchObject({ code: 'terminal-console/failed', message: 'not an error' })
    await harness.dispose()
  })
})

describe('TerminalConsole.list', () => {
  it('is empty before anything is opened', async () => {
    const harness = await createHarness()
    expect(harness.console.list({ id: 'a-empty', ctx: new Context() } as unknown as Agent)).toEqual([])
  })

  it('reports each live shell with its PTY process identity', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-list')
    await harness.console.open(owner.agent, new AbortController().signal)
    expect(harness.console.list(owner.agent)).toEqual([
      { shellId: FIRST_SHELL, index: 1, pid: 1001, status: { kind: 'running' } },
    ])
    await harness.dispose()
  })

  it('drops a shell whose PTY session was reaped elsewhere', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-vanished')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.drop('pty-1' as never)
    expect(harness.console.list(owner.agent)).toEqual([])
    expect(harness.console.list(owner.agent)).toEqual([])
    await harness.dispose()
  })

  it('omits the process id when the PTY session reports none', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-nopid')
    await harness.console.open(owner.agent, new AbortController().signal)
    const session = harness.terminals.sessions.get('pty-1')
    if (session === undefined) throw new Error('the console did not publish a PTY session')
    delete session.pid
    expect(harness.console.list(owner.agent)).toEqual([
      { shellId: FIRST_SHELL, index: 1, status: { kind: 'running' } },
    ])
    await harness.dispose()
  })
})

describe('TerminalConsole.write', () => {
  it('accepts one interactive send and reports the shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-write')
    await harness.console.open(owner.agent, new AbortController().signal)
    expect(harness.console.write(owner.agent, FIRST_SHELL, { text: 'ls\n', submit: true }))
      .toMatchObject({ shellId: FIRST_SHELL })
    expect(harness.terminals.sends).toEqual([
      { id: 'pty-1', request: { text: 'ls\n', submit: true } },
    ])
    await harness.dispose()
  })

  it('refuses a second interactive send while one is in flight', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-busy')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.sendError = new TerminalError('already active', 'SEND_ACTIVE')
    expect(() => harness.console.write(owner.agent, FIRST_SHELL, { text: 'x', submit: false }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/busy', message: 'already active' }))
    await harness.dispose()
  })

  it('maps a closed PTY session to an unknown shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-closed-pty')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.sendError = new TerminalError('no session', 'NO_SESSION')
    expect(() => harness.console.write(owner.agent, FIRST_SHELL, { text: 'x', submit: false }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/unknown-shell' }))
    await harness.dispose()
  })

  it('maps any other PTY failure to a generic failure', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-disposing')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.sendError = new TerminalError('service disposing', 'SERVICE_DISPOSING')
    expect(() => harness.console.write(owner.agent, FIRST_SHELL, { text: 'x', submit: false }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/failed' }))
    await harness.dispose()
  })

  it('names an unknown shell without reaching the PTY registry', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-unknown')
    expect(() => harness.console.write(owner.agent, FIRST_SHELL, { text: 'x', submit: false }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/unknown-shell' }))
    expect(harness.terminals.sends).toEqual([])
  })
})

describe('TerminalConsole.close', () => {
  it('closes the shell and forgets it', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-close')
    await harness.console.open(owner.agent, new AbortController().signal)
    await expect(harness.console.close(owner.agent, FIRST_SHELL)).resolves.toBe(true)
    expect(harness.terminals.kills).toEqual([{ id: 'pty-1', reason: 'console shell closed' }])
    expect(harness.console.list(owner.agent)).toEqual([])
    await harness.dispose()
  })

  it('keeps a sibling shell when one of two is closed', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-sibling')
    await harness.console.open(owner.agent, new AbortController().signal)
    await harness.console.open(owner.agent, new AbortController().signal)
    await harness.console.close(owner.agent, FIRST_SHELL)
    expect(harness.console.list(owner.agent)).toMatchObject([{ shellId: 'console-2', index: 2 }])
    await harness.dispose()
  })

  it('reports a close that was already in flight', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-reclose')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.killResult = false
    await expect(harness.console.close(owner.agent, FIRST_SHELL)).resolves.toBe(false)
    await harness.dispose()
  })

  it('keeps the shell when the PTY registry refuses to close it', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-closefail')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.killError = new TerminalError('still closing', 'SERVICE_DISPOSING')
    await expect(harness.console.close(owner.agent, FIRST_SHELL))
      .rejects.toMatchObject({ code: 'terminal-console/failed' })
    expect(harness.console.list(owner.agent)).toHaveLength(1)
    await harness.dispose()
  })

  it('names an unknown shell', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-closeunknown')
    await expect(harness.console.close(owner.agent, FIRST_SHELL))
      .rejects.toMatchObject({ code: 'terminal-console/unknown-shell' })
  })
})

describe('TerminalConsole cross-session authority', () => {
  it('answers unknown-shell for another session\'s shell and leaves it untouched', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-holder')
    const intruder = await createOwner(harness.ctx, 'a-intruder')
    await harness.console.open(owner.agent, new AbortController().signal)

    expect(() => harness.console.write(intruder.agent, FIRST_SHELL, { text: 'rm -rf', submit: true }))
      .toThrow(expect.objectContaining({ code: 'terminal-console/unknown-shell' }))
    await expect(harness.console.close(intruder.agent, FIRST_SHELL))
      .rejects.toMatchObject({ code: 'terminal-console/unknown-shell' })
    await expect(harness.console.output(intruder.agent, FIRST_SHELL, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'terminal-console/unknown-shell' })

    expect(harness.console.list(intruder.agent)).toEqual([])
    expect(harness.terminals.sends).toEqual([])
    expect(harness.terminals.kills).toEqual([])
    expect(harness.console.list(owner.agent)).toHaveLength(1)
    await harness.dispose()
  })

  it('resolves a shell id two sessions both minted to the session that asked', async () => {
    const harness = await createHarness()
    const first = await createOwner(harness.ctx, 'a-first')
    const second = await createOwner(harness.ctx, 'a-second')
    const shellOfFirst = await harness.console.open(first.agent, new AbortController().signal)
    const shellOfSecond = await harness.console.open(second.agent, new AbortController().signal)
    expect(shellOfFirst.shellId).toBe(shellOfSecond.shellId)

    harness.console.write(second.agent, shellOfSecond.shellId, { text: 'mine', submit: true })
    expect(harness.terminals.sends).toEqual([{ id: 'pty-2', request: { text: 'mine', submit: true } }])
    expect(harness.console.list(first.agent)).toHaveLength(1)
    await harness.dispose()
  })
})

describe('TerminalConsole bounds and reaping', () => {
  it('asks the PTY seam for exactly the configured frame bound', async () => {
    const harness = await createHarness({ maxFrameLines: 7 })
    const owner = await createOwner(harness.ctx, 'a-bound')
    await harness.console.open(owner.agent, new AbortController().signal)
    const session = harness.terminals.sessions.get('pty-1')
    if (session === undefined) throw new Error('the console did not publish a PTY session')
    session.text = 'ready'
    const controller = new AbortController()
    const stream = harness.console.output(owner.agent, FIRST_SHELL, controller.signal)[Symbol.asyncIterator]()
    await expect(stream.next()).resolves.toMatchObject({ value: { kind: 'output', text: 'ready' } })
    controller.abort()
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(harness.terminals.reads).toEqual([{ offset: 0, count: 7 }])
    await harness.dispose()
  })

  it('reaps every shell of an owner whose session ended', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-reap')
    await harness.console.open(owner.agent, new AbortController().signal)
    await harness.console.open(owner.agent, new AbortController().signal)
    await owner.dispose()
    expect(reapsOf(harness.console).size).toBe(0)
    expect(harness.console.list(owner.agent)).toEqual([])
    expect(harness.terminals.sessions.size).toBe(2)
    await harness.dispose()
  })

  it('closes every owned shell when the service is disposed', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-service')
    await harness.console.open(owner.agent, new AbortController().signal)
    await harness.dispose()
    expect(harness.terminals.kills).toEqual([{ id: 'pty-1', reason: 'terminal console disposed' }])
    expect(harness.terminals.sessions.size).toBe(0)
    expect(reapsOf(harness.console).size).toBe(0)
  })

  it('reports the shells it could not close', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-disposefail')
    await harness.console.open(owner.agent, new AbortController().signal)
    harness.terminals.killError = new TerminalError('already gone', 'NO_SESSION')
    await expect(disposeAllOf(harness.console)()).rejects.toThrow(AggregateError)
    expect(reapsOf(harness.console).size).toBe(0)
  })

  it('disposes a service that owns nothing', async () => {
    const harness = await createHarness()
    await expect(disposeAllOf(harness.console)()).resolves.toBeUndefined()
  })
})

describe('TerminalConsole config identity', () => {
  it('keeps the exact deployment values it was constructed with', async () => {
    const harness = await createHarness({ maxShellsPerOwner: 5 })
    const config: Config = harness.config
    expect(config).toEqual({ ...BASE_CONFIG, maxShellsPerOwner: 5 })
  })
})

describe('FakeTerminals', () => {
  it('refuses a session another owner holds, as the real seam does', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-seam')
    const other = await createOwner(harness.ctx, 'a-seam-other')
    await harness.console.open(owner.agent, new AbortController().signal)
    expect(() => harness.terminals.read(other.agent, 'pty-1' as never)).toThrow(/another session/)
    await expect(harness.terminals.kill(other.agent, 'pty-1' as never)).rejects.toThrow(/another session/)
    expect(() => harness.terminals.read(owner.agent, 'pty-9' as never)).toThrow(/no PTY session/)
    await harness.dispose()
  })

  it('serves newest-relative pages and records every send', async () => {
    const harness = await createHarness()
    const owner = await createOwner(harness.ctx, 'a-page')
    await harness.console.open(owner.agent, new AbortController().signal)
    const session = harness.terminals.sessions.get('pty-1')
    if (session === undefined) throw new Error('the console did not publish a PTY session')
    session.text = 'one\ntwo\nthree'
    expect(harness.terminals.read(owner.agent, 'pty-1' as never, { offset: 0, count: 2 })).toMatchObject({
      text: 'two\nthree',
      totalLines: 3,
      lineBegin: 0,
      lineEnd: 2,
    })
    expect(harness.terminals.read(owner.agent, 'pty-1' as never)).toMatchObject({ text: 'one\ntwo\nthree' })
    await harness.dispose()
  })
})

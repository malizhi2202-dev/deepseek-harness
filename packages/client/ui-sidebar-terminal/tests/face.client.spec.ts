/**
 * The panel's asynchronous half against a scripted console.
 *
 * The face's contract is what reaches the store and when: the tab is `loading`
 * before the first list settles, `ready` with the shells the server reports, a
 * shell is minted only for a session that holds none, output frames extend or
 * replace one shell's text, an exit frame marks it ended, and nothing is
 * written once the owner's signal aborted. The adapter's contract is what it
 * passes through: the session, the shell id, and the signal reach the
 * namespace, and a write always submits.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createTerminalConsole, terminalFace } from '../src/client/face.ts'
import type { TerminalInjected } from '../src/client/face.ts'
import { createTerminalStore } from '../src/client/store.ts'
import type { TerminalTabState } from '../src/client/store.ts'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SESSION, flush, scriptedConsole, shell } from './scripted-console.client.ts'
import type { ScriptedConsole } from './scripted-console.client.ts'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

const FAILURE = new RemoteError('terminal-console/unavailable', 'no console-shell backend', {})

/** One tab's state under one face, with the script behind it. */
function mount() {
  const instance = createTerminalStore().create()
  const script = scriptedConsole()
  const face = terminalFace(createTerminalConsole(script.remote))(SESSION, instance.actions)
  return { script, face, at: (tabId: TabId = TAB): TerminalTabState | undefined => instance.getSnapshot().byTab[tabId] }
}

/**
 * One shell's recorded failure under a tab.
 * @param state - the tab's state, or undefined when the store holds no bucket.
 * @param shellId - the shell whose failure is read.
 * @returns the failure, or undefined when the tab is not serving shells or none is recorded.
 */
function failureOf(state: TerminalTabState | undefined, shellId: string): RemoteFailure | undefined {
  return state?.kind === 'ready' ? state.failures[shellId] : undefined
}

/** Start one tab and answer its first list with the given shells. */
async function started(script: ScriptedConsole, face: TerminalInjected, signal: AbortSignal, shells: ReturnType<typeof shell>[]) {
  face.start(TAB, signal)
  await script.settleList(shells)
}

describe('createTerminalConsole', () => {
  it('passes the session and the shell through to the namespace', async () => {
    const script = scriptedConsole()
    const calls = createTerminalConsole(script.remote)
    const opening = calls.list(SESSION)
    expect(script.calls).toEqual([{ method: 'list', sessionId: SESSION, shellId: undefined, text: undefined, signal: undefined }])
    await script.settleList([shell(1, 9)])
    expect(await opening).toEqual({ ok: true, value: [shell(1, 9)] })

    const writing = calls.write(SESSION, 'console-1', 'ls\n')
    // A submitted line is the only write the panel makes, so the request always submits.
    expect(script.calls[1]).toEqual({ method: 'write', sessionId: SESSION, shellId: 'console-1', text: 'ls\n', signal: undefined })
    await script.settleWrite(shell(1, 9))
    expect(await writing).toEqual({ ok: true, value: shell(1, 9) })

    const closing = calls.close(SESSION, 'console-1')
    await script.settleClose(true)
    expect(await closing).toEqual({ ok: true, value: true })
  })

  it('carries the caller signal into the one cancellable call', async () => {
    const script = scriptedConsole()
    const calls = createTerminalConsole(script.remote)
    const controller = new AbortController()
    const pending = calls.open(SESSION, controller.signal)
    expect(script.calls[0]).toMatchObject({ method: 'open', sessionId: SESSION, signal: controller.signal })
    await script.settle({ ok: false, error: FAILURE })
    expect(await pending).toEqual({ ok: false, error: FAILURE })
  })

  it('names the shell in the error a finished generation amounts to', () => {
    const script = scriptedConsole()
    const calls = createTerminalConsole(script.remote)
    calls.output(SESSION, 'console-1')
    expect(script.streams[0]?.ended(false)).toHaveProperty(
      'message',
      expect.stringContaining('terminal-console(console-1)'),
    )
  })

  it('names one supervised stream per shell and opens the namespace call it wraps', () => {
    const script = scriptedConsole()
    const calls = createTerminalConsole(script.remote)
    const stream = calls.output(SESSION, 'console-1')
    expect(typeof stream.dispose).toBe('function')
    expect(script.calls[0]).toMatchObject({ method: 'output', sessionId: SESSION, shellId: 'console-1' })
    expect(script.calls[0]?.signal).toBeDefined()
    expect(script.streams.map(entry => entry.shellId)).toEqual(['console-1'])
  })
})

describe('terminalFace', () => {
  it('lists a session\'s shells and attaches a stream to each', async () => {
    const { script, face, at } = mount()
    face.start(TAB, new AbortController().signal)
    expect(at()).toEqual({ kind: 'loading' })
    await script.settleList([shell(1, 1234), shell(2)])
    expect(at()).toMatchObject({ kind: 'ready', active: 'console-2', busy: false })
    expect(script.streams.map(entry => entry.shellId)).toEqual(['console-1', 'console-2'])
  })

  it('mints one shell for a session that holds none', async () => {
    const { script, face, at } = mount()
    face.start(TAB, new AbortController().signal)
    await script.settleList([])
    expect(script.calls.map(call => call.method)).toEqual(['list', 'open'])
    await script.settleOpen(shell(1, 1234))
    expect(at()).toMatchObject({ kind: 'ready', shells: [shell(1, 1234)], active: 'console-1' })
    expect(script.streams.map(entry => entry.shellId)).toEqual(['console-1'])
  })

  it('records a refusal as the panel\'s own state and a later failure as a failure', async () => {
    const refused = mount()
    refused.face.start(TAB, new AbortController().signal)
    const denial = new RemoteError('terminal-console/refused', 'this install serves a reachable surface', {})
    await refused.script.settle({ ok: false, error: denial })
    expect(refused.at()).toEqual({ kind: 'refused', failure: denial })

    const failed = mount()
    failed.face.start(TAB, new AbortController().signal)
    await failed.script.settle({ ok: false, error: FAILURE })
    expect(failed.at()).toEqual({ kind: 'failed', failure: FAILURE })
  })

  it('records a failed mint under the tab', async () => {
    const { script, face, at } = mount()
    face.start(TAB, new AbortController().signal)
    await script.settleList([])
    await script.settle({ ok: false, error: FAILURE })
    expect(at()).toEqual({ kind: 'failed', failure: FAILURE })
  })

  it('extends one shell\'s text with an append frame and replaces it with an attach frame', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234)])
    script.streams[0]?.push({ kind: 'output', text: 'first\n', replace: true })
    await flush()
    script.streams[0]?.push({ kind: 'output', text: 'second\n', replace: false })
    await flush()
    expect(at()).toMatchObject({ output: { 'console-1': 'first\nsecond\n' } })
  })

  it('marks one shell ended on an exit frame and stops reading it', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234)])
    script.streams[0]?.push({ kind: 'output', text: 'bye\n', replace: true })
    await flush()
    script.streams[0]?.push({ kind: 'exit', exitCode: 0, signal: null })
    await flush()
    expect(at()).toMatchObject({ ended: { 'console-1': true }, output: { 'console-1': 'bye\n' } })
  })

  it('marks a shell ended when its generation ends without an exit frame', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234)])
    script.streams[0]?.end()
    await flush()
    expect(at()).toMatchObject({ ended: { 'console-1': true } })
  })

  it('records a carrier rejection as one shell\'s failure, naming a non-Remote throw itself', async () => {
    const carrier = mount()
    await started(carrier.script, carrier.face, new AbortController().signal, [shell(1, 1234)])
    const error = new RemoteError('gateway/internal', 'the socket closed', {})
    carrier.script.streams[0]?.fail(error)
    await flush()
    expect(carrier.at()).toMatchObject({ failures: { 'console-1': error } })

    const named = mount()
    await started(named.script, named.face, new AbortController().signal, [shell(1, 1234)])
    named.script.streams[0]?.fail(new Error('the shell went away'))
    await flush()
    expect(failureOf(named.at(), 'console-1')).toMatchObject({ code: 'gateway/internal', message: 'the shell went away' })

    const unknown = mount()
    await started(unknown.script, unknown.face, new AbortController().signal, [shell(1, 1234)])
    unknown.script.streams[0]?.fail('not an error')
    await flush()
    expect(failureOf(unknown.at(), 'console-1')).toMatchObject({ code: 'gateway/internal', message: 'not an error' })
  })

  it('attaches one stream per shell even when a restart lists the same shells', async () => {
    const { script, face } = mount()
    const signal = new AbortController().signal
    face.start(TAB, signal)
    await script.settleList([shell(1, 1234)])
    face.start(TAB, signal)
    await script.settleList([shell(1, 1234)])
    expect(script.streams.map(entry => entry.shellId)).toEqual(['console-1'])
  })

  it('ignores a rejection that arrives after the tab aborted', async () => {
    const { script, face, at } = mount()
    const controller = new AbortController()
    await started(script, face, controller.signal, [shell(1, 1234)])
    controller.abort()
    script.streams[0]?.fail(new Error('late'))
    await flush()
    expect(at()).toBeUndefined()
  })

  it('ignores a close and a write that settle after the tab aborted', async () => {
    const { script, face, at } = mount()
    const controller = new AbortController()
    await started(script, face, controller.signal, [shell(1, 1234)])
    face.closeShell(TAB, controller.signal, 'console-1')
    face.send(TAB, controller.signal, 'console-1', 'ls\n')
    controller.abort()
    await script.settleClose(true)
    await script.settleWrite(shell(1, 1234))
    expect(at()).toBeUndefined()
  })

  it('mints another shell on demand and attaches it once', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234)])
    face.openShell(TAB, new AbortController().signal)
    await script.settleOpen(shell(2))
    expect(at()).toMatchObject({ active: 'console-2' })
    expect(at()).toMatchObject({ shells: [shell(1, 1234), shell(2)] })
    expect(script.streams.map(entry => entry.shellId)).toEqual(['console-1', 'console-2'])
    // Re-selecting an attached shell opens no second stream.
    face.selectShell(TAB, 'console-1')
    expect(script.streams).toHaveLength(2)
  })

  it('drops a closed shell and records a refused close against it', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234), shell(2)])
    face.closeShell(TAB, new AbortController().signal, 'console-2')
    await script.settleClose(true)
    expect(at()).toMatchObject({ shells: [shell(1, 1234)] })
    expect(at()).toMatchObject({ active: 'console-1' })

    face.closeShell(TAB, new AbortController().signal, 'console-1')
    await script.settle({ ok: false, error: FAILURE })
    expect(at()).toMatchObject({ failures: { 'console-1': FAILURE } })
  })

  it('marks the tab busy for the length of one write and records a refused write', async () => {
    const { script, face, at } = mount()
    await started(script, face, new AbortController().signal, [shell(1, 1234)])
    face.send(TAB, new AbortController().signal, 'console-1', 'ls\n')
    expect(at()).toMatchObject({ busy: true })
    expect(script.calls.at(-1)).toMatchObject({ method: 'write', shellId: 'console-1', text: 'ls\n' })
    const busy = new RemoteError('terminal-console/busy', 'a send is already active', {})
    await script.settle({ ok: false, error: busy })
    expect(at()).toMatchObject({ busy: false, failures: { 'console-1': busy } })
  })

  it('makes no call for a gesture whose record already ended', async () => {
    const { script, face } = mount()
    const controller = new AbortController()
    controller.abort()
    face.start(TAB, controller.signal)
    face.openShell(TAB, controller.signal)
    face.closeShell(TAB, controller.signal, 'console-1')
    face.send(TAB, controller.signal, 'console-1', 'ls\n')
    expect(script.calls).toEqual([])
  })

  it('abort forgets the bucket and a late settlement writes nothing', async () => {
    const { script, face, at } = mount()
    const controller = new AbortController()
    face.start(TAB, controller.signal)
    controller.abort()
    expect(at()).toBeUndefined()
    await script.settleList([shell(1, 1234)])
    expect(at()).toBeUndefined()
  })

  it('lets a restart retire the list still in flight; only the current one writes', async () => {
    const { script, face, at } = mount()
    const signal = new AbortController().signal
    face.start(TAB, signal)
    face.start(TAB, signal)
    expect(script.outstanding()).toEqual(2)
    await script.settleList([shell(1, 1234)])
    expect(at()).toEqual({ kind: 'loading' })
    await script.settleList([shell(2)])
    expect(at()).toMatchObject({ kind: 'ready', active: 'console-2' })
  })

  it('retires a mint still in flight when the tab restarts', async () => {
    const { script, face, at } = mount()
    const signal = new AbortController().signal
    face.start(TAB, signal)
    await script.settleList([])
    expect(script.outstanding()).toEqual(1)
    face.start(TAB, signal)
    // The mint the restart retired settles with a shell the panel must not hold.
    await script.settleOpen(shell(1))
    expect(at()).toEqual({ kind: 'loading' })
  })

  it('writes nothing for a shell whose frame arrives after the tab aborted', async () => {
    const { script, face, at } = mount()
    const controller = new AbortController()
    await started(script, face, controller.signal, [shell(1, 1234)])
    controller.abort()
    script.streams[0]?.push({ kind: 'output', text: 'late\n', replace: true })
    await flush()
    expect(at()).toBeUndefined()
  })

  it('serves two tabs independently from one face', async () => {
    const instance = createTerminalStore().create()
    const script = scriptedConsole()
    const face = terminalFace(createTerminalConsole(script.remote))(SESSION, instance.actions)
    face.start(TAB, new AbortController().signal)
    face.start(TAB2, new AbortController().signal)
    await script.settleList([shell(1, 1234)])
    await script.settleList([shell(2)])
    expect(instance.getSnapshot().byTab[TAB]).toMatchObject({ active: 'console-1' })
    expect(instance.getSnapshot().byTab[TAB2]).toMatchObject({ active: 'console-2' })
  })
})

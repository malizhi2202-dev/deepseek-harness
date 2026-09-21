/**
 * A scripted console: the Remote-shaped face the panel's adapter calls, the
 * unary answers it settles with, and the output frames its streams deliver —
 * all driven by hand from the spec.
 *
 * The stream double follows the Remote supervisor's own contract (an async
 * iterable of items carrying `accept`, plus `dispose`), so a spec drives a
 * frame, a normal generation end, or a carrier rejection without a carrier in
 * between.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  TerminalConsoleFrame,
  TerminalConsoleShell,
} from '@deepseek-ai/dsh-api-terminal-console/types'
import type {
  SupervisedStream,
  SupervisedStreamOptions,
  TerminalConsoleRemote,
} from '../src/client/face.ts'

export const SESSION = 's-test' as SessionId

/**
 * One shell as the server mints it.
 * @param index - the mint index the server reports.
 * @param pid - the shell's process id, omitted when the backend reports none.
 * @returns the shell.
 */
export function shell(index: number, pid?: number): TerminalConsoleShell {
  return {
    shellId: `console-${String(index)}`,
    index,
    ...pid === undefined ? {} : { pid },
    status: { kind: 'running' },
  }
}

/** One recorded unary call. */
export interface RecordedCall {
  /** The namespace method called. */
  readonly method: string
  /** The session the call named. */
  readonly sessionId: SessionId
  /** The shell the call named, where it named one. */
  readonly shellId: string | undefined
  /** The text a write carried. */
  readonly text: string | undefined
  /** The signal the call carried. */
  readonly signal: AbortSignal | undefined
}

/** One opened output stream, as the spec drives it. */
export interface ScriptedStream {
  /** The shell this stream was opened for. */
  readonly shellId: string
  /** Deliver one frame as this generation's next item. */
  push: (frame: TerminalConsoleFrame) => void
  /** End the generation normally, as the supervisor reports a finished shell. */
  end: () => void
  /** Reject the generation, as the supervisor reports a carrier or shell failure. */
  fail: (error: unknown) => void
  /** Whether the consumer has finished with the stream. */
  readonly closed: boolean
  /**
   * The error a normal generation end amounts to, as the adapter classifies it.
   * The script never uses it; a spec reads it to hold the adapter's own answer.
   */
  readonly ended: (accepted: boolean) => Error
}

/** One queued delivery or terminal outcome. */
type Entry<Item> = { readonly value: Item } | { readonly error: unknown } | { readonly end: true }

/** One push-driven async iterable, and the handles a spec drives it with. */
interface Push<Item> {
  readonly stream: AsyncIterable<Item>
  readonly push: (value: Item) => void
  readonly end: () => void
  readonly fail: (error: unknown) => void
  readonly closed: () => boolean
}

/**
 * Build one push-driven async iterable.
 * @returns the iterable and its delivery handles.
 */
function pushStream<Item>(): Push<Item> {
  const queue: Array<Entry<Item>> = []
  let waiting: { resolve: (result: IteratorResult<Item>) => void; reject: (error: unknown) => void } | undefined
  let done = false
  const settle = (entry: Entry<Item>): void => {
    const waiter = waiting
    if (waiter === undefined) {
      queue.push(entry)
      return
    }
    waiting = undefined
    if ('error' in entry) waiter.reject(entry.error)
    else if ('end' in entry) waiter.resolve({ done: true, value: undefined })
    else waiter.resolve({ done: false, value: entry.value })
  }
  return {
    stream: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Item>> => {
          const entry = queue.shift()
          if (entry !== undefined) {
            if ('error' in entry) throw entry.error
            if ('end' in entry) return { done: true, value: undefined }
            return { done: false, value: entry.value }
          }
          if (done) return { done: true, value: undefined }
          return await new Promise<IteratorResult<Item>>((resolve, reject) => { waiting = { resolve, reject } })
        },
        return: async (): Promise<IteratorResult<Item>> => {
          done = true
          return { done: true, value: undefined }
        },
      }),
    },
    push: (value) => { settle({ value }) },
    end: () => {
      done = true
      settle({ end: true })
    },
    fail: (error) => {
      done = true
      settle({ error })
    },
    closed: () => done,
  }
}

/** What a spec holds from the script. */
export interface ScriptedConsole {
  /** The Remote-shaped face, ready to hand to `createTerminalConsole`. */
  readonly remote: TerminalConsoleRemote
  /** Every call recorded, oldest first. */
  readonly calls: readonly RecordedCall[]
  /** Every output stream opened, oldest first. */
  readonly streams: readonly ScriptedStream[]
  /** How many unary calls are still outstanding. */
  readonly outstanding: () => number
  /** Answer the oldest outstanding call, whatever it was. */
  readonly settle: (result: RemoteResult<unknown>) => Promise<void>
  /** Answer the oldest outstanding `list`. */
  readonly settleList: (value: TerminalConsoleShell[]) => Promise<void>
  /** Answer the oldest outstanding `open`. */
  readonly settleOpen: (value: TerminalConsoleShell) => Promise<void>
  /** Answer the oldest outstanding `write`. */
  readonly settleWrite: (value: TerminalConsoleShell) => Promise<void>
  /** Answer the oldest outstanding `close`. */
  readonly settleClose: (value: boolean) => Promise<void>
}

/** Let the face's `then` handlers run before the spec reads the store. */
async function tick(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Let every pending continuation run before the spec reads the store.
 *
 * A delivered frame crosses the scripted iterable, the supervisor's wrapper,
 * and the face's pump before it reaches an action, so a spec flushes rather
 * than counting microtasks.
 */
export async function flush(): Promise<void> {
  await tick()
}

/**
 * Script one console channel.
 * @returns the script's handles.
 */
export function scriptedConsole(): ScriptedConsole {
  const calls: RecordedCall[] = []
  const streams: ScriptedStream[] = []
  const pending: Array<{ readonly method: string; readonly resolve: (result: RemoteResult<unknown>) => void }> = []

  const unary = (
    method: string,
    sessionId: SessionId,
    shellId?: string,
    text?: string,
  ): Promise<RemoteResult<unknown>> => {
    calls.push({ method, sessionId, shellId, text, signal: undefined })
    return new Promise<RemoteResult<unknown>>((resolve) => { pending.push({ method, resolve }) })
  }

  const settle = async (result: RemoteResult<unknown>): Promise<void> => {
    const next = pending.shift()
    if (next === undefined) throw new Error('scripted console settled with no outstanding call')
    next.resolve(result)
    await tick()
  }

  const settleAs = async (method: string, result: RemoteResult<unknown>): Promise<void> => {
    const next = pending[0]
    if (next === undefined) throw new Error(`scripted console has no outstanding call to answer as ${method}`)
    if (next.method !== method) throw new Error(`scripted console expected ${next.method}, not ${method}`)
    await settle(result)
  }

  const openStream = (sessionId: SessionId, shellId: string, signal: AbortSignal | undefined): AsyncIterable<TerminalConsoleFrame> => {
    calls.push({ method: 'output', sessionId, shellId, text: undefined, signal })
    const pushed = pushStream<TerminalConsoleFrame>()
    streams.push({
      shellId,
      push: pushed.push,
      end: pushed.end,
      fail: pushed.fail,
      get closed() { return pushed.closed() },
      /* v8 ignore next -- the adapter's `$stream` call assigns the real classifier before any spec reads it. */
      ended: () => new Error('no classifier'),
    })
    return pushed.stream
  }

  const remote: TerminalConsoleRemote = {
    terminalConsole: {
      open: async (sessionId, signal) => {
        calls.push({ method: 'open', sessionId, shellId: undefined, text: undefined, signal })
        return await new Promise<RemoteResult<unknown>>((resolve) => { pending.push({ method: 'open', resolve }) }) as RemoteResult<TerminalConsoleShell>
      },
      list: async sessionId =>
        await unary('list', sessionId) as RemoteResult<TerminalConsoleShell[]>,
      write: async (sessionId, shellId, request) =>
        await unary('write', sessionId, shellId, request.text) as RemoteResult<TerminalConsoleShell>,
      close: async (sessionId, shellId) =>
        await unary('close', sessionId, shellId) as RemoteResult<boolean>,
      output: (sessionId, shellId, signal) => openStream(sessionId, shellId, signal),
    },
    $stream: <Item>(options: SupervisedStreamOptions<Item>): SupervisedStream<Item> => {
      const generation = new AbortController()
      const inner = options.open(generation.signal)
      // `options.open` pushed exactly one handle; give it the adapter's own
      // end classifier so a spec can read what the adapter answers.
      const handle = streams.at(-1)
      if (handle !== undefined) Object.assign(handle, { ended: options.ended })
      return {
        // The real supervisor annotates each delivered item with the generation
        // it came from; the script only has to carry `value` and `accept`.
        [Symbol.asyncIterator]: () => (async function* () {
          for await (const value of inner) yield { value, accept: () => {} }
        })(),
        dispose: async () => { generation.abort() },
      }
    },
  }

  return {
    remote,
    calls,
    streams,
    outstanding: () => pending.length,
    settle,
    settleList: async (value) => { await settleAs('list', { ok: true, value }) },
    settleOpen: async (value) => { await settleAs('open', { ok: true, value }) },
    settleWrite: async (value) => { await settleAs('write', { ok: true, value }) },
    settleClose: async (value) => { await settleAs('close', { ok: true, value }) },
  }
}

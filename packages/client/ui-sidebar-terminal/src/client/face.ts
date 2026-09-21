/**
 * The panel's asynchronous half: minting shells and pumping their output into
 * the store.
 *
 * The component never awaits anything. It calls `start`, `openShell`,
 * `closeShell`, `selectShell`, or `send`, and this face performs the call and
 * writes the outcome through the store's own actions — the Slot-standard
 * `inject` shape, so the session id is resolved by the framework and the write
 * set stays the store's.
 *
 * Output is a supervised logical stream, not a raw call: the Remote supervisor
 * owns reconnection, and the server marks the first frame of every generation
 * as a replacement, so a reconnected generation replaces the panel's view
 * instead of appending a window it may already hold. Cleanup rides the owner's
 * `signal`, and when the record goes away the tab's bookkeeping is forgotten,
 * so no later settlement writes to it.
 */
import { remoteErrorOf, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TerminalConsoleFrame,
  TerminalConsoleShell,
} from '@deepseek-ai/dsh-api-terminal-console/types'
// Merges the generated `terminalConsole` namespace into the Client Remote face.
import type {} from '@deepseek-ai/dsh-api-terminal-console/remote'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { createTerminalStore } from './store.ts'

/** One item of a supervised stream, as the Client Remote yields it. */
export interface SupervisedStreamItem<Item> {
  /** The decoded frame. */
  readonly value: Item
  /** Reset the reconnect backoff: this generation is delivering. */
  accept(): void
}

/** A reconnecting single-consumer stream the Remote supervises. */
export interface SupervisedStream<Item> extends AsyncIterable<SupervisedStreamItem<Item>> {
  /**
   * Stop the stream for good.
   * @returns once the active generation and the consumer iterator are closed.
   */
  dispose(): Promise<void>
}

/** What one supervised stream needs from its owner. */
export interface SupervisedStreamOptions<Item> {
  /** Diagnostic owner name. */
  readonly name: string
  /** Open one physical generation; `signal` aborts it. */
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>
  /** The error a generation's normal end amounts to. */
  readonly ended: (accepted: boolean) => Error
}

/** The `terminalConsole` namespace methods this package calls, as the generated Remote declares them. */
export type TerminalConsoleNamespace = Pick<
  ClientRemote['terminalConsole'],
  'open' | 'list' | 'write' | 'close' | 'output'
>

/** The Client Remote as this package sees it. */
export interface TerminalConsoleRemote {
  /**
   * Create one reconnecting stream.
   * @param options - opener and end classification.
   * @returns the supervised stream, unstarted until iterated.
   */
  $stream<Item>(options: SupervisedStreamOptions<Item>): SupervisedStream<Item>
  /** The `terminalConsole` namespace. */
  readonly terminalConsole: TerminalConsoleNamespace
}

/**
 * The console calls the panel's face performs.
 *
 * Only `open` carries the caller's signal, because it is the one call whose
 * setup the panel may abandon: listing and writing are synchronous on the Host,
 * and a close is a kill the panel wants to complete. A stream's lifetime is the
 * stream's own, so the face ends it by disposing rather than by cancelling.
 */
export interface TerminalConsoleCalls {
  /** Mint one shell owned by the resolved session. */
  readonly open: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<TerminalConsoleShell>>
  /** List the resolved session's live shells. */
  readonly list: (sessionId: SessionId) => Promise<RemoteResult<TerminalConsoleShell[]>>
  /** Write one submitted line into one shell. */
  readonly write: (
    sessionId: SessionId,
    shellId: string,
    text: string,
  ) => Promise<RemoteResult<TerminalConsoleShell>>
  /** Close one shell. */
  readonly close: (sessionId: SessionId, shellId: string) => Promise<RemoteResult<boolean>>
  /** Supervise one shell's output frames for as long as the tab lives. */
  readonly output: (sessionId: SessionId, shellId: string) => SupervisedStream<TerminalConsoleFrame>
}

/**
 * Bind the console to one Remote face.
 * @param remote - the Client Remote face carrying the `terminalConsole` namespace.
 * @returns the calls the panel's face performs.
 */
export function createTerminalConsole(remote: TerminalConsoleRemote): TerminalConsoleCalls {
  return {
    open: async (sessionId, signal) => await remote.terminalConsole.open(sessionId, signal),
    list: async sessionId => await remote.terminalConsole.list(sessionId),
    write: async (sessionId, shellId, text) =>
      await remote.terminalConsole.write(sessionId, shellId, { text, submit: true }),
    close: async (sessionId, shellId) => await remote.terminalConsole.close(sessionId, shellId),
    output: (sessionId, shellId) => remote.$stream<TerminalConsoleFrame>({
      name: `terminal-console(${shellId})`,
      open: streamSignal => remote.terminalConsole.output(sessionId, shellId, streamSignal),
      // The server ends a shell's stream when that shell is gone, which is an
      // end for this panel rather than a failure it should reconnect through.
      ended: () => new Error(`terminal-console(${shellId}): the shell's output stream ended`),
    }),
  }
}

/** The panel's injected business face, as the body receives it. */
export interface TerminalInjected {
  /**
   * Read this tab's shells for the first time, minting one when it holds none.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Mint one more shell and put it on screen.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly openShell: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Close one shell.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param shellId - the shell to close.
   */
  readonly closeShell: (tabId: TabId, signal: AbortSignal, shellId: string) => void
  /**
   * Put one shell on screen.
   * @param tabId - the tab being drawn.
   * @param shellId - the shell to show.
   */
  readonly selectShell: (tabId: TabId, shellId: string) => void
  /**
   * Submit one line to one shell.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param shellId - the shell to write into.
   * @param text - the command line, without the Enter the endpoint adds.
   */
  readonly send: (tabId: TabId, signal: AbortSignal, shellId: string, text: string) => void
}

/** The code a refused install answers with, which the panel draws as its own state. */
const REFUSED = 'terminal-console/refused'

/**
 * Bind the panel's face to one console.
 * @param calls - the bound console calls.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function terminalFace(
  calls: TerminalConsoleCalls,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createTerminalStore>>) => TerminalInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createTerminalStore>>,
  ): TerminalInjected => {
    /** Per tab: the generation a settlement must match; a retired tab writes nothing. */
    const generations = new Map<TabId, number>()
    /** Per tab: the output streams pumping, one per shell, so a shell attaches once. */
    const streams = new Map<TabId, Map<string, SupervisedStream<TerminalConsoleFrame>>>()

    /** Retire everything in flight for one tab and open a fresh generation. */
    const bump = (tabId: TabId): number => {
      const generation = (generations.get(tabId) ?? 0) + 1
      generations.set(tabId, generation)
      return generation
    }

    const report = (tabId: TabId, failure: RemoteFailure): void => {
      if (failure.code === REFUSED) actions.refused(tabId, failure)
      else actions.failed(tabId, failure)
    }

    const attach = (tabId: TabId, signal: AbortSignal, shellId: string): void => {
      const attached = streams.get(tabId) ?? new Map<string, SupervisedStream<TerminalConsoleFrame>>()
      streams.set(tabId, attached)
      if (attached.has(shellId)) return
      const stream = calls.output(sessionId, shellId)
      attached.set(shellId, stream)
      void (async () => {
        try {
          for await (const item of stream) {
            if (signal.aborted) return
            item.accept()
            const frame = item.value
            if (frame.kind === 'output') actions.output(tabId, shellId, frame.text, frame.replace)
            else {
              actions.ended(tabId, shellId)
              return
            }
          }
          // The supervisor yields nothing more without a frame: the shell's
          // stream is over, so the panel stops waiting on it.
          actions.ended(tabId, shellId)
        } catch (error: unknown) {
          if (signal.aborted) return
          actions.streamFailed(tabId, shellId, failureOf(error))
        } finally {
          attached.delete(shellId)
        }
      })()
    }

    const list = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = bump(tabId)
      actions.loading(tabId)
      void calls.list(sessionId).then((result) => {
        if (generations.get(tabId) !== generation) return
        if (!result.ok) {
          report(tabId, result.error)
          return
        }
        if (result.value.length === 0) {
          // A session that holds no shell gets one, so opening the panel is the
          // whole gesture: there is nothing to choose between yet.
          mint(tabId, signal, generation)
          return
        }
        actions.listed(tabId, result.value)
        for (const shell of result.value) attach(tabId, signal, shell.shellId)
      })
    }

    const mint = (tabId: TabId, signal: AbortSignal, generation: number): void => {
      void calls.open(sessionId, signal).then((result) => {
        if (generations.get(tabId) !== generation) return
        if (!result.ok) {
          report(tabId, result.error)
          return
        }
        actions.minted(tabId, result.value)
        attach(tabId, signal, result.value.shellId)
      })
    }

    return {
      start(tabId, signal) {
        signal.addEventListener('abort', () => {
          // Retire everything in flight by bumping past its generation, so no
          // settlement matches even after a later start reopens the bucket; end
          // every stream this tab opened, whose lifetime is the tab's; and
          // forget the bucket with it.
          bump(tabId)
          for (const stream of streams.get(tabId)?.values() ?? []) void stream.dispose()
          streams.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        list(tabId, signal)
      },
      openShell(tabId, signal) {
        if (signal.aborted) return
        mint(tabId, signal, bump(tabId))
      },
      closeShell(tabId, signal, shellId) {
        if (signal.aborted) return
        void calls.close(sessionId, shellId).then((result) => {
          if (signal.aborted) return
          if (result.ok) actions.dropped(tabId, shellId)
          else actions.streamFailed(tabId, shellId, result.error)
        })
      },
      selectShell(tabId, shellId) {
        actions.select(tabId, shellId)
      },
      send(tabId, signal, shellId, text) {
        if (signal.aborted) return
        actions.busy(tabId, true)
        void calls.write(sessionId, shellId, text).then((result) => {
          if (signal.aborted) return
          actions.busy(tabId, false)
          if (!result.ok) actions.streamFailed(tabId, shellId, result.error)
        })
      },
    }
  }
}

/**
 * The failure one thrown stream error carries.
 *
 * The Remote carrier rejects rather than resolving a `RemoteResult`, so the
 * panel reads the rejection structurally and names anything unrecognizable as
 * a carrier fault of its own.
 * @param error - the thrown value.
 * @returns a failure the store can hold.
 */
function failureOf(error: unknown): RemoteFailure {
  return remoteErrorOf(error) ?? new RemoteError(
    'gateway/internal',
    error instanceof Error ? error.message : String(error),
    {},
    { cause: error },
  )
}

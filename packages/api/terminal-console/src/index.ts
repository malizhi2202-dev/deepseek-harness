/**
 * Browser-facing shell console for one session, exposed as the `terminalConsole`
 * Remote namespace.
 *
 * The console is its own seam over the PTY capability, not a second PTY owner
 * and not the model's registry. `ctx.terminals` owns spawning, confinement,
 * readiness, bounded scrollback, and owner cleanup; this service owns exactly
 * what a browser needs on top of that:
 *
 * 1. **Authority.** Every method takes `agent: Agent`, resolved by the Gateway
 *    from the Session identity on the wire. A shell's identity is minted here
 *    and stored per owner, so a request that resolves to another session finds
 *    no such shell — the PTY session id never crosses the wire, and
 *    `ctx.terminals`'s own `FOREIGN_SESSION` fence stays a second check.
 * 2. **A network-surface gate.** A loopback listener is not isolated per local
 *    user, and a `trustedHosts` authority is a reachability declaration rather
 *    than an authentication layer, so an install that serves one refuses the
 *    console until it states `acceptReachableSurface`.
 * 3. **Bounds.** Live shells per session, the lines one output frame carries,
 *    and the poll interval are validated Config; a shell is reaped when its
 *    owner is disposed, when its shell exits, and when this service is
 *    disposed.
 * 4. **No session log.** Nothing here appends a session event, and no typed
 *    byte ever reaches the transcript. The console is not a model channel.
 *
 * Output is a poll over the seam's bounded backward paging — the PTY seam has
 * no push stream — delivered as a logical Remote stream, which is the push and
 * reconnect surface the browser carrier already owns.
 *
 * @module @deepseek-ai/dsh-api-terminal-console
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  TerminalSessionId,
  TerminalSessionSnapshot,
} from '@deepseek-ai/dsh-terminal'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { advanceConsoleOutput, EMPTY_OUTPUT_WINDOW } from './output-window.ts'
import type {
  TerminalConsoleFrame,
  TerminalConsoleShell,
  TerminalConsoleWriteRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `terminalConsole` Remote namespace. */
    terminalConsole: TerminalConsole
  }
}

/**
 * Deployment bounds and the one security switch this service reads. Every field
 * carries its default in the schema below, so a composition states only what it
 * changes.
 */
export interface Config {
  /**
   * Registered PTY backend type this console mints shells from. A composition
   * gives the console its own backend registration, so the shells it owns are
   * never the ones a model-facing terminal tool addresses.
   * @default 'console-shell'
   */
  readonly backendType?: string
  /**
   * Live console shells one session may hold at once; further opens are refused.
   * @default 2
   */
  readonly maxShellsPerOwner?: number
  /**
   * Retained scrollback lines one output frame may carry.
   * @default 400
   */
  readonly maxFrameLines?: number
  /**
   * Milliseconds between scrollback polls for one live output stream.
   * @default 250
   */
  readonly pollIntervalMs?: number
  /**
   * Whether this install accepts that its Web surface may be reachable by
   * another device, and therefore serves the console on it.
   *
   * The name states the acceptance, not a grant: the console is served only
   * when this is true, so the refusal is the security default. A loopback
   * listener is not isolated per local user, and a `trustedHosts` authority is
   * a reachability declaration rather than an authentication layer, so any
   * device that can load the Web UI could otherwise run shells. A composition
   * that binds loopback and adds no authority sets this, because nothing else
   * can reach it; one that widens reachability must state it deliberately.
   * @default false
   */
  readonly acceptReachableSurface?: boolean
}

/** {@link Config} with every default resolved, as the service reads it. */
interface ResolvedConfig extends Config {
  readonly backendType: string
  readonly maxShellsPerOwner: number
  readonly maxFrameLines: number
  readonly pollIntervalMs: number
  readonly acceptReachableSurface: boolean
}

/** One console-owned shell: its PTY identity and the index its panel labels. */
interface ShellRecord {
  readonly session: TerminalSessionId
  readonly index: number
}

/** A shell together with the PTY snapshot that was current when it was read. */
interface LiveShell {
  readonly record: ShellRecord
  readonly snapshot: TerminalSessionSnapshot
}

/**
 * One session's console state.
 *
 * The mint counter is per session, so the first shell any session opens is
 * `console-1` and its panel labels it `1`: a shell id is meaningful only
 * against the session that minted it, and one session's numbering never
 * depends on another's.
 */
interface OwnerShells {
  readonly shells: Map<string, ShellRecord>
  minted: number
}

/** Host Remote service owning the browser-facing shell console. */
export class TerminalConsole extends TypertRemoteService {
  static inject = ['terminals', 'typert']

  static Config: z<Config> = z.object({
    backendType: z.string().default('console-shell'),
    maxShellsPerOwner: z.number().step(1).min(1).default(2),
    maxFrameLines: z.number().step(1).min(1).default(400),
    pollIntervalMs: z.number().step(1).min(1).default(250),
    acceptReachableSurface: z.boolean().default(false),
  })

  private readonly config: ResolvedConfig
  private readonly owners = new Map<Agent, OwnerShells>()
  private readonly pendingOpens = new Map<Agent, number>()
  private readonly ownerReaps = new Map<Agent, () => Promise<void> | void>()

  /**
   * @param ctx - Host context carrying the PTY registry.
   * @param config - deployment bounds and the network-surface switch.
   * @throws Error when the configured backend type is empty, so a misconfigured
   *   composition fails at load rather than at the first open.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'terminalConsole')
    this.config = config as ResolvedConfig
    if (this.config.backendType.length === 0) throw new Error('terminal-console: backendType must be non-empty')
    ctx.effect(() => () => this.disposeAll(), 'terminal-console teardown')
  }

  /**
   * Mint one console shell owned by the resolved session.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param signal - cancellation of unpublished shell setup.
   * @returns the minted shell as its panel addresses it.
   */
  @Remote
  async open(agent: Agent, signal: AbortSignal): Promise<TerminalConsoleShell> {
    this.assertServed()
    if (this.liveCount(agent) >= this.config.maxShellsPerOwner) {
      throw new RemoteError(
        'terminal-console/limit',
        `this session already holds ${String(this.config.maxShellsPerOwner)} live console shells`,
        {},
      )
    }
    this.ensureOwnerReap(agent)
    const reserved = (this.pendingOpens.get(agent) ?? 0) + 1
    this.pendingOpens.set(agent, reserved)
    const owned = this.ownerFor(agent)
    const index = ++owned.minted
    const shellId = `console-${String(index)}`
    try {
      const spawned = await this.ctx.terminals.spawn(
        agent,
        { type: this.config.backendType, name: shellId },
        signal,
      )
      owned.shells.set(shellId, { session: spawned.sessionId, index })
      return shellOf(shellId, index, spawned)
    } catch (error: unknown) {
      throw this.failureOf(error)
    } finally {
      this.releaseOpen(agent, reserved)
    }
  }

  /**
   * List the resolved session's live console shells in mint order.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @returns one entry per shell whose PTY session still exists.
   */
  @Remote
  list(agent: Agent): TerminalConsoleShell[] {
    this.assertServed()
    const owned = this.owners.get(agent)
    if (owned === undefined) return []
    const live = new Map(this.ctx.terminals.list(agent).map(snapshot => [snapshot.sessionId, snapshot]))
    const shells: TerminalConsoleShell[] = []
    for (const [shellId, record] of owned.shells) {
      const snapshot = live.get(record.session)
      // A shell whose PTY session is gone was reaped elsewhere — by its owner's
      // disposal or by the model's own tooling. Drop the console record with it.
      if (snapshot === undefined) owned.shells.delete(shellId)
      else shells.push(shellOf(shellId, record.index, snapshot))
    }
    if (owned.shells.size === 0) this.owners.delete(agent)
    return shells
  }

  /**
   * Write input into one console shell.
   *
   * The write is line-oriented, which is the PTY seam's own consumption
   * contract: one exclusive interactive operation at a time. This call reports
   * acceptance, never the command's result — the output stream reports that —
   * so it returns as soon as the shell took the input.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param shellId - console-minted shell identity.
   * @param request - explicit text and whether the shell's Enter sequence follows it.
   * @returns the shell as it stands after the input was accepted.
   * @throws RemoteError `terminal-console/busy` when an interactive operation is already in flight.
   */
  @Remote
  write(agent: Agent, shellId: string, request: TerminalConsoleWriteRequest): TerminalConsoleShell {
    this.assertServed()
    const { record, snapshot } = this.expectShell(agent, shellId)
    try {
      // The PTY seam settles the operation on the shell's own readiness and
      // already owns its rejection; the output stream is what reports it.
      this.ctx.terminals.startSend(agent, record.session, { text: request.text, submit: request.submit })
    } catch (error: unknown) {
      throw this.failureOf(error)
    }
    return shellOf(shellId, record.index, snapshot)
  }

  /**
   * Close one console shell and await its process tree's quiescence.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param shellId - console-minted shell identity.
   * @returns true when this call closed the shell, false when a close was already in flight.
   */
  @Remote
  async close(agent: Agent, shellId: string): Promise<boolean> {
    this.assertServed()
    const { record } = this.expectShell(agent, shellId)
    try {
      const closed = await this.ctx.terminals.kill(agent, record.session, 'console shell closed')
      this.forget(agent, shellId)
      return closed
    } catch (error: unknown) {
      throw this.failureOf(error)
    }
  }

  /**
   * Stream one console shell's output.
   *
   * Each poll reads the seam's bounded retained window and sends either the
   * text the panel has not seen or the whole window as a replacement; the
   * stream ends with an exit frame once the shell's top-level process is gone,
   * and closes the shell so nothing detached is left behind.
   *
   * The first frame a generation sends carries the whole retained window and is
   * marked `replace`, so a consumer that reconnects replaces its view rather
   * than appending a window it may already hold.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param shellId - console-minted shell identity.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns output frames in order, ending in one exit frame.
   */
  @Remote({ mode: 'stream' })
  async *output(agent: Agent, shellId: string, signal: AbortSignal): AsyncIterable<TerminalConsoleFrame> {
    this.assertServed()
    this.expectShell(agent, shellId)
    let window = EMPTY_OUTPUT_WINDOW
    let attach = true
    while (!signal.aborted) {
      const live = this.liveShell(agent, shellId)
      if (live === undefined) {
        // The PTY session vanished under the stream. Report an exit with no
        // code rather than a transport failure the panel cannot act on.
        yield { kind: 'exit', exitCode: null, signal: null }
        return
      }
      let page: string
      try {
        page = this.ctx.terminals.read(agent, live.record.session, {
          offset: 0,
          count: this.config.maxFrameLines,
        }).text
      } catch (error: unknown) {
        throw this.failureOf(error)
      }
      const advance = advanceConsoleOutput(window, page)
      window = advance.window
      if (advance.kind !== 'idle') {
        yield { kind: 'output', text: advance.text, replace: attach || advance.kind === 'replace' }
        attach = false
      }
      if (live.snapshot.status.kind === 'exited') {
        await this.reap(agent, shellId, live.record.session)
        yield { kind: 'exit', exitCode: live.snapshot.status.exitCode, signal: live.snapshot.status.signal }
        return
      }
      await delay(this.config.pollIntervalMs, signal)
    }
  }

  /** Refuse every operation on an install that has not accepted a network-reachable surface. */
  private assertServed(): void {
    if (this.config.acceptReachableSurface) return
    throw new RemoteError(
      'terminal-console/refused',
      'this install serves an authority a network can reach and has not enabled the terminal console for it',
      {},
    )
  }

  /** This owner's console state, created on first use. */
  private ownerFor(agent: Agent): OwnerShells {
    const existing = this.owners.get(agent)
    if (existing !== undefined) return existing
    const created: OwnerShells = { shells: new Map(), minted: 0 }
    this.owners.set(agent, created)
    return created
  }

  /** Live plus in-flight shells one owner holds, so the bound covers a concurrent open. */
  private liveCount(agent: Agent): number {
    return (this.owners.get(agent)?.shells.size ?? 0) + (this.pendingOpens.get(agent) ?? 0)
  }

  /**
   * Release one in-flight reservation.
   * @param agent - owner that reserved it.
   * @param reserved - the reservation count this open observed, so a
   *   concurrent open's own reservation is never released by this one.
   */
  private releaseOpen(agent: Agent, reserved: number): void {
    if (reserved <= 1) this.pendingOpens.delete(agent)
    else this.pendingOpens.set(agent, reserved - 1)
  }

  /**
   * Drop every console record of one owner when that Agent is disposed.
   * The PTY seam closes the sessions themselves through its own owner cleanup;
   * this only releases the console's map, so neither side outlives the other.
   */
  private ensureOwnerReap(agent: Agent): void {
    if (this.ownerReaps.has(agent)) return
    const detach = agent.ctx.effect(() => () => {
      this.ownerReaps.delete(agent)
      this.owners.delete(agent)
      this.pendingOpens.delete(agent)
    }, 'terminal-console.ownerReap()')
    this.ownerReaps.set(agent, detach)
  }

  /**
   * Resolve one shell for the requesting session.
   * @throws RemoteError `terminal-console/unknown-shell` when this session holds
   *   no such shell, which is also the answer for a shell another session holds.
   */
  private expectShell(agent: Agent, shellId: string): LiveShell {
    const live = this.liveShell(agent, shellId)
    if (live === undefined) {
      throw new RemoteError(
        'terminal-console/unknown-shell',
        `no console shell ${JSON.stringify(shellId)} belongs to this session`,
        {},
      )
    }
    return live
  }

  /**
   * Resolve one shell and its current PTY snapshot.
   * @returns undefined when this session holds no such shell, or when the PTY
   *   session behind it is gone; the stale console record is dropped either way.
   */
  private liveShell(agent: Agent, shellId: string): LiveShell | undefined {
    const record = this.owners.get(agent)?.shells.get(shellId)
    if (record === undefined) return undefined
    const snapshot = this.ctx.terminals.list(agent).find(candidate => candidate.sessionId === record.session)
    if (snapshot === undefined) {
      this.forget(agent, shellId)
      return undefined
    }
    return { record, snapshot }
  }

  /** Close a shell whose top-level process has already exited, so its PTY session is not left behind. */
  private async reap(agent: Agent, shellId: string, session: TerminalSessionId): Promise<void> {
    try {
      await this.ctx.terminals.kill(agent, session, 'console shell exited')
    } catch (error: unknown) {
      // The session is already gone, which is the outcome this reap wanted.
      if (!isTerminalError(error)) throw this.failureOf(error)
    }
    this.forget(agent, shellId)
  }

  private forget(agent: Agent, shellId: string): void {
    const owned = this.ownerFor(agent)
    owned.shells.delete(shellId)
    if (owned.shells.size === 0) this.owners.delete(agent)
  }

  /** Carry one PTY seam failure across the wire under this namespace's codes. */
  private failureOf(error: unknown): RemoteError {
    if (isTerminalError(error)) {
      const message = error.message
      if (error.code === 'NO_BACKEND') {
        return new RemoteError(
          'terminal-console/unavailable',
          `no PTY backend of type "${this.config.backendType}" is registered on this Host`,
          {},
          { cause: error },
        )
      }
      if (error.code === 'SEND_ACTIVE') {
        return new RemoteError('terminal-console/busy', message, {}, { cause: error })
      }
      if (error.code === 'NO_SESSION' || error.code === 'FOREIGN_SESSION') {
        return new RemoteError('terminal-console/unknown-shell', message, {}, { cause: error })
      }
      return new RemoteError('terminal-console/failed', message, {}, { cause: error })
    }
    const message = error instanceof Error ? error.message : String(error)
    return new RemoteError('terminal-console/failed', message, {}, { cause: error })
  }

  /**
   * Close every console shell this service owns and detach every owner reap it
   * registered.
   *
   * A reap effect is registered on its *Agent's* context, so it outlives this
   * service unless it is invoked here: after an HMR disposal of the service a
   * surviving effect would still close over this instance and delete from its
   * maps. Any shell the PTY registry reaps first is not a leak — the kill below
   * is idempotent against a session that is already gone.
   */
  private async disposeAll(): Promise<void> {
    const failures: unknown[] = []
    for (const [agent, owned] of this.owners) {
      for (const record of owned.shells.values()) {
        try {
          await this.ctx.terminals.kill(agent, record.session, 'terminal console disposed')
        } catch (error: unknown) {
          failures.push(error)
        }
      }
    }
    this.owners.clear()
    this.pendingOpens.clear()
    const reaps = [...this.ownerReaps.values()]
    this.ownerReaps.clear()
    for (const detach of reaps) await Promise.resolve(detach())
    if (failures.length > 0) throw new AggregateError(failures, 'failed to close console shells')
  }
}

/**
 * Structural test for a PTY seam failure. Discrimination is by the class's own
 * `name` plus its stable `code` field, never by class identity: the
 * `TerminalError` class belongs to whichever `dsh-terminal` instance the
 * composition loaded.
 * @param error - a caught value.
 * @returns true when the value is a PTY seam failure carrying a code.
 */
function isTerminalError(error: unknown): error is { code: string; message: string } {
  return error instanceof Error
    && error.name === 'TerminalError'
    && typeof (error as { code?: unknown }).code === 'string'
}

/**
 * Project one PTY snapshot into the shell a panel addresses.
 * @param shellId - console-minted identity.
 * @param index - the shell's mint position.
 * @param snapshot - the PTY snapshot read now.
 * @returns the shell entry.
 */
function shellOf(shellId: string, index: number, snapshot: TerminalSessionSnapshot): TerminalConsoleShell {
  return {
    shellId,
    index,
    ...snapshot.pid === undefined ? {} : { pid: snapshot.pid },
    status: snapshot.status,
  }
}

/**
 * Wait one poll interval, or until the stream is cancelled.
 * @param ms - milliseconds to wait.
 * @param signal - cancellation that ends the wait early.
 * @returns a promise resolved by the timer or by cancellation.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    // A listener added after the signal aborted never fires, so an abort that
    // landed between the stream's loop check and this call still resolves here.
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export default TerminalConsole

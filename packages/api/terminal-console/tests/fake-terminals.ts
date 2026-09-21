/**
 * A PTY registry double for the console's unit tests.
 *
 * It stands in for `ctx.terminals` only: it keeps the real seam's
 * owner-scoping (`FOREIGN_SESSION` for a session another owner holds), its
 * newest-relative paging, and its one-exclusive-send rule, so a console test
 * exercises the console's own decisions rather than a permissive stub. Failures
 * are injected per method with the real `TerminalError`, so code mapping is
 * tested against the class the seam actually throws.
 *
 * The PTY substrate itself — spawning, confinement, scrollback bounds,
 * readiness — is covered by `dsh-terminal` and `dsh-terminal-bash`.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TerminalError } from '@deepseek-ai/dsh-terminal'
import type {
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionId,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSpawnRequest,
  TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'

/** One published PTY session inside the double. */
export interface FakeTerminalSession {
  readonly id: TerminalSessionId
  readonly owner: Agent
  readonly name: string
  /** Retained scrollback the double pages over. */
  text: string
  status: TerminalSessionStatus
  pid?: number
}

/** One accepted send, recorded so a test can assert what reached the seam. */
export interface FakeSend {
  readonly id: TerminalSessionId
  readonly request: TerminalSendRequest
}

/** Mutable PTY registry double; every failure field is injected by a test. */
export class FakeTerminals {
  /** Published sessions by id, in spawn order. */
  readonly sessions = new Map<string, FakeTerminalSession>()
  /** Sends accepted so far. */
  readonly sends: FakeSend[] = []
  /** Reads served so far, so a test can assert the frame bound reached the seam. */
  readonly reads: TerminalReadRequest[] = []
  /** Owners killed so far, in order. */
  readonly kills: { readonly id: TerminalSessionId; readonly reason: string }[] = []
  /** Rejection `spawn` throws instead of publishing. */
  spawnError: unknown
  /** Rejection `read` throws instead of paging. */
  readError: unknown
  /** Rejection `startSend` throws instead of accepting. */
  sendError: unknown
  /** Rejection `kill` throws instead of closing. */
  killError: unknown
  /** Value `kill` returns for a successful close. */
  killResult = true
  /** Held `spawn` calls: `spawn` waits on this before publishing. */
  spawnGate: Promise<void> | undefined
  /** Next minted session id suffix. */
  private next = 0

  /**
   * Publish one session, or reject with the injected `spawnError`.
   * @param owner - exact owner the session belongs to.
   * @param request - backend type and optional name.
   * @returns the published snapshot.
   */
  async spawn(owner: Agent, request: TerminalSpawnRequest): Promise<TerminalSpawnResult> {
    if (this.spawnGate !== undefined) await this.spawnGate
    if (this.spawnError !== undefined) throw this.spawnError
    const id = `pty-${++this.next}` as TerminalSessionId
    const pid = 1000 + this.next
    const session: FakeTerminalSession = {
      id,
      owner,
      name: request.name ?? id,
      text: '',
      status: { kind: 'running' },
      pid,
    }
    this.sessions.set(id, session)
    return { sessionId: id, name: session.name, type: request.type, pid, status: session.status, motd: '' }
  }

  /**
   * List one owner's published sessions.
   * @param owner - exact owner to filter by.
   * @returns one snapshot per session this owner holds.
   */
  list(owner: Agent): TerminalSessionSnapshot[] {
    return [...this.sessions.values()]
      .filter(session => session.owner === owner)
      .map(session => ({
        sessionId: session.id,
        name: session.name,
        type: 'fake',
        ...session.pid === undefined ? {} : { pid: session.pid },
        status: session.status,
      }))
  }

  /**
   * Serve one newest-relative scrollback page.
   * @param owner - exact owner that must hold the session.
   * @param id - target session.
   * @param request - newest-relative offset and line count.
   * @returns the page and its pagination metadata.
   */
  read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult {
    const session = this.expectOwned(owner, id)
    this.reads.push(request)
    if (this.readError !== undefined) throw this.readError
    const lines = session.text.split('\n')
    const offset = request.offset ?? 0
    const end = Math.max(0, lines.length - offset)
    const begin = Math.max(0, end - (request.count ?? 500))
    const page = lines.slice(begin, end)
    return {
      text: page.join('\n'),
      totalLines: lines.length,
      lineBegin: offset,
      lineEnd: offset + page.length,
      truncated: false,
    }
  }

  /**
   * Accept one exclusive interactive send.
   * @param owner - exact owner that must hold the session.
   * @param id - target session.
   * @param request - explicit text and submit behavior.
   * @returns a handle that never settles on its own.
   */
  startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation {
    this.expectOwned(owner, id)
    if (this.sendError !== undefined) throw this.sendError
    this.sends.push({ id, request })
    return {
      done: new Promise(() => {}),
      readOutput: () => ({ delta: '', truncated: false }),
      cancel: () => false,
    }
  }

  /**
   * Close one session, or reject with the injected `killError`.
   * @param owner - exact owner that must hold the session.
   * @param id - target session.
   * @param reason - diagnostic cleanup reason.
   * @returns true for a newly closed session.
   */
  async kill(owner: Agent, id: TerminalSessionId, reason = 'model request'): Promise<boolean> {
    this.expectOwned(owner, id)
    this.kills.push({ id, reason })
    if (this.killError !== undefined) throw this.killError
    this.sessions.delete(id)
    return this.killResult
  }

  /** Remove one session as an owner-level reap would, without recording a kill. */
  drop(id: TerminalSessionId): void {
    this.sessions.delete(id)
  }

  private expectOwned(owner: Agent, id: TerminalSessionId): FakeTerminalSession {
    const session = this.sessions.get(id)
    if (session === undefined) throw new TerminalError(`no PTY session ${id}`, 'NO_SESSION')
    if (session.owner !== owner) throw new TerminalError(`PTY session ${id} belongs to another session`, 'FOREIGN_SESSION')
    return session
  }
}

/** One test Agent with a real disposer context, so owner reaping is observable. */
export function testAgent(id: string, ctx: Context): Agent {
  return { id, ctx } as unknown as Agent
}

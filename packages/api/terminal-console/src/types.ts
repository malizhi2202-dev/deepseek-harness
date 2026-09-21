/**
 * Wire types of the `terminalConsole` Remote namespace. Types only: the
 * generated Remote clients consume this module without Host runtime code.
 *
 * A console shell is what the browser addresses, and its identity is minted
 * here rather than borrowed from the PTY seam: the PTY session id never crosses
 * the wire, so no request can name a PTY session — or another session's shell —
 * at all. Every frame is plain JSON data by construction, because the whole
 * namespace crosses the Remote carrier.
 *
 * @module @deepseek-ai/dsh-api-terminal-console/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Top-level status of one console shell, independent of what it last printed. */
export type TerminalConsoleStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }

/** One console shell as the browser addresses it. */
export interface TerminalConsoleShell {
  /** Console-minted opaque identity, unique among this owner's shells. */
  readonly shellId: string
  /**
   * Position of this shell in its owner's mint order, starting at 1. A panel
   * labels a shell from this number, so no display copy crosses the wire and a
   * closed shell never renumbers its siblings.
   */
  readonly index: number
  /** Top-level shell process id when the PTY backend reports one. */
  readonly pid?: number
  /** Top-level shell status. */
  readonly status: TerminalConsoleStatus
}

/** Request to write into one console shell. */
export interface TerminalConsoleWriteRequest {
  /** UTF-8 text written to the shell's input. */
  readonly text: string
  /** Whether the shell's Enter sequence follows the text. */
  readonly submit: boolean
}

/** One frame of a shell's output stream. */
export type TerminalConsoleFrame =
  | {
    readonly kind: 'output'
    /** Sanitized text to append, or the complete replacement view when `replace`. */
    readonly text: string
    /**
     * Whether the panel must replace its view instead of appending. True on the
     * first frame of every stream generation, which carries the whole retained
     * window so a reconnecting consumer never appends a window it already
     * holds, and true when the seam could not bridge the gap between what it had
     * already sent and what the shell retains now — a bounded read, so a gap is
     * reported rather than silently spliced.
     */
    readonly replace: boolean
  }
  | {
    readonly kind: 'exit'
    /** Exit code, or null when the shell died from a signal or never reported one. */
    readonly exitCode: number | null
    /** Terminating signal name, or null when the shell exited on its own. */
    readonly signal: string | null
  }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** This install has not enabled the console for a surface a network can reach. */
    'terminal-console/refused': {}
    /** No console shell with that id belongs to the requesting session. */
    'terminal-console/unknown-shell': {}
    /** The session already holds the maximum number of live console shells. */
    'terminal-console/limit': {}
    /** The shell already has an interactive operation in flight. */
    'terminal-console/busy': {}
    /** No PTY backend of the configured type is registered on this Host. */
    'terminal-console/unavailable': {}
    /** The PTY seam failed while serving the request. */
    'terminal-console/failed': {}
  }
}

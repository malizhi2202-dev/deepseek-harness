/**
 * The paged read and the guarded write this type performs, bound to the Client
 * Remote.
 *
 * Content is the consumer's business: the `file` resource carries metadata only,
 * and the text arrives here one page of lines at a time and leaves as one whole
 * file. The endpoint takes a session and a workspace path while a tab carries a
 * `dsh-resource://file/` address in one of two scopes, so this module also owns
 * that translation.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileRange, WorkspaceFileStat, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The slice of the Client Remote this package calls. */
export interface WorkspaceFilesReadRemote {
  readonly workspaceFiles: {
    /**
     * Read one page of lines.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - 1-based start line; the Host's page cap applies when `limit` is absent.
     * @param signal - cancels the call.
     * @returns the page, or the failure the Host declares.
     */
    read(
      sessionId: SessionId,
      path: string,
      range: WorkspaceFileRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileText>>
  }
}

/**
 * The slice of the Client Remote a save calls: the same namespace's `write`.
 *
 * The version travels with the content because the endpoint replaces the whole
 * file: without it the Host could not tell a save based on the reader's page
 * from one that would clobber a change made since.
 */
export interface WorkspaceFilesWriteRemote {
  readonly workspaceFiles: {
    /**
     * Replace one file's complete text, guarded by the version the reader saw.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param content - the complete new file text.
     * @param expectedVersion - the `version` the reader's page carried.
     * @param signal - cancels the call.
     * @returns the written file's stat, or the failure the Host declares.
     */
    write(
      sessionId: SessionId,
      path: string,
      content: string,
      expectedVersion: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileStat>>
  }
}

/**
 * The read one page performs, injected so the face stays host-free.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different files in different sessions. A
 * Remote call does not reject: the result carries the failure.
 */
export type ReadWorkspaceFilePage = (
  sessionId: SessionId,
  path: string,
  offset: number,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileText>>

/**
 * The write one save performs, injected for the same reason as
 * {@link ReadWorkspaceFilePage} and carrying the same session and path.
 */
export type WriteWorkspaceFile = (
  sessionId: SessionId,
  path: string,
  content: string,
  expectedVersion: string,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileStat>>

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The session whose workspace confines the read. */
  readonly sessionId: SessionId
  /** The path the Host receives: workspace-relative for a `session` address, absolute for an `absolute` one. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a workspace-relative path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and is read through the seat's own, which the
 * Host confines to that session's workspace. The registry routes every
 * parseable `file` address to this type, so an address `parseFileAddress`
 * rejects is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @param sessionId - the seat's session, which an `absolute` address is read through.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string, sessionId: SessionId): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) throw new Error(`ui-sidebar-textpreview: not a file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return parsed.scope === 'session'
    ? { sessionId: parsed.sessionId as SessionId, path: parsed.path }
    : { sessionId, path: parsed.path }
}

/**
 * Bind the paged read to one Remote face. The page length is the Host's
 * configured cap, so no `limit` travels.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadPage(remote: WorkspaceFilesReadRemote): ReadWorkspaceFilePage {
  return (sessionId, path, offset, signal) => remote.workspaceFiles.read(sessionId, path, { offset }, signal)
}

/**
 * Bind the guarded write to one Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the write a save performs.
 */
export function createWriteFile(remote: WorkspaceFilesWriteRemote): WriteWorkspaceFile {
  return (sessionId, path, content, expectedVersion, signal) =>
    remote.workspaceFiles.write(sessionId, path, content, expectedVersion, signal)
}

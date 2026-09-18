/**
 * Workspace git service: one bounded read-only observation of the git
 * repository that contains a session's workspace root, exposed as the
 * `workspaceGit` Remote namespace.
 *
 * The seam this endpoint rides (`ctx.git`) owns every read rule — the single
 * bound on its lists, the explicit absent answer, the no-mutation guarantee —
 * and this service adds exactly one: the directory observed is the session's
 * workspace root, resolved through the sandbox policy, so the same session
 * always means the same repository. Git errors cross the wire as one
 * `RemoteError` per declared code, so a panel distinguishes "git is missing on
 * the host" from "this observation failed".
 *
 * Nothing here reaches a model request: the panel is the only consumer, and it
 * draws rather than reports.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-git'
import type { GitObservation } from '@deepseek-ai/dsh-git'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceGit` Remote namespace. */
    workspaceGit: WorkspaceGit
  }
}

/** Host Remote service reading one workspace's repository state through `ctx.git`. */
export class WorkspaceGit extends TypertRemoteService {
  static inject = ['git', 'sandboxPolicy', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'workspaceGit')
  }

  /**
   * Observe the repository that contains the Agent's workspace root.
   *
   * The observation is one bounded read, not a subscription: a consumer asks
   * again when it wants a fresher answer, and aborting the call abandons the
   * read without leaving any state behind.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param signal - caller cancellation.
   * @returns the repository's bounded snapshot, or `absent` when the workspace
   *   root is not inside a git work tree.
   */
  @Remote
  async observe(agent: Agent, signal: AbortSignal): Promise<GitObservation> {
    const workspaceRoot = this.ctx.sandboxPolicy.resolve({ session: agent.session }).workspaceRoot
    try {
      return await this.ctx.git.observe(workspaceRoot, signal)
    } catch (error: unknown) {
      throw remoteFailureOf(error)
    }
  }
}

/**
 * Carry one git seam failure across the wire. Discrimination is by the stable
 * `code` field, never by class identity: the `GitError` class belongs to
 * whichever `dsh-git` instance the provider loaded, so no class is shared
 * across the package boundary. Anything the seam did not classify reads as a
 * failed observation, because the caller still needs one answer.
 * @param error - what the git seam raised.
 * @returns the `RemoteError` to reject the call with.
 */
function remoteFailureOf(error: unknown): RemoteError {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  if (code === 'GIT_UNAVAILABLE') {
    return new RemoteError('workspace-git/unavailable', message, {}, { cause: error })
  }
  return new RemoteError('workspace-git/failed', message, {}, { cause: error })
}

export default WorkspaceGit

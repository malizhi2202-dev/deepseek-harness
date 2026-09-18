/**
 * Wire types of the `workspaceGit` Remote namespace. Types only: the generated
 * Remote clients consume this module without Host runtime code.
 *
 * The vocabulary is the git observation seam's own, re-exported rather than
 * restated: the Host endpoint's answer and the Client panel's read name the
 * same declarations, so a seam change cannot leave one side behind.
 *
 * @module @deepseek-ai/dsh-api-workspace-git/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'

export type {
  GitBranch,
  GitChangeKind,
  GitCommit,
  GitHeadState,
  GitObservation,
  GitRepositorySnapshot,
  GitWorktreeEntry,
} from '@deepseek-ai/dsh-git'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The git executable could not be run on the Host at all. */
    'workspace-git/unavailable': {}
    /** A git command ran and failed where the observation expects success. */
    'workspace-git/failed': {}
  }
}

/**
 * Automation ledger service: one read-only projection of the automation
 * runtime's run ledger for one workspace, exposed as the `workspace` Remote
 * namespace's `automationLedger` method.
 *
 * The ledger the runtime keeps is authoritative and this package owns no fact
 * of its own: every value returned is copied from a stored `RunRecord`, from
 * the stored state, or from the commit record of a run. The projection exists
 * because the ledger is workspace-scoped and independent of any session, and
 * because a person — not a model — is its reader: a run's outcome, the paths it
 * named, and the next move must survive the trip to the panel, including the
 * runs that did nothing, refused, or were superseded.
 *
 * The namespace is `workspace`, shared with `packages/api/workspace-controller`
 * (also keyed by `WorkspaceId`): both are read through one service on the wire,
 * `remote.workspace`. The method name is this package's only claim on it.
 *
 * Two bounds, both validated Config: the runs one read returns (newest first,
 * with the ledger's own count reported beside them) and the paths one path list
 * carries (with the count the ledger held). Nothing here reaches a model
 * request, and nothing here writes.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-workspace-automation'
import { projectLedger } from './projection.ts'
import type { AutomationLedgerView } from './types.ts'

export type * from './types.ts'
export { nextStepOf, projectCommit, projectLedger, projectOutcome, projectRun } from './projection.ts'
export type { ProjectionBounds } from './projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspace/automationLedger` Remote method. */
    workspaceAutomationLedger: WorkspaceAutomationLedger
  }
}

/** Deployment bounds on one ledger read. */
export interface Config {
  /**
   * Most runs one read returns, counting back from the newest. @default 20
   *
   * The panel draws the newest runs and reports the ledger's own count beside
   * them, so the default is what a person reads at a glance rather than the
   * retention bound: `ledgerEntries` on the runtime decides what exists.
   */
  readonly maxRuns?: number
  /**
   * Most paths one path list carries: a run's conflict paths, the paths it
   * refused over or could not attribute, a commit's paths, and the worktree
   * remainder the last commit job reported. @default 10
   *
   * The design's bound for a conflict report is ten paths plus the remaining
   * count, which GitLab's system notes established; the same bound serves every
   * other path list because all of them answer the same question.
   */
  readonly maxPaths?: number
}

/** The bounds after the schema filled its defaults. */
interface ResolvedConfig extends Config {
  readonly maxRuns: number
  readonly maxPaths: number
}

/** Host Remote service projecting one workspace's automation ledger. */
export class WorkspaceAutomationLedger extends TypertRemoteService {
  static inject = ['workspaceAutomation', 'typert']

  static Config: z<Config> = z.object({
    maxRuns: z.number().step(1).min(1).default(20),
    maxPaths: z.number().step(1).min(1).default(10),
  })

  /**
   * @param ctx - Host context carrying the automation runtime.
   * @param config - deployment bounds on one read.
   */
  constructor(ctx: Context, private readonly config: ResolvedConfig) {
    super(ctx, 'workspaceAutomationLedger', { namespace: 'workspace' })
  }

  /**
   * Read one workspace's automation ledger.
   *
   * A workspace the runtime holds no state for answers `unrecorded` rather than
   * failing: a workspace whose timer has never run is a normal reading, and the
   * panel says so instead of showing an empty ledger.
   * @param workspaceId - the workspace whose ledger is read.
   * @returns the recorded state with its bounded runs, or `unrecorded`.
   */
  @Remote
  automationLedger(workspaceId: WorkspaceId): AutomationLedgerView {
    return projectLedger(workspaceId, this.ctx.workspaceAutomation.report(workspaceId), {
      maxRuns: this.config.maxRuns,
      maxPaths: this.config.maxPaths,
    })
  }
}

export default WorkspaceAutomationLedger

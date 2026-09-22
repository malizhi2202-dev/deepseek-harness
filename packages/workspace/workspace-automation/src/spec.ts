/**
 * The `workspace_automation` domain declaration: the durable run ledger, the
 * per-workspace baselines, backoff state, lease, and commit watermarks. The zod
 * schemas validate the stored format at the durability boundary and are the
 * direct source of a future RPC wire projection.
 *
 * @module @deepseek-ai/dsh-workspace-automation/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** One run's closed outcome as stored. */
const outcomeRecord = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('no-op'),
    reason: z.enum([
      'up-to-date',
      'no-repository',
      'no-upstream',
      'observe-only',
      'deferred-to-downstream-verification',
      'no-attributable-paths',
      'already-committed',
    ]),
  }),
  z.object({ kind: z.literal('aligned'), strategy: z.enum(['ff-only', 'merge']) }),
  z.object({ kind: z.literal('committed'), sessionId: z.string(), turn: z.number() }),
  z.object({ kind: z.literal('conflicted'), paths: z.readonly(z.array(z.string())), total: z.number() }),
  z.object({
    kind: z.literal('refused'),
    reason: z.enum(['detached-head', 'dirty', 'secrets', 'colocated-vcs', 'too-many-paths', 'unattributable-remainder', 'unreadable-path']),
    paths: z.readonly(z.array(z.string())),
  }),
  z.object({ kind: z.literal('ambiguous-attribution'), paths: z.readonly(z.array(z.string())) }),
  z.object({ kind: z.literal('skipped-locked') }),
  z.object({ kind: z.literal('superseded') }),
  z.object({
    kind: z.literal('failed'),
    reason: z.enum(['fetch', 'probe', 'merge', 'merge-dirty', 'superseded-write', 'observe', 'resolve', 'commit', 'ledger']),
    detail: z.string(),
  }),
  z.object({ kind: z.literal('suspended'), reason: z.string() }),
])

/** What one created commit was, as stored. */
const commitRecord = z.object({
  oid: z.string(),
  parentOid: z.string(),
  paths: z.readonly(z.array(z.string())),
  subject: z.string(),
  body: z.readonly(z.array(z.string())),
  summarySource: z.string(),
  summaryNotes: z.readonly(z.array(z.string())),
  scanBytes: z.number(),
  withdrawable: z.boolean(),
  softReset: z.string(),
  mixedReset: z.string(),
})

/** One retained run record, as stored. */
const runRecord = z.object({
  id: z.string(),
  job: z.enum(['align', 'commit']),
  trigger: z.enum(['due', 'turn-end']),
  startedAt: z.string(),
  finishedAt: z.string(),
  outcome: outcomeRecord,
  expectedHeadOid: z.string().nullable(),
  observedUpstreamOid: z.string().nullable(),
  baselineBefore: z.string().nullable(),
  baselineAfter: z.string().nullable(),
  commit: commitRecord.nullable(),
})

/** Everything durable the runtime owns for one workspace, as stored. */
export const automationStateRecord = z.object({
  baselineUpstreamOid: z.string().nullable(),
  baselineLocalOid: z.string().nullable(),
  baselineBranch: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastOutcome: z.string().nullable(),
  consecutiveFailures: z.number(),
  nextEarliestRunAt: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  leaseOwner: z.string().nullable(),
  leaseUntil: z.string().nullable(),
  commitWatermarks: z.record(z.string(), z.number()),
  uncommittedPaths: z.readonly(z.array(z.string())),
  ledger: z.readonly(z.array(runRecord)),
})

/** The stored state inferred from {@link automationStateRecord}. */
export type StoredAutomationState = z.infer<typeof automationStateRecord>

/** The initial state of a workspace the runtime has never run for. */
export const INITIAL_AUTOMATION_STATE: StoredAutomationState = {
  baselineUpstreamOid: null,
  baselineLocalOid: null,
  baselineBranch: null,
  lastRunAt: null,
  lastOutcome: null,
  consecutiveFailures: 0,
  nextEarliestRunAt: null,
  suspendedReason: null,
  leaseOwner: null,
  leaseUntil: null,
  commitWatermarks: {},
  uncommittedPaths: [],
  ledger: [],
}

/**
 * The workspace automation domain: one `workspaces` table keyed by workspace
 * id. The runtime opens it through `ctx.storageDomain`; this spec object is the
 * single source of the domain's identity, version, and record schema.
 */
export const workspaceAutomationDomainSpec = defineDomain({
  name: 'workspace_automation',
  version: 1,
  tables: { workspaces: domainTable<string, StoredAutomationState>(automationStateRecord) },
})

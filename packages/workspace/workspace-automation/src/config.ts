/**
 * Plugin configuration for the workspace automation runtime: every
 * deployment-varying choice, its validated range, and the explicit resolution
 * step that turns a declaration into the policy one workspace runs under.
 *
 * Misconfiguration fails loud at load. The cross-field rules that a schema
 * cannot express — a missing `worktreeRoot` in align mode, a fallback type
 * outside the declared vocabulary, an unusable secret pattern — reject here
 * rather than at the first run.
 *
 * @module @deepseek-ai/dsh-workspace-automation/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { AlignStrategy } from '@deepseek-ai/dsh-git-align'

/** Whether the runtime only observes or may align a repository. */
export type AutomationMode = 'observe' | 'align'

/** What an alignment run does when the work tree carries uncommitted changes. */
export type DirtyPolicy = 'refuse' | 'commit-attributable'

/** Whether a downstream verifier already covers what alignment would do. */
export type DownstreamVerification = 'none' | 'external'

/** Credential shapes the pre-commit screen refuses. */
export const DEFAULT_SECRET_PATTERNS = [
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  '(?:^|[^A-Za-z0-9])(?:sk|rk)-[A-Za-z0-9_-]{16,}',
  'gh[pousr]_[A-Za-z0-9]{20,}',
  'AKIA[0-9A-Z]{16}',
  'xox[baprs]-[A-Za-z0-9-]{10,}',
] as const

/** Per-workspace overrides; every field falls back to the deployment default. */
export interface WorkspaceOverride {
  /** Whether the timer runs for this workspace. */
  enabled?: boolean
  /** Timer interval for this workspace, in seconds. */
  intervalSeconds?: number
  /** Observation or alignment for this workspace. */
  mode?: AutomationMode
  /** Alignment strategy for this workspace. */
  alignStrategy?: AlignStrategy
  /** Dirty-tree policy for this workspace. */
  dirtyPolicy?: DirtyPolicy
  /** Whether the automatic commit job runs for this workspace. */
  commitEnabled?: boolean
}

/** The commit job's declared policy. */
export interface CommitConfig {
  /** Whether a turn boundary may create a commit. */
  enabled?: boolean
  /** Whether the created commit runs the repository's commit hooks. */
  runHooks?: boolean
  /** Credential shapes the screen refuses; a hit always refuses. */
  secretPatterns?: string[]
  /** Maximum bytes read from one path by the screen. */
  maxScanBytes?: number
  /** Maximum paths one commit may contain. */
  maxPathsPerCommit?: number
  /** Maximum UTF-8 bytes of the complete commit message. */
  maxMessageBytes?: number
  /** Trailer key marking the commit as produced by one work unit. */
  trailer?: string
  /** Conventional-commit types the summary vocabulary accepts. */
  messageTypes?: string[]
  /** Whether a summary may declare a breaking change. */
  allowBreaking?: boolean
  /** Type the mechanical summary declares. */
  fallbackType?: string
  /** Maximum UTF-8 bytes of a subject line. */
  maxSubjectBytes?: number
  /** Maximum body lines. */
  maxBodyLines?: number
}

/** Plugin configuration. */
export interface Config {
  /** Whether the timer runs at all; the default is off. */
  enabled?: boolean
  /** Timer interval in seconds; the floor matches the schedule capability's. */
  intervalSeconds?: number
  /** Fraction of the interval applied as symmetric jitter. */
  jitterRatio?: number
  /** Observation or alignment. */
  mode?: AutomationMode
  /** Alignment strategy; a rebase is not expressible. */
  alignStrategy?: AlignStrategy
  /** Whether a downstream verifier already covers alignment. */
  downstreamVerification?: DownstreamVerification
  /** Dirty-tree policy. */
  dirtyPolicy?: DirtyPolicy
  /** Minimum commits behind before an alignment run acts. */
  behindThreshold?: number
  /** Time budget for one run in milliseconds. */
  runTimeoutMs?: number
  /** How long a conflicted workspace is left alone, in seconds. */
  conflictCooldownSeconds?: number
  /** Backoff base in seconds after the first failure. */
  backoffBaseSeconds?: number
  /** Backoff ceiling in seconds. */
  backoffMaxSeconds?: number
  /** Consecutive failures after which a workspace is suspended. */
  backoffSuspendAfter?: number
  /** Retained ledger records per workspace. */
  ledgerEntries?: number
  /** Directory outside every workspace where probe work trees are created. */
  worktreeRoot?: string
  /** Extra lease time beyond the run budget, in milliseconds. */
  leaseGraceMs?: number
  /** Maximum conflict paths one probe report lists. */
  maxConflictPaths?: number
  /** The commit job's declared policy. */
  commit?: CommitConfig
  /** Per-workspace overrides keyed by workspace id. */
  workspaces?: Record<string, WorkspaceOverride>
}

/** Validated configuration schema; out-of-range values fail at load. */
export const Config: Schema<Config> = z.object({
  enabled: z.boolean().default(false),
  intervalSeconds: z.natural().min(300).default(3600),
  jitterRatio: z.number().min(0).max(1).default(0.5),
  mode: z.union([z.const('observe'), z.const('align')]).default('observe'),
  alignStrategy: z.union([z.const('ff-only'), z.const('merge')]).default('ff-only'),
  downstreamVerification: z.union([z.const('none'), z.const('external')]).default('none'),
  dirtyPolicy: z.union([z.const('refuse'), z.const('commit-attributable')]).default('refuse'),
  behindThreshold: z.natural().min(1).default(1),
  runTimeoutMs: z.natural().min(1000).default(120_000),
  conflictCooldownSeconds: z.natural().default(3600),
  backoffBaseSeconds: z.natural().min(1).default(300),
  backoffMaxSeconds: z.natural().min(1).default(21_600),
  backoffSuspendAfter: z.natural().min(1).default(5),
  ledgerEntries: z.natural().min(1).default(200),
  worktreeRoot: z.string(),
  leaseGraceMs: z.natural().default(5000),
  maxConflictPaths: z.natural().min(1).default(10),
  commit: z.object({
    enabled: z.boolean().default(false),
    runHooks: z.boolean().default(true),
    secretPatterns: z.array(z.string()).default([...DEFAULT_SECRET_PATTERNS]),
    maxScanBytes: z.natural().min(1).default(1_048_576),
    maxPathsPerCommit: z.natural().min(1).default(200),
    maxMessageBytes: z.natural().min(1).default(4096),
    trailer: z.string().default('Dsh-Unit'),
    messageTypes: z.array(z.string()).default(['feat', 'fix', 'docs', 'refactor', 'test', 'chore']),
    allowBreaking: z.boolean().default(false),
    fallbackType: z.string().default('chore'),
    maxSubjectBytes: z.natural().min(1).default(72),
    maxBodyLines: z.natural().default(50),
  }),
  workspaces: z.dict(z.object({
    enabled: z.boolean(),
    intervalSeconds: z.natural().min(300),
    mode: z.union([z.const('observe'), z.const('align')]),
    alignStrategy: z.union([z.const('ff-only'), z.const('merge')]),
    dirtyPolicy: z.union([z.const('refuse'), z.const('commit-attributable')]),
    commitEnabled: z.boolean(),
  })).default({}),
})

/** The resolved commit policy one workspace runs under. */
export interface ResolvedCommitPolicy {
  readonly enabled: boolean
  readonly runHooks: boolean
  readonly secretPatterns: readonly RegExp[]
  readonly maxScanBytes: number
  readonly maxPathsPerCommit: number
  readonly maxMessageBytes: number
  readonly trailer: string
  readonly messageTypes: readonly string[]
  readonly allowBreaking: boolean
  readonly fallbackType: string
  readonly maxSubjectBytes: number
  readonly maxBodyLines: number
}

/** The resolved policy one workspace runs under. */
export interface AutomationPolicy {
  readonly enabled: boolean
  readonly intervalSeconds: number
  readonly jitterRatio: number
  readonly mode: AutomationMode
  readonly alignStrategy: AlignStrategy
  readonly downstreamVerification: DownstreamVerification
  readonly dirtyPolicy: DirtyPolicy
  readonly behindThreshold: number
  readonly runTimeoutMs: number
  readonly conflictCooldownSeconds: number
  readonly backoff: BackoffPolicy
  readonly ledgerEntries: number
  readonly worktreeRoot: string | undefined
  readonly leaseMs: number
  readonly maxConflictPaths: number
  readonly commit: ResolvedCommitPolicy
}

/** Failure backoff: delay, ceiling, and the suspension threshold. */
export interface BackoffPolicy {
  /** Delay after the first failure, in seconds. */
  readonly baseSeconds: number
  /** Delay ceiling, in seconds. */
  readonly maxSeconds: number
  /** Consecutive failures after which the workspace is suspended. */
  readonly suspendAfter: number
}

/**
 * Resolve one declaration into the deployment-wide policy.
 * @param config - the declared configuration, as a deployment writes it rather than as the schema resolves it.
 * @returns the resolved policy shared by every workspace without an override.
 */
export function resolveAutomationPolicy(config: Partial<Config> = {}): AutomationPolicy {
  const commit = config.commit ?? {}
  const messageTypes = commit.messageTypes ?? ['feat', 'fix', 'docs', 'refactor', 'test', 'chore']
  const fallbackType = commit.fallbackType ?? 'chore'
  const trailer = commit.trailer ?? 'Dsh-Unit'
  const mode = config.mode ?? 'observe'
  const worktreeRoot = config.worktreeRoot
  if (messageTypes.length === 0) throw new Error('workspace-automation: commit.messageTypes must not be empty')
  if (!messageTypes.includes(fallbackType)) {
    throw new Error(`workspace-automation: commit.fallbackType "${fallbackType}" is not one of commit.messageTypes`)
  }
  if (trailer.trim().length === 0 || /[\r\n:]/.test(trailer)) {
    throw new Error('workspace-automation: commit.trailer must be a non-empty single-line trailer key')
  }
  if (mode === 'align' && (worktreeRoot === undefined || worktreeRoot.trim().length === 0)) {
    throw new Error('workspace-automation: worktreeRoot is required when mode is "align"')
  }
  const backoff: BackoffPolicy = {
    baseSeconds: config.backoffBaseSeconds ?? 300,
    maxSeconds: config.backoffMaxSeconds ?? 21_600,
    suspendAfter: config.backoffSuspendAfter ?? 5,
  }
  if (backoff.maxSeconds < backoff.baseSeconds) {
    throw new Error('workspace-automation: backoffMaxSeconds must not be below backoffBaseSeconds')
  }
  return {
    enabled: config.enabled ?? false,
    intervalSeconds: config.intervalSeconds ?? 3600,
    jitterRatio: config.jitterRatio ?? 0.5,
    mode,
    alignStrategy: config.alignStrategy ?? 'ff-only',
    downstreamVerification: config.downstreamVerification ?? 'none',
    dirtyPolicy: config.dirtyPolicy ?? 'refuse',
    behindThreshold: config.behindThreshold ?? 1,
    runTimeoutMs: config.runTimeoutMs ?? 120_000,
    conflictCooldownSeconds: config.conflictCooldownSeconds ?? 3600,
    backoff,
    ledgerEntries: config.ledgerEntries ?? 200,
    worktreeRoot,
    leaseMs: (config.runTimeoutMs ?? 120_000) + (config.leaseGraceMs ?? 5000),
    maxConflictPaths: config.maxConflictPaths ?? 10,
    commit: {
      enabled: commit.enabled ?? false,
      runHooks: commit.runHooks ?? true,
      secretPatterns: resolveSecretPatterns(commit.secretPatterns ?? [...DEFAULT_SECRET_PATTERNS]),
      maxScanBytes: commit.maxScanBytes ?? 1_048_576,
      maxPathsPerCommit: commit.maxPathsPerCommit ?? 200,
      maxMessageBytes: commit.maxMessageBytes ?? 4096,
      trailer,
      messageTypes,
      allowBreaking: commit.allowBreaking ?? false,
      fallbackType,
      maxSubjectBytes: commit.maxSubjectBytes ?? 72,
      maxBodyLines: commit.maxBodyLines ?? 50,
    },
  }
}

/**
 * Compile the declared credential shapes; an unusable pattern fails at load.
 * @param patterns - declared regular-expression sources.
 * @returns the compiled patterns.
 */
export function resolveSecretPatterns(patterns: readonly string[]): readonly RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, 'g')
    } catch (error: unknown) {
      throw new Error(`workspace-automation: unusable secret pattern "${pattern}": ${String(error)}`)
    }
  })
}

/**
 * Apply one workspace's overrides to the deployment policy.
 * @param base - the deployment-wide policy.
 * @param override - the declared override, when the workspace has one.
 * @returns the policy that workspace runs under.
 */
export function resolveWorkspacePolicy(base: AutomationPolicy, override?: WorkspaceOverride): AutomationPolicy {
  if (override === undefined) return base
  const mode = override.mode ?? base.mode
  if (mode === 'align' && base.worktreeRoot === undefined) {
    throw new Error('workspace-automation: worktreeRoot is required when a workspace sets mode to "align"')
  }
  return {
    ...base,
    enabled: override.enabled ?? base.enabled,
    intervalSeconds: override.intervalSeconds ?? base.intervalSeconds,
    mode,
    alignStrategy: override.alignStrategy ?? base.alignStrategy,
    dirtyPolicy: override.dirtyPolicy ?? base.dirtyPolicy,
    commit: { ...base.commit, enabled: override.commitEnabled ?? base.commit.enabled },
  }
}

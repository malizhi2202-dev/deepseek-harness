import { describe, expect, it } from 'vitest'
import {
  resolveAutomationPolicy,
  resolveSecretPatterns,
  resolveWorkspacePolicy,
} from '@deepseek-ai/dsh-workspace-automation'

describe('resolveAutomationPolicy', () => {
  it('resolves the documented defaults', () => {
    const policy = resolveAutomationPolicy({})
    expect(policy.enabled).toBe(false)
    expect(policy.intervalSeconds).toBe(3600)
    expect(policy.jitterRatio).toBe(0.5)
    expect(policy.mode).toBe('observe')
    expect(policy.alignStrategy).toBe('ff-only')
    expect(policy.downstreamVerification).toBe('none')
    expect(policy.dirtyPolicy).toBe('refuse')
    expect(policy.behindThreshold).toBe(1)
    expect(policy.runTimeoutMs).toBe(120_000)
    expect(policy.conflictCooldownSeconds).toBe(3600)
    expect(policy.backoff).toEqual({ baseSeconds: 300, maxSeconds: 21_600, suspendAfter: 5 })
    expect(policy.ledgerEntries).toBe(200)
    expect(policy.worktreeRoot).toBe(undefined)
    expect(policy.leaseMs).toBe(125_000)
    expect(policy.maxConflictPaths).toBe(10)
    expect(policy.commit).toMatchObject({
      enabled: false,
      runHooks: true,
      maxScanBytes: 1_048_576,
      maxPathsPerCommit: 200,
      maxMessageBytes: 4096,
      trailer: 'Dsh-Unit',
      allowBreaking: false,
      fallbackType: 'chore',
      maxSubjectBytes: 72,
      maxBodyLines: 50,
    })
    expect(policy.commit.messageTypes).toEqual(['feat', 'fix', 'docs', 'refactor', 'test', 'chore'])
    expect(policy.commit.secretPatterns).toHaveLength(5)
  })

  it('rejects an empty commit type vocabulary', () => {
    expect(() => resolveAutomationPolicy({ commit: { messageTypes: [] } }))
      .toThrow('commit.messageTypes must not be empty')
  })

  it('rejects a fallback type outside the vocabulary', () => {
    expect(() => resolveAutomationPolicy({ commit: { fallbackType: 'wip' } }))
      .toThrow('is not one of commit.messageTypes')
  })

  it('rejects an unusable trailer key', () => {
    expect(() => resolveAutomationPolicy({ commit: { trailer: ' ' } })).toThrow('trailer must be a non-empty')
    expect(() => resolveAutomationPolicy({ commit: { trailer: 'A:B' } })).toThrow('trailer must be a non-empty')
  })

  it('requires worktreeRoot when align mode is the deployment default', () => {
    expect(() => resolveAutomationPolicy({ mode: 'align' })).toThrow('worktreeRoot is required')
  })

  it('accepts align mode with a worktree root outside every workspace', () => {
    expect(resolveAutomationPolicy({ mode: 'align', worktreeRoot: '/scratch' }).worktreeRoot).toBe('/scratch')
  })

  it('rejects a backoff ceiling below its base', () => {
    expect(() => resolveAutomationPolicy({ backoffBaseSeconds: 600, backoffMaxSeconds: 60 }))
      .toThrow('backoffMaxSeconds must not be below backoffBaseSeconds')
  })

  it('rejects an unusable secret pattern', () => {
    expect(() => resolveAutomationPolicy({ commit: { secretPatterns: ['('] } }))
      .toThrow('unusable secret pattern')
  })
})

describe('resolveSecretPatterns', () => {
  it('compiles every declared source into a global pattern', () => {
    const patterns = resolveSecretPatterns(['a', 'b'])
    expect(patterns.map(pattern => pattern.source)).toEqual(['a', 'b'])
    expect(patterns.every(pattern => pattern.global)).toBe(true)
  })
})

describe('resolveWorkspacePolicy', () => {
  const base = resolveAutomationPolicy({ enabled: true, intervalSeconds: 600 })

  it('returns the deployment policy when a workspace declares no override', () => {
    expect(resolveWorkspacePolicy(base)).toBe(base)
  })

  it('applies every declared override', () => {
    const policy = resolveWorkspacePolicy(base, {
      enabled: false,
      intervalSeconds: 300,
      mode: 'observe',
      alignStrategy: 'merge',
      dirtyPolicy: 'commit-attributable',
      commitEnabled: true,
    })
    expect(policy.enabled).toBe(false)
    expect(policy.intervalSeconds).toBe(300)
    expect(policy.alignStrategy).toBe('merge')
    expect(policy.dirtyPolicy).toBe('commit-attributable')
    expect(policy.commit.enabled).toBe(true)
  })

  it('keeps the deployment mode when the override omits it', () => {
    expect(resolveWorkspacePolicy(base, { intervalSeconds: 300 }).mode).toBe('observe')
  })

  it('requires a deployment worktree root before a workspace may align', () => {
    expect(() => resolveWorkspacePolicy(base, { mode: 'align' })).toThrow('worktreeRoot is required')
  })

  it('accepts a workspace align override when the deployment has a worktree root', () => {
    const alignable = resolveAutomationPolicy({ mode: 'align', worktreeRoot: '/scratch' })
    expect(resolveWorkspacePolicy(alignable, { mode: 'align' }).mode).toBe('align')
  })
})

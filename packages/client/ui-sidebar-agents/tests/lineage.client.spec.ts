/**
 * The derivation forest fold.
 *
 * The fold is pure, so the specs state session facts directly: what the session
 * list reports, and what the forest therefore shows. Everything the panel draws
 * comes from here, which is why cycles, missing roots, and the depth bound are
 * asserted rather than assumed.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MAX_LINEAGE_DEPTH, buildLineageForest, hasRunningDescendant } from '../src/client/lineage.ts'

/** One summary as the fold reads it. */
function summary(
  id: string,
  over: { parentId?: string; origin?: 'subagent'; running?: boolean; displayTitle?: string } = {},
) {
  return {
    id: id as SessionId,
    ...over.parentId === undefined ? {} : { parentId: over.parentId as SessionId },
    ...over.origin === undefined ? {} : { origin: over.origin },
    displayTitle: over.displayTitle ?? id,
    running: over.running ?? false,
  }
}

/** A summary record keyed the way the session list keys it. */
function record(...entries: ReturnType<typeof summary>[]): Record<SessionId, ReturnType<typeof summary>> {
  return Object.fromEntries(entries.map(entry => [entry.id, entry]))
}

describe('buildLineageForest', () => {
  it('reports no root for a session the list does not hold', () => {
    expect(buildLineageForest('missing' as SessionId, record(summary('s1')), ['s1' as SessionId])).toBeUndefined()
  })

  it('carries finished and failed derivations as ordinary nodes', () => {
    const forest = buildLineageForest(
      'root' as SessionId,
      record(
        summary('root'),
        summary('done', { parentId: 'root', origin: 'subagent', displayTitle: 'finished worker' }),
        summary('failed', { parentId: 'root', origin: 'subagent', displayTitle: 'failed worker' }),
      ),
      ['root' as SessionId, 'done' as SessionId, 'failed' as SessionId],
    )
    expect(forest?.label).toBe('root')
    expect(forest?.depth).toBe(0)
    expect(forest?.parentId).toBeUndefined()
    expect(forest?.truncated).toBe(false)
    expect(forest?.children.map(child => [child.label, child.running, child.parentId]))
      .toEqual([['finished worker', false, 'root'], ['failed worker', false, 'root']])
  })

  it('nests a derived session under its own derivations', () => {
    const forest = buildLineageForest(
      'root' as SessionId,
      record(
        summary('root'),
        summary('child', { parentId: 'root', origin: 'subagent' }),
        summary('grandchild', { parentId: 'child', origin: 'subagent' }),
      ),
      ['root' as SessionId, 'child' as SessionId, 'grandchild' as SessionId],
    )
    expect(forest?.children[0]?.children[0]?.id).toBe('grandchild')
    expect(forest?.children[0]?.children[0]?.depth).toBe(2)
  })

  it('ranks siblings by the list order, then by id, and unlisted sessions last', () => {
    const forest = buildLineageForest(
      'root' as SessionId,
      record(
        summary('root'),
        summary('b', { parentId: 'root', origin: 'subagent' }),
        summary('a', { parentId: 'root', origin: 'subagent' }),
        summary('z', { parentId: 'root', origin: 'subagent' }),
        summary('y', { parentId: 'root', origin: 'subagent' }),
      ),
      ['root' as SessionId, 'b' as SessionId, 'a' as SessionId],
    )
    // `b` and `a` follow the list; `y` and `z` are unlisted, so they rank after
    // it and break their tie on id.
    expect(forest?.children.map(child => child.id)).toEqual(['b', 'a', 'y', 'z'])
  })

  it('ignores a summary that is not a durable derivation', () => {
    const forest = buildLineageForest(
      'root' as SessionId,
      record(
        summary('root'),
        summary('fork', { parentId: 'root' }),
        summary('orphan', { origin: 'subagent' }),
      ),
      ['root' as SessionId, 'fork' as SessionId, 'orphan' as SessionId],
    )
    expect(forest?.children).toEqual([])
  })

  it('places each session once, which also ends a parent cycle', () => {
    const forest = buildLineageForest(
      'a' as SessionId,
      record(
        summary('a', { parentId: 'b', origin: 'subagent' }),
        summary('b', { parentId: 'a', origin: 'subagent' }),
      ),
      ['a' as SessionId, 'b' as SessionId],
    )
    expect(forest?.id).toBe('a')
    expect(forest?.children.map(child => child.id)).toEqual(['b'])
    expect(forest?.children[0]?.children).toEqual([])
  })

  it('stops at the depth bound and says the branch was cut', () => {
    const chain = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']
    const forest = buildLineageForest(
      'n0' as SessionId,
      record(...chain.map((id, index) => summary(id, index === 0
        ? {}
        : { parentId: chain[index - 1]!, origin: 'subagent' as const }))),
      chain.map(id => id as SessionId),
    )
    const leaves: string[] = []
    const walk = (node: NonNullable<typeof forest>): void => {
      if (node.truncated) leaves.push(node.id)
      node.children.forEach(walk)
    }
    walk(forest!)
    expect(leaves).toEqual([`n${MAX_LINEAGE_DEPTH}`])
  })
})

describe('hasRunningDescendant', () => {
  it('is true only for a node with running work below it', () => {
    const forest = buildLineageForest(
      'root' as SessionId,
      record(
        summary('root'),
        summary('child', { parentId: 'root', origin: 'subagent' }),
        summary('grandchild', { parentId: 'child', origin: 'subagent', running: true }),
      ),
      ['root' as SessionId, 'child' as SessionId, 'grandchild' as SessionId],
    )
    expect(hasRunningDescendant(forest!)).toBe(true)
    expect(hasRunningDescendant(forest!.children[0]!)).toBe(true)
    expect(hasRunningDescendant(forest!.children[0]!.children[0]!)).toBe(false)
  })
})

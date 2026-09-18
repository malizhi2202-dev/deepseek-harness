/**
 * The panel's write set, one tab at a time.
 *
 * The load-bearing fact for the body: every action replaces one tab's whole
 * state, and `forget` alone takes a bucket away — the face dispatches only
 * while the record's signal is live, so a settlement reaching a missing bucket
 * is a face bug, not a panel state.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createGitStore } from '../src/client/store.ts'
import type { GitTabState } from '../src/client/store.ts'
import type { GitRepositoryObservation } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB = 'tab-1' as TabId
const TAB2 = 'tab-2' as TabId

const SNAPSHOT: GitRepositoryObservation = {
  kind: 'repository',
  root: '/work/repo',
  head: { oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a', branch: 'main' },
  branches: [{ name: 'main', tip: '868919447ee24b11c2ae361450fbe8cbbcf2596a' }],
  branchesTruncated: false,
  history: [],
  historyTruncated: false,
  worktree: [],
  worktreeTruncated: false,
}

describe('createGitStore', () => {
  it('mints an independent instance per call', () => {
    const first = createGitStore().create()
    const second = createGitStore().create()
    first.actions.loading(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('writes one tab through loading, absent, ready, and failed', () => {
    const store = createGitStore().create()
    const { actions } = store
    const at = (): GitTabState | undefined => store.getSnapshot().byTab[TAB]
    actions.loading(TAB)
    expect(at()).toEqual({ kind: 'loading' })
    actions.absent(TAB)
    expect(at()).toEqual({ kind: 'absent' })
    actions.ready(TAB, SNAPSHOT)
    expect(at()).toEqual({ kind: 'ready', snapshot: SNAPSHOT })
    const failure = new RemoteError('workspace-git/failed', 'broken repository', {})
    actions.failed(TAB, failure)
    expect(at()).toEqual({ kind: 'failed', failure })
  })

  it('refuses to settle a tab whose bucket was forgotten', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.forget(TAB)
    expect(() => { actions.absent(TAB) }).toThrow(/no state for tab/)
  })

  it('forgets exactly the tab asked for', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.loading(TAB2)
    actions.forget(TAB)
    expect(store.getSnapshot().byTab).toEqual({ [TAB2]: { kind: 'loading' } })
  })

  it('lets a forgotten tab start over', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.loading(TAB)
    actions.forget(TAB)
    expect(() => { actions.loading(TAB) }).not.toThrow()
    expect(store.getSnapshot().byTab[TAB]).toEqual({ kind: 'loading' })
  })
})

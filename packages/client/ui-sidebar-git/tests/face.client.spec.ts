/**
 * The panel's asynchronous half against a scripted observation, and the Remote
 * adapter under it.
 *
 * The face's contract is what reaches the store and when: the tab is `loading`
 * before the observation settles, `absent` / `ready` / `failed` after, never
 * written once the owner's signal aborted or a newer read was asked for, and a
 * tab whose record is gone leaves no bucket behind. The adapter's is what it
 * keeps and drops: the call reaches the `workspaceGit` namespace with the
 * session and the signal, and the result passes through untouched.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createObserve, gitFace } from '../src/client/face.ts'
import { createGitStore } from '../src/client/store.ts'
import { ROOT, SESSION, scriptedObserve } from './scripted-observe.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { GitRepositorySnapshot } from '@deepseek-ai/dsh-api-workspace-git/types'

const TAB = 'tab-1' as TabId

const SNAPSHOT: GitRepositorySnapshot = {
  root: ROOT,
  head: { oid: '868919447ee24b11c2ae361450fbe8cbbcf2596a', branch: 'main' },
  branches: [{ name: 'main', tip: '868919447ee24b11c2ae361450fbe8cbbcf2596a' }],
  branchesTruncated: false,
  history: [],
  historyTruncated: false,
  worktree: [],
  worktreeTruncated: false,
}

function mount() {
  const instance = createGitStore().create()
  const script = scriptedObserve()
  const face = gitFace(createObserve(script.remote))(SESSION, instance.actions)
  return { script, face, snapshot: () => instance.getSnapshot().byTab[TAB] }
}

describe('createObserve', () => {
  it('calls the workspaceGit namespace with the session and the signal', async () => {
    const script = scriptedObserve()
    const observe = createObserve(script.remote)
    const controller = new AbortController()
    const pending = observe(SESSION, controller.signal)
    expect(script.calls).toEqual([{ sessionId: SESSION, signal: controller.signal }])
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(await pending).toEqual({ ok: true, value: { kind: 'absent' } })
  })

  it('passes a failure through untouched', async () => {
    const script = scriptedObserve()
    const observe = createObserve(script.remote)
    const pending = observe(SESSION, new AbortController().signal)
    const error = new RemoteError('workspace-git/unavailable', 'no git', {})
    await script.settle({ ok: false, error })
    expect(await pending).toEqual({ ok: false, error })
  })
})

describe('gitFace', () => {
  it('start marks the tab loading and writes the repository answer ready', async () => {
    const { script, face, snapshot } = mount()
    const controller = new AbortController()
    face.start(TAB, controller.signal)
    expect(snapshot()).toEqual({ kind: 'loading' })
    await script.settle({ ok: true, value: { kind: 'repository', ...SNAPSHOT } })
    expect(snapshot()).toEqual({ kind: 'ready', snapshot: { kind: 'repository', ...SNAPSHOT } })
  })

  it('writes an absent workspace as the absent state', async () => {
    const { script, face, snapshot } = mount()
    face.start(TAB, new AbortController().signal)
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(snapshot()).toEqual({ kind: 'absent' })
  })

  it('records a failed observation under its tab', async () => {
    const { script, face, snapshot } = mount()
    face.start(TAB, new AbortController().signal)
    const error = new RemoteError('workspace-git/failed', 'broken repository', {})
    await script.settle({ ok: false, error })
    expect(snapshot()).toEqual({ kind: 'failed', failure: error })
  })

  it('abort forgets the bucket and a late settlement writes nothing', async () => {
    const { script, face, snapshot } = mount()
    const controller = new AbortController()
    face.start(TAB, controller.signal)
    controller.abort()
    expect(snapshot()).toBeUndefined()
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(snapshot()).toBeUndefined()
  })

  it('makes no request for a record that already ended', () => {
    const { script, face } = mount()
    const controller = new AbortController()
    controller.abort()
    face.start(TAB, controller.signal)
    expect(script.calls).toEqual([])
  })

  it('lets the reload gesture retire the read still in flight; only the current read writes', async () => {
    const { script, face, snapshot } = mount()
    const signal = new AbortController().signal
    face.start(TAB, signal)
    // The reload gesture asks again while the first read is still out.
    face.reload(TAB, signal)
    expect(script.outstanding()).toEqual(2)
    // The retired first read settles first and changes nothing.
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The current read settles after and wins.
    await script.settle({ ok: true, value: { kind: 'repository', ...SNAPSHOT } })
    expect(snapshot()).toEqual({ kind: 'ready', snapshot: { kind: 'repository', ...SNAPSHOT } })
  })

  it('a start after abort reopens the bucket, and the aborted read writes nothing into it', async () => {
    const { script, face, snapshot } = mount()
    const first = new AbortController()
    face.start(TAB, first.signal)
    first.abort()
    expect(snapshot()).toBeUndefined()
    face.start(TAB, new AbortController().signal)
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The aborted read settles first, with an answer that would overwrite the
    // bucket if its generation still matched; it must not.
    await script.settle({ ok: true, value: { kind: 'repository', ...SNAPSHOT } })
    expect(snapshot()).toEqual({ kind: 'loading' })
    // The current read settles behind it and wins.
    await script.settle({ ok: true, value: { kind: 'absent' } })
    expect(snapshot()).toEqual({ kind: 'absent' })
  })

  it('serves two tabs independently from one face', async () => {
    const instance = createGitStore().create()
    const script = scriptedObserve()
    const face = gitFace(createObserve(script.remote))(SESSION, instance.actions)
    const tab2 = 'tab-2' as TabId
    face.start(TAB, new AbortController().signal)
    face.start(tab2, new AbortController().signal)
    await script.settle({ ok: true, value: { kind: 'absent' } })
    await script.settle({ ok: true, value: { kind: 'repository', ...SNAPSHOT } })
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ kind: 'absent' })
    expect(instance.getSnapshot().byTab[tab2]).toEqual({ kind: 'ready', snapshot: { kind: 'repository', ...SNAPSHOT } })
  })
})

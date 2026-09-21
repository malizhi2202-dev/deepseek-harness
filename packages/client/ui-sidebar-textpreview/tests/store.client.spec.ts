/**
 * The store's write set: pages keyed by their first line, invalidated by a newer
 * file version; a view that survives a reset; one bucket per tab, dropped on
 * `forget` so a closed tab leaves nothing behind.
 */
import { describe, expect, it } from 'vitest'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { createTextStore, fresh } from '../src/client/store.ts'
import { page } from './fixtures.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB_1 = 'tab-1' as TabId
const TAB_2 = 'tab-2' as TabId
const TAB_9 = 'tab-9' as TabId

function pageValue(offset: number, lines: readonly string[], eof: boolean, version = 'v1', bytes?: number) {
  const result = page(offset, lines, eof, version, bytes)
  if (!result.ok) throw new Error('fixture')
  return result.value
}

describe('text store', () => {
  it('starts empty and mints a bucket on the first write', () => {
    const instance = createTextStore().create()
    expect(instance.getSnapshot().byTab).toEqual({})
    instance.actions.loading(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({ ...fresh(), loading: true })
  })

  it('keeps pages by their first line and reports the end of the file', () => {
    const instance = createTextStore().create()
    instance.actions.loading(TAB_1)
    // Every page of one file reports the whole file's size.
    instance.actions.page(TAB_1, pageValue(1, ['a', 'b'], false, 'v1', 3))
    instance.actions.page(TAB_1, pageValue(3, ['c'], true, 'v1', 3))
    const state = instance.getSnapshot().byTab[TAB_1]
    expect(state?.pages).toEqual({ 1: { text: 'a\nb', lines: 2 }, 3: { text: 'c', lines: 1 } })
    expect(state?.version).toBe('v1')
    expect(state?.bytes).toBe(3)
    expect(state?.eof).toBe(true)
    expect(state?.loading).toBe(false)
  })

  it('drops the pages of an older version when a newer page arrives', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], false))
    instance.actions.page(TAB_1, pageValue(2, ['B'], true, 'v2'))
    expect(instance.getSnapshot().byTab[TAB_1]?.pages).toEqual({ 2: { text: 'B', lines: 1 } })
    expect(instance.getSnapshot().byTab[TAB_1]?.version).toBe('v2')
  })

  it('records a failure beside the pages already held, and the next page clears it', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], false))
    const failure = { code: 'workspace-file/too-large', message: 'x', details: {} } as unknown as RemoteFailure
    instance.actions.failed(TAB_1, failure)
    expect(instance.getSnapshot().byTab[TAB_1]?.failure).toBe(failure)
    expect(instance.getSnapshot().byTab[TAB_1]?.pages).toEqual({ 1: { text: 'a', lines: 1 } })
    instance.actions.page(TAB_1, pageValue(2, ['b'], true))
    expect(instance.getSnapshot().byTab[TAB_1]?.failure).toBeUndefined()
  })

  it('resets the pages but keeps the view', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], true))
    instance.actions.scrolled(TAB_1, 120)
    instance.actions.toggledWrap(TAB_1)
    instance.actions.navigated(TAB_1, 3)
    instance.actions.reset(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      ...fresh(), scrollTop: 120, wrap: false, revision: 3,
    })
  })

  it('forgets one tab and keeps the rest', () => {
    const instance = createTextStore().create()
    instance.actions.toggledWrap(TAB_1)
    instance.actions.toggledWrap(TAB_2)
    instance.actions.forget(TAB_1)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([TAB_2])
    // Forgetting an unknown tab is a no-op, not a fault: the abort listener may
    // fire for a tab that never wrote anything.
    instance.actions.forget(TAB_9)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([TAB_2])
  })
})

describe('text store — the edit and its save', () => {
  const failure = { code: 'gateway/internal', message: 'socket closed', details: {} } as unknown as RemoteFailure

  it('opens an edit on the text and the version it was read at, and types into it', () => {
    const instance = createTextStore().create()
    instance.actions.edit(TAB_1, 'a\nb\n', 'v1')
    expect(instance.getSnapshot().byTab[TAB_1]?.draft).toEqual({ baseline: 'a\nb\n', text: 'a\nb\n', version: 'v1' })
    instance.actions.edited(TAB_1, 'a\nB\n')
    expect(instance.getSnapshot().byTab[TAB_1]?.draft).toEqual({ baseline: 'a\nb\n', text: 'a\nB\n', version: 'v1' })
  })

  it('ignores typing for a tab that is not editing, and mints nothing to hold it', () => {
    const instance = createTextStore().create()
    instance.actions.edited(TAB_1, 'a')
    expect(instance.getSnapshot().byTab[TAB_1]?.draft).toBeUndefined()
  })

  it('cancels an edit without touching the pages', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], true))
    instance.actions.edit(TAB_1, 'a', 'v1')
    instance.actions.cancelled(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]).toMatchObject({ draft: undefined, pages: { 1: { text: 'a', lines: 1 } } })
  })

  it('goes back to idle when the reader types again after a save or a refusal', () => {
    const instance = createTextStore().create()
    instance.actions.edit(TAB_1, 'a', 'v1')
    instance.actions.saving(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]?.save).toEqual({ kind: 'saving' })
    instance.actions.edited(TAB_1, 'ab')
    expect(instance.getSnapshot().byTab[TAB_1]?.save).toEqual({ kind: 'idle' })
    instance.actions.saveFailed(TAB_1, failure)
    expect(instance.getSnapshot().byTab[TAB_1]?.save).toEqual({ kind: 'failed', failure })
    instance.actions.edited(TAB_1, 'abc')
    expect(instance.getSnapshot().byTab[TAB_1]?.save).toEqual({ kind: 'idle' })
  })

  it('adopts the written text as the pages, at the reported version and size, and leaves the edit', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], true))
    instance.actions.edit(TAB_1, 'a', 'v1')
    instance.actions.saving(TAB_1)
    instance.actions.saved(TAB_1, 'a\nB\n', 'v2', 4)
    expect(instance.getSnapshot().byTab[TAB_1]).toMatchObject({
      draft: undefined,
      save: { kind: 'saved' },
      version: 'v2',
      bytes: 4,
      eof: true,
      loading: false,
      failure: undefined,
      pages: { 1: { text: 'a\nB', lines: 2 } },
    })
  })

  it('pages an empty written text as no lines, and one that is only a terminator as one', () => {
    const instance = createTextStore().create()
    instance.actions.edit(TAB_1, 'x', 'v1')
    instance.actions.saved(TAB_1, '', 'v2', 0)
    expect(instance.getSnapshot().byTab[TAB_1]?.pages).toEqual({ 1: { text: '', lines: 0 } })
    instance.actions.edit(TAB_1, 'x', 'v2')
    instance.actions.saved(TAB_1, '\n', 'v3', 1)
    expect(instance.getSnapshot().byTab[TAB_1]?.pages).toEqual({ 1: { text: '', lines: 1 } })
  })

  it('keeps the reader\'s text when the save is refused', () => {
    const instance = createTextStore().create()
    instance.actions.edit(TAB_1, 'a', 'v1')
    instance.actions.edited(TAB_1, 'mine')
    instance.actions.saveFailed(TAB_1, failure)
    expect(instance.getSnapshot().byTab[TAB_1]?.draft?.text).toBe('mine')
  })

  it('drops the reported size with the pages it belonged to', () => {
    const instance = createTextStore().create()
    instance.actions.page(TAB_1, pageValue(1, ['a'], true))
    instance.actions.reset(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]?.bytes).toBeUndefined()
  })
})

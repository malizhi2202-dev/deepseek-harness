// @vitest-environment jsdom
/**
 * The derivation panel against scripted session facts.
 *
 * What is asserted is the reader's contract: the tree is the session list's own
 * summaries, so finished and failed derivations show up beside running ones; a
 * branch that still has work below it is open and every other one waits for a
 * gesture; and the child catalog — unread, loading, failed, or answered — is
 * drawn as the distinct state it is, with navigation admitted only where the
 * host will accept it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionSummary, SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { MAX_LINEAGE_DEPTH } from '../src/client/lineage.ts'
import { ROOT, catalog, childEntry, derived, diagnostic, failure, mountBody, summary } from './mount.client.tsx'

afterEach(() => { cleanup() })

/** Every session row in document order. */
function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-agents-row]')]
}

/** The row of one session. */
function row(container: HTMLElement, id: string): HTMLElement {
  const found = rows(container).find(element => element.getAttribute('data-agents-row') === id)
  if (found === undefined) throw new Error(`no row for ${id}`)
  return found
}

/** The disclosure control inside one session's row. */
function disclosure(container: HTMLElement, id: string): HTMLElement {
  const button = row(container, id).querySelector('button')
  if (button === null) throw new Error(`no disclosure for ${id}`)
  return button
}

describe('the forest', () => {
  it('waits for a session the list does not hold', () => {
    const { view } = mountBody({ summaries: [summary('other')] })
    expect(view.container.textContent).toContain('正在等待这个会话出现在会话列表中。')
    expect(view.queryAllByRole('tree')).toEqual([])
  })

  it('draws finished and failed derivations, and opens a catalogued child', () => {
    const mounted = mountBody({
      summaries: [
        summary(ROOT),
        derived('worker', ROOT, { displayTitle: 'finished worker' }),
        derived('failed', ROOT, { displayTitle: 'failed worker' }),
      ],
      catalogs: {
        [ROOT]: catalog({
          entries: [childEntry('worker', { mode: 'continuable' }), childEntry('failed')],
        }),
      },
    })
    expect(rows(mounted.view.container).map(element => element.getAttribute('data-agents-row')))
      .toEqual([ROOT, 'worker', 'failed'])
    expect(row(mounted.view.container, ROOT).getAttribute('aria-current')).toBe('true')
    expect(row(mounted.view.container, ROOT).getAttribute('tabindex')).toBeNull()

    fireEvent.click(row(mounted.view.container, 'worker'))
    expect(mounted.actions.openChild).toHaveBeenCalledWith({
      parentSessionId: ROOT, childSessionId: 'worker', mode: 'continuable',
    })
    fireEvent.click(row(mounted.view.container, 'failed'))
    expect(mounted.actions.openChild).toHaveBeenLastCalledWith({
      parentSessionId: ROOT, childSessionId: 'failed', mode: 'one-shot',
    })
  })

  it('opens a deeper branch on its disclosure and closes it again', () => {
    const mounted = mountBody({
      summaries: [summary(ROOT), derived('mid', ROOT), derived('leaf', 'mid')],
      catalogs: {
        [ROOT]: catalog({ entries: [childEntry('mid', { hasChildren: true })] }),
        ['mid' as SessionId]: catalog({ entries: [childEntry('leaf')] }),
      },
    })
    expect(rows(mounted.view.container).map(element => element.getAttribute('data-agents-row'))).toEqual([ROOT, 'mid'])
    fireEvent.click(disclosure(mounted.view.container, 'mid'))
    expect(rows(mounted.view.container).map(element => element.getAttribute('data-agents-row')))
      .toEqual([ROOT, 'mid', 'leaf'])

    fireEvent.click(disclosure(mounted.view.container, 'mid'))
    expect(rows(mounted.view.container).map(element => element.getAttribute('data-agents-row'))).toEqual([ROOT, 'mid'])
  })

  it('leaves the running chain open and everything else closed', () => {
    const mounted = mountBody({
      summaries: [
        summary(ROOT),
        derived('working', ROOT, { running: true }),
        derived('watching', 'working', { running: true }),
        derived('idle', ROOT),
      ],
      catalogs: {},
    })
    // The root's own children are always drawn; only the working branch
    // continues past them without a gesture.
    expect(rows(mounted.view.container).map(element => element.getAttribute('data-agents-row')))
      .toEqual([ROOT, 'working', 'watching', 'idle'])
    expect(row(mounted.view.container, 'working').getAttribute('aria-expanded')).toBe('true')
    expect(row(mounted.view.container, 'idle').getAttribute('aria-expanded')).toBeNull()
  })

  it('reports a branch cut at the depth bound', () => {
    const chain = [ROOT, ...Array.from({ length: MAX_LINEAGE_DEPTH + 1 }, (_, index) => `n${index + 1}`)]
    const summaries = chain.map((id, index) => index === 0
      ? summary(id, { running: true })
      : derived(id, chain[index - 1]!, { running: true }))
    const catalogs = Object.fromEntries(chain.map((id, index) => [
      id,
      catalog({
        entries: index === chain.length - 1
          ? []
          : [childEntry(chain[index + 1]!, { hasChildren: true })],
      }),
    ]))
    const mounted = mountBody({ summaries, catalogs })
    const cut = chain[MAX_LINEAGE_DEPTH]!
    expect(rows(mounted.view.container)).toHaveLength(MAX_LINEAGE_DEPTH + 1)
    expect(row(mounted.view.container, cut).getAttribute('aria-expanded')).toBe('false')
    expect(mounted.view.container.querySelector(`[data-agents-truncated="${cut}"]`)).not.toBeNull()

    // A node at the bound is expandable but no longer read: its branch stops here.
    mounted.actions.observeCatalog.mockClear()
    fireEvent.click(disclosure(mounted.view.container, cut))
    expect(mounted.actions.observeCatalog).not.toHaveBeenCalledWith(cut, true)
    expect(mounted.view.container.querySelector(`[data-agents-truncated="${cut}"]`)).not.toBeNull()
  })
})

describe('the child catalog', () => {
  const tree = [summary(ROOT), derived('worker', ROOT)]

  it('says a catalog has not been read instead of showing no children', () => {
    const { view } = mountBody({ summaries: tree })
    expect(row(view.container, 'worker').getAttribute('aria-disabled')).toBe('true')
    expect(view.container.textContent).toContain('子代理目录尚未加载。')
  })

  it('says a catalog read is in progress', () => {
    const { view } = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog({ state: 'loading' }) },
    })
    expect(view.container.textContent).toContain('正在读取子代理目录…')
    expect(view.container.querySelector('[role="group"]')?.getAttribute('aria-busy')).toBe('true')
  })

  it('shows the failure, and retries it on request', () => {
    const mounted = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog({ state: 'error', error: failure('subagent catalog read failed') }) },
    })
    expect(mounted.view.container.textContent).toContain('subagent catalog read failed')
    expect(row(mounted.view.container, 'worker').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(mounted.view.getByText('重试'))
    expect(mounted.actions.refreshCatalog).toHaveBeenCalledWith(ROOT)
  })

  it('falls back to its own wording for a failure that carries none', () => {
    const { view } = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog({ state: 'error' }) },
    })
    expect(view.container.textContent).toContain('无法读取子代理目录。')
  })

  it('lists a diagnostic entry as a disabled row with its reason', () => {
    const { view } = mountBody({
      summaries: [summary(ROOT)],
      catalogs: {
        [ROOT]: catalog({
          entries: [diagnostic('bad', 'corrupt'), diagnostic('gone', 'unavailable'), diagnostic('old', 'unsupported')],
        }),
      },
    })
    const drawn = [...view.container.querySelectorAll<HTMLElement>('[data-agents-diagnostic]')]
    expect(drawn.map(element => element.getAttribute('data-agents-diagnostic'))).toEqual(['bad', 'gone', 'old'])
    expect(drawn[0]?.getAttribute('aria-disabled')).toBe('true')
    expect(drawn[0]?.getAttribute('aria-label')).toContain('会话记录损坏')
    expect(view.container.textContent).toContain('记录暂不可用')
    expect(view.container.textContent).toContain('记录版本不受支持')
    // Three diagnostics are not an empty session.
    expect(view.container.textContent).not.toContain('这个会话还没有派生子代理。')
    expect(rows(view.container)).toHaveLength(1)
  })

  it('names the reason a summary-backed row cannot be opened', () => {
    const missing = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog() },
    })
    expect(missing.view.container.textContent).toContain('父会话的子代理目录中没有这个条目。')

    const broken = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog({ entries: [diagnostic('worker', 'corrupt')] }) },
    })
    expect(row(broken.view.container, 'worker').getAttribute('aria-label')).toContain('会话记录损坏')
    expect(broken.view.container.querySelector('[data-agents-diagnostic]')).toBeNull()
  })

  it('marks every child of an offline parent', () => {
    const { view } = mountBody({
      summaries: tree,
      catalogs: { [ROOT]: catalog({ parentAvailable: false, entries: [childEntry('worker')] }) },
    })
    expect(row(view.container, 'worker').textContent).toContain('父会话当前不在线，重新打开父会话后才能继续。')
  })

  it('names an empty session once its catalog has answered', () => {
    const { view } = mountBody({ summaries: [summary(ROOT)], catalogs: { [ROOT]: catalog() } })
    expect(view.container.textContent).toContain('这个会话还没有派生子代理。')
  })

  it('opens a childless session whose own catalog holds entries', () => {
    const mounted = mountBody({
      summaries: [summary(ROOT), derived('branch', ROOT)],
      catalogs: {
        [ROOT]: catalog({ entries: [childEntry('branch')] }),
        ['branch' as SessionId]: catalog({ entries: [diagnostic('lost', 'unavailable')] }),
      },
    })
    expect(mounted.view.container.querySelector('[data-agents-diagnostic]')).toBeNull()
    fireEvent.click(disclosure(mounted.view.container, 'branch'))
    expect(mounted.view.container.querySelector('[data-agents-diagnostic="lost"]')).not.toBeNull()
  })
})

describe('the rows', () => {
  it('opens a row from the keyboard and drives its branch', () => {
    const mounted = mountBody({
      summaries: [summary(ROOT), derived('mid', ROOT), derived('leaf', 'mid')],
      catalogs: {
        [ROOT]: catalog({ entries: [childEntry('mid', { hasChildren: true })] }),
        ['mid' as SessionId]: catalog({ entries: [childEntry('leaf')] }),
      },
    })
    const mid = row(mounted.view.container, 'mid')
    fireEvent.keyDown(mid, { key: 'Enter' })
    expect(mounted.actions.openChild).toHaveBeenCalledWith({
      parentSessionId: ROOT, childSessionId: 'mid', mode: 'one-shot',
    })
    fireEvent.keyDown(mid, { key: ' ' })
    expect(mounted.actions.openChild).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(mid, { key: 'x' })
    expect(rows(mounted.view.container)).toHaveLength(2)
    fireEvent.keyDown(mid, { key: 'ArrowRight' })
    expect(rows(mounted.view.container)).toHaveLength(3)
    fireEvent.keyDown(row(mounted.view.container, 'leaf'), { key: 'ArrowRight' })
    expect(rows(mounted.view.container)).toHaveLength(3)
    fireEvent.keyDown(row(mounted.view.container, 'mid'), { key: 'ArrowLeft' })
    expect(rows(mounted.view.container)).toHaveLength(2)
    fireEvent.keyDown(row(mounted.view.container, 'mid'), { key: 'ArrowLeft' })
    expect(rows(mounted.view.container)).toHaveLength(2)
  })
})

describe('catalog reads', () => {
  /** A tree whose branches are all open, so several catalogs are wanted at once. */
  function wideTree(): {
    summaries: readonly SessionSummary[]
    catalogs: Readonly<Record<SessionId, SubagentCatalogSnapshot>>
    ids: readonly string[]
  } {
    const ids = ['a', 'b', 'c', 'd']
    const pairs: (readonly [SessionId, SubagentCatalogSnapshot])[] = [
      [ROOT, catalog({ entries: ids.map(id => childEntry(id, { hasChildren: true })), state: 'loading' })],
      ...ids.map(id => [id as SessionId, catalog({
        entries: [childEntry(`${id}-child`)],
        state: 'loading' as const,
      })] as const),
    ]
    return {
      summaries: [
        summary(ROOT, { running: true }),
        ...ids.map(id => derived(id, ROOT, { running: true })),
        ...ids.map(id => derived(`${id}-child`, id, { running: true })),
      ],
      catalogs: Object.fromEntries(pairs),
      ids,
    }
  }

  it('observes the root at once and reads the open branches within the limit', () => {
    const { summaries, catalogs, ids } = wideTree()
    const mounted = mountBody({ summaries, catalogs })
    const observed = mounted.actions.observeCatalog.mock.calls.map(call => [call[0], call[1]])
    expect(observed[0]).toEqual([ROOT, true])
    // The root's own read is in flight, so only two branches open alongside it.
    expect(observed).toEqual([[ROOT, true], [ids[0], true], [ids[1], true]])
  })

  it('keeps what is still wanted and releases what is not', () => {
    const { summaries, catalogs } = wideTree()
    const mounted = mountBody({ summaries, catalogs })
    mounted.actions.observeCatalog.mockClear()
    mounted.update({ summaries, catalogs })
    expect(mounted.actions.observeCatalog.mock.calls
      .filter(call => call[1])
      .map(call => call[0])).toEqual([])

    mounted.update({ summaries: [summary(ROOT)], catalogs })
    expect(mounted.actions.observeCatalog.mock.calls
      .filter(call => !call[1])
      .map(call => call[0])).toEqual(['a', 'b'])
  })

  it('releases every read it still holds when the panel goes', () => {
    const { summaries, catalogs } = wideTree()
    const mounted = mountBody({ summaries, catalogs })
    mounted.actions.observeCatalog.mockClear()
    mounted.view.unmount()
    expect(mounted.actions.observeCatalog.mock.calls).toEqual([[ROOT, false], ['a', false], ['b', false]])
  })
})

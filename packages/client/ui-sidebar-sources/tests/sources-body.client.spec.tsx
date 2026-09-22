// @vitest-environment jsdom
/**
 * The panel's body, as the reader sees it: one card per source with its state,
 * its capabilities, its credential references, its schema-driven form, and its
 * hard limits; then the sources this design deliberately does not build.
 *
 * The cases pin the three facts the panel must never blur: an unconfigured
 * source is drawn as unconfigured and offers no connection of its own, a source
 * that failed shows the failure and the last error the Host recorded, and no
 * credential VALUE is ever rendered — only the reference name and whether it
 * resolves.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SOURCE_KEY, SOURCE_VALUE, failure, namespaceView, sourceView } from './scripted-sources.client.ts'
import { TAB, flush, listSources, mountBody } from './mount.client.tsx'
import type { Mounted } from './mount.client.tsx'
import { zh } from '../src/client/locales.ts'

/** The card for one source instance, or a failure naming what is missing. */
function card(mounted: Mounted, key = SOURCE_KEY): HTMLElement {
  const found = mounted.view.container.querySelector(`[data-sources-card="${key}"]`)
  if (found === null) throw new Error(`no card rendered for ${key}`)
  return found as HTMLElement
}

/** The panel's state marker. */
function panelState(mounted: Mounted): string | null {
  return mounted.view.container.querySelector('[data-sources-panel-state]')?.getAttribute('data-sources-panel-state') ?? null
}

/** One element inside the mounted panel, or a failure naming the selector. */
function pick(mounted: Mounted, selector: string): HTMLElement {
  const found = mounted.view.container.querySelector(selector)
  if (found === null) throw new Error(`nothing matched ${selector}`)
  return found as HTMLElement
}

describe('SourcesBody reading the list', () => {
  it('reads the list on mount and draws a card per source with its state', async () => {
    const mounted = mountBody()
    expect(panelState(mounted)).toBe('loading')
    expect(mounted.view.getByText(zh['loading'])).toBeDefined()
    await listSources(mounted, [
      sourceView(),
      sourceView({
        key: 'mysql/main',
        kind: 'mysql',
        id: 'main',
        namespace: 'resource-mysql',
        state: 'unusable',
        lastError: 'the connection was refused',
        capabilities: {
          search: false, browse: true, read: true, maxReadBytes: 1024, maxListItems: 10, description: '',
        },
        credentials: [{ field: 'password', ref: 'MYSQL_PASSWORD', configured: false, writable: false }],
      }),
    ])
    await flush()
    expect(panelState(mounted)).toBe('ready')
    expect(card(mounted).getAttribute('data-sources-state')).toBe('unconfigured')
    expect(card(mounted).textContent).toContain(zh['state.unconfigured'])
    expect(card(mounted, 'mysql/main').getAttribute('data-sources-state')).toBe('unusable')
    expect(card(mounted, 'mysql/main').textContent).toContain(zh['state.unusable'])
    expect(pick(mounted, '[data-sources-last-error]').textContent)
      .toBe(zh['lastError'].replace('{message}', 'the connection was refused'))
  })

  it('draws the notice for a host with no source registered', async () => {
    const mounted = mountBody()
    await listSources(mounted, [])
    await flush()
    expect(pick(mounted, '[data-sources-empty]').textContent).toBe(zh['empty'])
  })

  it('reports a list it could not read at all', async () => {
    const mounted = mountBody()
    await mounted.script.settle({ ok: false, error: failure('sources/failed', 'the host is gone') })
    await flush()
    expect(panelState(mounted)).toBe('failed')
    expect(pick(mounted, '[data-sources-code]').getAttribute('data-sources-code')).toBe('sources/failed')
    expect(mounted.view.getByText(zh['error.failed'].replace('{message}', 'the host is gone'))).toBeDefined()
  })

  it('reads the list again when the reader asks for it', async () => {
    const mounted = mountBody()
    await listSources(mounted, [sourceView()])
    await flush()
    fireEvent.click(pick(mounted, '[data-sources-reload]'))
    expect(mounted.script.calls.filter(call => call.method === 'status')).toHaveLength(2)
    await listSources(mounted, [sourceView({ state: 'usable' })])
    await flush()
    expect(card(mounted).getAttribute('data-sources-state')).toBe('usable')
  })

  it('starts no read for a record whose tab is already gone', () => {
    const mounted = mountBody({ live: false })
    expect(panelState(mounted)).toBe('loading')
    expect(mounted.script.calls).toEqual([])
  })
})

describe('SourcesBody one source\'s card', () => {
  it('names a kind this build knows and leaves an unknown kind verbatim', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [
      sourceView({ key: 'mediawiki/wiki', kind: 'mediawiki', id: 'wiki', namespace: 'resource-mediawiki' }),
      sourceView({ key: 'mysql/main', kind: 'mysql', id: 'main', namespace: 'resource-mysql' }),
      sourceView({ key: 'source-ghost/one', kind: 'source-ghost', id: 'one', namespace: 'resource-source-ghost' }),
    ]) } })
    expect(card(mounted, 'mediawiki/wiki').textContent).toContain(zh['kind.mediawiki'])
    expect(card(mounted, 'mysql/main').textContent).toContain(zh['kind.mysql'])
    expect(card(mounted, 'source-ghost/one').textContent).toContain('source-ghost')
  })

  it('draws the state word for a configured source nothing has probed yet', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView({ kind: 'github', state: 'unchecked' })]) } })
    expect(card(mounted).textContent).toContain(zh['state.unchecked'])
  })

  it('lists the capabilities the provider claims, and the read bound it enforces', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [
      sourceView({
        capabilities: {
          search: true, browse: true, read: false, maxReadBytes: 4096, maxListItems: 25, description: '',
        },
      }),
    ]) } })
    const text = pick(mounted, '[data-sources-capabilities]').textContent ?? ''
    expect(text).toContain(zh['capabilities.title'])
    expect(text).toContain(zh['capabilities.search'])
    expect(text).toContain(zh['capabilities.browse'])
    expect(text).not.toContain(zh['capabilities.read'])
    expect(text).toContain(zh['capabilities.maxReadBytes'].replace('{value}', '4096'))
  })

  it('shows a credential reference with its presence and its origin, and never a value', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView({
      credentials: [
        { field: 'tokenRef', ref: 'GITHUB_TOKEN', configured: true, source: 'env', writable: true },
        { field: 'otherRef', ref: 'GITHUB_OTHER', configured: false, writable: false },
      ],
    })]) } })
    const configured = pick(mounted, '[data-sources-credential="tokenRef"]')
    expect(configured.getAttribute('data-sources-configured')).toBe('true')
    expect(configured.textContent).toContain('GITHUB_TOKEN')
    expect(configured.textContent).toContain(zh['credentials.configured'])
    expect(configured.textContent).toContain(zh['credentials.source'].replace('{source}', 'env'))
    expect(configured.textContent).not.toContain(zh['credentials.unset'])
    const unset = pick(mounted, '[data-sources-credential="otherRef"]')
    expect(unset.getAttribute('data-sources-configured')).toBe('false')
    expect(unset.textContent).toContain(zh['credentials.unset'])
    expect(unset.textContent).toContain(zh['credentials.readonly'])
    expect(pick(mounted, '[data-sources-credentials-note]').textContent).toBe(zh['credentials.note'])
  })

  it('reports the last probe answer, and the failure of the call that could not be made', async () => {
    const mounted = mountBody({ seed: (actions) => {
      actions.listed(TAB, [sourceView()])
      actions.probed(TAB, SOURCE_KEY, { ok: true })
    } })
    expect(pick(mounted, '[data-sources-probe="ok"]').textContent).toBe(zh['probe.ok'])
    fireEvent.click(pick(mounted, '[data-sources-action="probe"]'))
    expect(mounted.script.calls.at(-1)).toEqual({ method: 'probe', key: SOURCE_KEY })
    await mounted.script.settleProbe({ ok: false, message: 'the token was refused' })
    await flush()
    expect(pick(mounted, '[data-sources-probe="failed"]').textContent)
      .toBe(zh['probe.failed'].replace('{message}', 'the token was refused'))
    // A refusal the Host stated without a message still reads as a refusal.
    const silent = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView()]) } })
    fireEvent.click(pick(silent, '[data-sources-action="probe"]'))
    await silent.script.settleProbe({ ok: false })
    await flush()
    expect(pick(silent, '[data-sources-probe="failed"]').textContent)
      .toBe(zh['probe.failed'].replace('{message}', ''))
    // The button is disabled while that source's own probe is in flight.
    expect((pick(mounted, '[data-sources-action="probe"]') as HTMLButtonElement).disabled).toBe(false)

    const refused = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView()]) } })
    fireEvent.click(pick(refused, '[data-sources-action="probe"]'))
    expect((pick(refused, '[data-sources-action="probe"]') as HTMLButtonElement).disabled).toBe(true)
    await refused.script.settle({ ok: false, error: failure('sources/unknown', 'no such source') })
    await flush()
    const line = pick(refused, '[data-sources-failure]')
    expect(line.getAttribute('data-sources-failure')).toBe('sources/unknown')
    expect(line.textContent).toBe(zh['error.unknown'].replace('{kind}', 'github'))

    const broke = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView()]) } })
    fireEvent.click(pick(broke, '[data-sources-action="probe"]'))
    await broke.script.settle({ ok: false, error: failure('sources/failed', 'the carrier dropped') })
    await flush()
    expect(pick(broke, '[data-sources-failure]').textContent)
      .toBe(zh['error.failed'].replace('{message}', 'the carrier dropped'))
  })

  it('states a source\'s hard limits, and leaves an unknown kind to its provider', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [
      sourceView(),
      sourceView({ key: 'mysql/main', kind: 'mysql', id: 'main', namespace: 'resource-mysql' }),
      sourceView({ key: 'mediawiki/wiki', kind: 'mediawiki', id: 'wiki', namespace: 'resource-mediawiki' }),
      // A kind this build does not name states its own limits when its provider
      // states them, and the panel's own wording when it does not.
      sourceView({ key: 'source-ghost/one', kind: 'source-ghost', id: 'one', namespace: 'resource-source-ghost' }),
      sourceView({
        key: 'source-silent/one',
        kind: 'source-silent',
        id: 'one',
        namespace: 'resource-source-silent',
        capabilities: {
          search: false, browse: false, read: false, maxReadBytes: 1, maxListItems: 1, description: '',
        },
      }),
    ]) } })
    expect(pick(mounted, '[data-sources-limits="github"]').textContent).toContain(zh['limits.github'])
    expect(pick(mounted, '[data-sources-limits="mysql"]').textContent).toContain(zh['limits.mysql'])
    expect(pick(mounted, '[data-sources-limits="mediawiki"]').textContent).toContain(zh['limits.mediawiki'])
    expect(pick(mounted, '[data-sources-limits="source-ghost"]').textContent)
      .toContain('Search code in the repositories this source grants.')
    expect(pick(mounted, '[data-sources-limits="source-silent"]').textContent).toContain(zh['limits.other'])
  })
})

describe('SourcesBody the settings form', () => {
  it('reports a form the client cannot reach, and one the mirror never answered', () => {
    const unreachable = mountBody({ seed: (actions) => {
      actions.listed(TAB, [sourceView()])
      actions.described(TAB, SOURCE_KEY, { status: 'unavailable' })
    } })
    expect(pick(unreachable, '[data-sources-settings-state="unavailable"]').textContent)
      .toBe(zh['settings.unavailable'])
    const loading = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView()]) } })
    expect(pick(loading, '[data-sources-settings-state="loading"]').textContent).toBe(zh['settings.loading'])
  })

  /**
   * Mount a panel whose one source already has a settings form published.
   * @param view - the descriptor the namespace published.
   * @returns the mounted panel.
   */
  async function withForm(view: ReturnType<typeof namespaceView>): Promise<Mounted> {
    const mounted = mountBody()
    await listSources(mounted, [sourceView()])
    await flush()
    mounted.settings.publish({
      status: 'ready',
      view: { namespaces: [view], writable: true, hasDocument: true },
      error: null,
    })
    await flush()
    return mounted
  }

  it('renders one control per declared field, with the layer that supplied each value', async () => {
    const mounted = await withForm({
      ...namespaceView(),
      user: { host: 'https://user' },
      base: { query: 'from-base' },
      value: { host: 'https://user', query: 'from-base', limit: 20, deep: true, mode: 'code', tokenRef: '' },
    })
    expect(pick(mounted, '[data-sources-settings-state="ready"]')).toBeDefined()
    expect(pick(mounted, '[data-sources-field="host"]').getAttribute('data-sources-layer')).toBe('user')
    expect(pick(mounted, '[data-sources-field="query"]').getAttribute('data-sources-layer')).toBe('base')
    expect(pick(mounted, '[data-sources-field="limit"]').getAttribute('data-sources-layer')).toBe('default')
    expect(pick(mounted, '[data-sources-field="host"] input').getAttribute('type')).toBe('text')
    expect(pick(mounted, '[data-sources-field="limit"] input').getAttribute('type')).toBe('number')
    expect(pick(mounted, '[data-sources-field="deep"] [role="switch"]').getAttribute('aria-checked')).toBe('true')
    expect(pick(mounted, '[data-sources-field="mode"] select')).toBeDefined()
    expect(pick(mounted, '[data-sources-field="host"] [data-sources-field-state="user"]')).toBeDefined()
  })

  it('stages a toggle, sends it under the form\'s revision, and clears it when the save lands', async () => {
    const mounted = await withForm(namespaceView())
    const save = pick(mounted, '[data-sources-save="github/main"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect((pick(mounted, '[data-sources-discard="github/main"]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pick(mounted, '[data-sources-field="deep"] [role="switch"]'))
    expect(pick(mounted, '[data-sources-field="deep"] [role="switch"]').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pick(mounted, '[data-sources-field="deep"] [role="switch"]'))
    expect(pick(mounted, '[data-sources-field="deep"] [role="switch"]').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(pick(mounted, '[data-sources-field="deep"] [role="switch"]'))
    expect(pick(mounted, '[data-sources-dirty]').textContent).toBe(zh['settings.dirty'])
    // A staged draft is the reader's own value, so the row shows the user layer.
    expect(pick(mounted, '[data-sources-field="deep"]').getAttribute('data-sources-layer')).toBe('default')
    mounted.settings.scope('resource-github').revision(1)
    fireEvent.click(pick(mounted, '[data-sources-save="github/main"]'))
    expect(mounted.settings.scope('resource-github').mutations).toEqual([
      { ops: [{ op: 'set', path: ['deep'], value: true }], revision: 1 },
    ])
    mounted.settings.scope('resource-github').user({ deep: true })
    await mounted.settings.scope('resource-github').settle()
    await flush()
    expect(mounted.view.container.querySelector('[data-sources-dirty]')).toBeNull()
  })

  it('stages a select choice, and keeps a value the declared choices do not hold', async () => {
    const mounted = await withForm(namespaceView({ value: { ...SOURCE_VALUE, mode: 'code' } }))
    fireEvent.change(pick(mounted, '[data-sources-field="mode"] select'), { target: { value: 'refs' } })
    fireEvent.click(pick(mounted, '[data-sources-save="github/main"]'))
    expect(mounted.settings.scope('resource-github').mutations[0]?.ops)
      .toEqual([{ op: 'set', path: ['mode'], value: 'refs' }])

    const unexpected = await withForm(namespaceView({ value: { ...SOURCE_VALUE, mode: 'legacy' } }))
    const select = pick(unexpected, '[data-sources-field="mode"] select') as HTMLSelectElement
    expect(select.value).toBe('legacy')
    expect([...select.options].map(option => option.value)).toEqual(['legacy', 'refs', 'code'])
    expect((pick(unexpected, '[data-sources-save="github/main"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('previews the fallback for a cleared field and refuses a draft no control accepts', async () => {
    const mounted = await withForm({ ...namespaceView(), user: { limit: 5 }, base: { limit: 10 } })
    const limit = pick(mounted, '[data-sources-field="limit"] input') as HTMLInputElement
    expect(limit.value).toBe('20')
    fireEvent.click(pick(mounted, '[data-sources-field-reset="limit"]'))
    expect((pick(mounted, '[data-sources-field="limit"] input') as HTMLInputElement).value).toBe('10')
    fireEvent.change(pick(mounted, '[data-sources-field="limit"] input'), { target: { value: 'ten' } })
    expect(pick(mounted, '[data-sources-field="limit"] input').getAttribute('aria-invalid')).toBe('true')
    expect((pick(mounted, '[data-sources-save="github/main"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('clears a user override through the reset control, and disables it for a field no user layer carries', async () => {
    const mounted = await withForm({ ...namespaceView(), user: { query: 'mine' } })
    const reset = pick(mounted, '[data-sources-field-reset="query"]') as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    fireEvent.click(reset)
    fireEvent.click(pick(mounted, '[data-sources-save="github/main"]'))
    expect(mounted.settings.scope('resource-github').mutations[0]?.ops).toEqual([{ op: 'unset', path: ['query'] }])
    expect((pick(mounted, '[data-sources-field-reset="host"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a read-only document, a discarded stage, and a save that did not land', async () => {
    const mounted = mountBody()
    await listSources(mounted, [sourceView()])
    await flush()
    mounted.settings.publish({
      status: 'ready',
      view: { namespaces: [namespaceView()], writable: false, hasDocument: true },
      error: null,
    })
    await flush()
    expect(pick(mounted, '[data-sources-settings-readonly]').textContent).toBe(zh['settings.readonly'])
    expect((pick(mounted, '[data-sources-save="github/main"]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(pick(mounted, '[data-sources-field="query"] input'), { target: { value: 'needle' } })
    fireEvent.click(pick(mounted, '[data-sources-discard="github/main"]'))
    expect(mounted.view.container.querySelector('[data-sources-dirty]')).toBeNull()
    mounted.actions.saved(TAB, SOURCE_KEY, false)
    await flush()
    expect(pick(mounted, '[data-sources-save-failed]').textContent).toBe(zh['settings.failed'])
  })

  it('draws a field the panel cannot edit as the value it holds, and names a credential field', async () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'object', meta: {}, dict: { fixed: 2, missing: 3, absent: 4 } },
        '2': { type: 'const', meta: {}, value: 42 },
        '3': { type: 'string', meta: {} },
        '4': { type: 'const', meta: {}, value: 7 },
      },
    } as unknown as JsonValue
    const mounted = mountBody()
    await listSources(mounted, [sourceView({
      credentials: [{ field: 'missing', ref: 'A_REF', configured: true, writable: true }],
    })])
    await flush()
    mounted.settings.publish({
      status: 'ready',
      view: { namespaces: [namespaceView({ schema, value: { fixed: 42 } })], writable: true, hasDocument: true },
      error: null,
    })
    await flush()
    const fixed = pick(mounted, '[data-sources-field="fixed"]')
    expect(fixed.querySelector('code')?.textContent).toBe('42')
    expect(fixed.textContent).toContain(zh['settings.unsupported'])
    // A field the descriptor carries no value for still renders, with the
    // credential hint naming what a reference there means.
    const missing = pick(mounted, '[data-sources-field="missing"]')
    expect((missing.querySelector('input') as HTMLInputElement).value).toBe('')
    expect(missing.querySelector('input')?.getAttribute('aria-label'))
      .toBe(`missing — ${zh['settings.credentialHint']}`)
    // A field the descriptor carries no value for at all renders as nothing.
    expect(pick(mounted, '[data-sources-field="absent"]').querySelector('code')?.textContent).toBe('')
  })
})

describe('SourcesBody the deliberately absent sources', () => {
  it('lists every source this design does not build, with its reason, and offers no control', () => {
    const mounted = mountBody({ seed: (actions) => { actions.listed(TAB, [sourceView()]) } })
    const absent = pick(mounted, '[data-sources-absent]')
    const text = absent.textContent ?? ''
    expect(text).toContain(zh['absent.title'])
    expect(text).toContain(zh['absent.note'])
    expect(text).toContain(zh['absent.360'])
    expect(text).toContain(zh['absent.netease'])
    expect(text).toContain(zh['absent.quark'])
    expect(text).toContain(zh['absent.baidu'])
    expect(text).toContain(zh['absent.360ai'])
    expect(text).toContain(zh['absent.alternatives'])
    expect(absent.querySelectorAll('button, input, select')).toHaveLength(0)
  })
})

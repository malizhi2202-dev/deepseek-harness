// @vitest-environment jsdom
/**
 * The body against a scripted Host.
 *
 * What is asserted is the reader's contract: the panel reads its channels on
 * mount and draws whichever state the read settled in, one card per channel
 * with the connection the Host reports, the credentials by reference name only,
 * and a form built from the channel's own schema — where staging an edit is not
 * a write, saving sends the staged operations under the revision the form was
 * read at, and a field the panel cannot edit says so instead of pretending.
 */
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChannelView } from '@deepseek-ai/dsh-api-channels/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { NAMESPACE, channelView, failure, namespaceView } from './scripted-channels.client.ts'
import { TAB, flush, listChannels, mountBody } from './mount.client.tsx'
import type { Mounted } from './mount.client.tsx'

/** Earlier mounts leave their nodes behind; each test draws only its own. */
afterEach(() => { cleanup() })

/** One channel's card. */
function card(mounted: Mounted, channel = 'tuitui'): HTMLElement {
  const found = mounted.view.container.querySelector(`[data-channels-card="${channel}"]`)
  if (found === null) throw new Error(`no card for ${channel}`)
  return found as HTMLElement
}

/** The `data-` hook of one element inside a card, the card itself included. */
function hook(mounted: Mounted, name: string, channel = 'tuitui'): HTMLElement | null {
  const root = card(mounted, channel)
  if (root.getAttribute(`data-channels-${name}`) !== null) return root
  return root.querySelector(`[data-channels-${name}]`)
}

/** The value of one `data-` hook inside a card. */
function hookValue(mounted: Mounted, name: string, channel = 'tuitui'): string | null {
  return hook(mounted, name, channel)?.getAttribute(`data-channels-${name}`) ?? null
}

/** The one field row a form renders for a field name. */
function field(mounted: Mounted, name: string): HTMLElement {
  const row = mounted.view.container.querySelector(`[data-channels-field="${name}"]`)
  if (row === null) throw new Error(`no field row for ${name}`)
  return row as HTMLElement
}

/** The control one field row renders. */
function control(mounted: Mounted, name: string): HTMLElement {
  const found = field(mounted, name).querySelector('input, select')
  if (found === null) throw new Error(`no control for ${name}`)
  return found as HTMLElement
}

/** Type into one field's control. */
function type(mounted: Mounted, name: string, text: string): void {
  fireEvent.change(control(mounted, name), { target: { value: text } })
}

/** Click one `data-` hook inside a card. */
function click(mounted: Mounted, name: string): void {
  fireEvent.click(hook(mounted, name) as HTMLElement)
}

/** The button state of one `data-` hook inside a card. */
function disabled(mounted: Mounted, name: string): boolean {
  return (hook(mounted, name) as HTMLButtonElement).disabled
}

/**
 * Mount a panel whose channel read has settled over one published descriptor.
 * @param options - the descriptor overrides, whether the document is writable, and the channels the Host reports.
 * @returns the mounted panel.
 */
async function mountReady(options: {
  overrides?: Partial<SettingsNamespaceView>
  writable?: boolean
  channels?: ChannelView[]
} = {}): Promise<Mounted> {
  const mounted = mountBody()
  mounted.settings.publish({
    status: 'ready',
    view: {
      namespaces: [namespaceView(options.overrides ?? {})],
      writable: options.writable ?? true,
      hasDocument: true,
    },
    error: null,
  })
  await listChannels(mounted, options.channels ?? [channelView()])
  return mounted
}

/**
 * One schema envelope holding a single field named `field`.
 *
 * Every node is reached by reference, as the Host's serializer emits them: a
 * nested node inlined into its parent is not what a channel ever publishes.
 * @param node - the field's schema node.
 * @param extra - further referenced nodes, keyed by the id that reaches them.
 * @returns the serialized envelope.
 */
function schemaOf(node: Record<string, unknown>, extra: Record<string, unknown> = {}): JsonValue {
  return JSON.parse(JSON.stringify({
    uid: 1,
    refs: { 1: { type: 'object', meta: {}, dict: { field: 2 } }, 2: node, ...extra },
  })) as JsonValue
}

describe('ChannelsBody states', () => {
  it('reads its channels on mount and draws the loading line until the read settles', () => {
    const mounted = mountBody()
    expect(mounted.script.calls.map(call => call.method)).toEqual(['status'])
    expect(mounted.view.getByText('正在读取渠道状态…')).toBeDefined()
  })

  it('draws the ready list once the read settles', async () => {
    const mounted = mountBody()
    await listChannels(mounted, [channelView({ connection: 'connected' })])
    expect(mounted.view.container.querySelector('[data-channels-state="ready"]')).not.toBeNull()
    expect(hookValue(mounted, 'connection')).toBe('connected')
  })

  it('draws a channel list it could not read as the failure line with its code', async () => {
    const mounted = mountBody()
    await mounted.script.settle({ ok: false, error: failure('channels/failed', 'no host') })
    expect(mounted.view.getByText('渠道操作失败：no host')).toBeDefined()
    expect(mounted.view.container.querySelector('[data-channels-state="failed"]')?.getAttribute('data-channels-code'))
      .toBe('channels/failed')
  })

  it('says so when the Host serves no channel, and reads again on request', async () => {
    const mounted = mountBody()
    await listChannels(mounted, [])
    expect(mounted.view.getByText('这个主机还没有注册任何聊天渠道。')).toBeDefined()
    fireEvent.click(mounted.view.getByLabelText('重新读取'))
    expect(mounted.script.calls.map(call => call.method)).toEqual(['status', 'status'])
  })

  it('reads nothing for a record that is already gone', () => {
    const mounted = mountBody({ live: false })
    expect(mounted.script.calls).toEqual([])
    expect(mounted.view.getByText('正在读取渠道状态…')).toBeDefined()
  })
})

describe('ChannelCard', () => {
  it('names each connection state the Host reports', async () => {
    const mounted = await mountReady({
      channels: [
        channelView({ connection: 'connected' }),
        channelView({ channel: 'other', connection: 'connecting' }),
        channelView({ channel: 'third', connection: 'failed' }),
        channelView({ channel: 'fourth', connection: 'stopped' }),
      ],
    })
    const label = (channel: string): string | null =>
      mounted.view.container.querySelector(`[data-channels-card="${channel}"] [data-channels-connection-label]`)?.textContent ?? null
    expect([label('tuitui'), label('other'), label('third'), label('fourth')])
      .toEqual(['已连接', '正在连接', '连接失败', '未连接'])
  })

  it('keeps an id this build does not name verbatim', async () => {
    const mounted = await mountReady({ channels: [channelView({ channel: 'dingtalk' })] })
    expect(mounted.view.getByText('dingtalk')).toBeDefined()
    expect(mounted.view.queryByText('推推')).toBeNull()
  })

  it('names the bound session and the last failure the Host reported', async () => {
    const mounted = await mountReady({
      channels: [channelView({ sessionId: 's-bound', lastError: 'token rejected' })],
    })
    expect(mounted.view.getByText('已绑定会话 s-bound')).toBeDefined()
    expect(mounted.view.getByText('最近一次失败：token rejected')).toBeDefined()
  })

  it('names a channel the Host does not serve, and one whose change it refused', async () => {
    const mounted = await mountReady()
    fireEvent.click(mounted.view.getByText('启用'))
    await mounted.script.settle({ ok: false, error: failure('channels/unknown', 'no such channel') })
    expect(mounted.view.getByText('这个主机没有注册名为 tuitui 的渠道。')).toBeDefined()
    expect(hookValue(mounted, 'failure')).toBe('channels/unknown')
    fireEvent.click(mounted.view.getByText('启用'))
    await mounted.script.settle({ ok: false, error: failure('channels/failed', 'refused') })
    expect(mounted.view.getByText('渠道操作失败：refused')).toBeDefined()
  })

  it('offers enable or disable according to what the Host reports, and probes on request', async () => {
    const mounted = await mountReady({ channels: [channelView({ enabled: true, sessionId: 's-1' })] })
    fireEvent.click(mounted.view.getByText('停用'))
    expect(mounted.script.calls.at(-1)).toEqual({ method: 'disable', channel: 'tuitui', sessionId: undefined })
    expect(hookValue(mounted, 'action')).toBe('disable')
    await mounted.script.settleControl({ channels: [channelView({ enabled: false })] })
    expect(mounted.view.getByText('启用')).toBeDefined()
    fireEvent.click(mounted.view.getByText('启用'))
    expect(mounted.script.calls.at(-1)).toEqual({ method: 'enable', channel: 'tuitui', sessionId: 's-test' })
    expect(hookValue(mounted, 'action')).toBe('enable')
    await mounted.script.settleControl({ channels: [channelView({ enabled: true })] })
    fireEvent.click(mounted.view.getByText('测试凭据'))
    expect(mounted.script.calls.at(-1)?.method).toBe('probe')
    await mounted.script.settleProbe({ ok: true, accountLabel: 'ops', details: ['region cn'] })
    expect(mounted.view.getByText('凭据可用。')).toBeDefined()
    expect(mounted.view.getByText('账号：ops')).toBeDefined()
    expect(mounted.view.getByText('region cn')).toBeDefined()
    expect(hookValue(mounted, 'probe')).toBe('ok')
  })

  it('draws a failed probe with the Host\'s message, and one without any', async () => {
    const mounted = await mountReady()
    fireEvent.click(mounted.view.getByText('测试凭据'))
    await mounted.script.settleProbe({ ok: false, message: 'bad token' })
    expect(mounted.view.getByText('测试失败：bad token')).toBeDefined()
    expect(hookValue(mounted, 'probe')).toBe('failed')
    fireEvent.click(mounted.view.getByText('测试凭据'))
    await mounted.script.settleProbe({ ok: false })
    expect(mounted.view.getByText('测试失败：')).toBeDefined()
  })

  it('lists the capabilities the connector declared, and says nothing when it declared none', async () => {
    const mounted = await mountReady({
      channels: [channelView({
        capabilities: {
          quoting: true,
          inbound: { images: false, files: true },
          outbound: { images: true, files: false },
          markdown: false,
          maxTextChars: 2048,
          maxInboundBytes: 1024,
          maxOutboundBytes: 4096,
        },
      })],
    })
    const line = hook(mounted, 'capabilities')?.textContent ?? ''
    expect(line).toContain('平台能力')
    expect(line).toContain('引用回复')
    expect(line).toContain('接收文件')
    expect(line).toContain('发送图片')
    expect(line).toContain('单条文本上限 2048 字')
    expect(line).toContain('接收附件上限 1024 字节')
    expect(line).toContain('发送附件上限 4096 字节')
    expect(line).not.toContain('接收图片')
    expect(line).not.toContain('Markdown')
    const bare = await mountReady({
      channels: [channelView({
        capabilities: {
          quoting: false,
          inbound: { images: false, files: false },
          outbound: { images: false, files: false },
          markdown: false,
        },
      })],
    })
    expect(hook(bare, 'capabilities')).toBeNull()
  })

  it('names every credential by reference only, with where its value comes from', async () => {
    const mounted = await mountReady({
      channels: [channelView({
        credentials: [
          { field: 'appSecretRef', ref: 'TUYTUY_APP_SECRET', configured: true, source: 'env', writable: false },
          { field: 'tokenRef', ref: '', configured: false, writable: true },
        ],
      })],
    })
    const rows = mounted.view.container.querySelectorAll('[data-channels-credential]')
    expect([...rows].map(row => [
      row.getAttribute('data-channels-credential'),
      row.getAttribute('data-channels-credential-state'),
      row.textContent,
    ])).toEqual([
      ['appSecretRef', 'configured', 'appSecretRefTUYTUY_APP_SECRET已配置来源：env不可写入'],
      ['tokenRef', 'unset', 'tokenRef未配置'],
    ])
    expect(hook(mounted, 'credentials-note')?.textContent).toContain('只显示引用名')
    expect(mounted.view.container.querySelector('[data-channels-settings]')?.getAttribute('data-channels-settings'))
      .toBe(NAMESPACE)
  })
})

describe('settings form', () => {
  it('says what the form is waiting for, and what this client is not served', async () => {
    const mounted = mountBody()
    await listChannels(mounted, [channelView()])
    expect(mounted.view.getByText('正在读取设置…')).toBeDefined()
    mounted.settings.publish({ status: 'unavailable', view: undefined, error: null })
    await flush()
    expect(mounted.view.getByText('这个渠道的设置没有暴露给这个客户端。')).toBeDefined()
  })

  it('renders one control per field the channel\'s own schema declares', async () => {
    const mounted = await mountReady()
    expect([...mounted.view.container.querySelectorAll('[data-channels-field]')].map(row => row.getAttribute('data-channels-field')))
      .toEqual(['enabled', 'sessionId', 'markdown', 'host', 'appSecretRef'])
    expect(field(mounted, 'enabled').querySelector('[role="switch"]')).not.toBeNull()
    expect(control(mounted, 'host').getAttribute('type')).toBe('text')
    expect(control(mounted, 'appSecretRef').getAttribute('type')).toBe('password')
    expect(field(mounted, 'appSecretRef').querySelector('[data-channels-field-reset]')).toBeNull()
    expect(field(mounted, 'appSecretRef').textContent).toContain('只能写入，不回显；留空表示不改动。')
    expect(field(mounted, 'sessionId').textContent).toContain('结构默认')
  })

  it('names the layer that supplies each field, and offers the reset only where the user layer owns it', async () => {
    const mounted = await mountReady({
      overrides: {
        value: { enabled: false, sessionId: 's-1', markdown: true, host: 'h', appSecretRef: '' },
        base: { host: 'from-base', markdown: false },
        user: { sessionId: 's-1' },
        secrets: [{ path: ['appSecretRef'], set: true }],
      },
    })
    expect(field(mounted, 'sessionId').getAttribute('data-channels-layer')).toBe('user')
    expect(field(mounted, 'host').getAttribute('data-channels-layer')).toBe('base')
    expect(field(mounted, 'enabled').getAttribute('data-channels-layer')).toBe('default')
    expect(field(mounted, 'appSecretRef').getAttribute('data-channels-layer')).toBeNull()
    const reset = (name: string): HTMLButtonElement =>
      field(mounted, name).querySelector('[data-channels-field-reset]') as HTMLButtonElement
    expect(reset('sessionId').disabled).toBe(false)
    expect(reset('host').disabled).toBe(true)
    const badge = (name: string): HTMLElement =>
      field(mounted, name).querySelector('[data-channels-field-state]') as HTMLElement
    expect(badge('appSecretRef').getAttribute('data-channels-field-state')).toBe('set')
    expect(badge('appSecretRef').textContent).toBe('已配置')
    expect(badge('host').textContent).toBe('部署默认')
  })

  it('shows the value a field falls back to once it is cleared', async () => {
    const mounted = await mountReady({
      overrides: {
        value: { enabled: false, sessionId: '', markdown: true, host: 'typed', appSecretRef: '' },
        base: { host: 'from-base' },
        user: { host: 'typed' },
      },
    })
    fireEvent.click(field(mounted, 'host').querySelector('[data-channels-field-reset]') as HTMLElement)
    expect((control(mounted, 'host') as HTMLInputElement).value).toBe('from-base')
    // A field the user layer owns reverts to the schema's own default.
    const schema = await mountReady({
      overrides: {
        value: { enabled: false, sessionId: '', markdown: false, host: 'typed', appSecretRef: '' },
        user: { host: 'typed', markdown: false },
      },
    })
    fireEvent.click(field(schema, 'markdown').querySelector('[data-channels-field-reset]') as HTMLElement)
    expect(field(schema, 'markdown').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('stages an edit without writing, and saves the staged operations under the revision it read', async () => {
    const mounted = await mountReady()
    mounted.settings.scope(NAMESPACE).revision(5)
    expect(disabled(mounted, 'save')).toBe(true)
    type(mounted, 'host', 'typed')
    expect(hook(mounted, 'dirty')?.textContent).toBe('有未保存的修改')
    expect(disabled(mounted, 'save')).toBe(false)
    expect(mounted.settings.scope(NAMESPACE).mutations).toEqual([])
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations).toEqual([
      { ops: [{ op: 'set', path: ['host'], value: 'typed' }], revision: 5 },
    ])
    expect(hook(mounted, 'save')?.textContent).toBe('正在保存…')
    mounted.settings.scope(NAMESPACE).user({ host: 'typed' })
    await mounted.settings.scope(NAMESPACE).settle()
    expect(hook(mounted, 'dirty')).toBeNull()
    expect(hook(mounted, 'save-failed')).toBeNull()
  })

  it('keeps the staged edit and says so when the save did not take effect', async () => {
    const mounted = await mountReady()
    type(mounted, 'host', 'typed')
    click(mounted, 'save')
    mounted.settings.scope(NAMESPACE).user({})
    await mounted.settings.scope(NAMESPACE).settle()
    expect(hook(mounted, 'save-failed')?.textContent).toContain('保存没有生效')
    expect(hook(mounted, 'dirty')?.textContent).toBe('有未保存的修改')
    expect((control(mounted, 'host') as HTMLInputElement).value).toBe('typed')
    click(mounted, 'discard')
    expect(hook(mounted, 'dirty')).toBeNull()
    expect((control(mounted, 'host') as HTMLInputElement).value).toBe('')
  })

  it('clears a field through the user layer rather than writing the default', async () => {
    const mounted = await mountReady({
      overrides: {
        value: { enabled: false, sessionId: 's-1', markdown: true, host: '', appSecretRef: '' },
        base: { host: 'from-base' },
        user: { host: 'from-base' },
      },
    })
    fireEvent.click(field(mounted, 'host').querySelector('[data-channels-field-reset]') as HTMLElement)
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[0]?.ops).toEqual([{ op: 'unset', path: ['host'] }])
  })

  it('writes a secret only when the reader typed one', async () => {
    const mounted = await mountReady()
    type(mounted, 'appSecretRef', 'typed-secret')
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[0]?.ops).toEqual([
      { op: 'set', path: ['appSecretRef'], value: 'typed-secret' },
    ])
  })

  it('offers the declared choices of a select, keeping a stored value outside them', async () => {
    const mounted = await mountReady({
      overrides: {
        schema: schemaOf(
          { type: 'union', meta: {}, list: [3] },
          { 3: { type: 'const', meta: {}, value: 'fast' } },
        ),
        value: { field: 'legacy' },
      },
    })
    const select = (): HTMLSelectElement => control(mounted, 'field') as HTMLSelectElement
    expect([...select().options].map(option => option.value)).toEqual(['legacy', 'fast'])
    expect(select().value).toBe('legacy')
    // A staged value the field cannot store leaves the save disabled.
    mounted.actions.edited(TAB, 'tuitui', 'field', { text: 'slow', clear: false })
    await flush()
    expect(disabled(mounted, 'save')).toBe(true)
    expect(hook(mounted, 'dirty')?.textContent).toBe('有未保存的修改')
    fireEvent.change(select(), { target: { value: 'fast' } })
    expect(select().value).toBe('fast')
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[0]?.ops).toEqual([
      { op: 'set', path: ['field'], value: 'fast' },
    ])
  })

  it('draws a field the panel cannot edit as the value it holds', async () => {
    const mounted = await mountReady({
      overrides: { schema: schemaOf({ type: 'object', meta: {}, dict: {} }), value: { field: { perDay: 3 } } },
    })
    expect(field(mounted, 'field').querySelector('code')?.textContent).toBe('{"perDay":3}')
    expect(field(mounted, 'field').textContent).toContain('这个字段不能在面板里编辑。')
    const empty = await mountReady({
      overrides: { schema: schemaOf({ type: 'object', meta: {}, dict: {} }), value: {} },
    })
    expect(field(empty, 'field').querySelector('code')?.textContent).toBe('')
  })

  it('renders a number field from its own value and refuses text it cannot parse', async () => {
    const mounted = await mountReady({
      overrides: { schema: schemaOf({ type: 'number', meta: { default: 2 } }), value: { field: 5 } },
    })
    expect(control(mounted, 'field').getAttribute('type')).toBe('number')
    expect((control(mounted, 'field') as HTMLInputElement).value).toBe('5')
    type(mounted, 'field', 'many')
    expect(control(mounted, 'field').getAttribute('aria-invalid')).toBe('true')
    expect(disabled(mounted, 'save')).toBe(true)
    type(mounted, 'field', '7')
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[0]?.ops).toEqual([{ op: 'set', path: ['field'], value: 7 }])
  })

  it('toggles a boolean field through its own control, both ways', async () => {
    const mounted = await mountReady()
    fireEvent.click(field(mounted, 'markdown').querySelector('[role="switch"]') as HTMLElement)
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[0]?.ops).toEqual([
      { op: 'set', path: ['markdown'], value: false },
    ])
    mounted.settings.scope(NAMESPACE).user({ markdown: false })
    await mounted.settings.scope(NAMESPACE).settle()
    fireEvent.click(field(mounted, 'enabled').querySelector('[role="switch"]') as HTMLElement)
    click(mounted, 'save')
    expect(mounted.settings.scope(NAMESPACE).mutations[1]?.ops).toEqual([
      { op: 'set', path: ['enabled'], value: true },
    ])
  })

  it('marks a credential field as a reference name rather than a secret', async () => {
    const mounted = await mountReady({
      channels: [channelView({ credentials: [{ field: 'host', ref: 'HOST', configured: true, writable: true }] })],
    })
    expect(control(mounted, 'host').getAttribute('aria-label')).toBe('host — 凭据引用名，不是密钥本身。')
  })

  it('states a read-only document and refuses to save into it', async () => {
    const mounted = await mountReady({ writable: false })
    expect(hook(mounted, 'settings-readonly')?.textContent).toBe('这个部署的设置文档是只读的。')
    expect(disabled(mounted, 'save')).toBe(true)
    type(mounted, 'host', 'typed')
    expect(disabled(mounted, 'save')).toBe(true)
  })

  it('disables the discard control until something is staged', async () => {
    const mounted = await mountReady()
    expect(disabled(mounted, 'discard')).toBe(true)
    type(mounted, 'host', 'typed')
    expect(disabled(mounted, 'discard')).toBe(false)
  })
})

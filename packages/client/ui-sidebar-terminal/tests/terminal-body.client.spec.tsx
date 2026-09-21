// @vitest-environment jsdom
/**
 * The body against a scripted console.
 *
 * What is asserted is the reader's contract: the panel asks for its shells on
 * mount, draws each settled state whole, numbers the shell chips from the
 * server's index rather than from position, submits a typed line through its
 * face and clears it, disables the line while a write is in flight or after the
 * shell exits, and states what it is not.
 */
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { flush } from './scripted-console.client.ts'
import { mountBody, listShells } from './mount.client.tsx'

/** Earlier mounts leave their nodes behind; each test draws only its own. */
afterEach(() => { cleanup() })

/**
 * Type one line into the mounted panel's console and submit it.
 * @param mounted - the mounted panel.
 * @param text - the command line to type.
 */
async function submit(mounted: ReturnType<typeof mountBody>, text: string): Promise<void> {
  const field = mounted.view.getByLabelText('输入命令')
  fireEvent.change(field, { target: { value: text } })
  fireEvent.submit(field.closest('form') as HTMLFormElement)
  await flush()
}

describe('TerminalBody', () => {
  it('asks for its shells on mount and shows the connecting line until the list settles', () => {
    const { script, view } = mountBody()
    expect(script.calls.map(call => call.method)).toEqual(['list'])
    expect(view.getByText('正在连接终端…')).toBeDefined()
  })

  it('draws the refusal as its own state with no controls and no request beyond the list', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: false, error: new RemoteError('terminal-console/refused', 'reachable surface', {}) })
    expect(view.getByText('这个安装允许网络可达的设备访问，因此终端面板已被拒绝。')).toBeDefined()
    expect(view.queryByLabelText('新建终端')).toBeNull()
    expect(script.calls.map(call => call.method)).toEqual(['list'])
  })

  it('names the missing backend for an unavailable host', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: false, error: new RemoteError('terminal-console/unavailable', 'no console-shell backend', {}) })
    expect(view.getByText('这个主机没有注册可用的 shell 后端：no console-shell backend')).toBeDefined()
  })

  it('draws a carrier fault as a failed panel with its code', async () => {
    const { script, view } = mountBody()
    await script.settle({ ok: false, error: new RemoteError('gateway/internal', 'the socket closed', {}) })
    expect(view.getByText('终端操作失败：the socket closed')).toBeDefined()
    expect(view.container.querySelector('[data-terminal-state="failed"]')?.getAttribute('data-terminal-code'))
      .toBe('gateway/internal')
  })

  it('mints one shell when the session holds none and draws its text', async () => {
    const { script, view } = mountBody()
    await script.settleList([])
    expect(script.calls.map(call => call.method)).toEqual(['list', 'open'])
    await script.settleOpen({ shellId: 'console-1', index: 1, pid: 4242, status: { kind: 'running' } })
    expect(view.getByRole('button', { name: '终端 1' })).toBeDefined()
    script.streams[0]?.push({ kind: 'output', text: 'total 0\n', replace: true })
    await flush()
    expect(view.container.querySelector('[data-terminal-output]')?.textContent).toBe('total 0\n')
  })

  it('numbers the chips from the server index, not from position, and switches on click', async () => {
    const mounted = mountBody()
    await listShells(mounted, [
      { shellId: 'console-1', index: 1, status: { kind: 'running' } },
      { shellId: 'console-3', index: 3, status: { kind: 'running' } },
    ])
    const chips = mounted.view.container.querySelectorAll('[data-terminal-chip]')
    expect([...chips].map(chip => chip.textContent)).toEqual(['终端 1', '终端 3'])
    fireEvent.click(mounted.view.getByRole('button', { name: '终端 1' }))
    expect(mounted.view.getByRole('button', { name: '终端 1' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('submits a typed line through the face and clears the field', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    const field = mounted.view.getByLabelText('输入命令')
    fireEvent.change(field, { target: { value: 'ls -la' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    expect(mounted.script.calls.at(-1)).toMatchObject({ method: 'write', shellId: 'console-1', text: 'ls -la' })
    expect((field as HTMLInputElement).value).toBe('')
    await mounted.script.settleWrite({ shellId: 'console-1', index: 1, status: { kind: 'running' } })
  })

  it('submits nothing for an empty line', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    fireEvent.submit(mounted.view.getByLabelText('输入命令').closest('form') as HTMLFormElement)
    expect(mounted.script.calls.map(call => call.method)).toEqual(['list', 'output'])
  })

  it('disables the line while a write is in flight and reports a refused one', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    const field = mounted.view.getByLabelText('输入命令')
    fireEvent.change(field, { target: { value: 'sleep 60' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    expect((field as HTMLInputElement).disabled).toBe(true)
    expect(mounted.view.getByText('上一条命令还在运行，等它结束或关闭这个终端。')).toBeDefined()
    await mounted.script.settle({ ok: false, error: new RemoteError('terminal-console/busy', 'a send is active', {}) })
    expect((field as HTMLInputElement).disabled).toBe(false)
    expect(mounted.view.getByText('这个终端正忙：a send is active')).toBeDefined()
  })

  it('names the reached limit and a shell that is gone', async () => {
    const limited = mountBody()
    await listShells(limited, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    await submit(limited, 'ls')
    await limited.script.settle({ ok: false, error: new RemoteError('terminal-console/limit', 'this session holds 2', {}) })
    expect(limited.view.getByText('同时打开的终端数量已达上限：this session holds 2')).toBeDefined()
    limited.view.unmount()

    const gone = mountBody()
    await listShells(gone, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    await submit(gone, 'ls')
    await gone.script.settle({ ok: false, error: new RemoteError('terminal-console/unknown-shell', 'no such shell', {}) })
    expect(gone.view.getByText('这个终端已经不在了：no such shell')).toBeDefined()
  })

  it('says a shell exited and disables its line', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    mounted.script.streams[0]?.push({ kind: 'exit', exitCode: 130, signal: null })
    await flush()
    expect(mounted.view.getByText('这个终端已退出。')).toBeDefined()
    expect((mounted.view.getByLabelText('输入命令') as HTMLInputElement).disabled).toBe(true)
    // An exited shell offers no close control: the server already reaped it.
    expect(mounted.view.queryByLabelText('关闭终端')).toBeNull()
  })

  it('mints another shell from the bar and closes the one on screen', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    fireEvent.click(mounted.view.getByLabelText('新建终端'))
    await mounted.script.settleOpen({ shellId: 'console-2', index: 2, status: { kind: 'running' } })
    expect(mounted.view.getByRole('button', { name: '终端 2' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(mounted.view.getByLabelText('关闭终端'))
    await mounted.script.settleClose(true)
    expect(mounted.view.queryByRole('button', { name: '终端 2' })).toBeNull()
    expect(mounted.view.getByRole('button', { name: '终端 1' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says so when the session holds no shells at all', async () => {
    const mounted = mountBody()
    await listShells(mounted, [])
    await mounted.script.settleOpen({ shellId: 'console-1', index: 1, status: { kind: 'running' } })
    mounted.actions.dropped('tab-1' as never, 'console-1')
    await flush()
    expect(mounted.view.getByText('还没有终端。新建一个开始使用。')).toBeDefined()
  })

  it('states what this surface is not, wherever the console is drawn', async () => {
    const mounted = mountBody()
    await listShells(mounted, [{ shellId: 'console-1', index: 1, status: { kind: 'running' } }])
    expect(mounted.view.getByText('这里是纯文本输出，不是完整终端：没有颜色、光标控制和全屏程序。')).toBeDefined()
    expect(mounted.view.getByText('这个终端只属于你：输出不会进入会话记录，也不会成为模型输入。')).toBeDefined()
  })

  it('asks for nothing from a record that already ended', () => {
    const { script, view } = mountBody(false)
    expect(script.calls).toEqual([])
    expect(view.getByText('正在连接终端…')).toBeDefined()
  })
})

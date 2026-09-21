/**
 * Tests for the chat-channel registry: registration is an effect that a
 * duplicate refuses and that unwinds with its disposer or its owning fiber.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChatChannels from '../src/index.ts'
import type { ChatChannelConnector } from '../src/types.ts'

/** One connector for the named platform, with everything else irrelevant here. */
function connector(channel: string): ChatChannelConnector {
  return { channel } as unknown as ChatChannelConnector
}

/** A fresh context with the registry mounted, and the registry it registered. */
async function open(): Promise<{
  ctx: Context
  registry: ChatChannels
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = await ctx.plugin(ChatChannels)
  const registry = ctx.get('chatChannels')
  if (registry === undefined) throw new Error('ChatChannels did not register as ctx.chatChannels')
  return { ctx, registry, dispose: async () => { await fiber.dispose() } }
}

describe('ChatChannels', () => {
  it('registers as ctx.chatChannels', async () => {
    const { registry, dispose } = await open()
    expect(registry).toBeInstanceOf(ChatChannels)
    await dispose()
  })

  it('lists connectors in registration order and looks each one up', async () => {
    const { registry, dispose } = await open()
    const first = connector('tuitui')
    const second = connector('other')
    registry.register(first)
    registry.register(second)
    expect(registry.list()).toEqual([first, second])
    expect(registry.get('tuitui' as never)).toBe(first)
    expect(registry.get('absent' as never)).toBeUndefined()
    await dispose()
  })

  it('detaches the array it returns, so a later registration does not change it', async () => {
    const { registry, dispose } = await open()
    registry.register(connector('tuitui'))
    const listed = registry.list()
    registry.register(connector('other'))
    expect(listed).toHaveLength(1)
    await dispose()
  })

  it('refuses a second connector for one platform', async () => {
    const { registry, dispose } = await open()
    registry.register(connector('tuitui'))
    expect(() => registry.register(connector('tuitui')))
      .toThrow('a connector for chat channel "tuitui" is already registered')
    await dispose()
  })

  it('removes the entry when the returned disposer runs', async () => {
    const { registry, dispose } = await open()
    const remove = registry.register(connector('tuitui'))
    remove()
    expect(registry.list()).toEqual([])
    expect(registry.get('tuitui' as never)).toBeUndefined()
    await dispose()
  })

  it('disposes a registration when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, registry, dispose } = await open()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.chatChannels.register(connector('tuitui'))
    }, { inject: ['chatChannels'] }))
    expect(registry.list()).toHaveLength(1)
    await fiber.dispose()
    expect(registry.list()).toEqual([])
    await dispose()
  })
})

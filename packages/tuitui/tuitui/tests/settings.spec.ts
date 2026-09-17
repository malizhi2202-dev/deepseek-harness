/** Settings-seam behavior: the `tuitui` namespace, its secret field, and live reconfiguration. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as TuituiPlugin from '../src/index.ts'
import type { TuituiConfig } from '../src/index.ts'
import type { IncomingCallback, IncomingMessage, TuituiTransport } from '../src/types.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Records reactions so a test can observe a behavioral field change. */
class StubTransport implements TuituiTransport {
  readonly reactions: Array<{ chatId: string; messageId: string; emoji: string }> = []
  private messageHandler: ((message: IncomingMessage) => void) | undefined

  connect = vi.fn(async () => {})
  disconnect = vi.fn(async () => {})

  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  onCallback(_handler: (callback: IncomingCallback) => void): void {}

  async sendMessage(): Promise<boolean> {
    return true
  }

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<boolean> {
    this.reactions.push({ chatId, messageId, emoji })
    return true
  }

  async sendInteractive(): Promise<string | undefined> {
    return 'm1'
  }

  async updateInteractive(): Promise<boolean> {
    return true
  }

  emitMessage(message: IncomingMessage): void {
    this.messageHandler?.(message)
  }
}

let root: string | undefined

/** Prompt assembly as the model-selection waterfall reads and returns it. */
interface Assembly {
  variables: Record<string, string>
}

/**
 * Stand-in for the Agent-scoped context `setup` receives, capturing the
 * `system-prompt/assemble` waterfall that `installModelSelection` registers.
 */
class StubAgentContext {
  private listener:
    | ((assembly: Assembly, context: unknown, next: () => Promise<Assembly>) => Promise<Assembly>)
    | undefined

  constructor(readonly sessionId: string) {}

  on(event: string, listener: unknown): void {
    if (event === 'system-prompt/assemble') {
      this.listener = listener as never
    }
  }

  /**
   * Run the installed waterfall over an empty assembly.
   * @returns the variables the waterfall produced.
   */
  async assemble(): Promise<Record<string, string>> {
    if (this.listener === undefined) throw new Error('setup installed no system-prompt/assemble listener')
    const assembly: Assembly = { variables: {} }
    const assembled = await this.listener(assembly, {}, async () => assembly)
    return assembled.variables
  }
}

interface Bench {
  ctx: Context
  stub: StubTransport
  pluginFiber: Fiber
  create: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  agentContexts: StubAgentContext[]
}

async function boot(config: Partial<TuituiConfig> = {}): Promise<Bench> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tuitui-settings-'))
  const ctx = new Context()
  const stub = new StubTransport()
  const agentContexts: StubAgentContext[] = []

  const dispose = vi.fn(async () => {})
  const create = vi.fn(async (options: { sessionId: string; setup?: (agentCtx: unknown) => Promise<void> }) => {
    const agentCtx = new StubAgentContext(options.sessionId)
    await options.setup?.(agentCtx)
    agentContexts.push(agentCtx)
    return {
      agent: {
        session: { header: { id: options.sessionId }, append: vi.fn() },
        followup: vi.fn(), whenIdle: async () => {}, cancel: () => {},
      },
      dispose,
    }
  })

  ctx.provide('agents' as never, { create } as never)
  ctx.provide('agentDefaultModel' as never, {
    currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
  } as never)
  ctx.provide('llm' as never, {
    listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
    listModels: async () => [
      { id: 'test-model', name: 'test-model-360' },
      { id: 'second-model', name: 'Second Model' },
    ],
  } as never)
  ctx.provide('agentPresets' as never, {
    resolve: async (id?: string) => ({ id: id ?? 'default', name: 'default' }),
    mount: async () => {},
    standingKeyFor: async () => {},
  } as never)
  ctx.provide('permissionPresets' as never, {
    defaultPreset: 'default', resolve: () => {}, set: () => {},
  } as never)

  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(TuituiPlugin, {
    appId: 'test-app',
    appSecret: 'test-secret',
    host: 'im.example.com',
    allowFrom: ['*'],
    groupAllowFrom: ['*'],
    requireMention: false,
    emojiReaction: true,
    reactionEmoji: 'A',
    showThinking: false,
    dataDir: root,
    treePersist: false,
    transport: stub,
    ...config,
  })
  await pluginFiber.await()
  return { ctx, stub, pluginFiber, create, dispose, agentContexts }
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('tuitui settings section', () => {
  it('registers the tuitui namespace with appSecret as a redacted secret', async () => {
    const { ctx, pluginFiber } = await boot()

    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'tuitui')

    expect(descriptor).toBeDefined()
    expect(descriptor?.secrets).toEqual([{ path: ['appSecret'], set: true }])
    expect(JSON.stringify(descriptor)).not.toContain('test-secret')
    await pluginFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('applies a behavioral settings change to subsequent messages', async () => {
    const { ctx, stub, pluginFiber } = await boot()
    const message = (id: string): IncomingMessage => ({
      chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One',
      messageId: id, text: 'hello', mediaUrls: [], raw: {},
    })

    stub.emitMessage(message('m1'))
    await vi.waitFor(() => { expect(stub.reactions).toEqual([{ chatId: 'u1', messageId: 'm1', emoji: 'A' }]) })

    await ctx.settings.update('tuitui', { reactionEmoji: 'B' })

    stub.emitMessage(message('m2'))
    await vi.waitFor(() => {
      expect(stub.reactions).toEqual([
        { chatId: 'u1', messageId: 'm1', emoji: 'A' },
        { chatId: 'u1', messageId: 'm2', emoji: 'B' },
      ])
    })
    await pluginFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('reconnects the transport when the host changes', async () => {
    const { ctx, stub, pluginFiber } = await boot()
    expect(stub.connect).toHaveBeenCalledTimes(1)

    await ctx.settings.update('tuitui', { host: 'other.test' })

    await vi.waitFor(() => { expect(stub.disconnect).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(stub.connect).toHaveBeenCalledTimes(2) })
    await pluginFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('serves its namespace without connecting when unconfigured, then connects after the card saves credentials', async () => {
    const { ctx, stub, pluginFiber } = await boot({ appId: '', appSecret: '', host: '' })

    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'tuitui')
    expect(descriptor).toBeDefined()
    expect(stub.connect).not.toHaveBeenCalled()

    await ctx.settings.update('tuitui', { appId: 'a', appSecret: 's', host: 'im.example.com' })
    await vi.waitFor(() => { expect(stub.connect).toHaveBeenCalledTimes(1) })

    await pluginFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('applies a changed model route to the live chat session instead of restarting it', async () => {
    const { ctx, stub, create, agentContexts, pluginFiber } = await boot({ provider: 'test-provider', model: 'test-model' })
    const message = (id: string): IncomingMessage => ({
      chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One',
      messageId: id, text: 'hello', mediaUrls: [], raw: {},
    })

    stub.emitMessage(message('m1'))
    await vi.waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
    expect(await agentContexts[0]!.assemble()).toMatchObject({ provider: 'test-provider', model: 'test-model' })

    await ctx.settings.update('tuitui', { model: 'second-model' })

    // A Session keeps the route recorded in its log, so the saved change reaches
    // it through the selection ref rather than by recreating the Session.
    stub.emitMessage(message('m2'))
    await vi.waitFor(async () => {
      expect(await agentContexts[0]!.assemble()).toMatchObject({ model: 'second-model' })
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(agentContexts).toHaveLength(1)

    await pluginFiber.dispose()
    await ctx.fiber.dispose()
  })
})

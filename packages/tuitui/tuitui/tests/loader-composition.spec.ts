/** Real Loader composition: boots a test-only cordis.yml that wires the plugin to stub services and a stub transport. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as TuituiPlugin from '../src/index.ts'
import type { TuituiConfig } from '../src/index.ts'
import type { IncomingCallback, IncomingMessage, TuituiTransport } from '../src/types.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class StubTransport implements TuituiTransport {
  readonly sentMessages: Array<{ chatId: string; text: string }> = []
  readonly sentInteractives: Array<{ chatId: string; interactive: Record<string, unknown> }> = []
  private messageHandler: ((message: IncomingMessage) => void) | undefined
  private callbackHandler: ((callback: IncomingCallback) => void) | undefined

  connect = vi.fn(async () => {})
  disconnect = vi.fn(async () => {})

  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  onCallback(handler: (callback: IncomingCallback) => void): void {
    this.callbackHandler = handler
  }

  async sendMessage(chatId: string, content: string): Promise<boolean> {
    this.sentMessages.push({ chatId, text: content })
    return true
  }

  async sendReaction(): Promise<boolean> {
    return true
  }

  async sendInteractive(chatId: string, interactive: Record<string, unknown>): Promise<string | undefined> {
    this.sentInteractives.push({ chatId, interactive })
    return `card-${this.sentInteractives.length}`
  }

  async updateInteractive(): Promise<boolean> {
    return true
  }

  emitMessage(message: IncomingMessage): void {
    this.messageHandler?.(message)
  }

  emitCallback(callback: IncomingCallback): void {
    this.callbackHandler?.(callback)
  }
}

interface Created {
  readonly session: Session
  readonly sessionId: SessionId
  readonly followup: ReturnType<typeof vi.fn>
  readonly agentOptions: { provider?: string; model?: string } | undefined
  readonly append: ReturnType<typeof vi.fn>
}

interface BootResult {
  readonly stub: StubTransport
  readonly create: ReturnType<typeof vi.fn>
  readonly state: { created?: Created }
  readonly pluginCtx: Context | undefined
}

async function boot(config: Partial<TuituiConfig> = {}): Promise<BootResult> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tuitui-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: fixture-dependencies',
    "- name: '@deepseek-ai/dsh-tuitui'",
    '',
  ].join('\n'))

  const stub = new StubTransport()
  const state: { created?: Created } = {}
  const create = vi.fn(async (options: {
    sessionId: SessionId
    agentOptions?: { provider?: string; model?: string }
  }) => {
    const append = vi.fn()
    const session = { header: { id: options.sessionId }, append } as unknown as Session
    const followup = vi.fn()
    state.created = { session, sessionId: options.sessionId, followup, agentOptions: options.agentOptions, append }
    return {
      agent: { session, followup, whenIdle: async () => {}, cancel: () => {} },
      dispose: async () => {},
    }
  })

  const dependencies = {
    name: 'fixture-dependencies',
    apply(ctx: Context) {
      ctx.provide('agents' as never, { create } as never)
      ctx.provide('agentDefaultModel' as never, {
        currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
      } as never)
      ctx.provide('llm' as never, {
        listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
        listModels: async () => [{ id: 'test-model', name: 'test-model-360' }],
      } as never)
      ctx.provide('agentPresets' as never, {
        resolve: async (id?: string) => ({ id: id ?? 'default', name: 'default' }),
        mount: async () => {},
        standingKeyFor: async () => {},
      } as never)
      ctx.provide('permissionPresets' as never, {
        defaultPreset: 'default',
        resolve: () => {},
        set: () => {},
      } as never)
    },
  }

  let pluginCtx: Context | undefined
  const tuitui = {
    name: TuituiPlugin.name,
    inject: TuituiPlugin.inject,
    Config: TuituiPlugin.Config,
    apply(ctx: Context) {
      pluginCtx = ctx
      TuituiPlugin.apply(ctx, {
        appId: 'test-app',
        appSecret: 'test-secret',
        host: 'im.example.com',
        allowFrom: ['*'],
        groupAllowFrom: ['*'],
        requireMention: false,
        emojiReaction: false,
        showThinking: false,
        dataDir: root!,
        treePersist: false,
        transport: stub,
        ...config,
      })
    },
  }

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['fixture-dependencies', dependencies],
    ['@deepseek-ai/dsh-tuitui', tuitui],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()

  return { stub, create, state, pluginCtx }
}

describe('real Loader composition', () => {
  it('routes a chat message to an agent and replies with streamed text', { timeout: 60_000 }, async () => {
    const { stub, create, state, pluginCtx } = await boot()
    expect([...context!.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm1', text: 'hello', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(state.created).toBeDefined() })
    await vi.waitFor(() => { expect(state.created!.followup).toHaveBeenCalledTimes(1) })
    const userMessage = state.created!.followup.mock.calls[0]![0] as {
      source: { kind: string; chatId: string }
      content: Array<{ type: string; text: string }>
    }
    expect(userMessage.source.kind).toBe('tuitui')
    expect(userMessage.source.chatId).toBe('u1')
    expect(userMessage.content[0]).toEqual({ type: 'text', text: 'hello' })

    const session = state.created!.session
    pluginCtx!.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent)
    pluginCtx!.emit('session/event', session, {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'hello world' }] }, stream: [] },
    } as unknown as SessionEvent)
    pluginCtx!.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent)

    await vi.waitFor(() => { expect(stub.sentMessages.some(message => message.text === 'hello world')).toBe(true) })
  })

  it('opens an interactive file-tree card on /tree', { timeout: 60_000 }, async () => {
    const { stub } = await boot()

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm2', text: '/tree', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(stub.sentInteractives.length).toBeGreaterThan(0) })
    expect(stub.sentInteractives[0]!.chatId).toBe('u1')
    expect(stub.sentInteractives[0]!.interactive).toHaveProperty('action')
  })

  it('resolves the deployment default model when the card sets no explicit route', { timeout: 60_000 }, async () => {
    const { stub, create, state } = await boot()

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm3', text: 'hello', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
    // An unset `options.model` fails strict persona templates that reference {{model}}.
    expect(state.created!.agentOptions).toEqual({ provider: 'test-provider', model: 'test-model' })
  })

  it('rejects an unregistered provider with the registered ids instead of opening a broken session', { timeout: 60_000 }, async () => {
    const { stub, create } = await boot({ provider: 'Test Provider', model: 'test-model' })

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm4', text: 'hello', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(stub.sentMessages).toHaveLength(1) })
    expect(stub.sentMessages[0]!.text).toContain('provider "Test Provider" is not registered')
    expect(stub.sentMessages[0]!.text).toContain('did you mean "test-provider"?')
    expect(create).not.toHaveBeenCalled()
  })

  it('disables approvals for a chat session, which has no interactive answerer', { timeout: 60_000 }, async () => {
    const { stub, state } = await boot()

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm6', text: 'hello', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(state.created).toBeDefined() })
    // Under the composed `ask` policy the Web GUI's answerer holds the turn open
    // for a prompt a chat user cannot see, so the chat stays busy forever.
    expect(state.created!.append).toHaveBeenCalledWith('approval/policy', { policy: 'never' })
  })

  it('suggests the model id when the card holds a model display name', { timeout: 60_000 }, async () => {
    const { stub, create } = await boot({ provider: 'test-provider', model: 'test-model-360' })

    stub.emitMessage({ chatId: 'u1', chatType: 'dm', chatName: 'U One', userId: 'u1', userName: 'U One', messageId: 'm5', text: 'hello', mediaUrls: [], raw: {} })

    await vi.waitFor(() => { expect(stub.sentMessages).toHaveLength(1) })
    expect(stub.sentMessages[0]!.text).toContain('has no model "test-model-360" — did you mean "test-model"?')
    expect(create).not.toHaveBeenCalled()
  })
})

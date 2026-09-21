/**
 * Composition harness for the console's unit tests: one real Cordis context,
 * the PTY registry double, and the console service mounted in its own fiber the
 * way a bundle row mounts it, so disposing that fiber is the real teardown path.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TerminalConsole, type Config } from '../src/index.ts'
import { FakeTerminals } from './fake-terminals.ts'

/**
 * Deployment values every console test starts from.
 *
 * Left as the inferred literal type rather than `Config`: every default is
 * resolved here, which is what the service's constructor requires, while the
 * schema's own input type keeps every field optional.
 */
export const BASE_CONFIG = {
  backendType: 'console-shell',
  maxShellsPerOwner: 2,
  maxFrameLines: 400,
  pollIntervalMs: 250,
  acceptReachableSurface: true,
}

/** One test Agent whose scope can be disposed, so owner reaping is observable. */
export interface TestOwner {
  readonly agent: Agent
  /** Dispose this owner's scope, as a session ending does. */
  dispose(): Promise<void>
}

/**
 * Create one owner scope under a context.
 * @param ctx - context the owner scope is created under.
 * @param id - owner id, unique within one test.
 * @returns the Agent and its scope disposer.
 */
export async function createOwner(ctx: Context, id: string): Promise<TestOwner> {
  const scope = await ctx.plugin(() => {})
  return {
    agent: { id, ctx: scope.ctx } as unknown as Agent,
    dispose: async () => { await scope.dispose() },
  }
}

/** One console service over the registry double. */
export interface ConsoleHarness {
  /** Root context the console was mounted under. */
  readonly ctx: Context
  /** The PTY registry double the console reads and writes. */
  readonly terminals: FakeTerminals
  /** The service under test. */
  readonly console: TerminalConsole
  /** The exact deployment values the service was constructed with. */
  readonly config: typeof BASE_CONFIG
  /** Dispose the fiber hosting the console, running its teardown effect. */
  dispose(): Promise<void>
}

/**
 * Build one console service in its own fiber.
 * @param overrides - deployment values to replace before construction.
 * @returns the harness.
 */
export async function createHarness(overrides: Partial<Config> = {}): Promise<ConsoleHarness> {
  const ctx = new Context()
  const terminals = new FakeTerminals()
  const config = { ...BASE_CONFIG, ...overrides }
  ctx.provide('terminals', terminals as never)
  let console: TerminalConsole | undefined
  const fiber = await ctx.plugin({
    name: 'test-terminal-console-host',
    apply: (hostCtx) => { console = new TerminalConsole(hostCtx, config) },
  })
  if (console === undefined) throw new Error('the console host fiber did not construct the service')
  return {
    ctx,
    terminals,
    console,
    config,
    dispose: async () => { await fiber.dispose() },
  }
}

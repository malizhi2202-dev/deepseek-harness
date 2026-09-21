/**
 * Browser half: register `terminal` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.ts`), what it keeps (`store.ts`), how it drives the console
 * (`face.ts`), what it draws (`TerminalBody.tsx`), what it says (`locales.ts`),
 * and this module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-terminal-console/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TERMINAL_ID, terminalDefinition } from './definition.ts'
import { createTerminalConsole, terminalFace } from './face.ts'
import { en, zh } from './locales.ts'
import { createTerminalStore } from './store.ts'
import { TerminalBody } from './TerminalBody.tsx'

export type { SidebarTerminalKey } from './locales.ts'
export type { TerminalReadyState, TerminalTabState, TerminalState, createTerminalStore } from './store.ts'
export type {
  SupervisedStream,
  SupervisedStreamItem,
  SupervisedStreamOptions,
  TerminalConsoleCalls,
  TerminalConsoleNamespace,
  TerminalConsoleRemote,
  TerminalInjected,
} from './face.ts'
export type { TerminalBodyProps } from './TerminalBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarTerminal'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.terminalConsole']

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(terminalDefinition(t)), 'ui-sidebar-terminal: terminal type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-terminal: dictionaries')

  const store = createTerminalStore()
  const inject = terminalFace(createTerminalConsole(ctx.remote))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TERMINAL_ID, locale: NS, store, inject },
    TerminalBody,
  )), 'ui-sidebar-terminal: terminal tab body')
}

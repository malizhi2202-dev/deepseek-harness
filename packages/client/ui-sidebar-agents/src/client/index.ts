/**
 * Browser half: register `agents` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The body reads the session list through framework hooks and reaches the
 * session object layer only through the three callbacks below, so nothing here
 * crosses a package boundary as an imported value.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { AgentsBody, type AgentsInjected } from './AgentsBody.tsx'
import { AGENTS_ID, agentsDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'

export type { AgentsBodyProps, AgentsInjected } from './AgentsBody.tsx'
export type { LineageNode } from './lineage.ts'
export type { SidebarAgentsKey } from './locales.ts'
export { AGENTS_ID, AGENTS_KIND } from './definition.ts'

/** Required browser services: the tab registry, the keyed seat, the session object layer, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the tab registry, the slots, and the sessions service.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const sessions = ctx.sessions
  const actions: AgentsInjected = {
    openChild(address: SubagentAddress): void {
      sessions.openSubagent(address)
    },
    observeCatalog(parentSessionId: SessionId, open: boolean): void {
      sessions.setSubagentCatalogOpen(parentSessionId, open)
    },
    refreshCatalog(parentSessionId: SessionId): void {
      void sessions.refreshSubagents(parentSessionId)
    },
  }
  ctx.effect(() => ctx.sidebarRightTabs.register(agentsDefinition(t)), 'ui-sidebar-agents: agents type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-agents: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: AGENTS_ID, locale: NS, inject: () => actions },
    AgentsBody,
  )), 'ui-sidebar-agents: agents tab body')
}

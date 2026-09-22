/**
 * Browser half: register `automation` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.ts`), what it keeps (`store.ts`), how it reads (`face.ts`), what
 * it draws (`AutomationBody.tsx`, with `lines.ts` holding the pure folds), what
 * it says (`locales.ts`), and this module, which only wires them together.
 *
 * The injected service is `remote.workspace`: the ledger read lives on the
 * `workspace` Remote namespace beside the Workspace Controller's own methods,
 * because both are keyed by `WorkspaceId` on the wire.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-automation/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { AutomationBody } from './AutomationBody.tsx'
import { AUTOMATION_ID, automationDefinition } from './definition.ts'
import { automationFace } from './face.ts'
import { en, zh } from './locales.ts'
import { createAutomationStore } from './store.ts'

export type { SidebarAutomationKey } from './locales.ts'
export type { AutomationState, AutomationTabState, createAutomationStore } from './store.ts'
export type { AutomationInjected, AutomationNamespace, AutomationRemote, AutomationWorkspaceId } from './face.ts'
export type { AutomationBodyProps } from './AutomationBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarAutomation'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and the namespace the ledger read lives on, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspace']

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(automationDefinition(t)), 'ui-sidebar-automation: automation type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-automation: dictionaries')

  const store = createAutomationStore()
  const inject = automationFace({ workspace: ctx.remote.workspace })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: AUTOMATION_ID, locale: NS, store, inject },
    AutomationBody,
  )), 'ui-sidebar-automation: automation tab body')
}

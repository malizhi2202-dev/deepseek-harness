/**
 * Stage one of this package's registration: what the `agents` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, so it opens from the
 * guide page's entry box, the strip's type picker, or a session header's own
 * entry, and never by resolving a resource.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const AGENTS_KIND = 'agents'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const AGENTS_ID = '@deepseek-ai/dsh-client-ui-sidebar-agents'

/**
 * The derivation type's registry definition.
 *
 * `default-on`: a fresh surface opens this tab beside task observation, because
 * the derivation forest is what a user watches while subagents work. That makes
 * its `icon` required, and `order` seats it after task observation.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function agentsDefinition(t: TranslateNS<'sidebarAgents'>): SidebarRightTabDefinition {
  return {
    id: AGENTS_ID,
    kind: AGENTS_KIND,
    priority: 'builtin',
    order: 20,
    visibility: 'default-on',
    icon: IconBranchOutline16,
    title: () => t('type.label'),
    guide: [{
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutline16,
    }],
  }
}

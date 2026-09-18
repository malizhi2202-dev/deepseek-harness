/**
 * Stage one of this package's registration: what the `tasks` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, so it opens from the
 * guide page's entry box or a tab menu and never by resolving a resource.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const TASKS_KIND = 'tasks'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TASKS_ID = '@deepseek-ai/dsh-client-ui-sidebar-tasks'

/**
 * The tasks type's registry definition.
 *
 * `default-on`: a fresh surface opens this tab, because the session's own
 * progress is what a user watches without asking. That makes its `icon`
 * required, and its `order` seats it ahead of every type a user has to open.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function tasksDefinition(t: TranslateNS<'sidebarTasks'>): SidebarRightTabDefinition {
  return {
    id: TASKS_ID,
    kind: TASKS_KIND,
    priority: 'builtin',
    order: 10,
    visibility: 'default-on',
    icon: IconChecklistOutline14,
    title: () => t('type.label'),
    guide: [{
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconChecklistOutline14,
    }],
  }
}

/**
 * Stage one of this package's registration: what the `automation` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, because the
 * automation ledger is a per-workspace record with no addressable identity —
 * the read is keyed by the workspace the session belongs to, and the panel
 * holds the answer in its own store.
 *
 * `available` rather than `default-on`: the right Sidebar's always-on seats
 * belong to the surfaces that answer questions about the current session, and a
 * workspace's timer ledger is something the person opens. `order` 800 follows
 * the files, textpreview, git, terminal, channels, and sources pages (200, 300,
 * 400, 500, 600, 700), so the page order keeps reading as
 * tree-then-preview-then-repository-then-console-then-connections-then-library
 * and the workspace-level record closes the column.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconAlarmClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const AUTOMATION_KIND = 'automation'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const AUTOMATION_ID = '@deepseek-ai/dsh-client-ui-sidebar-automation'

/**
 * The automation type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function automationDefinition(t: TranslateNS<'sidebarAutomation'>): SidebarRightTabDefinition {
  return {
    id: AUTOMATION_ID,
    kind: AUTOMATION_KIND,
    priority: 'builtin',
    order: 800,
    visibility: 'available',
    icon: IconAlarmClockOutline16,
    title: () => t('type.label'),
    guide: [{
      order: 80,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconAlarmClockOutline16,
    }],
  }
}

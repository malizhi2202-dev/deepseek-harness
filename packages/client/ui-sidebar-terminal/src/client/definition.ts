/**
 * Stage one of this package's registration: what the `terminal` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, because a shell
 * console has no addressable identity of its own — the console mints shell ids
 * server-side and the panel holds them in its own store.
 *
 * `available` rather than `default-on`: a shell is something the person asks
 * for, and the right Sidebar's three always-on seats belong to the surfaces
 * that answer questions about the session. `order` 500 follows the files,
 * textpreview, and git pages (200, 300, 400), so the page order keeps reading
 * as tree-then-preview-then-repository-then-console.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const TERMINAL_KIND = 'terminal'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TERMINAL_ID = '@deepseek-ai/dsh-client-ui-sidebar-terminal'

/**
 * The terminal type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function terminalDefinition(t: TranslateNS<'sidebarTerminal'>): SidebarRightTabDefinition {
  return {
    id: TERMINAL_ID,
    kind: TERMINAL_KIND,
    priority: 'builtin',
    order: 500,
    visibility: 'available',
    icon: IconCodeOutline16,
    title: () => t('type.label'),
    guide: [{
      order: 50,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconCodeOutline16,
    }],
  }
}

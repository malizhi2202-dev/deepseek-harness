/**
 * Stage one of this package's registration: what the `channels` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, because a chat
 * channel is a Host-owned registration with no addressable identity — the
 * panel lists what `channels.status` reports and holds it in its own store.
 *
 * `available` rather than `default-on`: remote control is something the person
 * asks for, and the right Sidebar's three always-on seats belong to the
 * surfaces that answer questions about the session. `order` 600 follows the
 * files, textpreview, git, and terminal pages (200, 300, 400, 500), so the
 * page order keeps reading as tree-then-preview-then-repository-then-console-
 * then-connections.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const CHANNELS_KIND = 'channels'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const CHANNELS_ID = '@deepseek-ai/dsh-client-ui-sidebar-channels'

/**
 * The channels type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function channelsDefinition(t: TranslateNS<'sidebarChannels'>): SidebarRightTabDefinition {
  return {
    id: CHANNELS_ID,
    kind: CHANNELS_KIND,
    priority: 'builtin',
    order: 600,
    visibility: 'available',
    icon: IconShareOutline16,
    title: () => t('type.label'),
    guide: [{
      order: 60,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconShareOutline16,
    }],
  }
}

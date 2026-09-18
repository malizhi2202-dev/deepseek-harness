/**
 * Stage one of this package's registration: what the `files` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page offers
 * it as an entry box, and the tree opens files through `tabActions.openResource`
 * for the `dsh-resource://file` viewers to claim.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconFolderClose16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const FILES_KIND = 'files'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const FILES_ID = '@deepseek-ai/dsh-client-ui-sidebar-files'

/**
 * The files type's registry definition.
 *
 * `available`: nothing opens the tree by itself, and the type picker draws it
 * with the same glyph its guide box carries, so a user who has closed the tab
 * finds it again.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function filesDefinition(t: TranslateNS<'sidebarFiles'>): SidebarRightTabDefinition {
  return {
    id: FILES_ID,
    kind: FILES_KIND,
    priority: 'builtin',
    order: 200,
    visibility: 'available',
    icon: IconFolderClose16,
    title: () => t('type.label'),
    guide: [{
      order: 10,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconFolderClose16,
    }],
  }
}

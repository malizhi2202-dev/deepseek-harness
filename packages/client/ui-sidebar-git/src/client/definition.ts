/**
 * Stage one of this package's registration: what the `git` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, because a repository
 * observation is a current-value read with no addressable identity — the r2
 * review corrected the earlier idea of addressing git facts as resources, and
 * this panel is the consequence: it fetches its answer directly and holds it in
 * its own store.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const GIT_KIND = 'git'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const GIT_ID = '@deepseek-ai/dsh-client-ui-sidebar-git'

/**
 * The git type's registry definition.
 *
 * `available`: the panel never opens by itself. `order` 400 follows the files
 * and textpreview pages (200, 300) so the page order keeps reading as
 * tree-then-preview-then-repository.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function gitDefinition(t: TranslateNS<'sidebarGit'>): SidebarRightTabDefinition {
  return {
    id: GIT_ID,
    kind: GIT_KIND,
    priority: 'builtin',
    order: 400,
    visibility: 'available',
    icon: IconBranchOutline16,
    title: () => t('type.label'),
    guide: [{
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutline16,
    }],
  }
}

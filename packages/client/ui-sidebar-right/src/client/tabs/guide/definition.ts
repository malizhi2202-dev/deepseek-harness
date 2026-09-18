/**
 * Stage one of the guide type's registration: what it IS.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '../../tab-registry.ts'
import { GUIDE_KIND } from '../../contract/seed.ts'

/** The shipped guide implementation's identity: the key its body registers under. */
export const GUIDE_ID = '@deepseek-ai/dsh-client-ui-sidebar-right/guide'

/**
 * The guide type's registry definition.
 *
 * A page type: it recognizes no resource address, because a guide views
 * nothing, and is opened by kind; `builtin` is the ordinary band for a type
 * shipped here. It stays `available` — every pane seeds its own guide without
 * the registry's default-visible set — and its `order` keeps it ahead of the
 * types a user has to open.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function guideDefinition(t: TranslateNS<'sidebarRight'>): SidebarRightTabDefinition {
  return {
    id: GUIDE_ID,
    kind: GUIDE_KIND,
    priority: 'builtin',
    order: 100,
    visibility: 'available',
    title: () => t('tab.guide.title'),
  }
}

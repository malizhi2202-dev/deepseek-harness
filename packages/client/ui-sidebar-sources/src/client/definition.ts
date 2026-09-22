/**
 * Stage one of this package's registration: what the `sources` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address, because a remote
 * resource source is a Host-owned registration with no addressable identity —
 * the panel lists what `sources.status` reports and holds it in its own store.
 * A document a source does answer is addressed as
 * `dsh-resource://<kind>/<ref>`, which the existing text viewer opens, so this
 * package adds no viewer of its own.
 *
 * `available` rather than `default-on`: attaching a remote resource library is
 * something the person asks for, and the right Sidebar's three always-on seats
 * belong to the surfaces that answer questions about the session. `order` 700
 * follows the files, textpreview, git, terminal, and channels pages (200, 300,
 * 400, 500, 600), so the page order keeps reading as
 * tree-then-preview-then-repository-then-console-then-connections-then-library.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const SOURCES_KIND = 'sources'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const SOURCES_ID = '@deepseek-ai/dsh-client-ui-sidebar-sources'

/**
 * The sources type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function sourcesDefinition(t: TranslateNS<'sidebarSources'>): SidebarRightTabDefinition {
  return {
    id: SOURCES_ID,
    kind: SOURCES_KIND,
    priority: 'builtin',
    order: 700,
    visibility: 'available',
    icon: IconGlobeOutline14,
    title: () => t('type.label'),
    guide: [{
      order: 70,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconGlobeOutline14,
    }],
  }
}

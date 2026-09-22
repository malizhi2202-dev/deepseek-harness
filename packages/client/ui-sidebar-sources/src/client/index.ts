/**
 * Browser half: register `sources` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The file split is this package's layering: what the type IS (`definition.ts`),
 * what it keeps (`store.ts`), how it drives the Remote namespace and the
 * settings document (`face.ts`), how a descriptor becomes a form (`form.ts`),
 * what it draws (`SourcesBody.tsx`), what it says (`locales.ts`), and this
 * module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-sources/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SourcesBody } from './SourcesBody.tsx'
import { SOURCES_ID, sourcesDefinition } from './definition.ts'
import { createSourcesSettings, sourcesFace } from './face.ts'
import { en, zh } from './locales.ts'
import { createSourcesStore } from './store.ts'

export type { SidebarSourcesKey } from './locales.ts'
export type {
  SourceEntry, SourceFormFields, SourceSettingsDescription, SourceSettingsState,
  SourcesReadyState, SourcesState, SourcesTabState, createSourcesStore,
} from './store.ts'
export type { SourcesInjected, SourcesNamespace, SourcesRemote, SourcesSettingsPort } from './face.ts'
export type { SourcesBodyProps } from './SourcesBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarSources'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and the settings domain's descriptor and write
 * services.
 */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.sources', 'remote.settings',
  'settingsScope', 'settingsSchema',
]

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(sourcesDefinition(t)), 'ui-sidebar-sources: sources type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-sources: dictionaries')

  const store = createSourcesStore()
  const inject = sourcesFace(ctx.remote, createSourcesSettings(ctx.settingsScope, ctx.settingsSchema))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: SOURCES_ID, locale: NS, store, inject },
    SourcesBody,
  )), 'ui-sidebar-sources: sources tab body')
}

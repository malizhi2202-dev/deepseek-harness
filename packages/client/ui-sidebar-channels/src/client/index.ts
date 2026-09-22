/**
 * Browser half: register `channels` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.ts`), what it keeps (`store.ts`), how it drives the Remote
 * namespace and the settings document (`face.ts`), how a descriptor becomes a
 * form (`schema-form.ts`), what it draws (`ChannelsBody.tsx`), what it says
 * (`locales.ts`), and this module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-channels/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ChannelsBody } from './ChannelsBody.tsx'
import { CHANNELS_ID, channelsDefinition } from './definition.ts'
import { channelsFace, createChannelsSettings } from './face.ts'
import { en, zh } from './locales.ts'
import { createChannelsStore } from './store.ts'

export type { SidebarChannelsKey } from './locales.ts'
export type {
  ChannelEntry, ChannelFormFields, ChannelSettingsDescription, ChannelSettingsState,
  ChannelsReadyState, ChannelsState, ChannelsTabState, createChannelsStore,
} from './store.ts'
export type { ChannelsInjected, ChannelsNamespace, ChannelsRemote, ChannelsSettingsPort } from './face.ts'
export type { ChannelsBodyProps } from './ChannelsBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarChannels'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and the settings domain's descriptor and write
 * services.
 */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.channels', 'remote.settings',
  'settingsScope', 'settingsSchema',
]

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(channelsDefinition(t)), 'ui-sidebar-channels: channels type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-channels: dictionaries')

  const store = createChannelsStore()
  const inject = channelsFace(ctx.remote, createChannelsSettings(ctx.settingsScope, ctx.settingsSchema))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: CHANNELS_ID, locale: NS, store, inject },
    ChannelsBody,
  )), 'ui-sidebar-channels: channels tab body')
}

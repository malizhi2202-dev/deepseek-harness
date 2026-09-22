/**
 * The panel's asynchronous half: reading the channel list into the store and
 * forwarding the two operations that move a binding.
 *
 * The component never awaits anything. It calls `start`, `reload`, `enable`,
 * `disable`, `probe`, or `save`, and this face performs the call and writes the
 * outcome through the store's own actions — the Slot-standard `inject` shape,
 * so the session id is resolved by the framework and the write set stays the
 * store's.
 *
 * Two sources feed the panel. The `channels` Remote namespace reports every
 * channel and answers one enable, disable, or probe; the settings domain's
 * shared describe mirror reports each channel's configuration descriptor, and
 * a bound settings scope writes it. The form's field list is derived from that
 * descriptor's own serialized schema, so a channel this package has never heard
 * of still gets a form.
 *
 * A save carries the revision the panel read. The Host refuses a write whose
 * revision moved, so a concurrent change is reported rather than overwritten;
 * the outcome is read back from the user layer, because only the Host knows
 * whether it stored what was staged. Cleanup rides the owner's `signal`, and
 * when the record goes away the tab's bookkeeping is forgotten, so no later
 * settlement writes to it.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { ClientRemote, RemoteResult, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SettingsDescribeFace, SettingsMirrorSnapshot, SettingsScope, SettingsScopeBinder, SettingsSchemaService,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ChannelView } from '@deepseek-ai/dsh-api-channels/types'
// Merges the generated `channels` namespace into the Client Remote face.
import type {} from '@deepseek-ai/dsh-api-channels/remote'
import { hasField, layerValue, schemaFields, type SchemaField } from './schema-form.ts'
import type { createChannelsStore } from './store.ts'

/** The `channels` namespace methods this package calls, as the generated Remote declares them. */
export type ChannelsNamespace = Pick<ClientRemote['channels'], 'status' | 'probe' | 'enable' | 'disable'>

/** The Client Remote as this package sees it. */
export interface ChannelsRemote {
  /** The `channels` namespace. */
  readonly channels: ChannelsNamespace
  /** The `settings` namespace, read only to repair a descriptor the mirror's answer predates. */
  readonly settings: Pick<ClientRemote['settings'], 'describe'>
}

/** The settings-domain services the panel reads descriptors and writes sections through. */
export interface ChannelsSettingsPort {
  /** The shared describe mirror every channel's configuration descriptor is read from. */
  readonly describe: SettingsDescribeFace
  /**
   * Bind one channel namespace's write scope on this plugin's lifecycle.
   * @param namespace - the `dsh-settings` namespace holding the channel's configuration.
   * @returns the bound scope.
   */
  readonly bind: (namespace: string) => SettingsScope<Record<string, unknown>>
  /**
   * Flatten one serialized schema envelope into the fields a form renders.
   * @param schema - the namespace's serialized schema.
   * @returns the fields, in schema order.
   */
  readonly fields: (schema: JsonValue) => readonly SchemaField[]
}

/**
 * Bind the settings port to the client's settings services.
 * @param binder - the settings scope binder the settings domain provides.
 * @param schema - the settings schema service the settings domain provides.
 * @returns the port the panel's face reads and writes through.
 */
export function createChannelsSettings(
  binder: SettingsScopeBinder,
  schema: SettingsSchemaService,
): ChannelsSettingsPort {
  return {
    describe: binder.describe(),
    bind: namespace => binder.bind<Record<string, unknown>>({ namespace }),
    fields: serialized => schemaFields(schema.rehydrate(serialized)),
  }
}

/** The panel's injected business face, as the body receives it. */
export interface ChannelsInjected {
  /**
   * Read this tab's channel list for the first time, and follow the descriptors.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Read this tab's channel list again.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Bind one channel to the session this tab belongs to and open its connection.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param channel - the channel to enable.
   */
  readonly enable: (tabId: TabId, signal: AbortSignal, channel: string) => void
  /**
   * Close one channel's connection.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param channel - the channel to disable.
   */
  readonly disable: (tabId: TabId, signal: AbortSignal, channel: string) => void
  /**
   * Test one channel's configured credentials.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param channel - the channel to probe.
   */
  readonly probe: (tabId: TabId, signal: AbortSignal, channel: string) => void
  /**
   * Write one channel's staged settings edits under the revision they were read at.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param channel - the channel whose section is written.
   * @param ops - the staged path operations, in field order.
   */
  readonly save: (
    tabId: TabId,
    signal: AbortSignal,
    channel: string,
    ops: readonly SettingsPathOpView[],
  ) => void
}

/**
 * Bind the panel's face to one Remote namespace and the settings domain.
 * @param remote - the Client Remote face carrying the `channels` namespace.
 * @param settings - the settings descriptor and write port.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function channelsFace(
  remote: ChannelsRemote,
  settings: ChannelsSettingsPort,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createChannelsStore>>) => ChannelsInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createChannelsStore>>,
  ): ChannelsInjected => {
    /** Per tab: the read generation a settlement must match; a retired tab writes nothing. */
    const generations = new Map<TabId, number>()
    /** Per tab: the describe-mirror subscription, so one tab follows the descriptors once. */
    const follows = new Map<TabId, () => void>()
    /** Channel id to the settings namespace its connector registered. */
    const namespaces = new Map<string, string>()
    /** Namespace to the write scope bound for it. */
    const scopes = new Map<string, SettingsScope<Record<string, unknown>>>()

    /** Retire everything in flight for one tab and open a fresh generation. */
    const bump = (tabId: TabId): number => {
      const generation = (generations.get(tabId) ?? 0) + 1
      generations.set(tabId, generation)
      return generation
    }

    /** The write scope for one namespace, bound on first use. */
    const scopeOf = (namespace: string): SettingsScope<Record<string, unknown>> => {
      const bound = scopes.get(namespace) ?? settings.bind(namespace)
      scopes.set(namespace, bound)
      return bound
    }

    /**
     * Write every known channel's descriptor into one tab's store.
     *
     * The mirror holds one answer for the whole document, so this runs on every
     * change and after every channel-list replacement: a reload rebuilds the
     * per-channel buckets, and their descriptors have to be restored.
     */
    const describe = (tabId: TabId): void => {
      const snapshot = settings.describe.getSnapshot()
      const held = snapshot.view
      for (const [channel, namespace] of namespaces) {
        const view = held?.namespaces.find(row => row.ns === namespace)
        actions.described(tabId, channel, held === undefined || view === undefined
          ? { status: describeStatus(snapshot.status) }
          : { status: 'ready', writable: held.writable, view, fields: settings.fields(view.schema) })
      }
    }

    /** Replace one tab's channel list and restore every channel's descriptor. */
    const applyStatus = (tabId: TabId, channels: readonly ChannelView[]): void => {
      for (const channel of channels) namespaces.set(channel.channel, channel.settingsNamespace)
      actions.listed(tabId, channels)
      describe(tabId)
    }

    /** Follow the describe mirror for one tab, reading the held answer once. */
    const follow = (tabId: TabId): void => {
      if (follows.has(tabId)) return
      follows.set(tabId, settings.describe.subscribe(() => { describe(tabId) }))
    }

    /**
     * Fold a descriptor the mirror's held answer predates into the mirror.
     *
     * The chat bridge binds a connector, and so registers its settings
     * namespace, on the first `channels.status` — this panel's own first call.
     * The settings mirror reads once at startup and re-reads only on a document
     * update or a reconnect, and registering a namespace with an unchanged
     * value emits neither, so a channel's namespace can be missing from an
     * answer that is otherwise current. The repair reads the document once and
     * folds what it found through the mirror's own `acceptView`, so the panel
     * keeps no second view of the settings document.
     * @param signal - the tab record's lifetime.
     * @param channels - the channel list the status answer just reported.
     */
    const repair = (signal: AbortSignal, channels: readonly ChannelView[]): void => {
      const held = settings.describe.getSnapshot().view
      if (held === undefined) return
      const missing = channels
        .map(channel => channel.settingsNamespace)
        .filter(namespace => !held.namespaces.some(row => row.ns === namespace))
      if (missing.length === 0) return
      void remote.settings.describe().then((answer) => {
        if (signal.aborted || !answer.ok) return
        for (const view of answer.value.namespaces) {
          if (missing.includes(view.ns)) settings.describe.acceptView(view)
        }
      })
    }

    /** Read the channel list and put this tab's panel on it. */
    const read = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = bump(tabId)
      actions.loading(tabId)
      void remote.channels.status().then((result) => {
        if (generations.get(tabId) !== generation) return
        if (!result.ok) {
          actions.failed(tabId, result.error)
          return
        }
        follow(tabId)
        applyStatus(tabId, result.value.channels)
        repair(signal, result.value.channels)
      })
    }

    /** Run one control call for one channel and write whatever it answered. */
    const control = <Value>(
      tabId: TabId,
      signal: AbortSignal,
      channel: string,
      call: () => Promise<RemoteResult<Value>>,
      applied: (value: Value) => void,
    ): void => {
      if (signal.aborted) return
      actions.busy(tabId, channel)
      void call().then((result) => {
        if (signal.aborted) return
        actions.busy(tabId, undefined)
        if (result.ok) applied(result.value)
        else actions.channelFailed(tabId, channel, result.error)
      })
    }

    return {
      start(tabId, signal) {
        signal.addEventListener('abort', () => {
          // Retire the read in flight by bumping past its generation, stop
          // following the descriptors, and forget the bucket with it.
          bump(tabId)
          follows.get(tabId)?.()
          follows.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        read(tabId, signal)
      },
      reload: read,
      enable(tabId, signal, channel) {
        control(
          tabId,
          signal,
          channel,
          async () => await remote.channels.enable(channel, sessionId),
          (status) => { applyStatus(tabId, status.channels) },
        )
      },
      disable(tabId, signal, channel) {
        control(
          tabId,
          signal,
          channel,
          async () => await remote.channels.disable(channel),
          (status) => { applyStatus(tabId, status.channels) },
        )
      },
      probe(tabId, signal, channel) {
        control(
          tabId,
          signal,
          channel,
          async () => await remote.channels.probe(channel),
          (probe) => { actions.probed(tabId, channel, probe) },
        )
      },
      save(tabId, signal, channel, ops) {
        if (signal.aborted || ops.length === 0) return
        const namespace = namespaces.get(channel)
        // A save is reachable only from a rendered form, which came from a
        // status answer that recorded this channel's namespace.
        if (namespace === undefined) return
        const scope = scopeOf(namespace)
        actions.saving(tabId, channel, true)
        // A rejected mutate is a carrier fault: the write did not land, which
        // the read-back below reports like any other refusal.
        void scope.mutate(ops, scope.getSnapshot().revision).catch(() => {}).then(() => {
          if (signal.aborted) return
          actions.saving(tabId, channel, false)
          actions.saved(tabId, channel, landedIn(scope.getSnapshot().user, ops))
        })
      },
    }
  }
}

/**
 * The settings form state one mirror answer supports when it carries no view.
 * @param status - the describe mirror's own state.
 * @returns `unavailable` for an answer that serves no such namespace, and
 * `loading` while no answer is held.
 */
function describeStatus(status: SettingsMirrorSnapshot['status']): 'loading' | 'unavailable' {
  return status === 'ready' || status === 'unavailable' ? 'unavailable' : 'loading'
}

/**
 * Whether every staged write is in the user layer the Host now holds.
 * @param user - the raw user section the scope read back.
 * @param ops - the staged path operations.
 * @returns whether all of them landed.
 */
function landedIn(user: unknown, ops: readonly SettingsPathOpView[]): boolean {
  return ops.every((op) => {
    // A staged op addresses one top-level field, so its path is one segment.
    const field = op.path[0] as string
    return op.op === 'set' ? layerValue(user, field) === op.value : !hasField(user, field)
  })
}

/**
 * The panel's asynchronous half: reading the source list into the store and
 * forwarding the two operations the panel offers.
 *
 * The component never awaits anything. It calls `start`, `reload`, `probe`, or
 * `save`, and this face performs the call and writes the outcome through the
 * store's own actions — the Slot-standard `inject` shape, so the session id is
 * resolved by the framework and the write set stays the store's.
 *
 * Two sources feed the panel. The `sources` Remote namespace reports every
 * registered source and answers one probe; the settings domain's shared describe
 * mirror reports each source's configuration descriptor, and a bound settings
 * scope writes it. The form's rows are derived from that descriptor's own
 * serialized schema and its layers, so a source kind this package has never
 * heard of still gets a form.
 *
 * The panel moves no connection of its own: the design derives whether a source
 * connects from whether it is configured, so there is no enable or disable here,
 * and a source's state is whatever the last probe observed.
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
import type { ClientRemote, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SettingsDescribeFace, SettingsMirrorSnapshot, SettingsScope, SettingsScopeBinder, SettingsSchemaService,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SourceView } from '@deepseek-ai/dsh-api-sources/types'
// Merges the generated `sources` namespace into the Client Remote face.
import type {} from '@deepseek-ai/dsh-api-sources/remote'
import { formFields, layerCarries, layerValue, type FormField } from './form.ts'
import type { createSourcesStore } from './store.ts'

/** The `sources` namespace methods this package calls, as the generated Remote declares them. */
export type SourcesNamespace = Pick<ClientRemote['sources'], 'status' | 'probe'>

/** The Client Remote as this package sees it. */
export interface SourcesRemote {
  /** The `sources` namespace. */
  readonly sources: SourcesNamespace
  /** The `settings` namespace, read only to repair a descriptor the mirror's answer predates. */
  readonly settings: Pick<ClientRemote['settings'], 'describe'>
}

/** The settings-domain services the panel reads descriptors and writes sections through. */
export interface SourcesSettingsPort {
  /** The shared describe mirror every source's configuration descriptor is read from. */
  readonly describe: SettingsDescribeFace
  /**
   * Bind one source namespace's write scope on this plugin's lifecycle.
   * @param namespace - the `dsh-settings` namespace holding the source's configuration.
   * @returns the bound scope.
   */
  readonly bind: (namespace: string) => SettingsScope<Record<string, unknown>>
  /**
   * Flatten one descriptor's serialized schema into the rows a form renders.
   * @param schema - the namespace's serialized schema.
   * @param view - the descriptor the rows take their layers and values from.
   * @returns the rows, in schema order.
   */
  readonly fields: (schema: JsonValue, view: SettingsNamespaceView) => readonly FormField[]
}

/**
 * Bind the settings port to the client's settings services.
 * @param binder - the settings scope binder the settings domain provides.
 * @param schema - the settings schema service the settings domain provides.
 * @returns the port the panel's face reads and writes through.
 */
export function createSourcesSettings(
  binder: SettingsScopeBinder,
  schema: SettingsSchemaService,
): SourcesSettingsPort {
  return {
    describe: binder.describe(),
    bind: namespace => binder.bind<Record<string, unknown>>({ namespace }),
    fields: (serialized, view) => formFields(schema.rehydrate(serialized), view),
  }
}

/** The panel's injected business face, as the body receives it. */
export interface SourcesInjected {
  /**
   * Read this tab's source list for the first time, and follow the descriptors.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Read this tab's source list again.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Test whether one source can reach its target with its configured settings.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param key - the source to probe, as the status answer identified it.
   */
  readonly probe: (tabId: TabId, signal: AbortSignal, key: string) => void
  /**
   * Write one source's staged settings edits under the revision they were read at.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   * @param key - the source whose section is written.
   * @param ops - the staged path operations, in field order.
   */
  readonly save: (
    tabId: TabId,
    signal: AbortSignal,
    key: string,
    ops: readonly SettingsPathOpView[],
  ) => void
}

/**
 * Bind the panel's face to one Remote namespace and the settings domain.
 *
 * The session id is part of the Slot `inject` call and this panel has no
 * session-scoped operation, so it is accepted and unused.
 * @param remote - the Client Remote face carrying the `sources` namespace.
 * @param settings - the settings descriptor and write port.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function sourcesFace(
  remote: SourcesRemote,
  settings: SourcesSettingsPort,
): (
  sessionId: SessionId,
  actions: BoundActions<ReturnType<typeof createSourcesStore>>,
) => SourcesInjected {
  return (
    _sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createSourcesStore>>,
  ): SourcesInjected => {
    /** Per tab: the read generation a settlement must match; a retired tab writes nothing. */
    const generations = new Map<TabId, number>()
    /** Per tab: the describe-mirror subscription, so one tab follows the descriptors once. */
    const follows = new Map<TabId, () => void>()
    /** Source identity to the settings namespace its kind configures itself through. */
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
     * Write every known source's descriptor into one tab's store.
     *
     * The mirror holds one answer for the whole document, so this runs on every
     * change and after every source-list replacement: a reload rebuilds the
     * per-source buckets, and their descriptors have to be restored.
     * @param tabId - the tab being drawn.
     */
    const describe = (tabId: TabId): void => {
      const snapshot = settings.describe.getSnapshot()
      const held = snapshot.view
      for (const [key, namespace] of namespaces) {
        const view = held?.namespaces.find(row => row.ns === namespace)
        actions.described(tabId, key, held === undefined || view === undefined
          ? { status: describeStatus(snapshot.status) }
          : { status: 'ready', writable: held.writable, view, fields: settings.fields(view.schema, view) })
      }
    }

    /**
     * Replace one tab's source list and restore every source's descriptor.
     * @param tabId - the tab being drawn.
     * @param sources - the sources the Host reported.
     */
    const applyStatus = (tabId: TabId, sources: readonly SourceView[]): void => {
      for (const source of sources) namespaces.set(source.key, source.namespace)
      actions.listed(tabId, sources)
      describe(tabId)
    }

    /**
     * Follow the describe mirror for one tab, reading the held answer once.
     * @param tabId - the tab being drawn.
     */
    const follow = (tabId: TabId): void => {
      if (follows.has(tabId)) return
      follows.set(tabId, settings.describe.subscribe(() => { describe(tabId) }))
    }

    /**
     * Fold a descriptor the mirror's held answer predates into the mirror.
     *
     * A source's provider registers its settings namespace when its plugin
     * loads, which can be after the settings mirror read the document once. The
     * mirror re-reads on a document update or a reconnect, and registering a
     * namespace with an unchanged value emits neither, so a source's namespace
     * can be missing from an answer that is otherwise current. The repair reads
     * the document once and folds what it found through the mirror's own
     * `acceptView`, so the panel keeps no second view of the settings document.
     * @param signal - the tab record's lifetime.
     * @param sources - the source list the status answer just reported.
     */
    const repair = (signal: AbortSignal, sources: readonly SourceView[]): void => {
      const held = settings.describe.getSnapshot().view
      if (held === undefined) return
      const missing = [...new Set(sources.map(source => source.namespace))]
        .filter(namespace => !held.namespaces.some(row => row.ns === namespace))
      if (missing.length === 0) return
      void remote.settings.describe().then((answer) => {
        if (signal.aborted || !answer.ok) return
        for (const view of answer.value.namespaces) {
          if (missing.includes(view.ns)) settings.describe.acceptView(view)
        }
      })
    }

    /**
     * Read the source list and put this tab's panel on it.
     * @param tabId - the tab being drawn.
     * @param signal - the tab record's lifetime.
     */
    const read = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = bump(tabId)
      actions.loading(tabId)
      void remote.sources.status().then((result) => {
        if (generations.get(tabId) !== generation) return
        if (!result.ok) {
          actions.failed(tabId, result.error)
          return
        }
        follow(tabId)
        applyStatus(tabId, result.value.sources)
        repair(signal, result.value.sources)
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
      probe(tabId, signal, key) {
        if (signal.aborted) return
        actions.probing(tabId, key)
        void remote.sources.probe(key).then((result) => {
          if (signal.aborted) return
          actions.probing(tabId, undefined)
          if (result.ok) actions.probed(tabId, key, result.value)
          else actions.sourceFailed(tabId, key, result.error)
        })
      },
      save(tabId, signal, key, ops) {
        if (signal.aborted || ops.length === 0) return
        const namespace = namespaces.get(key)
        // A save is reachable only from a rendered form, which came from a
        // status answer that recorded this source's namespace.
        if (namespace === undefined) return
        const scope = scopeOf(namespace)
        actions.saving(tabId, key, true)
        // A rejected mutate is a carrier fault: the write did not land, which
        // the read-back below reports like any other refusal.
        void scope.mutate(ops, scope.getSnapshot().revision).catch(() => {}).then(() => {
          if (signal.aborted) return
          actions.saving(tabId, key, false)
          actions.saved(tabId, key, landedIn(scope.getSnapshot().user, ops))
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
    return op.op === 'set' ? layerValue(user, field) === op.value : !layerCarries(user, field)
  })
}

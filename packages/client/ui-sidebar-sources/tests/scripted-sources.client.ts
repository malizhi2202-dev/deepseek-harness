/**
 * Scripted Hosts for the panel's specs: the `sources` Remote namespace, the
 * settings describe mirror, and the per-namespace write scopes — all settled by
 * hand from the spec.
 *
 * The settings double follows the settings domain's own contracts: the mirror
 * is one snapshot with a subscriber set, a bound scope reads its snapshot
 * synchronously, and `mutate` settles only when the spec says the Host stored
 * what was staged. That is what lets a spec drive a landed save, a refused one,
 * and a carrier fault apart.
 */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  RemoteFailure, RemoteResult, SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SourceProbe, SourceView, SourcesStatus } from '@deepseek-ai/dsh-api-sources/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import type {
  SettingsDescribeFace, SettingsMirrorSnapshot, SettingsScope, SettingsScopeBinder, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSourcesSettings } from '../src/client/face.ts'
import type { SourcesNamespace, SourcesRemote, SourcesSettingsPort } from '../src/client/face.ts'
import { formFields } from '../src/client/form.ts'
import type { SourceSettingsDescription } from '../src/client/store.ts'

/** The session the panel's face is bound to, as a spec names it. */
export const SESSION = 's-test' as SessionId

/** The settings namespace a scripted source kind configures itself through. */
export const NAMESPACE = 'resource-github'

/** The identity the Host reports for the scripted source instance. */
export const SOURCE_KEY = 'github/main'

/** One source as the Host reports it. */
export function sourceView(overrides: Partial<SourceView> = {}): SourceView {
  return {
    key: SOURCE_KEY,
    kind: 'github',
    id: 'main',
    namespace: NAMESPACE,
    state: 'unconfigured',
    capabilities: {
      search: true, browse: false, read: true, maxReadBytes: 65536, maxListItems: 50,
      description: 'Search code in the repositories this source grants.',
    },
    credentials: [],
    ...overrides,
  }
}

/** The schema the scripted source's namespace registers, serialized as the Host publishes it. */
export const SOURCE_SCHEMA = JSON.parse(JSON.stringify(Schema.object({
  host: Schema.string().default('https://api.github.com'),
  query: Schema.string().default(''),
  limit: Schema.number().default(20),
  deep: Schema.boolean().default(false),
  mode: Schema.union(['refs', 'code']).default('refs'),
  tokenRef: Schema.string().default(''),
}).toJSON())) as JsonValue

/** The section value the scripted namespace publishes. */
export const SOURCE_VALUE: Readonly<Record<string, JsonValue>> = {
  host: 'https://api.github.com', query: '', limit: 20, deep: false, mode: 'refs', tokenRef: '',
}

/** One namespace's descriptor as the Host publishes it. */
export function namespaceView(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: NAMESPACE,
    schema: JSON.parse(JSON.stringify(SOURCE_SCHEMA)) as JsonValue,
    value: { ...SOURCE_VALUE },
    base: {},
    user: {},
    applies: 'live',
    secrets: [],
    revision: 1,
    ...overrides,
  }
}

/**
 * One source's settings form as the face writes it for the scripted schema.
 * @param overrides - the descriptor fields this case states differently.
 * @param writable - whether the Host document accepts writes.
 * @returns the description the store records.
 */
export function described(
  overrides: Partial<SettingsNamespaceView> = {},
  writable = true,
): SourceSettingsDescription {
  const view = namespaceView(overrides)
  return {
    status: 'ready',
    writable,
    view,
    fields: formFields(new Schema(view.schema as unknown as Schema), view),
  }
}

/** One recorded namespace call. */
export interface RecordedCall {
  /** The method called. */
  readonly method: string
  /** The source instance the call named; empty for the list read. */
  readonly key: string
}

/** What a spec holds from the scripted Remote namespace. */
export interface ScriptedRemote {
  /** The Remote-shaped face, ready to hand to `sourcesFace`. */
  readonly remote: SourcesRemote
  /** Every call recorded, oldest first. */
  readonly calls: readonly RecordedCall[]
  /** How many calls are still outstanding. */
  readonly outstanding: () => number
  /** Answer the oldest outstanding call, whatever it was. */
  readonly settle: (result: RemoteResult<unknown>) => Promise<void>
  /** Answer the oldest outstanding call with a source list. */
  readonly settleStatus: (value: SourcesStatus) => Promise<void>
  /** Answer the oldest outstanding call with a probe answer. */
  readonly settleProbe: (value: SourceProbe) => Promise<void>
  /** Answer the oldest outstanding settings-describe read. */
  readonly settleDescribe: (result: RemoteResult<SettingsDescribeValue>) => Promise<void>
  /** How many settings-describe reads have gone out. */
  readonly describes: () => number
}

/** Let the face's `then` handlers run before the spec reads the store. */
async function tick(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Script one Remote namespace.
 * @returns the script's handles.
 */
export function scriptedRemote(): ScriptedRemote {
  const calls: RecordedCall[] = []
  const pending: Array<(result: RemoteResult<unknown>) => void> = []
  const describePending: Array<(result: RemoteResult<SettingsDescribeValue>) => void> = []
  const unary = (method: string, key: string): Promise<RemoteResult<unknown>> => {
    calls.push({ method, key })
    return new Promise<RemoteResult<unknown>>((resolve) => { pending.push(resolve) })
  }
  const namespace: SourcesNamespace = {
    status: async () => await unary('status', '') as RemoteResult<SourcesStatus>,
    probe: async (key: string) => await unary('probe', key) as RemoteResult<SourceProbe>,
  }
  const settle = async (result: RemoteResult<unknown>): Promise<void> => {
    const resolve = pending.shift()
    if (resolve === undefined) throw new Error('scripted sources settled with no outstanding call')
    resolve(result)
    await tick()
  }
  return {
    remote: {
      sources: namespace,
      settings: {
        describe: async () => {
          calls.push({ method: 'describe', key: '' })
          return await new Promise<RemoteResult<SettingsDescribeValue>>((resolve) => { describePending.push(resolve) })
        },
      },
    },
    calls,
    outstanding: () => pending.length,
    describes: () => describePending.length,
    settle,
    settleStatus: async (value) => { await settle({ ok: true, value }) },
    settleProbe: async (value) => { await settle({ ok: true, value }) },
    settleDescribe: async (result) => {
      const resolve = describePending.shift()
      if (resolve === undefined) throw new Error('scripted settings describe settled with no outstanding read')
      resolve(result)
      await tick()
    },
  }
}

/** One recorded namespace mutation. */
export interface RecordedMutation {
  /** The operations the save staged. */
  readonly ops: readonly SettingsPathOpView[]
  /** The revision fence the save carried. */
  readonly revision: number | undefined
}

/** One bound write scope, as the spec drives it. */
export interface ScriptedScope {
  /** The namespace this scope was bound for. */
  readonly namespace: string
  /** The scope the panel writes through. */
  readonly scope: SettingsScope<Record<string, unknown>>
  /** Every mutation recorded, oldest first. */
  readonly mutations: readonly RecordedMutation[]
  /** Whether a mutation is crossing the wire. */
  readonly outstanding: () => number
  /** The raw user layer this scope currently reports. */
  readonly user: (value: unknown) => void
  /** The revision this scope's next write fences on. */
  readonly revision: (value: number | undefined) => void
  /** Settle the oldest outstanding mutation, as a Host that stored the write does. */
  readonly settle: () => Promise<void>
  /** Reject the oldest outstanding mutation, as a carrier fault does. */
  readonly fail: (error: unknown) => Promise<void>
}

/** What a spec holds from the scripted settings domain. */
export interface ScriptedSettings {
  /** The port the panel's face reads descriptors and writes sections through. */
  readonly port: SourcesSettingsPort
  /** Every namespace bound, in bind order. */
  readonly binds: readonly string[]
  /** The scope bound for one namespace. */
  readonly scope: (namespace: string) => ScriptedScope
  /** How many live mirror subscribers there are. */
  readonly subscribers: () => number
  /** Publish one mirror snapshot and notify its subscribers. */
  readonly publish: (snapshot: SettingsMirrorSnapshot) => void
  /** The snapshot the mirror currently holds. */
  readonly snapshot: () => SettingsMirrorSnapshot
}

/** One scripted scope's mutable state. */
interface ScopeState {
  readonly namespace: string
  snapshot: SettingsScopeSnapshot<Record<string, unknown>>
  readonly mutations: RecordedMutation[]
  readonly pending: Array<{ resolve: () => void; reject: (error: unknown) => void }>
}

/**
 * Script the settings domain: one describe mirror and one scope per namespace.
 * @returns the script's handles.
 */
export function scriptedSettings(): ScriptedSettings {
  let held: SettingsMirrorSnapshot = { status: 'idle', view: undefined, error: null }
  const listeners = new Set<() => void>()
  const states = new Map<string, ScopeState>()
  const binds: string[] = []

  const describe: SettingsDescribeFace = {
    getSnapshot: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensure: async () => {},
    acceptView: (view) => {
      if (held.view === undefined) return
      const namespaces = held.view.namespaces.some(row => row.ns === view.ns)
        ? held.view.namespaces.map(row => row.ns === view.ns ? view : row)
        : [...held.view.namespaces, view]
      held = { ...held, view: { ...held.view, namespaces } }
      for (const listener of listeners) listener()
    },
  }

  const stateOf = (namespace: string): ScopeState => {
    const existing = states.get(namespace)
    if (existing !== undefined) return existing
    binds.push(namespace)
    const created: ScopeState = {
      namespace,
      snapshot: {
        status: 'loading', value: undefined, base: undefined, user: undefined,
        revision: undefined, writable: true, mode: 'host',
      },
      mutations: [],
      pending: [],
    }
    states.set(namespace, created)
    return created
  }

  const scopeOf = (namespace: string): SettingsScope<Record<string, unknown>> => {
    const state = stateOf(namespace)
    return {
      getSnapshot: () => state.snapshot,
      subscribe: () => () => {},
      mutate: async (ops, revision) => {
        state.mutations.push({ ops, revision })
        await new Promise<void>((resolve, reject) => { state.pending.push({ resolve, reject }) })
      },
      set: async () => {},
      unset: async () => {},
    }
  }

  const binder = {
    describe: () => describe,
    bind: (spec: { namespace: string }) => scopeOf(spec.namespace),
  }

  const scope = (namespace: string): ScriptedScope => {
    const state = stateOf(namespace)
    return {
      namespace,
      scope: scopeOf(namespace),
      mutations: state.mutations,
      outstanding: () => state.pending.length,
      user: (value) => { state.snapshot = { ...state.snapshot, user: value } },
      revision: (value) => { state.snapshot = { ...state.snapshot, revision: value } },
      settle: async () => {
        const next = state.pending.shift()
        if (next === undefined) throw new Error('scripted scope settled with no outstanding mutation')
        next.resolve()
        await tick()
      },
      fail: async (error) => {
        const next = state.pending.shift()
        if (next === undefined) throw new Error('scripted scope rejected with no outstanding mutation')
        next.reject(error)
        await tick()
      },
    }
  }

  return {
    port: createSourcesSettings(binder as unknown as SettingsScopeBinder, new SettingsSchemaService(new Context())),
    binds,
    scope,
    subscribers: () => listeners.size,
    publish: (snapshot) => {
      held = snapshot
      for (const listener of listeners) listener()
    },
    snapshot: () => held,
  }
}

/**
 * One Remote failure.
 * @param code - the failure code.
 * @param message - the failure message.
 * @returns the failure, typed for the namespace's own error map.
 */
export function failure(code: 'sources/unknown' | 'sources/failed', message: string): RemoteFailure {
  return { code, message } as RemoteFailure
}

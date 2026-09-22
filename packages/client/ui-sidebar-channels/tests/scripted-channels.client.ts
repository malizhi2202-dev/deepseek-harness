/**
 * Scripted Hosts for the panel's specs: the `channels` Remote namespace, the
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
import type { ChannelProbe, ChannelView, ChannelsStatus } from '@deepseek-ai/dsh-api-channels/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import type {
  SettingsDescribeFace, SettingsMirrorSnapshot, SettingsScope, SettingsScopeBinder, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createChannelsSettings } from '../src/client/face.ts'
import type { ChannelsNamespace, ChannelsRemote, ChannelsSettingsPort } from '../src/client/face.ts'
import { schemaFields } from '../src/client/schema-form.ts'
import type { ChannelSettingsDescription } from '../src/client/store.ts'

/** The session the panel's face is bound to, as a spec names it. */
export const SESSION = 's-test' as SessionId

/** The namespace a scripted channel's connector registered. */
export const NAMESPACE = 'chat-channel-tuitui'

/**
 * One channel as the Host reports it.
 * @param overrides - the fields this case states differently.
 * @returns the channel view.
 */
export function channelView(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    channel: 'tuitui',
    enabled: false,
    sessionId: '',
    connection: 'stopped',
    capabilities: {
      quoting: true,
      inbound: { images: true, files: true },
      outbound: { images: false, files: false },
      markdown: true,
      maxTextChars: 4096,
    },
    settingsNamespace: NAMESPACE,
    credentials: [],
    ...overrides,
  }
}

/** The schema the scripted channel's namespace registers, serialized as the Host publishes it. */
export const CHANNEL_SCHEMA = JSON.parse(JSON.stringify(Schema.object({
  enabled: Schema.boolean().default(false),
  sessionId: Schema.string().default(''),
  markdown: Schema.boolean().default(true),
  host: Schema.string().default(''),
  appSecretRef: Schema.string().default('').role('secret'),
}).toJSON())) as JsonValue

/**
 * One namespace's descriptor as the Host publishes it.
 * @param overrides - the fields this case states differently.
 * @returns the namespace view.
 */
export function namespaceView(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: NAMESPACE,
    schema: JSON.parse(JSON.stringify(CHANNEL_SCHEMA)) as JsonValue,
    value: { enabled: false, sessionId: '', markdown: true, host: '', appSecretRef: '' },
    base: {},
    user: {},
    applies: 'live',
    secrets: [{ path: ['appSecretRef'], set: false }],
    revision: 1,
    ...overrides,
  }
}

/**
 * One channel's settings form as the face writes it for the scripted schema.
 * @param overrides - the descriptor fields this case states differently.
 * @param writable - whether the Host document accepts writes.
 * @returns the description the store records.
 */
export function described(
  overrides: Partial<SettingsNamespaceView> = {},
  writable = true,
): ChannelSettingsDescription {
  return {
    status: 'ready',
    writable,
    view: namespaceView(overrides),
    fields: schemaFields(new Schema(CHANNEL_SCHEMA as unknown as Schema)),
  }
}

/** One recorded namespace call. */
export interface RecordedCall {
  /** The method called. */
  readonly method: string
  /** The channel the call named. */
  readonly channel: string
  /** The session an enable named. */
  readonly sessionId: SessionId | undefined
}

/** What a spec holds from the scripted Remote namespace. */
export interface ScriptedRemote {
  /** The Remote-shaped face, ready to hand to `channelsFace`. */
  readonly remote: ChannelsRemote
  /** Every call recorded, oldest first. */
  readonly calls: readonly RecordedCall[]
  /** How many calls are still outstanding. */
  readonly outstanding: () => number
  /** Answer the oldest outstanding call, whatever it was. */
  readonly settle: (result: RemoteResult<unknown>) => Promise<void>
  /** Answer the oldest outstanding call with a channel list. */
  readonly settleStatus: (value: ChannelsStatus) => Promise<void>
  /** Answer the oldest outstanding call with a probe answer. */
  readonly settleProbe: (value: ChannelProbe) => Promise<void>
  /** Answer the oldest outstanding call with a channel list, as a control does. */
  readonly settleControl: (value: ChannelsStatus) => Promise<void>
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
  const unary = (method: string, channel: string, sessionId?: SessionId): Promise<RemoteResult<unknown>> => {
    calls.push({ method, channel, sessionId })
    return new Promise<RemoteResult<unknown>>((resolve) => { pending.push(resolve) })
  }
  const namespace: ChannelsNamespace = {
    status: async () => await unary('status', '') as RemoteResult<ChannelsStatus>,
    probe: async channel => await unary('probe', channel) as RemoteResult<ChannelProbe>,
    enable: async (channel, sessionId) => await unary('enable', channel, sessionId) as RemoteResult<ChannelsStatus>,
    disable: async channel => await unary('disable', channel) as RemoteResult<ChannelsStatus>,
  }
  const settle = async (result: RemoteResult<unknown>): Promise<void> => {
    const resolve = pending.shift()
    if (resolve === undefined) throw new Error('scripted channels settled with no outstanding call')
    resolve(result)
    await tick()
  }
  return {
    remote: {
      channels: namespace,
      settings: {
        describe: async () => {
          calls.push({ method: 'describe', channel: '', sessionId: undefined })
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
    settleControl: async (value) => { await settle({ ok: true, value }) },
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
  readonly port: ChannelsSettingsPort
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
    port: createChannelsSettings(binder as unknown as SettingsScopeBinder, new SettingsSchemaService(new Context())),
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
export function failure(code: 'channels/unknown' | 'channels/failed', message: string): RemoteFailure {
  return { code, message } as RemoteFailure
}

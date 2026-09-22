/**
 * Shared harness for the `sources` Remote endpoint suite.
 *
 * A bare Cordis Context carries scripted resource-registry, credential-provider,
 * and settings-provider doubles at exactly the boundary the endpoint reads them
 * through, so every assertion observes what the endpoint asked the seam for and
 * what it assembled from the answer. The endpoint is constructed directly rather
 * than mounted as a plugin, because mounting it would wait on the Gateway's
 * `typert` service, which a bare test Context does not carry.
 *
 * The settings schemas here are hand-written serializations, built the way the
 * settings provider publishes one: a root node plus a `refs` table holding every
 * node used more than once. That is what lets a case state a schema the endpoint
 * has to read structurally — a credential reference declared on a flat field,
 * inside a dictionary, inside an intersection, or behind a reference the table
 * does not hold.
 */

import { Context } from '@deepseek-ai/cordis'
import type { CredentialInfo, CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  SettingsDescribeOptions,
  SettingsDescriptor,
  SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import type {
  SourceCapabilities,
  SourceConfig,
  SourceDescription,
  SourceKind,
  SourceProvider,
  Sources,
} from '../src/seam.ts'
import SourcePanel from '../src/index.ts'

/** The one source kind this suite addresses. */
export const KIND = 'github'

/** A second source kind, for the cases that need two registered providers. */
export const OTHER_KIND = 'mediawiki'

/** The settings namespace the kind above configures itself through. */
export const NAMESPACE = 'resource-github'

/** The settings namespace the second kind configures itself through. */
export const OTHER_NAMESPACE = 'resource-mediawiki'

/** Capabilities of a source that searches, browses, and reads. */
export const CAPABILITIES: SourceCapabilities = {
  search: true,
  browse: true,
  read: true,
  maxReadBytes: 65536,
  maxListItems: 50,
  description: 'Search code in the repositories this source grants.',
}

/** One instance as a provider declares it: the address, the verdict, and its own resolved values. */
export type SourceInstance = SourceConfig & Record<string, unknown>

/**
 * One instance as a provider declares it.
 * @param id - the instance id inside its kind.
 * @param values - the kind's own resolved values, such as a credential reference.
 * @param configured - what the provider reports about the instance's completeness.
 * @returns the instance.
 */
export function instance(id: string, values: Record<string, unknown> = {}, configured = true): SourceInstance {
  return { ref: { kind: KIND, id }, configured, ...values }
}

/** One node of a hand-written serialized schema. */
type Node = Record<string, unknown>

/**
 * A schema node for one string field that names a credential reference.
 * @param role - the role the field declares; `credential-ref` by default.
 * @returns the node.
 */
function credentialNode(role = 'credential-ref'): Node {
  return { type: 'string', meta: { role } }
}

/**
 * A serialized schema shaped like one source kind's configuration: a root object
 * holding a dictionary of instances, each declaring the given credential fields.
 * @param fields - the credential-reference fields each instance declares.
 * @param extras - non-credential fields each instance declares.
 * @returns the serialized schema.
 */
export function instanceSchema(fields: readonly string[], extras: readonly string[] = []): unknown {
  const refs: Record<string, Node> = {}
  const dict: Record<string, number> = {}
  let next = 1
  for (const field of fields) {
    const id = next
    next += 1
    refs[String(id)] = credentialNode()
    dict[field] = id
  }
  for (const field of extras) {
    const id = next
    next += 1
    refs[String(id)] = { type: 'string', meta: {} }
    dict[field] = id
  }
  const inner = next
  next += 1
  refs[String(inner)] = { type: 'object', meta: { default: {} }, dict }
  const sKey = next
  next += 1
  refs[String(sKey)] = { type: 'string', meta: {} }
  const instances = next
  next += 1
  refs[String(instances)] = { type: 'dict', meta: { default: {} }, inner, sKey }
  const root = next
  refs[String(root)] = { type: 'object', meta: { default: {} }, dict: { instances } }
  return { uid: root, refs }
}

/**
 * A serialized schema declaring one credential-reference field directly on its
 * root object.
 * @param field - the field name.
 * @returns the serialized schema.
 */
export function flatSchema(field: string): unknown {
  return {
    uid: 3,
    refs: {
      '1': credentialNode(),
      '3': { type: 'object', meta: {}, dict: { [field]: 1 } },
    },
  }
}

/** The fields one scripted provider may state differently. */
export interface ProviderFields {
  /** The kind this provider serves; defaults to {@link KIND}. */
  readonly kind?: string
  /** What it can answer. */
  readonly capabilities?: SourceCapabilities
  /** The instances it declares; defaults to one configured instance. */
  readonly instances?: () => Promise<readonly SourceInstance[]>
  /** What its `check` does; the default finds the source usable. */
  readonly check?: (config: SourceConfig) => Promise<SourceDescription>
}

/** Build one provider carrying only the members this endpoint reads. */
export function provider(fields: ProviderFields = {}): SourceProvider {
  return {
    kind: fields.kind ?? KIND,
    capabilities: fields.capabilities ?? CAPABILITIES,
    instances: fields.instances ?? (async () => [instance('main')]),
    check: fields.check ?? (async () => ({ label: 'the-account' })),
  }
}

/** The settings layers one scripted descriptor may carry. */
export interface DescriptorLayers {
  /** The serialized schema the namespace registered; defaults to a schema declaring nothing. */
  readonly schema?: unknown
  /** The raw user section, when one exists. */
  readonly user?: unknown
  /** The composition base layer, when one was declared. */
  readonly base?: unknown
  /** The revision the section stands at; defaults to 1. */
  readonly revision?: number
}

/** One settings descriptor, carrying only the fields this endpoint reads. */
export function descriptor(ns: string, value: unknown, layers: DescriptorLayers = {}): SettingsDescriptor {
  return {
    ns: ns as SettingsNamespace,
    schema: layers.schema ?? {},
    value,
    revision: layers.revision ?? 1,
    applies: 'live',
    ...layers.user === undefined ? {} : { user: layers.user },
    ...layers.base === undefined ? {} : { base: layers.base },
  }
}

/** The registry double, recording every listing the endpoint made. */
export interface ScriptedRegistry {
  /** How many times the endpoint read the provider list. */
  readonly lists: () => number
  list(): readonly SourceProvider[]
  get(kind: SourceKind): SourceProvider | undefined
}

/** The credential-provider double, recording every reference it was asked about. */
export interface ScriptedCredentials {
  /** Reference names the endpoint asked about, in order. */
  readonly described: string[]
  describe(ref: CredentialRef): Promise<CredentialInfo>
}

/** The settings-provider double, recording every describe call it served. */
export interface ScriptedSettings {
  /** Options each `describe` call carried, in order. */
  readonly describeOptions: Array<SettingsDescribeOptions | undefined>
  describe(options?: SettingsDescribeOptions): SettingsDescriptor[]
}

/** What a test scripts into the harness, each entry defaulting to an inert answer. */
export interface HarnessOptions {
  /** Providers the registry reports, read fresh on every call. */
  readonly providers?: () => readonly SourceProvider[]
  /** Descriptors the settings provider reports. */
  readonly descriptors?: () => readonly SettingsDescriptor[]
  /** Presence facts the credential provider reports. */
  readonly credentialInfo?: (ref: CredentialRef) => Promise<CredentialInfo>
}

/** The doubles and the endpoint over them, plus the ordered boundary call log. */
export interface Harness {
  readonly endpoint: SourcePanel
  readonly registry: ScriptedRegistry
  readonly credentials: ScriptedCredentials
  readonly settings: ScriptedSettings
  /** Boundary calls the endpoint made, in order, named by the service that served them. */
  readonly log: string[]
}

/** The registry double: reports the scripted providers, in order. */
function scriptedRegistry(log: string[], options: HarnessOptions): ScriptedRegistry {
  let lists = 0
  return {
    lists: () => lists,
    list: () => {
      lists += 1
      log.push('sources.list')
      return options.providers?.() ?? []
    },
    get: kind => (options.providers?.() ?? []).find(candidate => candidate.kind === kind),
  }
}

/** The credential-provider double: unconfigured and unwritable unless a test scripts presence facts. */
function scriptedCredentials(log: string[], options: HarnessOptions): ScriptedCredentials {
  const described: string[] = []
  return {
    described,
    describe: async (ref) => {
      log.push(`credentials.describe(${ref})`)
      described.push(ref)
      return await options.credentialInfo?.(ref) ?? { configured: false, writable: false }
    },
  }
}

/** The settings-provider double: reports the scripted descriptors, in order. */
function scriptedSettings(log: string[], options: HarnessOptions): ScriptedSettings {
  const describeOptions: Array<SettingsDescribeOptions | undefined> = []
  return {
    describeOptions,
    describe: (given) => {
      log.push('settings.describe')
      describeOptions.push(given)
      return [...options.descriptors?.() ?? []]
    },
  }
}

/** Build the endpoint over a bare Context carrying the scripted boundary doubles. */
export function harness(options: HarnessOptions = {}): Harness {
  const log: string[] = []
  const ctx = new Context()
  const registry = scriptedRegistry(log, options)
  const credentials = scriptedCredentials(log, options)
  const settings = scriptedSettings(log, options)
  // Each double carries only the members this endpoint reads, so it is cast to
  // the service slot it fills; `ctx.provide` takes the value as given.
  ctx.provide('sources', registry as unknown as Sources)
  ctx.provide('credentials', credentials as never)
  ctx.provide('settings', settings as never)
  const disposeTypert = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => disposeTypert },
    contexts: { configureHost: () => disposeTypert },
  } as never)
  return { endpoint: new SourcePanel(ctx), registry, credentials, settings, log }
}

/**
 * The `sources` Remote namespace: the configuration panel's whole view of the
 * remote resource instances this Host serves, and the one operation that tests
 * one.
 *
 * The seam this endpoint rides (`ctx.sources`) owns every rule — which kinds
 * exist, which instances their settings declare, what each kind can answer, and
 * whether an instance is configured — and this service adds none of its own. It
 * reports, and it forwards one probe; it never reads a document and never
 * reaches a model request.
 *
 * Two facts are assembled here because only a configuration surface needs them:
 * the settings namespace and credential-reference fields a kind's configuration
 * declares, read through the settings provider; and where an instance stands,
 * derived from the provider's own `configured` answer plus the last probe this
 * Host observed. A probe outcome is held in memory for this process only,
 * because the design adds no durable domain for it.
 *
 * Credential status is reported by reference name and never by value, so this
 * endpoint cannot leak a secret even by accident.
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SourceConfig, SourceProvider, Sources } from './seam.ts'
import type { SourceCredentialView, SourceProbe, SourceState, SourcesStatus, SourceView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `sources` Remote namespace. */
    sourcesPanel: SourcePanel
  }
}

/**
 * The settings namespace one source kind configures itself through.
 *
 * Each provider package names its own namespace `resource-<kind>` and resolves
 * its instances from it. The seam carries no kind-to-namespace member, so the
 * panel derives the name here and reports the configuration surface as
 * unavailable when no such namespace is registered, rather than guessing at a
 * form it cannot read.
 * @param kind - the source kind.
 * @returns the settings namespace that configures the kind.
 */
function settingsNamespace(kind: string): string {
  return `resource-${kind}`
}

/**
 * The panel's opaque identity for one source instance.
 *
 * An instance id is unique only inside its kind, so the panel addresses an
 * instance by both. The string is opaque to every caller: it is passed back to
 * `probe` and compared, never parsed.
 * @param kind - the source kind.
 * @param id - the instance id inside that kind.
 * @returns the instance's identity.
 */
function sourceKey(kind: string, id: string): string {
  return `${kind}/${id}`
}

/** What one probe of a source instance observed, kept for the life of this process. */
interface Observation {
  /** Whether the most recent probe found the source usable. */
  readonly ok: boolean
  /** The settings revision the probe read, so a later edit reads as unchecked again. */
  readonly revision: number | undefined
  /** The most recent failure's text; never cleared by a later success. */
  readonly error?: string
  /** When the most recent failure was recorded, as an ISO timestamp. */
  readonly errorAt?: string
}

/** Host Remote service reporting the remote resource sources and probing one. */
export class SourcePanel extends TypertRemoteService {
  static inject = ['sources', 'credentials', 'settings', 'typert']

  /** Probe outcomes observed in this process, keyed by source instance. */
  private readonly observations = new Map<string, Observation>()

  constructor(ctx: Context) {
    super(ctx, 'sourcesPanel', { namespace: 'sources' })
  }

  /**
   * Read every declared source instance's state.
   *
   * The registry is read at call time, so a provider a plugin registered a
   * moment ago is reported rather than missing, and each provider is asked for
   * its instances rather than this endpoint holding a copy of any configuration.
   * @returns one view per declared instance, providers in registration order.
   */
  @Remote
  async status(): Promise<SourcesStatus> {
    return await this.readStatus()
  }

  /**
   * Test whether one source instance can reach its target with the configured
   * settings and credentials.
   *
   * A source that cannot is answered, not rejected: `ok: false` with the reason
   * is what the panel shows, and only an instance this Host does not serve is an
   * error.
   * @param key - the instance's identity, as `status` reported it.
   * @returns what the probe found.
   * @throws {RemoteError} with code `sources/unknown` when no such instance is declared.
   */
  @Remote
  async probe(key: string): Promise<SourceProbe> {
    const located = await this.locate(key)
    if (located === undefined) {
      throw new RemoteError('sources/unknown', `no source named ${key} is registered`, {})
    }
    const { provider, instance } = located
    const descriptor = this.descriptorOf(settingsNamespace(provider.kind))
    try {
      const description = await provider.check(instance)
      this.observe(key, descriptor, undefined)
      return {
        ok: true,
        label: description.label,
        ...description.detail === undefined ? {} : { detail: description.detail },
      }
    } catch (error: unknown) {
      const message = failureText(error)
      this.observe(key, descriptor, message)
      return { ok: false, message }
    }
  }

  /**
   * The resource seam's registry.
   *
   * Read through the service store rather than the property proxy: the seam's
   * owning package declares the `sources` context property, and a second
   * declaration here would merge against it.
   * @returns the registry this endpoint reports from.
   */
  private registry(): Sources {
    return this.ctx.get('sources') as Sources
  }

  /** Assemble the panel's view from the registry, the settings provider, and this process's observations. */
  private async readStatus(): Promise<SourcesStatus> {
    const descriptors = new Map(
      this.ctx.settings.describe({ redactSecrets: true }).map(descriptor => [String(descriptor.ns), descriptor]),
    )
    const sources: SourceView[] = []
    for (const provider of this.registry().list()) {
      const namespace = settingsNamespace(provider.kind)
      const descriptor = descriptors.get(namespace)
      const fields = credentialFields(descriptor?.schema)
      for (const instance of await provider.instances()) {
        const key = sourceKey(provider.kind, instance.ref.id)
        const observed = this.observations.get(key)
        sources.push({
          key,
          kind: provider.kind,
          id: instance.ref.id,
          namespace,
          state: stateOf(instance.configured, observed, descriptor?.revision),
          ...observed?.error === undefined ? {} : { lastError: observed.error },
          ...observed?.errorAt === undefined ? {} : { lastErrorAt: observed.errorAt },
          capabilities: provider.capabilities,
          credentials: await this.credentialsOf(instance, fields),
        })
      }
    }
    return { sources }
  }

  /** The provider and instance one wire key names, or undefined when this Host serves neither. */
  private async locate(key: string): Promise<{ provider: SourceProvider; instance: SourceConfig } | undefined> {
    for (const provider of this.registry().list()) {
      for (const instance of await provider.instances()) {
        if (sourceKey(provider.kind, instance.ref.id) === key) return { provider, instance }
      }
    }
    return undefined
  }

  /** One registered settings namespace's descriptor, read fresh. */
  private descriptorOf(namespace: string): SettingsDescriptor | undefined {
    return this.ctx.settings.describe({ redactSecrets: true })
      .find(descriptor => String(descriptor.ns) === namespace)
  }

  /**
   * Resolve one instance's credential reference names to presence facts.
   *
   * The names are read from the instance the provider itself resolved, so a
   * reference the user changed a moment ago is reported at its new value without
   * this endpoint caching anything, and the fields are the ones the kind's
   * settings schema marks as credential references.
   * @param instance - the instance the provider declared.
   * @param fields - the configuration fields that name credential references.
   * @returns one presence fact per field, in schema order.
   */
  private async credentialsOf(
    instance: SourceConfig,
    fields: readonly string[],
  ): Promise<readonly SourceCredentialView[]> {
    const record = instance as unknown as Record<string, unknown>
    const views: SourceCredentialView[] = []
    for (const field of fields) {
      const value = record[field]
      const ref = typeof value === 'string' ? value : ''
      if (!isCredentialRefName(ref)) {
        views.push({ field, ref, configured: false, writable: false })
        continue
      }
      const info = await this.ctx.credentials.describe(credentialRef(ref))
      views.push({
        field,
        ref,
        configured: info.configured,
        writable: info.writable,
        ...info.source === undefined ? {} : { source: info.source },
      })
    }
    return views
  }

  /**
   * Record what one probe observed.
   * @param key - the source instance that was probed.
   * @param descriptor - the settings descriptor the probe read, when the namespace is registered.
   * @param error - the failure's text, or undefined for a probe that found the source usable.
   */
  private observe(key: string, descriptor: SettingsDescriptor | undefined, error: string | undefined): void {
    const previous = this.observations.get(key)
    // A probe that succeeded does not clear the failure the last one recorded.
    const kept = error === undefined ? previous : undefined
    const message = error ?? kept?.error
    const at = error === undefined ? kept?.errorAt : new Date().toISOString()
    this.observations.set(key, {
      ok: error === undefined,
      revision: descriptor?.revision,
      ...message === undefined ? {} : { error: message },
      ...at === undefined ? {} : { errorAt: at },
    })
  }
}

/**
 * Where one source instance stands.
 * @param configured - whether its provider reports the instance's settings complete.
 * @param observed - the last probe this process observed, when it made one.
 * @param revision - the settings revision the kind now stands at.
 * @returns the state the panel draws.
 */
function stateOf(
  configured: boolean,
  observed: Observation | undefined,
  revision: number | undefined,
): SourceState {
  if (!configured) return 'unconfigured'
  // An instance edited since its last probe is unchecked again: the outcome
  // describes settings that no longer stand.
  if (observed === undefined || observed.revision !== revision) return 'unchecked'
  return observed.ok ? 'usable' : 'unusable'
}

/** One node of a serialized schemastery schema, as the settings provider publishes it. */
type SchemaNode = Record<string, unknown>

/**
 * The record view of a JSON value.
 * @param value - the value to read.
 * @returns the value as a record, or undefined for anything else.
 */
function asRecord(value: unknown): SchemaNode | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SchemaNode : undefined
}

/**
 * Resolve one child of a serialized schema: a nested node, or an index into the
 * shared `refs` table that serialization emits for a node used more than once.
 * @param value - the child as serialized.
 * @param refs - the serialization's shared node table.
 * @returns the child node, or undefined when the child is not a node.
 */
function schemaChild(value: unknown, refs: SchemaNode): SchemaNode | undefined {
  return asRecord(typeof value === 'number' ? refs[String(value)] : value)
}

/**
 * The configuration fields one serialized settings schema marks as credential
 * references.
 *
 * The settings provider publishes a schema as JSON. The walk follows the
 * containers a credential reference can be declared through — `object`, `dict`,
 * `array`, and `intersect` — and stops at everything else, because a reference
 * buried in a union branch or a transform is not reachable through a value and
 * must not be modeled that way.
 * @param schema - the serialized schema, when the namespace is registered.
 * @returns the field names, in schema order and without repeats.
 */
function credentialFields(schema: unknown): readonly string[] {
  const root = asRecord(schema)
  if (root === undefined) return []
  const refs = asRecord(root.refs) ?? {}
  const names: string[] = []
  collectCredentialFields(schemaChild(root.uid, refs) ?? root, refs, names)
  return [...new Set(names)]
}

/**
 * Collect the credential-reference field names one schema node declares.
 * @param node - the node to walk.
 * @param refs - the serialization's shared node table.
 * @param into - the names collected so far.
 */
function collectCredentialFields(node: SchemaNode, refs: SchemaNode, into: string[]): void {
  if (node.type === 'dict' || node.type === 'array') {
    const inner = schemaChild(node.inner, refs)
    if (inner !== undefined) collectCredentialFields(inner, refs, into)
    return
  }
  if (node.type === 'intersect') {
    for (const member of Array.isArray(node.list) ? node.list : []) {
      const child = schemaChild(member, refs)
      if (child !== undefined) collectCredentialFields(child, refs, into)
    }
    return
  }
  if (node.type !== 'object') return
  const dict = asRecord(node.dict)
  if (dict === undefined) return
  for (const [name, child] of Object.entries(dict)) {
    const resolved = schemaChild(child, refs)
    if (resolved === undefined) continue
    if (asRecord(resolved.meta)?.role === 'credential-ref') into.push(name)
    else collectCredentialFields(resolved, refs, into)
  }
}

/** The failure text of anything a provider refused with. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default SourcePanel

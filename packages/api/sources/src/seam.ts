/**
 * The remote-source capability seam's vocabulary, restated locally for the
 * members this endpoint reads.
 *
 * The seam itself is `@deepseek-ai/dsh-resource`; this wave may add no
 * dependency, so the members the panel uses are mirrored here under the seam
 * package's own names and contracts. Replacing this file with one type-only
 * import from `@deepseek-ai/dsh-resource/types` naming the same members, adding
 * that package as a devDependency, and referencing its project is the whole
 * change: the endpoint is already written against it. The operations the
 * panel never calls (`search`, `read`, `list`) are deliberately absent, so this
 * mirror cannot drift on them.
 *
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-api-sources/seam
 */

/** One source kind's discriminator, such as `'github'`; merge-extensible. */
export type SourceKind = 'mediawiki' | 'github' | 'mysql' | (string & {})

/**
 * What one source kind can answer, declared so a caller states the limits
 * outright instead of asking for a capability that does not exist.
 */
export interface SourceCapabilities {
  /** Whether the kind implements search. */
  readonly search: boolean
  /** Whether the kind implements listing. */
  readonly browse: boolean
  /** Whether the kind implements reading. */
  readonly read: boolean
  /** Largest single read the source returns, in bytes; the provider enforces it. */
  readonly maxReadBytes: number
  /** Largest single listing the source returns, in items; the provider enforces it. */
  readonly maxListItems: number
  /** Model-facing statement of what this kind answers and the limits it enforces. */
  readonly description: string
}

/** One configured source instance, addressed by its id inside its kind's settings namespace. */
export interface SourceRef {
  /** The kind's discriminator, matching the provider's `kind`. */
  readonly kind: SourceKind
  /** This instance's id inside its kind's settings namespace. */
  readonly id: string
}

/**
 * One configured instance of a kind, as its provider sees it: the address plus
 * the instance's own resolved settings, which only that kind's provider reads.
 */
export interface SourceConfig {
  /** The instance this configuration belongs to. */
  readonly ref: SourceRef
  /** False when the instance's settings lack a required value; it opens no connection. */
  readonly configured: boolean
}

/** What a successful credential and reachability probe found. */
export interface SourceDescription {
  /** Short label for the resolved target. */
  readonly label: string
  /** One line of detail the probe established; omitted when it established nothing more. */
  readonly detail?: string
}

/**
 * One source kind's implementation seam, narrowed to the members the panel
 * reads: what the kind answers, which instances its settings declare, and how
 * to probe one.
 */
export interface SourceProvider<C extends SourceConfig = SourceConfig> {
  /** The kind this provider implements; the registry key. */
  readonly kind: SourceKind
  /** What this kind answers, including the model-facing limits statement. */
  readonly capabilities: SourceCapabilities
  /**
   * Every instance this kind's settings declare, in settings order, reporting
   * whether each is complete. Opens no connection and makes no request.
   * @returns the declared instances, configured or not.
   */
  instances(): Promise<readonly C[]>
  /**
   * Probe the instance's credentials and describe the target. A rejection means
   * the source is unusable and its message is the last error text to show.
   * @param config - the instance to probe.
   * @returns the resolved target's label and optional detail.
   */
  check(config: C): Promise<SourceDescription>
}

/** The registry service (`ctx.sources`): one provider per kind, in registration order. */
export interface Sources {
  /**
   * Every registered provider, in registration order.
   * @returns the registered providers.
   */
  list(): readonly SourceProvider[]
  /**
   * Look up one kind's provider.
   * @param kind - the kind to look up.
   * @returns the provider, or `undefined` when the kind is not registered.
   */
  get(kind: SourceKind): SourceProvider | undefined
}

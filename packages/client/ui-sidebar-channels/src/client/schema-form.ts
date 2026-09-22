/**
 * The schema-driven half of the settings form: which fields one channel's
 * registered schema declares, which layer supplies each field's value, and the
 * writes a staged form produces.
 *
 * Nothing here knows a channel. The form is derived from the descriptor the
 * Host publishes — the serialized schema, the resolved value, the composition
 * base, and the raw user section — so a channel added by a plugin gets its form
 * without this package changing. A field the panel cannot edit is reported as
 * `readonly` rather than dropped, so a schema the panel does not understand
 * still shows what it declares.
 *
 * `role('secret')` slots are the one asymmetry: their value never rides the
 * wire, so a secret field is written but never seeded, and a blank draft writes
 * nothing rather than erasing a stored secret.
 */
import type { SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SchemaNode } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** How one schema field is edited, or that the panel cannot edit it. */
export type SchemaFieldKind = 'text' | 'number' | 'boolean' | 'select' | 'readonly'

/** One field a channel's settings schema declares. */
export interface SchemaField {
  /** Field name inside the settings section, as the schema spells it. */
  readonly name: string
  /** The control this field's schema asks for. */
  readonly kind: SchemaFieldKind
  /** The literal choices a `select` field accepts, in schema order; empty for every other kind. */
  readonly options: readonly string[]
  /** The value the namespace resolves for this field when neither the base nor the user layer carries it. */
  readonly fallback: unknown
}

/** Which layer supplies one field's effective value. */
export type FieldLayer = 'user' | 'base' | 'default'

/** One field's staged edit: what its control shows, and whether a save clears the field. */
export interface FieldDraft {
  /** Draft text the control renders. */
  readonly text: string
  /** Whether this edit clears the user layer instead of writing `text`. */
  readonly clear: boolean
}

/** The string choices a union of string constants offers, or undefined when it is anything else. */
function literalOptions(node: SchemaNode): readonly string[] | undefined {
  const options: string[] = []
  for (const member of node.list ?? []) {
    if (member.type !== 'const' || typeof member.value !== 'string') return undefined
    options.push(member.value)
  }
  return options.length === 0 ? undefined : options
}

/** The control one field's schema node asks for. */
function fieldOf(name: string, node: SchemaNode): SchemaField {
  const fallback = node.meta.default as JsonValue | undefined
  if (node.type === 'string') return { name, kind: 'text', options: [], fallback }
  if (node.type === 'number') return { name, kind: 'number', options: [], fallback }
  if (node.type === 'boolean') return { name, kind: 'boolean', options: [], fallback }
  if (node.type === 'union') {
    const options = literalOptions(node)
    if (options !== undefined) return { name, kind: 'select', options, fallback }
  }
  if (node.type === 'const' && typeof node.value === 'string') {
    return { name, kind: 'select', options: [node.value], fallback }
  }
  return { name, kind: 'readonly', options: [], fallback }
}

/** Collect the fields one schema node contributes, in schema order. */
function collectFields(node: SchemaNode, into: SchemaField[]): void {
  if (node.type === 'intersect') {
    for (const member of node.list ?? []) collectFields(member, into)
    return
  }
  // A root that is neither an object nor an intersection declares no field
  // names, so it contributes nothing rather than one nameless field.
  if (node.type !== 'object') return
  for (const [name, child] of Object.entries(node.dict ?? {})) {
    if (child.meta.hidden === true) continue
    into.push(fieldOf(name, child))
  }
}

/**
 * Flatten one settings schema into the fields its form renders.
 * @param schema - the rehydrated schema the namespace registered.
 * @returns one entry per declared field, in schema order.
 */
export function schemaFields(schema: SchemaNode): readonly SchemaField[] {
  const fields: SchemaField[] = []
  collectFields(schema, fields)
  return fields
}

/**
 * The top-level secret slots one descriptor reports.
 *
 * Only a top-level slot can be a form field, so a nested path is not named
 * here; the panel renders no control for it either.
 * @param secrets - the descriptor's redacted secret slots.
 * @returns each top-level secret field's name, mapped to whether it holds a value.
 */
export function secretSlots(secrets: readonly SettingsSecretView[]): ReadonlyMap<string, boolean> {
  const slots = new Map<string, boolean>()
  for (const secret of secrets) {
    const [name, ...rest] = secret.path
    if (name !== undefined && rest.length === 0) slots.set(name, secret.set)
  }
  return slots
}

/**
 * Whether one layer carries a value for a field.
 *
 * Presence rather than comparison is what marks a field overridden: an override
 * equal to the composition default is still an override.
 * @param layer - the base or user layer, as the descriptor published it.
 * @param name - the field name.
 * @returns whether that layer holds the field.
 */
export function hasField(layer: unknown, name: string): boolean {
  return typeof layer === 'object' && layer !== null && Object.hasOwn(layer, name)
}

/**
 * The value one layer holds for a field.
 * @param layer - the base or user layer, as the descriptor published it.
 * @param name - the field name.
 * @returns the value, or undefined when that layer does not carry the field.
 */
export function layerValue(layer: unknown, name: string): unknown {
  return hasField(layer, name) ? (layer as Record<string, unknown>)[name] : undefined
}

/**
 * Which layer supplies one field's effective value.
 * @param user - the descriptor's raw user section.
 * @param base - the descriptor's composition base layer.
 * @param name - the field name.
 * @returns `user`, `base`, or the schema default.
 */
export function fieldLayer(user: unknown, base: unknown, name: string): FieldLayer {
  if (hasField(user, name)) return 'user'
  if (hasField(base, name)) return 'base'
  return 'default'
}

/**
 * Render one stored value as the text its control shows.
 * @param field - the field whose control renders the value.
 * @param value - the stored value.
 * @returns the control's text; empty when the value is not one this field holds.
 */
export function fieldText(field: SchemaField, value: unknown): string {
  if (field.kind === 'boolean') return value === true ? 'true' : 'false'
  if (field.kind === 'number') return typeof value === 'number' ? String(value) : ''
  return typeof value === 'string' ? value : ''
}

/**
 * The value one draft text writes.
 * @param field - the field the draft belongs to.
 * @param text - the draft text.
 * @returns the value to store, or undefined when this field does not accept the text.
 */
export function fieldValue(field: SchemaField, text: string): JsonValue | undefined {
  if (field.kind === 'boolean') {
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }
  if (field.kind === 'number') {
    const parsed = Number(text)
    return text.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined
  }
  if (field.kind === 'select') return field.options.includes(text) ? text : undefined
  if (field.kind === 'text') return text
  return undefined
}

/**
 * The writes one form's staged drafts produce.
 *
 * A draft that changes nothing writes nothing; a secret draft writes only a
 * non-blank literal, because a blank one would erase a value the panel cannot
 * read back; and a clear writes only where the user layer actually carries the
 * field, since clearing an unset field changes no document.
 * @param fields - the fields the form renders.
 * @param secrets - the top-level secret slots, keyed by field name.
 * @param drafts - the staged edits, keyed by field name.
 * @param view - the descriptor the form was rendered from.
 * @returns the ops a save sends, or undefined when a draft is not a value its field accepts.
 */
export function fieldWrites(
  fields: readonly SchemaField[],
  secrets: ReadonlyMap<string, boolean>,
  drafts: Readonly<Record<string, FieldDraft>>,
  view: Pick<SettingsNamespaceView, 'value' | 'user'>,
): readonly SettingsPathOpView[] | undefined {
  const ops: SettingsPathOpView[] = []
  for (const field of fields) {
    const draft = drafts[field.name]
    if (draft === undefined) continue
    const path = [field.name]
    if (draft.clear) {
      // A secret slot has no readable value to revert to, so a clear cannot be
      // expressed for it; the panel offers no reset control for one either.
      if (!secrets.has(field.name) && hasField(view.user, field.name)) ops.push({ op: 'unset', path })
      continue
    }
    if (secrets.has(field.name)) {
      if (draft.text !== '') ops.push({ op: 'set', path, value: draft.text })
      continue
    }
    if (draft.text === fieldText(field, layerValue(view.value, field.name))) continue
    const value = fieldValue(field, draft.text)
    if (value === undefined) return undefined
    ops.push({ op: 'set', path, value })
  }
  return ops
}

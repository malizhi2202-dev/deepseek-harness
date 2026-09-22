/**
 * The schema-driven half of the settings form: which fields one source's
 * registered schema declares, which layer supplies each field's value, and the
 * writes a staged form produces.
 *
 * Nothing here knows a source. The form is derived from the descriptor the Host
 * publishes — the serialized schema, the resolved value, the composition base,
 * and the raw user section — so a source kind a plugin adds later gets its form
 * without this package changing. A field the panel cannot edit is reported as
 * `readonly` rather than dropped, so a schema this build does not understand
 * still shows what it declares.
 *
 * A source's secrets are never values here: the design has a credential
 * referenced by NAME, so the section holds reference names and this form edits
 * them like any other string. A secret slot the schema declares is therefore not
 * special-cased, and no field is ever seeded from a value the panel cannot read.
 */
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SchemaNode } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** How one settings field is edited, or that the panel cannot edit it. */
export type FieldControl = 'text' | 'number' | 'boolean' | 'select' | 'readonly'

/** Which layer supplies one field's effective value. */
export type FieldLayer = 'user' | 'base' | 'default'

/** One field's staged edit: what its control shows, and whether a save clears the field. */
export interface FieldDraft {
  /** Draft text the control renders. */
  readonly text: string
  /** Whether this edit clears the user layer instead of writing `text`. */
  readonly clear: boolean
}

/** One row the settings form renders. */
export interface FormField {
  /** Field name inside the settings section, as the schema spells it. */
  readonly name: string
  /** The control this field's schema asks for. */
  readonly control: FieldControl
  /** The literal choices a `select` field accepts, in schema order; empty for every other control. */
  readonly choices: readonly string[]
  /** Which layer supplies the value the control shows. */
  readonly layer: FieldLayer
  /** The resolved value, as the control renders it. */
  readonly text: string
  /** What the field would show if its user-layer entry were cleared. */
  readonly clearedText: string
  /** The raw resolved value, for a control that shows the value itself. */
  readonly value: unknown
}

/** The control each schemastery node type maps to, for the types with a plain control. */
const PLAIN_CONTROLS: Readonly<Record<string, FieldControl>> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
}

/**
 * The string choices a union of string constants offers, or none when the node
 * is anything else.
 * @param node - the field's schema node.
 * @returns the choices, in schema order; empty when this node is not such a union.
 */
function choicesOf(node: SchemaNode): readonly string[] {
  if (node.type === 'const') return typeof node.value === 'string' ? [node.value] : []
  if (node.type !== 'union') return []
  const choices: string[] = []
  for (const member of node.list ?? []) {
    if (member.type !== 'const' || typeof member.value !== 'string') return []
    choices.push(member.value)
  }
  return choices
}

/**
 * The control one field's schema node asks for.
 * @param node - the field's schema node.
 * @param choices - the choices {@link choicesOf} found.
 * @returns the control to render.
 */
function controlOf(node: SchemaNode, choices: readonly string[]): FieldControl {
  if (choices.length > 0) return 'select'
  return PLAIN_CONTROLS[node.type] ?? 'readonly'
}

/**
 * Whether one settings layer carries a value for a field.
 *
 * Presence rather than comparison is what marks a field overridden: an override
 * equal to the composition default is still an override.
 * @param layer - the base or user layer, as the descriptor published it.
 * @param name - the field name.
 * @returns whether that layer holds the field.
 */
export function layerCarries(layer: unknown, name: string): boolean {
  return typeof layer === 'object' && layer !== null && Object.hasOwn(layer, name)
}

/**
 * The value one layer holds for a field.
 * @param layer - the base or user layer, as the descriptor published it.
 * @param name - the field name.
 * @returns the value, or undefined when that layer does not carry the field.
 */
export function layerValue(layer: unknown, name: string): unknown {
  return layerCarries(layer, name) ? (layer as Record<string, unknown>)[name] : undefined
}

/**
 * Render one stored value as the text its control shows.
 * @param control - the control that renders the value.
 * @param value - the stored value.
 * @returns the control's text; empty when the value is not one this control holds.
 */
export function valueText(control: FieldControl, value: unknown): string {
  if (control === 'boolean') return value === true ? 'true' : 'false'
  if (control === 'number') return typeof value === 'number' ? String(value) : ''
  return typeof value === 'string' ? value : ''
}

/**
 * The value one draft text writes.
 * @param control - the control the draft belongs to.
 * @param choices - the choices a `select` control accepts.
 * @param text - the draft text.
 * @returns the value to store, or undefined when this control does not accept the text.
 */
export function draftValue(control: FieldControl, choices: readonly string[], text: string): JsonValue | undefined {
  switch (control) {
    case 'boolean':
      if (text === 'true') return true
      if (text === 'false') return false
      return undefined
    case 'number': {
      const parsed = Number(text)
      return text.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined
    }
    case 'select':
      return choices.includes(text) ? text : undefined
    case 'text':
      return text
    default:
      return undefined
  }
}

/**
 * Collect the rows one schema node contributes, in schema order.
 * @param node - the schema node to walk.
 * @param view - the descriptor the form renders from.
 * @param into - the rows collected so far.
 */
function collectRows(node: SchemaNode, view: SettingsNamespaceView, into: FormField[]): void {
  if (node.type === 'intersect') {
    for (const member of node.list ?? []) collectRows(member, view, into)
    return
  }
  // A root that is neither an object nor an intersection declares no field
  // names, so it contributes nothing rather than one nameless field.
  if (node.type !== 'object') return
  for (const [name, child] of Object.entries(node.dict ?? {})) {
    if (child.meta.hidden === true) continue
    into.push(rowOf(name, child, view))
  }
}

/**
 * One field's row, with the layer that supplies its value and the text its
 * control shows.
 * @param name - the field name.
 * @param node - the field's schema node.
 * @param view - the descriptor the form renders from.
 * @returns the row to render.
 */
function rowOf(name: string, node: SchemaNode, view: SettingsNamespaceView): FormField {
  const choices = choicesOf(node)
  const control = controlOf(node, choices)
  const layer: FieldLayer = layerCarries(view.user, name) ? 'user' : layerCarries(view.base, name) ? 'base' : 'default'
  const resolved = layerValue(view.value, name)
  const base = layerValue(view.base, name)
  return {
    name,
    control,
    choices,
    layer,
    text: valueText(control, resolved),
    clearedText: valueText(control, base ?? node.meta.default),
    value: resolved,
  }
}

/**
 * Flatten one settings schema into the rows its form renders.
 * @param schema - the rehydrated schema the namespace registered.
 * @param view - the descriptor the form renders from.
 * @returns one row per declared field, in schema order.
 */
export function formFields(schema: SchemaNode, view: SettingsNamespaceView): readonly FormField[] {
  const rows: FormField[] = []
  collectRows(schema, view, rows)
  return rows
}

/**
 * The writes one form's staged drafts produce.
 *
 * A draft that changes nothing writes nothing, and a clear writes only where the
 * user layer actually carries the field, since clearing an unset field changes
 * no document.
 * @param fields - the rows the form renders.
 * @param drafts - the staged edits, keyed by field name.
 * @returns the ops a save sends, or undefined when a draft is not a value its control accepts.
 */
export function formWrites(
  fields: readonly FormField[],
  drafts: Readonly<Record<string, FieldDraft>>,
): readonly SettingsPathOpView[] | undefined {
  const rows = new Map(fields.map(row => [row.name, row]))
  const ops: SettingsPathOpView[] = []
  for (const [name, draft] of Object.entries(drafts)) {
    const row = rows.get(name)
    if (row === undefined) continue
    const path = [name]
    if (draft.clear) {
      if (row.layer === 'user') ops.push({ op: 'unset', path })
      continue
    }
    if (draft.text === row.text) continue
    const value = draftValue(row.control, row.choices, draft.text)
    if (value === undefined) return undefined
    ops.push({ op: 'set', path, value })
  }
  return ops
}

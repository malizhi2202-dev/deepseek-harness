/**
 * The schema-driven half of the form, one declaration at a time.
 *
 * Every case here is about a descriptor this package did not write: a schema
 * node kind it has no control for, a field the schema hides, a layer that
 * carries a field without a value, and a secret slot whose value never arrives.
 * The form's contract is that none of those becomes a silent no-op.
 */
import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  fieldLayer, fieldText, fieldValue, fieldWrites, hasField, layerValue, schemaFields, secretSlots,
} from '../src/client/schema-form.ts'
import type { FieldDraft, SchemaField } from '../src/client/schema-form.ts'
import { CHANNEL_SCHEMA } from './scripted-channels.client.ts'

const text = (name: string, fallback?: unknown): SchemaField => ({ name, kind: 'text', options: [], fallback })
const draft = (value: string, clear = false): FieldDraft => ({ text: value, clear })

/**
 * One serialized envelope with a key removed from every matching node.
 *
 * The envelope is wire data, so a Host that publishes a union or object node
 * without its member list or dictionary is a case the form has to survive
 * rather than a shape the type rules out.
 * @param schema - the schema to serialize.
 * @param key - the node key to remove.
 * @param match - which nodes to strip.
 * @returns the serialized envelope.
 */
function withoutKey(schema: Schema, key: string, match: (node: Record<string, unknown>) => boolean): unknown {
  const wire = JSON.parse(JSON.stringify(schema.toJSON())) as {
    uid: number
    refs: Record<string, Record<string, unknown>>
  }
  for (const [id, node] of Object.entries(wire.refs)) {
    if (!match(node)) continue
    wire.refs[id] = Object.fromEntries(Object.entries(node).filter(([name]) => name !== key))
  }
  return wire
}

describe('schemaFields', () => {
  it('reads the channel schema this Host registers, in schema order', () => {
    expect(schemaFields(new Schema(CHANNEL_SCHEMA as unknown as Schema)).map(field => [field.name, field.kind, field.fallback])).toEqual([
      ['enabled', 'boolean', false],
      ['sessionId', 'text', ''],
      ['markdown', 'boolean', true],
      ['host', 'text', ''],
      ['appSecretRef', 'text', ''],
    ])
  })

  it('flattens an intersection of objects', () => {
    const schema = Schema.intersect([
      Schema.object({ host: Schema.string() }),
      Schema.object({ port: Schema.number() }),
    ])
    expect(schemaFields(schema).map(field => field.name)).toEqual(['host', 'port'])
  })

  it('skips a field the schema hides', () => {
    const schema = Schema.object({ shown: Schema.string(), hidden: Schema.string().hidden() })
    expect(schemaFields(schema).map(field => field.name)).toEqual(['shown'])
  })

  it('contributes no field for a root that declares no names', () => {
    expect(schemaFields(Schema.string())).toEqual([])
    expect(schemaFields(Schema.intersect([Schema.string()]))).toEqual([])
  })

  it('offers the declared choices of a union of string constants', () => {
    const schema = Schema.object({ mode: Schema.union([Schema.const('fast'), Schema.const('thorough')]) })
    expect(schemaFields(schema)).toEqual([
      { name: 'mode', kind: 'select', options: ['fast', 'thorough'], fallback: undefined },
    ])
  })

  it('reports a union that is not all string constants as readonly', () => {
    const mixed = Schema.object({ any: Schema.union([Schema.const('one'), Schema.number()]) })
    const numbered = Schema.object({ count: Schema.union([Schema.const(1), Schema.const(2)]) })
    expect(schemaFields(mixed)[0]?.kind).toBe('readonly')
    expect(schemaFields(numbered)[0]?.kind).toBe('readonly')
  })

  it('offers a lone string constant as the only choice, and any other constant as readonly', () => {
    const fixed = Schema.object({ pinned: Schema.const('only') })
    const counted = Schema.object({ pinned: Schema.const(7) })
    expect(schemaFields(fixed)[0]).toEqual({ name: 'pinned', kind: 'select', options: ['only'], fallback: undefined })
    expect(schemaFields(counted)[0]?.kind).toBe('readonly')
  })

  it('reports an empty union of constants as readonly', () => {
    expect(schemaFields(Schema.object({ mode: Schema.union([]) }))[0]?.kind).toBe('readonly')
  })

  it('reads a node whose member list or dictionary the envelope omits', () => {
    const union = withoutKey(
      Schema.object({ mode: Schema.union([Schema.const('a')]) }),
      'list',
      node => node.type === 'union',
    )
    const intersect = withoutKey(
      Schema.intersect([Schema.object({ x: Schema.string() })]),
      'list',
      node => node.type === 'intersect',
    )
    const object = withoutKey(Schema.object({ mode: Schema.string() }), 'dict', node => node.type === 'object')
    expect(schemaFields(new Schema(union as Schema))).toEqual([
      { name: 'mode', kind: 'readonly', options: [], fallback: undefined },
    ])
    // An intersection with no member list declares no field at all.
    expect(schemaFields(new Schema(intersect as Schema))).toEqual([])
    expect(schemaFields(new Schema(object as Schema))).toEqual([])
  })
})

describe('secretSlots', () => {
  it('names only the top-level slots, with whether each holds a value', () => {
    const slots = secretSlots([
      { path: ['appSecretRef'], set: true },
      { path: ['nested', 'deep'], set: true },
      { path: [], set: true },
      { path: ['token'], set: false },
    ])
    expect([...slots]).toEqual([['appSecretRef', true], ['token', false]])
  })
})

describe('hasField and layerValue', () => {
  it('reports presence rather than a value, and refuses a layer that is not an object', () => {
    expect(hasField({ a: undefined }, 'a')).toBe(true)
    expect(hasField({}, 'a')).toBe(false)
    expect(hasField(undefined, 'a')).toBe(false)
    expect(hasField(null, 'a')).toBe(false)
    expect(hasField('text', 'a')).toBe(false)
    expect(layerValue({ a: 1 }, 'a')).toBe(1)
    expect(layerValue({}, 'a')).toBeUndefined()
  })

  it('names the layer that supplies a field', () => {
    expect(fieldLayer({ a: 1 }, { a: 2 }, 'a')).toBe('user')
    expect(fieldLayer({}, { a: 2 }, 'a')).toBe('base')
    expect(fieldLayer({}, {}, 'a')).toBe('default')
  })
})

describe('fieldText', () => {
  it('renders each kind from the value its schema accepts', () => {
    expect(fieldText({ name: 'b', kind: 'boolean', options: [], fallback: undefined }, true)).toBe('true')
    expect(fieldText({ name: 'b', kind: 'boolean', options: [], fallback: undefined }, 'yes')).toBe('false')
    expect(fieldText({ name: 'n', kind: 'number', options: [], fallback: undefined }, 12)).toBe('12')
    expect(fieldText({ name: 'n', kind: 'number', options: [], fallback: undefined }, '12')).toBe('')
    expect(fieldText(text('t'), 'value')).toBe('value')
    expect(fieldText(text('t'), 7)).toBe('')
  })
})

describe('fieldValue', () => {
  it('accepts only the values each kind can store', () => {
    const boolean: SchemaField = { name: 'b', kind: 'boolean', options: [], fallback: undefined }
    const number: SchemaField = { name: 'n', kind: 'number', options: [], fallback: undefined }
    const select: SchemaField = { name: 's', kind: 'select', options: ['one'], fallback: undefined }
    const readonly: SchemaField = { name: 'r', kind: 'readonly', options: [], fallback: undefined }
    expect(fieldValue(boolean, 'true')).toBe(true)
    expect(fieldValue(boolean, 'false')).toBe(false)
    expect(fieldValue(boolean, 'maybe')).toBeUndefined()
    expect(fieldValue(number, '12.5')).toBe(12.5)
    expect(fieldValue(number, ' ')).toBeUndefined()
    expect(fieldValue(number, 'many')).toBeUndefined()
    expect(fieldValue(select, 'one')).toBe('one')
    expect(fieldValue(select, 'two')).toBeUndefined()
    expect(fieldValue(text('t'), 'anything')).toBe('anything')
    expect(fieldValue(readonly, 'anything')).toBeUndefined()
  })
})

describe('fieldWrites', () => {
  const fields = [
    text('host'),
    { name: 'markdown', kind: 'boolean', options: [], fallback: true } as SchemaField,
    { name: 'mode', kind: 'select', options: ['fast'], fallback: undefined } as SchemaField,
  ]
  const view = { value: { host: 'old', markdown: true, mode: 'fast' }, user: { host: 'old' } }

  it('writes nothing when nothing is staged', () => {
    expect(fieldWrites(fields, new Map(), {}, view)).toEqual([])
  })

  it('writes the fields that changed, in field order', () => {
    const ops: readonly SettingsPathOpView[] = fieldWrites(
      fields,
      new Map(),
      { mode: draft('fast'), host: draft('new') },
      view,
    ) ?? []
    expect(ops).toEqual([{ op: 'set', path: ['host'], value: 'new' }])
  })

  it('writes a boolean and a select through their own kinds', () => {
    expect(fieldWrites(fields, new Map(), { markdown: draft('false'), mode: draft('fast') }, {
      value: { host: 'old', markdown: true, mode: 'slow' },
      user: {},
    })).toEqual([
      { op: 'set', path: ['markdown'], value: false },
      { op: 'set', path: ['mode'], value: 'fast' },
    ])
  })

  it('refuses a staged draft its field cannot store', () => {
    expect(fieldWrites(fields, new Map(), { markdown: draft('maybe') }, view)).toBeUndefined()
    expect(fieldWrites(fields, new Map(), { mode: draft('slow') }, view)).toBeUndefined()
  })

  it('clears only a field the user layer actually carries', () => {
    expect(fieldWrites(fields, new Map(), { host: draft('', true) }, view)).toEqual([{ op: 'unset', path: ['host'] }])
    expect(fieldWrites(fields, new Map(), { markdown: draft('', true) }, view)).toEqual([])
  })

  it('never writes a secret from a blank draft or a clear, and never erases one', () => {
    const secrets = new Map([['appSecretRef', false]])
    const secretField = [text('appSecretRef')]
    expect(fieldWrites(secretField, secrets, { appSecretRef: draft('') }, { value: {}, user: {} })).toEqual([])
    expect(fieldWrites(secretField, secrets, { appSecretRef: draft('', true) }, { value: {}, user: {} })).toEqual([])
    expect(fieldWrites(secretField, secrets, { appSecretRef: draft('tok') }, { value: {}, user: {} })).toEqual([
      { op: 'set', path: ['appSecretRef'], value: 'tok' },
    ])
  })
})

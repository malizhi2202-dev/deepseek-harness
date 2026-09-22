/**
 * The schema-driven half of the settings form: which fields a descriptor's
 * schema declares, which layer supplies each one, and the writes a staged form
 * produces.
 *
 * Each case builds the schema node it needs rather than reusing one fixture, so
 * the branches that only a schema this build does not fully understand reaches —
 * an intersection root, a hidden field, a union of non-constants — are pinned
 * where they live.
 */
import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  draftValue, formFields, formWrites, layerCarries, layerValue, valueText,
} from '../src/client/form.ts'
import { namespaceView } from './scripted-sources.client.ts'

/**
 * One descriptor over an arbitrary schema.
 * @param schema - the live schema node.
 * @param overrides - the descriptor fields this case states differently.
 * @returns the descriptor the form renders from.
 */
function viewOf(schema: Schema, overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return namespaceView({ schema: JSON.parse(JSON.stringify(schema.toJSON())) as never, ...overrides })
}

describe('formFields', () => {
  it('maps each declared field to the control its type asks for, in schema order', () => {
    const schema = Schema.object({
      host: Schema.string().default('https://example'),
      limit: Schema.number().default(10),
      deep: Schema.boolean().default(false),
      mode: Schema.union(['refs', 'code']).default('refs'),
      fixed: Schema.const('one'),
      weird: Schema.const(42),
    })
    const view = viewOf(schema)
    expect(formFields(schema, view).map(field => [field.name, field.control])).toEqual([
      ['host', 'text'],
      ['limit', 'number'],
      ['deep', 'boolean'],
      ['mode', 'select'],
      ['fixed', 'select'],
      ['weird', 'readonly'],
    ])
    expect(formFields(schema, view)[3]?.choices).toEqual(['refs', 'code'])
    expect(formFields(schema, view)[4]?.choices).toEqual(['one'])
  })

  it('flattens an intersection root and drops a hidden field', () => {
    const schema = Schema.intersect([
      Schema.object({ host: Schema.string().default('') }),
      Schema.object({ hidden: Schema.string().default('x').hidden(), visible: Schema.number().default(1) }),
    ])
    expect(formFields(schema, viewOf(schema)).map(field => field.name)).toEqual(['host', 'visible'])
  })

  it('contributes nothing for a root that declares no field names', () => {
    const schema = Schema.string()
    expect(formFields(schema, viewOf(schema))).toEqual([])
  })

  it('treats a union that is not a list of string constants as an uneditable field', () => {
    const schema = Schema.object({ mixed: Schema.union(['refs', Schema.number()]).default('refs') })
    const [field] = formFields(schema, viewOf(schema))
    expect(field?.control).toBe('readonly')
    expect(field?.choices).toEqual([])
  })

  it('contributes nothing for a container the Host published without its members', () => {
    // The descriptor's schema arrives as a serialized envelope, so a container
    // node can reach the panel without the list or dict its type promises.
    const union = new Schema({
      uid: 1,
      refs: { '1': { type: 'object', meta: {}, dict: { mixed: 2 } }, '2': { type: 'union', meta: {} } },
    } as never)
    expect(formFields(union, viewOf(union)).map(field => [field.name, field.control])).toEqual([['mixed', 'readonly']])
    const intersect = new Schema({ uid: 1, refs: { '1': { type: 'intersect', meta: {} } } } as never)
    expect(formFields(intersect, viewOf(intersect))).toEqual([])
    const object = new Schema({ uid: 1, refs: { '1': { type: 'object', meta: {} } } } as never)
    expect(formFields(object, viewOf(object))).toEqual([])
  })

  it('reports the layer that supplies each field, and the text its control shows', () => {
    const schema = Schema.object({
      host: Schema.string().default('https://default'),
      limit: Schema.number().default(20),
      deep: Schema.boolean().default(false),
      mode: Schema.union(['refs', 'code']).default('refs'),
    })
    const view = viewOf(schema, {
      value: { host: 'https://user', limit: 5, deep: true, mode: 'code' },
      base: { host: 'https://base', limit: 10 },
      user: { host: 'https://user' },
    })
    expect(formFields(schema, view)).toEqual([
      {
        name: 'host', control: 'text', choices: [], layer: 'user',
        text: 'https://user', clearedText: 'https://base', value: 'https://user',
      },
      {
        name: 'limit', control: 'number', choices: [], layer: 'base',
        text: '5', clearedText: '10', value: 5,
      },
      {
        name: 'deep', control: 'boolean', choices: [], layer: 'default',
        text: 'true', clearedText: 'false', value: true,
      },
      {
        name: 'mode', control: 'select', choices: ['refs', 'code'], layer: 'default',
        text: 'code', clearedText: 'refs', value: 'code',
      },
    ])
  })

  it('previews the schema default for a field no layer carries', () => {
    const schema = Schema.object({ limit: Schema.number().default(7) })
    const [field] = formFields(schema, viewOf(schema, { value: { limit: 3 } }))
    expect(field?.layer).toBe('default')
    expect(field?.clearedText).toBe('7')
  })

  it('renders an empty text for a value the control does not hold', () => {
    const schema = Schema.object({ host: Schema.string().default(''), limit: Schema.number().default(0) })
    const [host, limit] = formFields(schema, viewOf(schema, { value: { host: 5, limit: 'ten' } }))
    expect(host?.text).toBe('')
    expect(limit?.text).toBe('')
  })
})

describe('layerCarries and layerValue', () => {
  it('reads a field from an object layer and refuses every other layer', () => {
    expect(layerCarries({ host: 'x' }, 'host')).toBe(true)
    expect(layerCarries({ host: 'x' }, 'other')).toBe(false)
    expect(layerCarries(undefined, 'host')).toBe(false)
    expect(layerCarries('a string', 'host')).toBe(false)
    expect(layerCarries(null, 'host')).toBe(false)
    expect(layerValue({ host: 'x' }, 'host')).toBe('x')
    expect(layerValue({ host: 'x' }, 'other')).toBeUndefined()
  })
})

describe('valueText', () => {
  it('renders each control\'s value as the text it shows', () => {
    expect(valueText('boolean', true)).toBe('true')
    expect(valueText('boolean', false)).toBe('false')
    expect(valueText('boolean', 'true')).toBe('false')
    expect(valueText('number', 12)).toBe('12')
    expect(valueText('number', '12')).toBe('')
    expect(valueText('text', 'a')).toBe('a')
    expect(valueText('text', 1)).toBe('')
    expect(valueText('select', 'refs')).toBe('refs')
    expect(valueText('readonly', 'anything')).toBe('anything')
  })
})

describe('draftValue', () => {
  it('accepts the values its control holds and refuses the rest', () => {
    expect(draftValue('boolean', [], 'true')).toBe(true)
    expect(draftValue('boolean', [], 'false')).toBe(false)
    expect(draftValue('boolean', [], 'maybe')).toBeUndefined()
    expect(draftValue('number', [], '3')).toBe(3)
    expect(draftValue('number', [], '')).toBeUndefined()
    expect(draftValue('number', [], 'three')).toBeUndefined()
    expect(draftValue('select', ['refs', 'code'], 'code')).toBe('code')
    expect(draftValue('select', ['refs'], 'other')).toBeUndefined()
    expect(draftValue('text', [], 'anything')).toBe('anything')
    expect(draftValue('readonly', [], 'anything')).toBeUndefined()
  })
})

describe('formWrites', () => {
  const schema = Schema.object({
    host: Schema.string().default('https://default'),
    limit: Schema.number().default(20),
    mode: Schema.union(['refs', 'code']).default('refs'),
  })
  const fields = formFields(schema, viewOf(schema, { value: { host: 'https://default', limit: 20, mode: 'refs' } }))

  it('writes nothing for a draft that changes nothing', () => {
    expect(formWrites(fields, { host: { text: 'https://default', clear: false } })).toEqual([])
  })

  it('writes the value a changed draft holds', () => {
    expect(formWrites(fields, {
      host: { text: 'https://other', clear: false },
      limit: { text: '5', clear: false },
      mode: { text: 'code', clear: false },
    })).toEqual([
      { op: 'set', path: ['host'], value: 'https://other' },
      { op: 'set', path: ['limit'], value: 5 },
      { op: 'set', path: ['mode'], value: 'code' },
    ])
  })

  it('refuses the whole form when one draft is not a value its control accepts', () => {
    expect(formWrites(fields, { limit: { text: 'five', clear: false } })).toBeUndefined()
    expect(formWrites(fields, { mode: { text: 'other', clear: false } })).toBeUndefined()
  })

  it('clears a field the user layer carries and ignores one it does not', () => {
    const withUser = formFields(schema, viewOf(schema, { user: { host: 'https://user' } }))
    expect(formWrites(withUser, { host: { text: '', clear: true } })).toEqual([{ op: 'unset', path: ['host'] }])
    expect(formWrites(fields, { host: { text: '', clear: true } })).toEqual([])
  })

  it('ignores a draft for a field the form does not render', () => {
    expect(formWrites(fields, { ghost: { text: 'x', clear: false } })).toEqual([])
  })
})

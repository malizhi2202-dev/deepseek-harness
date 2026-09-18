/**
 * The tab-type capacity gate's own proof: every rule rejects an illegal
 * declaration, and the shipped roster passes.
 *
 * The corpus assertions read the real Client sources, so a definition that
 * stops being discoverable — renamed type annotation, moved file, computed
 * `kind` — fails here as well as in the gate.
 */
import { describe, expect, it } from 'vitest'
import {
  CAPACITY_CONTRACT,
  MINIMUM_TAB_DEFINITIONS,
  collectModuleLiterals,
  definitionSources,
  findTabTypeViolations,
  parseCapacityRules,
  parseTabDefinitions,
  scanTabTypes,
} from './verify-sidebar-right-tab-types.ts'
import type { CapacityRules, TabTypeRecord } from './verify-sidebar-right-tab-types.ts'

/** The capacity numbers a rule check is judged against, as the contract states them. */
const RULES: CapacityRules = { maxDefaultVisible: 3, defaultOrder: 100, defaultOnOrderMax: 99, thirdPartyOrderMin: 1000 }

/** One definition file's source, written in the shipped style. */
function source(body: string): string {
  return `import type { SidebarRightTabDefinition } from '../tab-registry.ts'\n${body}\n`
}

/** The legal shape every illegal case starts from. */
const LEGAL = `export function pageDefinition(): SidebarRightTabDefinition {
  return {
    id: 'test/page',
    kind: 'page',
    order: 200,
    visibility: 'available',
    title: () => 'Page',
  }
}`

/** One source file's records, with its own constants resolvable. */
function recordsOf(text: string, file = 'packages/client/example/src/client/definition.ts'): TabTypeRecord[] {
  return parseTabDefinitions(file, text, collectModuleLiterals(new Map([[file, text]])))
}

/** A record with every field stated, for the rule checks. */
function record(overrides: Partial<TabTypeRecord> = {}): TabTypeRecord {
  return {
    file: 'packages/client/example/src/client/definition.ts',
    id: 'test/page',
    kind: 'page',
    order: 200,
    visibility: 'available',
    icon: false,
    patterns: undefined,
    ...overrides,
  }
}

describe('parseTabDefinitions', () => {
  it('reads a definition written as a function returning the object literal', () => {
    expect(recordsOf(source(LEGAL))).toEqual([{
      file: 'packages/client/example/src/client/definition.ts',
      id: 'test/page',
      kind: 'page',
      order: 200,
      visibility: 'available',
      icon: false,
      patterns: undefined,
    }])
  })

  it('reads a definition written as an annotated constant, with patterns and a glyph', () => {
    const text = source(`const KIND = 'text'
const ID = '@scope/text'
export const textDefinition: SidebarRightTabDefinition = {
  id: ID,
  kind: KIND,
  order: 300,
  icon: Glyph,
  patterns: ['dsh-resource://text/**', 'dsh-resource://text/session/*'],
}`)
    expect(recordsOf(text)).toEqual([{
      file: 'packages/client/example/src/client/definition.ts',
      id: '@scope/text',
      kind: 'text',
      order: 300,
      visibility: undefined,
      icon: true,
      patterns: ['dsh-resource://text/**', 'dsh-resource://text/session/*'],
    }])
  })

  it('resolves a kind imported from another scanned file, as the guide definition states it', () => {
    const contract = "export const GUIDE_KIND = 'guide'\n"
    const definition = source(`import { GUIDE_KIND } from '../../contract/seed.ts'
export function guideDefinition(): SidebarRightTabDefinition {
  return { id: 'test/guide', kind: GUIDE_KIND, order: 100, visibility: 'available', title: () => 'Start' }
}`)
    const file = 'packages/client/ui-sidebar-right/src/client/tabs/guide/definition.ts'
    const modules = collectModuleLiterals(new Map([
      [file, definition],
      ['packages/client/ui-sidebar-right/src/client/contract/seed.ts', contract],
    ]))
    expect(parseTabDefinitions(file, definition, modules)[0]?.kind).toBe('guide')
  })

  it('reports a declaration it cannot read instead of dropping it', () => {
    const records = recordsOf(source('export const definition = (): SidebarRightTabDefinition => pick()'))
    expect(records).toHaveLength(1)
    expect(findTabTypeViolations(records, RULES)).toEqual([{
      subject: 'packages/client/example/src/client/definition.ts (unreadable declaration)',
      reason: 'the declaration does not state `id` and `kind` as literals, so no rule can read it',
    }])
  })

  it('ignores an object literal that does not declare the tab-definition type', () => {
    const text = source(`export function other(): OtherDefinition {
  return { id: 'test/other', kind: 'other' }
}`)
    expect(recordsOf(text)).toEqual([])
  })
})

describe('findTabTypeViolations', () => {
  it('accepts a declaration that states every capacity field', () => {
    expect(findTabTypeViolations([record()], RULES)).toEqual([])
  })

  it('rejects a declaration that names no order', () => {
    expect(findTabTypeViolations([record({ order: undefined })], RULES)).toEqual([{
      subject: 'page',
      reason: 'declares no `order`; the default-open sequence would depend on registration order',
    }])
  })

  it('rejects two declarations sharing an order', () => {
    const violations = findTabTypeViolations([record({ kind: 'page' }), record({ id: 'test/other', kind: 'other' })], RULES)
    expect(violations).toEqual([{ subject: 'page + other', reason: 'share the order 200' }])
  })

  it('rejects two declarations sharing a kind or an identity', () => {
    const duplicated = [record(), record({ id: 'test/other', order: 250, file: 'packages/client/other/src/client/definition.ts' })]
    expect(findTabTypeViolations(duplicated, RULES)).toEqual([{
      subject: 'page',
      reason: 'is declared by 2 definitions (packages/client/example/src/client/definition.ts, packages/client/other/src/client/definition.ts)',
    }])
    const shared = [record(), record({ kind: 'other', order: 250, file: 'packages/client/other/src/client/definition.ts' })]
    expect(findTabTypeViolations(shared, RULES)).toEqual([{
      subject: 'test/page',
      reason: 'is registered by 2 definitions (packages/client/example/src/client/definition.ts, packages/client/other/src/client/definition.ts)',
    }])
  })

  it('rejects a default-on type outside the default-visible band, and an ordered type inside it', () => {
    expect(findTabTypeViolations([record({ visibility: 'default-on', order: 100, icon: true })], RULES))
      .toEqual([{ subject: 'page', reason: 'is default-on but orders at 100, outside the default-visible band (at most 99)' }])
    expect(findTabTypeViolations([record({ order: 50 })], RULES))
      .toEqual([{ subject: 'page', reason: 'orders at 50, inside the default-visible band, while not being default-on' }])
  })

  it('rejects a default-on type without a glyph, and one that recognizes addresses', () => {
    expect(findTabTypeViolations([record({ visibility: 'default-on', order: 10 })], RULES))
      .toEqual([{ subject: 'page', reason: 'is default-on but declares no `icon`; the tab it opens has to stay recognizable' }])
    expect(findTabTypeViolations([record({ visibility: 'default-on', order: 10, icon: true, patterns: ['dsh-resource://page/**'] })], RULES))
      .toEqual([{ subject: 'page', reason: 'is default-on but recognizes addresses; only a page type opens by itself' }])
  })

  it('rejects a fourth default-on type, naming the whole over-budget set', () => {
    const seeded = ['tasks', 'agents', 'goals'].map((kind, index) => record({ id: `test/${kind}`, kind, visibility: 'default-on', order: 10 + index, icon: true }))
    const violations = findTabTypeViolations([...seeded, record({ visibility: 'default-on', order: 40, icon: true })], RULES)
    expect(violations).toEqual([{ subject: 'tasks + agents + goals + page', reason: 'are default-on, over the budget of 3' }])
  })

  it('rejects addresses that claim no domain, two domains, an empty list, and a non-literal entry', () => {
    const domain = (patterns: readonly string[] | undefined) => findTabTypeViolations([record({ patterns })], RULES)
    expect(domain(['sidebar://page'])).toEqual([{
      subject: 'page',
      reason: 'recognizes addresses outside a single dsh-resource://<type>/ domain: sidebar://page',
    }])
    expect(domain(['dsh-resource://file/**', 'dsh-resource://text/**'])[0]?.reason)
      .toContain('outside a single dsh-resource://<type>/ domain')
    expect(domain([])).toEqual([{
      subject: 'page',
      reason: 'declares an empty `patterns`; a page type omits the field instead',
    }])
    expect(recordsOf(source(`export function pageDefinition(): SidebarRightTabDefinition {
  return { id: 'test/page', kind: 'page', order: 200, patterns: [PREFIXES[0]] }
}`))[0]?.patterns).toBeUndefined()
  })

  it('reads the capacity numbers from the module the registry reads them from', () => {
    expect(CAPACITY_CONTRACT).toBe('packages/client/ui-sidebar-right/src/client/contract/visibility.ts')
    const source = [
      'export const MAX_DEFAULT_VISIBLE_TABS = 2',
      'export const DEFAULT_ORDER = 100',
      'export const DEFAULT_ON_ORDER_MAX = 99',
      'export const THIRD_PARTY_ORDER_MIN = 1000',
      '',
    ].join('\n')
    expect(parseCapacityRules(source)).toEqual({ ...RULES, maxDefaultVisible: 2 })
    expect(() => parseCapacityRules(source.replace('DEFAULT_ORDER = 100', 'DEFAULT_ORDER = DEFAULT_ON_ORDER_MAX + 1')))
      .toThrow(/states no numeric DEFAULT_ORDER/)
  })

  it('rejects a declaration whose identity or kind it cannot read', () => {
    expect(findTabTypeViolations([record({ id: '', kind: '' })], RULES))
      .toEqual([{
        subject: 'packages/client/example/src/client/definition.ts (unreadable declaration)',
        reason: 'the declaration does not state `id` and `kind` as literals, so no rule can read it',
      }])
  })
})

describe('the shipped tab types', () => {
  it('discovers every tab-definition file under the Client packages', () => {
    const files = definitionSources()
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('packages/client/ui-sidebar-right/src/client/tabs/guide/definition.ts')
    expect(files.every(file => !file.endsWith('.d.ts'))).toBe(true)
  })

  it('reads the shipped page types and viewer out of their sources', () => {
    const { records, rules } = scanTabTypes()
    expect(records.length).toBeGreaterThanOrEqual(MINIMUM_TAB_DEFINITIONS)
    expect(records.map(item => item.kind).sort()).toEqual(expect.arrayContaining(['files', 'guide', 'tasks', 'text']))
    expect(findTabTypeViolations(records, rules)).toEqual([])
  })
})

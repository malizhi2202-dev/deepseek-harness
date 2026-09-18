/**
 * Check the right Sidebar's tab-type declarations against the column's capacity
 * rules.
 *
 * A tab type declares how much of the column it wants before a user asks for it
 * (`visibility`), where it ranks (`order`), and the glyph the type picker draws
 * (`icon`). Those declarations are the only source of the default-open set: no
 * registration order, no hardcoded list of kinds, and no fixed roster decides
 * what a surface opens. This gate reads every shipped definition out of its
 * source and refuses a declaration that breaks a rule, then reports the whole
 * roster so a reviewer sees each kind's section, order, and default state
 * without reading four packages.
 *
 * The rules, and what each one protects:
 *
 * - Every definition names an explicit `order`, and no two share one. `order`
 *   seats the default-open tabs, so a silent tie is a silent change of what a
 *   user sees first.
 * - `default-on` sits in the default-visible band and everything else below it,
 *   which is what keeps the tabs a user has to open out of the way.
 * - At most `MAX_DEFAULT_VISIBLE_TABS` types may be `default-on`, and the
 *   registry throws on the declaration that would exceed it rather than seating
 *   fewer tabs than the declaration promised.
 * - A `default-on` type declares an `icon` and claims no address: it is a page,
 *   because a viewer has no page of its own to open.
 * - Address ownership is the admission rule for a new kind: a type that
 *   recognizes addresses must own exactly one `dsh-resource://<type>/` domain,
 *   and nothing else. A page type is exempt by design — it is opened by kind and
 *   recognizes no address — which is why the shipped page types (`guide`,
 *   `files`, `tasks`) declare no `patterns`. The rule is new in this gate: it
 *   was not enforced anywhere before, so no existing declaration relies on it.
 *
 * Run directly:
 *   pnpm exec tsx scripts/verify-sidebar-right-tab-types.ts
 */

import { globSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
/**
 * Discovery narrowing guard: the shipped page types plus the shipped viewer.
 */
export const MINIMUM_TAB_DEFINITIONS = 4
/** The interface a tab-type definition is declared with. */
const DEFINITION_TYPE = 'SidebarRightTabDefinition'
/** The one URL scheme a resource address may use. */
const RESOURCE_PREFIX = 'dsh-resource://'
/** The module the column's capacity numbers live in, as the single home two consumers read. */
export const CAPACITY_CONTRACT = 'packages/client/ui-sidebar-right/src/client/contract/visibility.ts'

/** The column's capacity numbers, read from their one home. */
export interface CapacityRules {
  /** How many types one surface may open by itself. */
  readonly maxDefaultVisible: number
  /** The first order a type a user has to open may take. */
  readonly defaultOrder: number
  /** The last order inside the default-visible band. */
  readonly defaultOnOrderMax: number
  /** The first order reserved for a type from outside the product. */
  readonly thirdPartyOrderMin: number
}

/**
 * Read the capacity numbers out of the contract module's source.
 *
 * The gate reads them rather than importing them: `scripts/` belongs to the Host
 * program, and the contract lives in a Client package, so an import would put a
 * browser source file in the Host program's file list.
 * @param sourceText - the contract module's source.
 * @returns the numbers, keyed by the field each one bounds.
 * @throws Error when a number is not stated as a numeric literal export.
 */
export function parseCapacityRules(sourceText: string): CapacityRules {
  const source = ts.createSourceFile(CAPACITY_CONTRACT, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const constants = new Map<string, number>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || initializer === undefined || !ts.isNumericLiteral(initializer)) continue
      constants.set(declaration.name.text, Number(initializer.text))
    }
  }
  const named: Record<keyof CapacityRules, string> = {
    maxDefaultVisible: 'MAX_DEFAULT_VISIBLE_TABS',
    defaultOrder: 'DEFAULT_ORDER',
    defaultOnOrderMax: 'DEFAULT_ON_ORDER_MAX',
    thirdPartyOrderMin: 'THIRD_PARTY_ORDER_MIN',
  }
  const rules = {} as Record<keyof CapacityRules, number>
  const missing: string[] = []
  for (const [field, name] of Object.entries(named) as [keyof CapacityRules, string][]) {
    const value = constants.get(name)
    if (value === undefined) missing.push(name)
    else rules[field] = value
  }
  if (missing.length > 0) {
    throw new Error(`verify-sidebar-right-tab-types: ${CAPACITY_CONTRACT} states no numeric ${missing.join(', ')}.`)
  }
  return rules
}

/** The order band a type ranks in, named for the report. */
export type TabTypeSection = 'default-visible' | 'product' | 'third-party'

/** One shipped tab-type declaration, as its source states it. */
export interface TabTypeRecord {
  /** Repository-relative source file. */
  file: string
  /** The identity the definition registers under. */
  id: string
  /** The kind whose tabs the definition describes. */
  kind: string
  /** Declared position, or `undefined` when the definition names none. */
  order: number | undefined
  /** Declared visibility, or `undefined` when the definition names none. */
  visibility: string | undefined
  /** Whether the definition declares a glyph. */
  icon: boolean
  /** Declared resource-address globs, or `undefined` for a page type. */
  patterns: readonly string[] | undefined
}

/** One way a declaration breaks a capacity rule. */
export interface TabTypeViolation {
  /** The kind the violation is about, or its file when the kind is unreadable. */
  subject: string
  /** Why the declaration is refused. */
  reason: string
}

/**
 * The band a declared order ranks in.
 * @param order - the declared order.
 * @param rules - the capacity numbers read from their one home.
 * @returns the band name the report prints.
 */
function sectionOf(order: number, rules: CapacityRules): TabTypeSection {
  if (order < rules.defaultOrder) return 'default-visible'
  return order < rules.thirdPartyOrderMin ? 'product' : 'third-party'
}

/** The literal text of a property initializer, when it is a literal or a name bound to one. */
function literalOf(node: ts.Expression | undefined, bindings: ReadonlyMap<string, string | number>): string | number | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isIdentifier(node)) return bindings.get(node.text)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text)
  }
  return undefined
}

/** The string elements of an array literal, or `undefined` when it holds anything else. */
function stringElements(node: ts.Expression, bindings: ReadonlyMap<string, string | number>): readonly string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined
  const values: string[] = []
  for (const element of node.elements) {
    const value = literalOf(element, bindings)
    if (typeof value !== 'string') return undefined
    values.push(value)
  }
  return values
}

/** Whether a type annotation names the tab-definition type. */
function namesDefinitionType(type: ts.TypeNode | undefined): boolean {
  return type !== undefined && type.getText().trim().endsWith(DEFINITION_TYPE)
}

/** The object literal a function body returns, when it returns one directly. */
function returnedLiteral(body: ts.ConciseBody | undefined): ts.ObjectLiteralExpression | undefined {
  if (body === undefined) return undefined
  if (!ts.isBlock(body)) return ts.isObjectLiteralExpression(body) ? body : undefined
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      return ts.isObjectLiteralExpression(statement.expression) ? statement.expression : undefined
    }
  }
  return undefined
}

/** How one statement declares a tab type: whether it does, and the literal it produces. */
interface DefinitionRead {
  /** Whether the statement states the tab-definition type. */
  matched: boolean
  /** The object literal it produces, or `undefined` when it produces none. */
  literal: ts.ObjectLiteralExpression | undefined
}

/** Read one candidate statement as a tab-type declaration. */
function declarationOf(node: ts.FunctionDeclaration | ts.VariableStatement): DefinitionRead {
  const unmatched = { matched: false, literal: undefined }
  if (ts.isFunctionDeclaration(node)) {
    return namesDefinitionType(node.type) ? { matched: true, literal: returnedLiteral(node.body) } : unmatched
  }
  const declaration = node.declarationList.declarations[0]
  if (declaration === undefined) return unmatched
  if (namesDefinitionType(declaration.type)) {
    const initializer = declaration.initializer
    return {
      matched: true,
      literal: initializer !== undefined && ts.isObjectLiteralExpression(initializer) ? initializer : undefined,
    }
  }
  const initializer = declaration.initializer
  if (initializer === undefined || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) return unmatched
  if (!namesDefinitionType(initializer.type)) return unmatched
  return { matched: true, literal: returnedLiteral(initializer.body) }
}

/** The repository-relative path a relative import specifier names. */
function resolveSpecifier(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier))
}

/** The module-level literals and imports of one file, so a definition's fields can be read from constants. */
function fieldBindings(
  file: string,
  source: ts.SourceFile,
  modules: ReadonlyMap<string, ReadonlyMap<string, string | number>>,
): Map<string, string | number> {
  const bindings = new Map<string, string | number>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const clause = statement.importClause?.namedBindings
    if (!specifier.startsWith('.') || clause === undefined || !ts.isNamedImports(clause)) continue
    const imported = modules.get(resolveSpecifier(file, specifier))
    if (imported === undefined) continue
    for (const element of clause.elements) {
      const value = imported.get((element.propertyName ?? element.name).text)
      if (value !== undefined) bindings.set(element.name.text, value)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const value = literalOf(declaration.initializer, bindings)
      if (value !== undefined) bindings.set(declaration.name.text, value)
    }
  }
  return bindings
}

/**
 * The module-level literals every scanned file binds, keyed by path and name.
 *
 * A tab definition names its `id` and `kind` through exported constants, so the
 * roster is only readable once each file's constants are known.
 * @param sources - every scanned file's source text, keyed by repository-relative path.
 * @returns each file's literal bindings.
 */
export function collectModuleLiterals(sources: ReadonlyMap<string, string>): Map<string, ReadonlyMap<string, string | number>> {
  const modules = new Map<string, ReadonlyMap<string, string | number>>()
  for (const [file, sourceText] of sources) {
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    modules.set(file, fieldBindings(file, source, modules))
  }
  return modules
}

/**
 * Read every tab-type declaration out of one source file.
 *
 * A declaration is a function or variable annotated with the definition type
 * whose value is an object literal; a field counts as stated when the source
 * writes a literal, a module-level constant, or a constant imported from
 * another scanned file. Anything else is reported rather than silently skipped.
 * @param file - repository-relative path used in diagnostics.
 * @param sourceText - TypeScript or TSX source.
 * @param modules - every scanned file's literal bindings, from {@link collectModuleLiterals}.
 * @returns one record per declaration, in source order.
 */
export function parseTabDefinitions(
  file: string,
  sourceText: string,
  modules: ReadonlyMap<string, ReadonlyMap<string, string | number>> = new Map(),
): TabTypeRecord[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const bindings = fieldBindings(file, source, modules)
  const records: TabTypeRecord[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
      const read = declarationOf(node)
      if (!read.matched) {
        ts.forEachChild(node, visit)
        return
      }
      const literal = read.literal
      if (literal === undefined) {
        records.push({
          file, id: '', kind: '', order: undefined, visibility: undefined, icon: false, patterns: undefined,
        })
        return
      }
      const property = (name: string): ts.Expression | undefined =>
        literal.properties.find((entry): entry is ts.PropertyAssignment =>
          ts.isPropertyAssignment(entry) && entry.name.getText().replaceAll(/['"]/g, '') === name)?.initializer
      const id = literalOf(property('id'), bindings)
      const kind = literalOf(property('kind'), bindings)
      const order = literalOf(property('order'), bindings)
      const visibility = literalOf(property('visibility'), bindings)
      const patterns = property('patterns')
      records.push({
        file,
        id: typeof id === 'string' ? id : '',
        kind: typeof kind === 'string' ? kind : '',
        order: typeof order === 'number' ? order : undefined,
        visibility: typeof visibility === 'string' ? visibility : undefined,
        icon: property('icon') !== undefined,
        patterns: patterns === undefined ? undefined : stringElements(patterns, bindings),
      })
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return records
}

/** The single `dsh-resource://<type>/` domain a definition's patterns live under, if they share one. */
function addressDomain(patterns: readonly string[]): string | undefined {
  const domains = new Set<string>()
  for (const pattern of patterns) {
    const match = /^dsh-resource:\/\/([^/]+)\//.exec(pattern)
    if (match?.[1] !== undefined) domains.add(match[1])
  }
  return domains.size === 1 ? [...domains][0] : undefined
}

/**
 * Check a roster of declarations against the capacity rules.
 * @param records - every shipped declaration, in source order.
 * @param rules - the capacity numbers read from their one home.
 * @returns one violation per broken rule, in roster order.
 */
export function findTabTypeViolations(records: readonly TabTypeRecord[], rules: CapacityRules): TabTypeViolation[] {
  const violations: TabTypeViolation[] = []
  const byKind = new Map<string, TabTypeRecord[]>()
  const byId = new Map<string, TabTypeRecord[]>()
  const byOrder = new Map<number, TabTypeRecord[]>()
  const defaultVisible = records.filter(record => record.visibility === 'default-on')

  for (const record of records) {
    const subject = record.kind === '' ? `${record.file} (unreadable declaration)` : record.kind
    if (record.kind === '' || record.id === '') {
      violations.push({ subject, reason: 'the declaration does not state `id` and `kind` as literals, so no rule can read it' })
      continue
    }
    byKind.set(record.kind, [...byKind.get(record.kind) ?? [], record])
    byId.set(record.id, [...byId.get(record.id) ?? [], record])
    if (record.order === undefined) {
      violations.push({ subject, reason: 'declares no `order`; the default-open sequence would depend on registration order' })
    } else {
      byOrder.set(record.order, [...byOrder.get(record.order) ?? [], record])
      if (record.visibility === 'default-on' && record.order > rules.defaultOnOrderMax) {
        violations.push({ subject, reason: `is default-on but orders at ${record.order}, outside the default-visible band (at most ${rules.defaultOnOrderMax})` })
      }
      if (record.visibility !== 'default-on' && record.order < rules.defaultOrder) {
        violations.push({ subject, reason: `orders at ${record.order}, inside the default-visible band, while not being default-on` })
      }
    }
    if (record.visibility === 'default-on' && !record.icon) {
      violations.push({ subject, reason: 'is default-on but declares no `icon`; the tab it opens has to stay recognizable' })
    }
    if (record.visibility === 'default-on' && record.patterns !== undefined) {
      violations.push({ subject, reason: 'is default-on but recognizes addresses; only a page type opens by itself' })
    }
    if (record.patterns === undefined) continue
    if (record.patterns.length === 0) {
      violations.push({ subject, reason: 'declares an empty `patterns`; a page type omits the field instead' })
      continue
    }
    const domain = addressDomain(record.patterns)
    if (domain === undefined) {
      violations.push({
        subject,
        reason: `recognizes addresses outside a single ${RESOURCE_PREFIX}<type>/ domain: ${record.patterns.join(', ')}`,
      })
    }
  }

  for (const [kind, sharing] of byKind) {
    if (sharing.length > 1) {
      violations.push({ subject: kind, reason: `is declared by ${sharing.length} definitions (${sharing.map(record => record.file).join(', ')})` })
    }
  }
  for (const [id, sharing] of byId) {
    if (sharing.length > 1) {
      violations.push({ subject: id, reason: `is registered by ${sharing.length} definitions (${sharing.map(record => record.file).join(', ')})` })
    }
  }
  for (const [order, sharing] of byOrder) {
    if (sharing.length > 1) {
      violations.push({ subject: sharing.map(record => record.kind).join(' + '), reason: `share the order ${order}` })
    }
  }
  if (defaultVisible.length > rules.maxDefaultVisible) {
    violations.push({
      subject: defaultVisible.map(record => record.kind).join(' + '),
      reason: `are default-on, over the budget of ${rules.maxDefaultVisible}`,
    })
  }
  return violations
}

/**
 * Every shipped tab-type source file, in a stable order.
 * @returns repository-relative file paths.
 */
export function definitionSources(): string[] {
  return globSync('packages/client/*/src/**/*.{ts,tsx}', { cwd: root })
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.endsWith('.d.ts'))
    .sort()
}

/**
 * Read the shipped tab types and the capacity rules they are checked against.
 * @returns the roster in discovery order, the scanned files, and the capacity numbers.
 */
export function scanTabTypes(): { records: TabTypeRecord[]; files: string[]; rules: CapacityRules } {
  const files = definitionSources()
  const texts = files.map(file => [file, readFileSync(resolve(root, file), 'utf8')] as const)
  const contract = readFileSync(resolve(root, CAPACITY_CONTRACT), 'utf8')
  // The contract joins the module map so a definition importing a constant from
  // it resolves like any other scanned file.
  const modules = collectModuleLiterals(new Map([...texts, [CAPACITY_CONTRACT, contract] as const]))
  return {
    records: texts.flatMap(([file, sourceText]) => parseTabDefinitions(file, sourceText, modules)),
    files,
    rules: parseCapacityRules(contract),
  }
}

/**
 * The address domain one record reports, as the roster table prints it.
 * @param record - one shipped declaration.
 * @returns the domain, or the reason none is stated.
 */
function domainOf(record: TabTypeRecord): string {
  if (record.patterns === undefined) return '(page type)'
  const domain = addressDomain(record.patterns)
  return domain === undefined ? '(no single domain)' : `${RESOURCE_PREFIX}${domain}/`
}

function main(): void {
  const { records, files, rules } = scanTabTypes()
  if (records.length < MINIMUM_TAB_DEFINITIONS) {
    throw new Error(
      `verify-sidebar-right-tab-types: discovery narrowed to ${records.length} tab definition(s); expected at least ${MINIMUM_TAB_DEFINITIONS}.`,
    )
  }
  console.log(`verify-sidebar-right-tab-types: ${records.length} tab type(s) across ${files.length} Client source file(s).`)
  console.log('  kind    section          order  default  address')
  for (const record of records) {
    console.log([
      `  ${record.kind.padEnd(8)}`,
      (record.order === undefined ? '(none)' : sectionOf(record.order, rules)).padEnd(16),
      String(record.order ?? '(none)').padEnd(6),
      (record.visibility ?? 'available').padEnd(8),
      domainOf(record),
    ].join(' '))
  }
  const violations = findTabTypeViolations(records, rules)
  if (violations.length > 0) {
    console.error(`verify-sidebar-right-tab-types: ${violations.length} violation(s):`)
    for (const violation of violations) console.error(`  ${violation.subject}: ${violation.reason}`)
    process.exitCode = 1
    return
  }
  console.log('verify-sidebar-right-tab-types: tab-type declarations are within the column\'s capacity rules.')
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()

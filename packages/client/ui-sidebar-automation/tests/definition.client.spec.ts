/**
 * Stage one, as the registry sees it: the type is an available page that claims
 * no address, sits in the builtin band after the pages before it, and offers the
 * guide page one entry that opens its kind.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { AUTOMATION_ID, AUTOMATION_KIND, automationDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('automationDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(automationDefinition(t))
    expect(registry.get(AUTOMATION_KIND)?.id).toBe(AUTOMATION_ID)
    // The ledger has no addressable identity, so no resource address reaches
    // this type: a session's files must not open the automation page.
    expect(registry.candidates(sessionFileAddress('s-1', '/work/repo/a.ts'))).toEqual([])
  })

  it('offers the guide page one entry that opens the automation kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(automationDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.kind).toBe(AUTOMATION_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description()).toBe(zh['guide.description'])
    expect(entry?.icon).toBeDefined()
  })

  it('sits in the builtin band after the pages before it and never opens by itself', () => {
    const definition = automationDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.order).toBe(800)
    expect(definition.visibility).toBe('available')
    expect(definition.icon).toBeDefined()
    expect(definition.guide?.map(entry => entry.order)).toEqual([80])
    expect(definition.title('automation')).toBe(zh['type.label'])
  })
})

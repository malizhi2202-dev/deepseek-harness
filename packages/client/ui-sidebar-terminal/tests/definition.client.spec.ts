/**
 * Stage one, as the registry sees it: the type is an available page that claims
 * no address, sits in the builtin band behind the other page types, and offers
 * the guide page one entry that opens its kind.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { TERMINAL_ID, TERMINAL_KIND, terminalDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('terminalDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(terminalDefinition(t))
    expect(registry.get(TERMINAL_KIND)?.id).toBe(TERMINAL_ID)
    expect(registry.candidates(sessionFileAddress('s-1', '/work/repo/a.ts'))).toEqual([])
  })

  it('offers the guide page one entry that opens the terminal kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(terminalDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.kind).toBe(TERMINAL_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description()).toBe(zh['guide.description'])
    expect(entry?.icon).toBeDefined()
  })

  it('sits in the builtin band behind the other page types and never opens by itself', () => {
    const definition = terminalDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.order).toBe(500)
    expect(definition.visibility).toBe('available')
    expect(definition.icon).toBeDefined()
    expect(definition.title('terminal')).toBe(zh['type.label'])
  })
})

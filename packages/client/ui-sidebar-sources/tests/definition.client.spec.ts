/**
 * Stage one, as the registry sees it: the type is an available page that claims
 * no address, sits behind the other page types, and offers the guide page one
 * entry that opens its kind.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { SOURCES_ID, SOURCES_KIND, sourcesDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('sourcesDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(sourcesDefinition(t))
    expect(registry.get(SOURCES_KIND)?.id).toBe(SOURCES_ID)
    expect(registry.candidates(sessionFileAddress('s-1', '/work/repo/a.ts'))).toEqual([])
    expect(registry.candidates('dsh-resource://github/owner/repo:path')).toEqual([])
  })

  it('offers the guide page one entry that opens the sources kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(sourcesDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.kind).toBe(SOURCES_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description()).toBe(zh['guide.description'])
    expect(entry?.icon).toBeDefined()
  })

  it('sits in the builtin band behind the other page types and never opens by itself', () => {
    const definition = sourcesDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.order).toBe(700)
    expect(definition.visibility).toBe('available')
    expect(definition.icon).toBeDefined()
    expect(definition.patterns).toBeUndefined()
    expect(definition.title('sources')).toBe(zh['type.label'])
    expect(definition.guide?.[0]?.order).toBe(70)
  })
})

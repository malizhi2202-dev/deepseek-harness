/**
 * Stage one, as the registry sees it: the type is an available page that claims
 * no address, sits in the builtin band, and offers the guide page one entry
 * that opens its kind.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { GIT_ID, GIT_KIND, gitDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('gitDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(gitDefinition(t))
    expect(registry.get(GIT_KIND)?.id).toBe(GIT_ID)
    expect(registry.candidates(sessionFileAddress('s-1', '/work/repo/a.ts'))).toEqual([])
  })

  it('offers the guide page one entry that opens the git kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(gitDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.kind).toBe(GIT_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description()).toBe(zh['guide.description'])
    expect(entry?.icon).toBeDefined()
  })

  it('sits in the builtin band behind the preview pages and never opens by itself', () => {
    const definition = gitDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.order).toBeGreaterThanOrEqual(100)
    expect(definition.visibility).toBe('available')
    expect(definition.icon).toBeDefined()
    expect(definition.title('git')).toBe(zh['type.label'])
  })
})

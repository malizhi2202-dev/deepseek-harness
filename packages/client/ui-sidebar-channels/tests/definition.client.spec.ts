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
import { CHANNELS_ID, CHANNELS_KIND, channelsDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('channelsDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(channelsDefinition(t))
    expect(registry.get(CHANNELS_KIND)?.id).toBe(CHANNELS_ID)
    expect(registry.candidates(sessionFileAddress('s-1', '/work/repo/a.ts'))).toEqual([])
  })

  it('offers the guide page one entry that opens the channels kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(channelsDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.kind).toBe(CHANNELS_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description()).toBe(zh['guide.description'])
    expect(entry?.icon).toBeDefined()
  })

  it('sits in the builtin band behind the other page types and never opens by itself', () => {
    const definition = channelsDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.order).toBe(600)
    expect(definition.visibility).toBe('available')
    expect(definition.icon).toBeDefined()
    expect(definition.title('channels')).toBe(zh['type.label'])
    expect(definition.guide?.[0]?.order).toBe(60)
  })
})

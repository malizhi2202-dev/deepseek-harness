// @vitest-environment jsdom
/**
 * Mount the body over a real store instance, a scripted Remote namespace, and a
 * scripted settings domain.
 *
 * The component reads a handful of its props; the rest of the standard kit is
 * framework-injected and never touched here, so one documented cast keeps the
 * harness to what is actually exercised. A spec seeds the store directly when
 * it wants one settled state, or lets the mount read the list through the face
 * when it is the read path under test.
 */
import { useSyncExternalStore } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { sourcesFace } from '../src/client/face.ts'
import type { SourcesInjected } from '../src/client/face.ts'
import { SourcesBody } from '../src/client/SourcesBody.tsx'
import type { SourcesBodyProps } from '../src/client/SourcesBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createSourcesStore } from '../src/client/store.ts'
import { SESSION, scriptedRemote, scriptedSettings } from './scripted-sources.client.ts'
import type { ScriptedRemote, ScriptedSettings } from './scripted-sources.client.ts'

export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the panel's store, as the framework would mint one per session. */
export type SourcesStoreInstance = ReturnType<ReturnType<typeof createSourcesStore>['create']>

/** What a spec holds after mounting: the rendered view and every hand on the panel. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: SourcesStoreInstance
  readonly script: ScriptedRemote
  readonly settings: ScriptedSettings
  readonly face: SourcesInjected
  readonly controller: AbortController
  /** The store's bound actions, for driving a state by hand. */
  readonly actions: SourcesStoreInstance['actions']
}

/**
 * Mount the body.
 * @param options - whether the owner's record is still live, and a seed for the store before the first render.
 * @returns the mounted panel.
 */
export function mountBody(options: { live?: boolean; seed?: (actions: SourcesStoreInstance['actions']) => void } = {}): Mounted {
  const instance = createSourcesStore().create()
  const script = scriptedRemote()
  const settings = scriptedSettings()
  const face = sourcesFace(script.remote, settings.port)(SESSION, instance.actions)
  const controller = new AbortController()
  if (options.live === false) controller.abort()
  options.seed?.(instance.actions)
  const tabActions = {
    openResource: vi.fn<SidebarRightTabActions['openResource']>(),
    openTab: vi.fn<SidebarRightTabActions['openTab']>(),
    close: vi.fn<SidebarRightTabActions['close']>(),
  }
  const shared = {
    // A page tab's address is the shell's to mint; the body never reads it.
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: 'sources', contentId: 'sources', title: zh['type.label'], visible: true,
        navigation: { address: 'sources', params: undefined, revision: 1 },
        signal: controller.signal,
        actions: tabActions,
      },
    }),
    sessionId: SESSION,
    useStore: hookOf(instance),
    actions: instance.actions,
    ...face,
    t: makeTranslate(zh),
  }
  const view = render(<SourcesBody {...shared as unknown as SourcesBodyProps} />)
  return { view, instance, script, settings, face, controller, actions: instance.actions }
}

/**
 * Let React flush an update a spec made outside an event handler.
 * @returns settlement after the next macrotask.
 */
export async function flush(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Answer the source list the body itself requested on mount.
 * @param mounted - the mounted panel.
 * @param sources - the sources the Host reports.
 */
export async function listSources(mounted: Mounted, sources: Parameters<ScriptedRemote['settleStatus']>[0]['sources']): Promise<void> {
  await mounted.script.settleStatus({ sources })
}

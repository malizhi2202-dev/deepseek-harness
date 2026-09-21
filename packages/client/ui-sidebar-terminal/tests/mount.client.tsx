// @vitest-environment jsdom
/**
 * Mount the body over a real store instance and a scripted console.
 *
 * The component reads a handful of its props; the rest of the standard kit is
 * framework-injected and never touched here, so one documented cast keeps the
 * harness to what is actually exercised.
 */
import { useSyncExternalStore } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createTerminalConsole, terminalFace } from '../src/client/face.ts'
import type { TerminalInjected } from '../src/client/face.ts'
import { TerminalBody } from '../src/client/TerminalBody.tsx'
import type { TerminalBodyProps } from '../src/client/TerminalBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createTerminalStore } from '../src/client/store.ts'
import { SESSION, scriptedConsole, shell } from './scripted-console.client.ts'
import type { ScriptedConsole } from './scripted-console.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the panel's store, as the framework would mint one per session. */
type TerminalStoreInstance = ReturnType<ReturnType<typeof createTerminalStore>['create']>

/** The owner's tab actions as recording mocks. */
interface MockedTabActions {
  readonly openResource: Mock<SidebarRightTabActions['openResource']>
  readonly openTab: Mock<SidebarRightTabActions['openTab']>
  readonly close: Mock<SidebarRightTabActions['close']>
}

/** What a spec holds after mounting: the rendered view and every hand on the panel. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: TerminalStoreInstance
  readonly script: ScriptedConsole
  readonly face: TerminalInjected
  readonly controller: AbortController
  readonly tabActions: MockedTabActions
  /** The store's bound actions, for driving a state by hand. */
  readonly actions: TerminalStoreInstance['actions']
}

/**
 * Mount the body.
 * @param live - whether the owner's record is still live; false mounts an already-aborted tab.
 */
export function mountBody(live = true): Mounted {
  const instance = createTerminalStore().create()
  const script = scriptedConsole()
  const face = terminalFace(createTerminalConsole(script.remote))(SESSION, instance.actions)
  const controller = new AbortController()
  if (!live) controller.abort()
  const tabActions: MockedTabActions = {
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
        id: TAB, kind: 'terminal', contentId: 'terminal', title: zh['type.label'], visible: true,
        navigation: { address: 'terminal', params: undefined, revision: 1 },
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
  const view = render(<TerminalBody {...shared as unknown as TerminalBodyProps} />)
  return { view, instance, script, face, controller, tabActions, actions: instance.actions }
}

/**
 * Answer the list the body itself requested on mount.
 * @param mounted - the mounted panel.
 * @param shells - the shells the server reports.
 */
export async function listShells(mounted: Mounted, shells: ReturnType<typeof shell>[]): Promise<void> {
  await mounted.script.settleList(shells)
}

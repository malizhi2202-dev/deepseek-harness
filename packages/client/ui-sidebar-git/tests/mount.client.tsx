// @vitest-environment jsdom
/**
 * Mount the body over a real store instance and a scripted observation.
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
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createObserve, gitFace } from '../src/client/face.ts'
import type { GitInjected } from '../src/client/face.ts'
import { GitBody } from '../src/client/GitBody.tsx'
import type { GitBodyProps } from '../src/client/GitBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createGitStore } from '../src/client/store.ts'
import { ROOT, SESSION, scriptedObserve } from './scripted-observe.client.ts'
import type { ScriptedObserve } from './scripted-observe.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the panel's store, as the framework would mint one per session. */
type GitStoreInstance = ReturnType<ReturnType<typeof createGitStore>['create']>

/** The owner's tab actions as recording mocks. */
interface MockedTabActions {
  readonly openResource: Mock<SidebarRightTabActions['openResource']>
  readonly openTab: Mock<SidebarRightTabActions['openTab']>
  readonly close: Mock<SidebarRightTabActions['close']>
}

/** What a spec holds after mounting: the rendered view and every hand on the panel. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: GitStoreInstance
  readonly script: ScriptedObserve
  readonly face: GitInjected
  readonly controller: AbortController
  readonly tabActions: MockedTabActions
  /** The store's bound actions, for driving a state by hand. */
  readonly actions: GitStoreInstance['actions']
}

/** One store instance, one face, one owner share. */
function harness(cwd: string | null) {
  const instance = createGitStore().create()
  const script = scriptedObserve()
  const face = gitFace(createObserve(script.remote))(SESSION, instance.actions)
  const controller = new AbortController()
  const tabActions: MockedTabActions = {
    openResource: vi.fn<SidebarRightTabActions['openResource']>(),
    openTab: vi.fn<SidebarRightTabActions['openTab']>(),
    close: vi.fn<SidebarRightTabActions['close']>(),
  }
  const sessions = { byId: cwd === null ? {} : { [SESSION]: { cwd } } } as unknown as SessionListState
  const shared = {
    // A page tab's address is the shell's to mint; the body never reads it.
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: 'git', contentId: 'git', title: zh['type.label'], visible: true,
        navigation: { address: 'git', params: undefined, revision: 1 },
        signal: controller.signal,
        actions: tabActions,
      },
    }),
    sessionId: SESSION,
    useSessions: <S,>(sel: (s: SessionListState) => S) => sel(sessions),
    useStore: hookOf(instance),
    actions: instance.actions,
    ...face,
    t: makeTranslate(zh),
  }
  return { instance, script, face, controller, tabActions, shared }
}

/**
 * Mount the body.
 * @param cwd - the session's working directory as `useSessions` reports it; `null` for a session without one.
 */
export function mountBody(cwd: string | null = ROOT): Mounted {
  const { shared, instance, script, face, controller, tabActions } = harness(cwd)
  const view = render(<GitBody {...shared as unknown as GitBodyProps} />)
  return { view, instance, script, face, controller, tabActions, actions: instance.actions }
}

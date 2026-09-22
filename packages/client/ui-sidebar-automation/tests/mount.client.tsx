// @vitest-environment jsdom
/**
 * Mount the body over a real store instance, a scripted ledger read, and a
 * workspace the framework's hook reports.
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
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { AutomationBody } from '../src/client/AutomationBody.tsx'
import type { AutomationBodyProps } from '../src/client/AutomationBody.tsx'
import { AUTOMATION_ID, AUTOMATION_KIND } from '../src/client/definition.ts'
import { automationFace } from '../src/client/face.ts'
import type { AutomationInjected } from '../src/client/face.ts'
import { zh } from '../src/client/locales.ts'
import { createAutomationStore } from '../src/client/store.ts'
import { SESSION, WORKSPACE_ID, workspaceView } from './fixtures.client.ts'
import { scriptedAutomation } from './scripted-automation.client.ts'
import type { ScriptedAutomation } from './scripted-automation.client.ts'

export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the panel's store, as the framework would mint one per session. */
type AutomationStoreInstance = ReturnType<ReturnType<typeof createAutomationStore>['create']>

/** The owner's tab actions as recording mocks. */
interface MockedTabActions {
  readonly openResource: Mock<SidebarRightTabActions['openResource']>
  readonly openTab: Mock<SidebarRightTabActions['openTab']>
  readonly close: Mock<SidebarRightTabActions['close']>
}

/** What a spec holds after mounting: the rendered view and every hand on the panel. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: AutomationStoreInstance
  readonly script: ScriptedAutomation
  readonly face: AutomationInjected
  readonly controller: AbortController
  readonly tabActions: MockedTabActions
  /** The store's bound actions, for driving a state by hand. */
  readonly actions: AutomationStoreInstance['actions']
}

/** How one mount differs from the default: which workspace, and whether its record already ended. */
export interface MountOptions {
  /** The workspace the hook reports; `null` for a session in no workspace, omitted for the fixture's. */
  readonly workspace?: WorkspaceView | null
  /** Abort the tab record before mounting, as a record that already went away. */
  readonly aborted?: boolean
}

/**
 * Mount the body.
 * @param options - the workspace to report and whether the record already ended.
 * @returns the rendered view and the hands on the panel.
 */
export function mountBody(options: MountOptions = {}): Mounted {
  const instance = createAutomationStore().create()
  const script = scriptedAutomation()
  const face = automationFace(script.remote)(SESSION, instance.actions)
  const controller = new AbortController()
  if (options.aborted === true) controller.abort()
  const tabActions: MockedTabActions = {
    openResource: vi.fn<SidebarRightTabActions['openResource']>(),
    openTab: vi.fn<SidebarRightTabActions['openTab']>(),
    close: vi.fn<SidebarRightTabActions['close']>(),
  }
  const row = options.workspace === undefined ? workspaceView() : options.workspace
  const workspaces: WorkspaceSnapshot = {
    items: row === null ? [] : [row],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const shared = {
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: AUTOMATION_KIND, contentId: AUTOMATION_ID, title: zh['type.label'], visible: true,
        navigation: { address: AUTOMATION_KIND, params: undefined, revision: 1 },
        signal: controller.signal,
        actions: tabActions,
      },
    }),
    sessionId: SESSION,
    useWorkspaces: <S,>(sel: (s: WorkspaceSnapshot) => S) => sel(workspaces),
    useStore: hookOf(instance),
    actions: instance.actions,
    ...face,
    t: makeTranslate(zh),
  }
  const view = render(<AutomationBody {...shared as unknown as AutomationBodyProps} />)
  return { view, instance, script, face, controller, tabActions, actions: instance.actions }
}

/** The workspace id the default fixture resolves to, for call assertions. */
export const FIXTURE_WORKSPACE_ID = WORKSPACE_ID

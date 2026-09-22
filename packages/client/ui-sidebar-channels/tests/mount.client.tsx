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
import { channelsFace } from '../src/client/face.ts'
import type { ChannelsInjected } from '../src/client/face.ts'
import { ChannelsBody } from '../src/client/ChannelsBody.tsx'
import type { ChannelsBodyProps } from '../src/client/ChannelsBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createChannelsStore } from '../src/client/store.ts'
import { SESSION, scriptedRemote, scriptedSettings } from './scripted-channels.client.ts'
import type { ScriptedRemote, ScriptedSettings } from './scripted-channels.client.ts'

export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the panel's store, as the framework would mint one per session. */
export type ChannelsStoreInstance = ReturnType<ReturnType<typeof createChannelsStore>['create']>

/** What a spec holds after mounting: the rendered view and every hand on the panel. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: ChannelsStoreInstance
  readonly script: ScriptedRemote
  readonly settings: ScriptedSettings
  readonly face: ChannelsInjected
  readonly controller: AbortController
  /** The store's bound actions, for driving a state by hand. */
  readonly actions: ChannelsStoreInstance['actions']
}

/**
 * Mount the body.
 * @param options - whether the owner's record is still live, and a seed for the store before the first render.
 * @returns the mounted panel.
 */
export function mountBody(options: { live?: boolean; seed?: (actions: ChannelsStoreInstance['actions']) => void } = {}): Mounted {
  const instance = createChannelsStore().create()
  const script = scriptedRemote()
  const settings = scriptedSettings()
  const face = channelsFace(script.remote, settings.port)(SESSION, instance.actions)
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
        id: TAB, kind: 'channels', contentId: 'channels', title: zh['type.label'], visible: true,
        navigation: { address: 'channels', params: undefined, revision: 1 },
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
  const view = render(<ChannelsBody {...shared as unknown as ChannelsBodyProps} />)
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
 * Answer the channel list the body itself requested on mount.
 * @param mounted - the mounted panel.
 * @param channels - the channels the Host reports.
 */
export async function listChannels(mounted: Mounted, channels: Parameters<ScriptedRemote['settleStatus']>[0]['channels']): Promise<void> {
  await mounted.script.settleStatus({ channels })
}

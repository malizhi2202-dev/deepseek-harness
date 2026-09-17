/**
 * Browser half: register `tasks` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The body reads only framework hooks (the `todos` projection and the Session
 * object layer's job mirror), so this package contributes no store and no face.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import { TASKS_ID, tasksDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { TasksBody } from './TasksBody.tsx'

export type { SidebarTasksKey } from './locales.ts'
export type { TasksBodyProps, TodoCounts } from './TasksBody.tsx'
export { TASKS_ID, TASKS_KIND } from './definition.ts'

/** Required browser services: the tab registry, the keyed seat, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the tab registry and the slots.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(tasksDefinition(t)), 'ui-sidebar-tasks: tasks type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-tasks: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TASKS_ID, locale: NS },
    TasksBody,
  )), 'ui-sidebar-tasks: tasks tab body')
}

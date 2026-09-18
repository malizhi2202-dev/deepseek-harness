/**
 * Browser half: register `git` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.ts`), what it keeps (`store.ts`), how it observes (`face.ts`),
 * what it draws (`GitBody.tsx`, with `history.ts` holding the pure folds), what
 * it says (`locales.ts`), and this module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GIT_ID, gitDefinition } from './definition.ts'
import { createObserve, gitFace } from './face.ts'
import { GitBody } from './GitBody.tsx'
import { en, zh } from './locales.ts'
import { createGitStore } from './store.ts'

export type { SidebarGitKey } from './locales.ts'
export type { GitTabState, GitState, createGitStore } from './store.ts'
export type { GitInjected, ObserveWorkspaceGit, WorkspaceGitObserveRemote } from './face.ts'
export type { GitBodyProps } from './GitBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarGit'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceGit']

/**
 * Client plugin body: register the type, its dictionaries, then its body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(gitDefinition(t)), 'ui-sidebar-git: git type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-git: dictionaries')

  const store = createGitStore()
  const inject = gitFace(createObserve(ctx.remote))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: GIT_ID, locale: NS, store, inject },
    GitBody,
  )), 'ui-sidebar-git: git tab body')
}

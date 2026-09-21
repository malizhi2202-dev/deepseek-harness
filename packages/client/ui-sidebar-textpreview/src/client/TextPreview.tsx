/**
 * The text preview's body: a file's pages, the editor over them, or the reason
 * the next one is not showing.
 *
 * Two sources meet here. The standard `useResource` hook gives the file's
 * metadata — its version and whether the agent wrote it since — and this type's
 * own store holds the pages it read through its face and the edit in progress.
 * A Host-reported change is announced, not applied: reloading under a reader
 * would lose their place, so the bar waits for a click. A failed metadata frame
 * — the file gone, its workspace unknown — takes the same bar's place over the
 * pages already loaded, with the same reload. The type's controls, wrap and
 * reload, sit at the end of the path row; the Sidebar's strip carries none of
 * them.
 *
 * Editing is offered only for a file this viewer holds whole — one page from
 * the first line to the end — because a save replaces the whole file: pages the
 * viewer never loaded would be deleted by it. Everything else says why instead.
 * A save carries the version its text was read at, so a file that moved on
 * underneath is refused and the reader's text stays in the editor.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TextInjected } from './face.ts'
import { failureLine, saveFailureLine } from './failure-line.ts'
import { IconWrapOutline16 } from './icons.tsx'
import type { SidebarTextpreviewKey } from './locales.ts'
import { hostFileOf } from './rpc.ts'
import type { TextPage, TextStore, TextTabState } from './store.ts'
import css from './TextPreview.module.css'

/** The body's composed props: the tab, its navigation, the shared store and face, and copy. */
export type TextPreviewProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<TextStore>
  & InjectFace<TextInjected>
  & PropsLocale<'sidebarTextpreview'>

/**
 * A page's lines. The Host joins a page's lines with `\n` without a terminator
 * and counts them, so a page past the file's last line (`lines: 0`) has none
 * and a page holding one empty line (`lines: 1`, `text: ''`) has one; a
 * trailing `\n` ends an empty last line.
 * @param page - the page's text and line count.
 * @returns the lines in order.
 */
export function linesOf(page: TextPage): string[] {
  return page.lines === 0 ? [] : page.text.split('\n')
}

/** One loaded page: the 1-based line it starts at, its text, and its line count. */
export interface LoadedPage extends TextPage {
  readonly offset: number
}

/**
 * The loaded pages in file order.
 * @param pages - the store's page table.
 * @returns the pages, ascending by offset.
 */
export function loadedPages(pages: Record<number, TextPage>): LoadedPage[] {
  return Object.entries(pages)
    .map(([offset, page]) => ({ offset: Number(offset), ...page }))
    .sort((left, right) => left.offset - right.offset)
}

/**
 * The last line the loaded pages reach, by the Host's line counts; 0 before the first page.
 * @param pages - the loaded pages, ascending.
 * @returns the 1-based last loaded line.
 */
export function lastLineLoaded(pages: readonly LoadedPage[]): number {
  const last = pages.at(-1)
  return last === undefined ? 0 : last.offset + last.lines - 1
}

/**
 * Scroll the body so one line sits at its top. A line the pages do not hold
 * leaves the body where it is.
 * @param body - the scrolling container; lines are positioned against it.
 * @param line - 1-based line.
 */
export function scrollToLine(body: HTMLElement, line: number): void {
  const row = body.querySelector(`[data-textpreview-line="${line}"]`)
  if (row instanceof HTMLElement) body.scrollTop = row.offsetTop
}

/** Why the viewer will not edit the file on screen. */
export type EditRefusal = 'loading' | 'failed' | 'partial'

/** What entering the editor would start from, or why there is none. */
export type EditScope =
  | { readonly kind: 'refused'; readonly reason: EditRefusal }
  | { readonly kind: 'ready'; readonly text: string; readonly version: string }

/** The one encoder both the reconstruction and its inverse are measured with. */
const UTF8 = new TextEncoder()

/**
 * The file's complete text, as the editor must show it.
 *
 * A page joins its lines with `\n` and drops the terminator of the last one, so
 * a file ending in a newline and one that does not page identically. The page's
 * byte size tells them apart: it is the text's own size plus the one byte a
 * dropped terminator costs. Without a reported size the text stands as read.
 * @param page - the page holding the whole file.
 * @param bytes - the file's byte size, when the Host reported it.
 * @returns the text to edit.
 */
export function fullText(page: TextPage, bytes: number | undefined): string {
  if (bytes === undefined) return page.text
  return bytes === UTF8.encode(page.text).length ? page.text : `${page.text}\n`
}

/**
 * What the editor would start from, or why the viewer will not open one.
 *
 * The editor writes the whole file back, so it opens only on a file this viewer
 * holds whole: one page starting at the first line and reaching the end. A file
 * read in several pages has lines the reader never loaded, and saving the pages
 * they did read would delete them.
 * @param state - the tab's state.
 * @returns the edit's starting point, or the refusal to render.
 */
export function editScope(state: TextTabState): EditScope {
  if (state.failure !== undefined) return { kind: 'refused', reason: 'failed' }
  if (state.loading) return { kind: 'refused', reason: 'loading' }
  const pages = loadedPages(state.pages)
  const only = pages.length === 1 ? pages[0] : undefined
  if (only === undefined || only.offset !== 1 || !state.eof || state.version === undefined) {
    return { kind: 'refused', reason: 'partial' }
  }
  return { kind: 'ready', text: fullText(only, state.bytes), version: state.version }
}

/** The copy each refusal renders. */
const REFUSAL_COPY: Record<EditRefusal, SidebarTextpreviewKey> = {
  loading: 'edit.refused.loading',
  failed: 'edit.refused.failed',
  partial: 'edit.refused.partial',
}

/** The copy a save in flight or a finished one renders; a failure has its own line. */
const SAVE_COPY: Record<'saving' | 'saved', SidebarTextpreviewKey> = {
  saving: 'saving',
  saved: 'saved',
}

/**
 * The text type's body, registered under `sidebar.right.pane.tab` as `text`.
 * @param props - composed slot props.
 * @returns the pages read so far with their controls, or a progress line.
 */
export function TextPreview({
  useTabInfo, sessionId, useResource, useStore, actions, loadPage, reloadPages, save, t,
}: TextPreviewProps): ReactNode {
  const { tab } = useTabInfo()
  const { navigation, signal } = tab
  const meta = useResource<'file'>(tab.contentId)
  const file = useMemo(() => hostFileOf(tab.contentId, sessionId), [tab.contentId, sessionId])
  const state = useStore(s => s.byTab[tab.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  // Every tab of this type is a `file` resource address, so its params are the
  // `file` type's; the union is narrowed on the one field read, not validated.
  const line = navigation.params !== undefined && 'line' in navigation.params ? navigation.params.line : undefined
  const pages = state?.pages
  const loaded = useMemo(() => loadedPages(pages ?? {}), [pages])
  const loadedThrough = lastLineLoaded(loaded)
  const hasPages = loaded.length > 0
  // The editor takes the file body's place, so both body effects below re-run
  // when an edit opens or closes and find the body gone or back.
  const editing = state?.draft !== undefined

  // First mount reads the first page; a body coming back to a tab with pages
  // reads nothing, because the store outlives the body.
  const started = state !== undefined
  useEffect(() => {
    if (!started) loadPage(tab.id, file, 1, signal)
  }, [started, tab.id, file, signal, loadPage])

  // Come back where the reader was once there are pages to scroll: on a remount,
  // and after a reload rebuilt the pages. Keyed on page presence only, so a
  // scroll write never re-lands.
  useEffect(() => {
    const body = bodyRef.current
    if (hasPages && body !== null && state !== undefined) body.scrollTop = state.scrollTop
  }, [hasPages, editing])

  // Answer a navigation once: a line the pages do not reach yet loads the next
  // page (again, until the pages cover it or the file ends); a line they hold
  // is scrolled to and marked. The store remembers the answer, so a remount
  // restores the reader's place instead. While the editor is open there is no
  // body to scroll, so the answer waits for the edit to close.
  useEffect(() => {
    const body = bodyRef.current
    if (state === undefined || body === null || state.revision === navigation.revision) return
    if (line === undefined) {
      actions.navigated(tab.id, navigation.revision)
      return
    }
    if (line > loadedThrough && !state.eof) {
      if (!state.loading && state.failure === undefined) loadPage(tab.id, file, loadedThrough + 1, signal)
      return
    }
    scrollToLine(body, line)
    actions.navigated(tab.id, navigation.revision)
    // Recorded here as well as by the scroll event, so the store holds the
    // landing before any later navigation reads it.
    actions.scrolled(tab.id, body.scrollTop)
  }, [navigation.revision, line, loadedThrough, state?.eof, state?.loading, state?.failure, started, editing])

  // One block per line inside one block per page, so a line has an offset to
  // scroll to and a target can be marked. The trailing newline keeps an empty
  // line one line tall. Memoized so a scroll write's re-render hands React the
  // same elements back.
  const rows = useMemo(() => loaded.map(page => (
    <pre key={page.offset} className={css.page} data-textpreview-page={page.offset}>
      {linesOf(page).map((content, index) => {
        const number = page.offset + index
        const target = number === line
        return (
          <div
            key={number}
            className={clsx(css.line, target && css.lineTarget)}
            data-textpreview-line={number}
            {...target ? { 'data-textpreview-target': number } : {}}
          >
            {content}{'\n'}
          </div>
        )
      })}
    </pre>
  )), [loaded, line])

  if (state === undefined) {
    return (
      <div className={css.status} data-textpreview-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  const next = loadedThrough + 1
  const displayPath = meta.value?.absolutePath ?? file.path
  // Reload does three things at once: stat again through the resource (which
  // clears `changed`, or a failed frame), read the pages again through the
  // face, and drop an edit in progress — the fresh pages are a different file
  // version, so the draft's save would be refused anyway.
  const reload = (): void => { actions.cancelled(tab.id); meta.reload(); reloadPages(tab.id, file, signal) }
  const scope = editScope(state)
  const draft = state.draft
  const saveState = state.save
  const dirty = draft !== undefined && draft.text !== draft.baseline
  return (
    <div className={css.preview} data-textpreview-state="text" data-textpreview-url={tab.contentId}>
      {meta.failure !== undefined
        ? (
          // The file's metadata failed — gone, or its workspace unknown — which
          // outranks a pending change; the pages already read stay under it.
          <p className={css.changed} data-textpreview-meta-failed={meta.failure.code}>
            <span>{failureLine(t, meta.failure)}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )
        : meta.value?.changed === true && (
          <p className={css.changed} data-textpreview-changed>
            <span>{t('changed')}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )}
      <div className={css.header}>
        <div className={css.path} title={displayPath} data-textpreview-path>{displayPath}</div>
        {draft === undefined
          ? (
            <>
              {scope.kind === 'ready' && (
                <button
                  type="button"
                  className={css.action}
                  data-textpreview-tool="edit"
                  onClick={() => { actions.edit(tab.id, scope.text, scope.version) }}
                >
                  {t('edit')}
                </button>
              )}
              <button
                type="button"
                className={clsx(css.tool, state.wrap && css.toolOn)}
                aria-pressed={state.wrap}
                aria-label={t('wrap')}
                title={t('wrap')}
                data-textpreview-tool="wrap"
                onClick={() => { actions.toggledWrap(tab.id) }}
              >
                <IconWrapOutline16 />
              </button>
              <button
                type="button"
                className={css.tool}
                aria-label={t('reload')}
                title={t('reload')}
                data-textpreview-tool="reload"
                onClick={reload}
              >
                <IconRefreshOutline16 />
              </button>
            </>
          )
          : (
            <>
              <button
                type="button"
                className={css.action}
                data-textpreview-tool="save"
                disabled={!dirty || saveState.kind === 'saving'}
                onClick={() => { save(tab.id, file, draft.text, draft.version, signal) }}
              >
                {t('save')}
              </button>
              <button
                type="button"
                className={css.action}
                data-textpreview-tool="cancel"
                onClick={() => { actions.cancelled(tab.id) }}
              >
                {t('cancel')}
              </button>
            </>
          )}
      </div>
      {scope.kind === 'refused' && (
        <p className={css.statusLine} data-textpreview-edit-refused={scope.reason}>
          {t(REFUSAL_COPY[scope.reason])}
        </p>
      )}
      {saveState.kind !== 'idle' && (
        <p className={css.statusLine} data-textpreview-save={saveState.kind}>
          <span>
            {saveState.kind === 'failed' ? saveFailureLine(t, saveState.failure) : t(SAVE_COPY[saveState.kind])}
          </span>
          {saveState.kind === 'failed' && saveState.failure.code === 'workspace-file/stale-version' && (
            <button
              type="button"
              className={css.action}
              data-textpreview-save-reload
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          )}
        </p>
      )}
      {draft !== undefined
        ? (
          <textarea
            className={css.editor}
            aria-label={t('editor')}
            spellCheck={false}
            data-textpreview-editor
            value={draft.text}
            onChange={(event) => { actions.edited(tab.id, event.currentTarget.value) }}
          />
        )
        : (
          <div
            ref={bodyRef}
            className={clsx(css.body, state.wrap && css.wrap)}
            data-textpreview-body
            data-textpreview-wrap={state.wrap ? '' : undefined}
            onScroll={(event) => { actions.scrolled(tab.id, event.currentTarget.scrollTop) }}
          >
            {rows}
            {state.failure !== undefined && (
              <p className={css.statusLine} data-textpreview-failed={state.failure.code}>
                <span>{failureLine(t, state.failure)}</span>
                <button
                  type="button"
                  className={css.action}
                  data-textpreview-retry
                  onClick={() => { loadPage(tab.id, file, next, signal) }}
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {!state.eof && state.failure === undefined && (
              <button
                type="button"
                className={css.more}
                disabled={state.loading}
                data-textpreview-more
                onClick={() => { loadPage(tab.id, file, next, signal) }}
              >
                {state.loading ? t('loading') : t('loadMore')}
              </button>
            )}
          </div>
        )}
    </div>
  )
}

/**
 * The panel's body: the shells one session holds, and the text they printed.
 *
 * Everything the panel keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component itself decides what to
 * draw for each state — connecting, refused, failed, or the shells themselves —
 * and holds exactly one piece of state of its own: the line being typed.
 *
 * Two lines of copy in the ready state are the panel's honesty rather than
 * chrome: this is sanitized text, not a terminal, and it is the person's
 * channel, not the model's.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutline16, IconCodeOutline16, IconPlusOutline16, IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalConsoleShell } from '@deepseek-ai/dsh-api-terminal-console/types'
import type { TerminalInjected } from './face.ts'
import type {} from './locales.ts'
import type { TerminalReadyState, createTerminalStore } from './store.ts'
import css from './TerminalBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type TerminalBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createTerminalStore>>
  & TerminalInjected
  & PropsLocale<'sidebarTerminal'>

/**
 * Say why the console could not be reached, or why one shell's stream stopped.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the shell.
 */
export function failureLine(t: TranslateNS<'sidebarTerminal'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'terminal-console/unavailable': return t('error.unavailable', { message: failure.message })
    case 'terminal-console/busy': return t('error.busy', { message: failure.message })
    case 'terminal-console/limit': return t('error.limit', { message: failure.message })
    case 'terminal-console/unknown-shell': return t('error.unknownShell', { message: failure.message })
    default:
      // Refusals the panel draws as their own state, and carrier faults this
      // panel knows nothing useful to add to, reach the reader as themselves.
      return t('error.failed', { message: failure.message })
  }
}

/**
 * One shell's chip label.
 * @param t - namespace-bound translate.
 * @param shell - the shell the chip names.
 * @returns the label, numbered from the server's mint index rather than from position.
 */
function shellLabel(t: TranslateNS<'sidebarTerminal'>, shell: TerminalConsoleShell): string {
  return t('shell', { index: shell.index })
}

/** The shell chips, the mint control, and the close control for what is on screen. */
function ShellBar({
  state, t, onSelect, onOpen, onClose,
}: {
  state: TerminalReadyState
  t: TranslateNS<'sidebarTerminal'>
  onSelect: (shellId: string) => void
  onOpen: () => void
  onClose: (shellId: string) => void
}): ReactNode {
  const active = state.shells.find(shell => shell.shellId === state.active)
  return (
    <div className={css.bar} data-terminal-bar>
      <div className={css.chips}>
        {state.shells.map(shell => (
          <button
            key={shell.shellId}
            type="button"
            className={shell.shellId === state.active ? css.chipCurrent : css.chip}
            aria-pressed={shell.shellId === state.active}
            data-terminal-chip={shell.shellId}
            onClick={() => { onSelect(shell.shellId) }}
          >
            {shellLabel(t, shell)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={css.tool}
        aria-label={t('newShell')}
        data-terminal-action="new"
        onClick={onOpen}
      >
        <IconPlusOutline16 />
      </button>
      {active !== undefined && state.ended[active.shellId] !== true && (
        <button
          type="button"
          className={css.tool}
          aria-label={t('closeShell')}
          data-terminal-action="close"
          onClick={() => { onClose(active.shellId) }}
        >
          <IconCloseOutline16 />
        </button>
      )}
    </div>
  )
}

/** The console's text: one scrollback window, kept at its newest line. */
function Scrollback({ text, t }: { text: string; t: TranslateNS<'sidebarTerminal'> }): ReactNode {
  const view = useRef<HTMLPreElement>(null)
  useEffect(() => {
    /* v8 ignore next -- the effect runs only while the ref'd <pre> is mounted, so the ref is attached. */
    if (view.current !== null) view.current.scrollTop = view.current.scrollHeight
  }, [text])
  return (
    <pre ref={view} className={css.output} data-terminal-output aria-label={t('output')} tabIndex={0}>
      {text}
    </pre>
  )
}

/** The input row: one line, submitted with Enter or the run control. */
function CommandLine({
  shellId, state, t, onSend,
}: {
  shellId: string
  state: TerminalReadyState
  t: TranslateNS<'sidebarTerminal'>
  onSend: (shellId: string, text: string) => void
}): ReactNode {
  const [draft, setDraft] = useState('')
  const disabled = state.ended[shellId] === true || state.busy
  const submit = (): void => {
    if (disabled || draft === '') return
    onSend(shellId, draft)
    setDraft('')
  }
  return (
    <form
      className={css.input}
      data-terminal-input
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <input
        className={css.field}
        type="text"
        value={draft}
        placeholder={t('placeholder')}
        aria-label={t('command')}
        disabled={disabled}
        onChange={(event) => { setDraft(event.target.value) }}
      />
      <button type="submit" className={css.tool} aria-label={t('run')} disabled={disabled}>
        <IconSendOutline16 />
      </button>
    </form>
  )
}

/** The shell on screen: its text, whatever it has to say, and its input row. */
function ActiveShell({
  shellId, state, t, onSend,
}: {
  shellId: string
  state: TerminalReadyState
  t: TranslateNS<'sidebarTerminal'>
  onSend: (shellId: string, text: string) => void
}): ReactNode {
  const failure = state.failures[shellId]
  const ended = state.ended[shellId] === true
  return (
    <>
      <Scrollback text={state.output[shellId] ?? ''} t={t} />
      {failure !== undefined && (
        <p className={css.note} data-terminal-failure={failure.code}>{failureLine(t, failure)}</p>
      )}
      {failure === undefined && ended && <p className={css.note} data-terminal-ended>{t('ended')}</p>}
      {state.busy && <p className={css.note} data-terminal-busy>{t('busy')}</p>}
      <CommandLine state={state} shellId={shellId} t={t} onSend={onSend} />
    </>
  )
}

/** The ready panel: the shell bar, the console's text, the notes, and the input row. */
function Console({
  state, t, onSelect, onOpen, onClose, onSend,
}: {
  state: TerminalReadyState
  t: TranslateNS<'sidebarTerminal'>
  onSelect: (shellId: string) => void
  onOpen: () => void
  onClose: (shellId: string) => void
  onSend: (shellId: string, text: string) => void
}): ReactNode {
  const active = state.active
  return (
    <div className={css.root} data-terminal-state="ready">
      <ShellBar state={state} t={t} onSelect={onSelect} onOpen={onOpen} onClose={onClose} />
      {active === undefined
        ? <p className={css.note} data-terminal-empty>{t('empty')}</p>
        : <ActiveShell shellId={active} state={state} t={t} onSend={onSend} />}
      <p className={css.disclaimer} data-terminal-disclaimer="text">{t('notTerminal')}</p>
      <p className={css.disclaimer} data-terminal-disclaimer="model">{t('notModel')}</p>
    </div>
  )
}

/** The panel's body: one tab's console, drawn for whichever state it settled in. */
export function TerminalBody({
  useTabInfo, useStore, start, openShell, closeShell, selectShell, send, t,
}: TerminalBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const state = useStore(store => store.byTab[tab.id])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || signal.aborted) return
    start(tab.id, signal)
  }, [state, tab.id, signal, start])

  if (state === undefined || state.kind === 'loading') {
    return (
      <div className={css.status} data-terminal-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.kind === 'refused') {
    return (
      <div className={css.status} data-terminal-state="refused" data-terminal-code={state.failure.code}>
        <IconCodeOutline16 />
        <p className={css.statusLine}>{t('error.refused')}</p>
      </div>
    )
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.status} data-terminal-state="failed" data-terminal-code={state.failure.code}>
        <p className={css.statusLine}>{failureLine(t, state.failure)}</p>
      </div>
    )
  }
  return (
    <Console
      state={state}
      t={t}
      onSelect={(shellId) => { selectShell(tab.id, shellId) }}
      onOpen={() => { openShell(tab.id, signal) }}
      onClose={(shellId) => { closeShell(tab.id, signal, shellId) }}
      onSend={(shellId, text) => { send(tab.id, signal, shellId, text) }}
    />
  )
}

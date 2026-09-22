/**
 * The panel's body: every remote resource source this Host serves, with its
 * configuration state, its capabilities, its credentials by reference name, the
 * settings form its own schema declares, and the limits it enforces.
 *
 * Everything the panel keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component renders one control per
 * row the descriptor's schema declares, so a source kind this package has never
 * heard of still gets a form rather than a blank card.
 *
 * Three facts are stated rather than implied. The credential list names
 * reference names and never values, because a value never rides the wire. A
 * field the panel cannot edit is drawn as the value it holds, not as a control
 * that would quietly write nothing. And the sources this design deliberately
 * does not build are listed with their reasons, without a control for any of
 * them, because a control that cannot work is worse than no control.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RemoteFailure, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SourceCapabilities, SourceCredentialView, SourceState } from '@deepseek-ai/dsh-api-sources/types'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SourcesInjected } from './face.ts'
import { draftValue, formWrites, type FieldDraft, type FormField } from './form.ts'
import type { SidebarSourcesKey } from './locales.ts'
import type {} from './locales.ts'
import type { SourceEntry, SourceSettingsState, createSourcesStore } from './store.ts'
import css from './SourcesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type SourcesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createSourcesStore>>
  & SourcesInjected
  & PropsLocale<'sidebarSources'>

/**
 * Say why a source operation failed.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @param kind - the source kind the call named.
 * @returns the line to show in place of the card's controls.
 */
export function failureLine(t: TranslateNS<'sidebarSources'>, failure: RemoteFailure, kind: string): string {
  if (failure.code === 'sources/unknown') return t('error.unknown', { kind })
  // Every other code — a refused probe and a carrier fault alike — reaches the
  // reader as the Host's own message.
  return t('error.failed', { message: failure.message })
}

/**
 * One source kind's name, in the reader's language where this build names it.
 * @param t - namespace-bound translate.
 * @param kind - the kind the Host registered.
 * @returns the label; a kind this build does not know stays verbatim.
 */
function kindLabel(t: TranslateNS<'sidebarSources'>, kind: string): string {
  if (kind === 'github') return t('kind.github')
  if (kind === 'mysql') return t('kind.mysql')
  if (kind === 'mediawiki') return t('kind.mediawiki')
  return kind
}

/**
 * One configuration state's word and dot.
 * @param t - namespace-bound translate.
 * @param state - the state the Host derived.
 * @returns the label to show and the dot that goes with it.
 */
function stateOf(t: TranslateNS<'sidebarSources'>, state: SourceState): { readonly label: string; readonly dot: StateDotState } {
  if (state === 'usable') return { label: t('state.usable'), dot: 'done' }
  if (state === 'unusable') return { label: t('state.unusable'), dot: 'error' }
  if (state === 'unchecked') return { label: t('state.unchecked'), dot: 'warning' }
  return { label: t('state.unconfigured'), dot: 'idle' }
}

/**
 * The capability facts worth stating, so the reader knows what this source can
 * be asked for before anything is configured.
 * @param t - namespace-bound translate.
 * @param capabilities - what the provider declared.
 * @returns one line per capability the provider claims, and its two bounds.
 */
function capabilityLines(t: TranslateNS<'sidebarSources'>, capabilities: SourceCapabilities): readonly string[] {
  const lines: string[] = []
  if (capabilities.search) lines.push(t('capabilities.search'))
  if (capabilities.browse) lines.push(t('capabilities.browse'))
  if (capabilities.read) lines.push(t('capabilities.read'))
  lines.push(t('capabilities.maxReadBytes', { value: String(capabilities.maxReadBytes) }))
  lines.push(t('capabilities.maxListItems', { value: String(capabilities.maxListItems) }))
  return lines
}

/**
 * The hard limits one source kind enforces.
 *
 * A limit belongs to the provider that enforces it, so a kind this build does
 * not name is reported as the provider's own statement rather than given a limit
 * the panel cannot substantiate. That statement is model-facing text carried
 * verbatim from the wire, which is the only truthful wording available for a
 * kind whose limits this build has no copy for.
 * @param t - namespace-bound translate.
 * @param kind - the source kind.
 * @param description - the provider's own statement of what the kind answers.
 * @returns one line per limit this build can state.
 */
function limitLines(t: TranslateNS<'sidebarSources'>, kind: string, description: string): readonly string[] {
  if (kind === 'github') return [t('limits.github')]
  if (kind === 'mysql') return [t('limits.mysql')]
  if (kind === 'mediawiki') return [t('limits.mediawiki')]
  return description.length === 0 ? [t('limits.other')] : [description]
}

/** One credential reference: its name, whether it resolves, and where it comes from. */
function CredentialRow({
  credential, t,
}: {
  credential: SourceCredentialView
  t: TranslateNS<'sidebarSources'>
}): ReactNode {
  return (
    <li className={css.credential} data-sources-credential={credential.field} data-sources-configured={String(credential.configured)}>
      <span className={css.fieldName}>{credential.field}</span>
      <code className={css.token}>{credential.ref}</code>
      <span className={css.badge}>
        {credential.configured ? t('credentials.configured') : t('credentials.unset')}
      </span>
      {credential.source === undefined ? null : <span className={css.note}>{t('credentials.source', { source: credential.source })}</span>}
      {credential.writable ? null : <span className={css.note}>{t('credentials.readonly')}</span>}
    </li>
  )
}

/**
 * The one control a settings row renders.
 *
 * A row the panel cannot edit is drawn as the value it holds, so a schema this
 * build does not understand still shows what it declares instead of offering a
 * control that would write nothing.
 */
function FieldControl({
  field, text, invalid, label, onEdit,
}: {
  field: FormField
  text: string
  invalid: boolean
  label: string
  onEdit: (text: string) => void
}): ReactNode {
  if (field.control === 'boolean') {
    return <Switch checked={text === 'true'} label={label} onChange={(next) => { onEdit(next ? 'true' : 'false') }} />
  }
  if (field.control === 'select') {
    // A section whose value is not one of the declared choices keeps showing
    // it, so the control never silently displays a choice the Host did not make.
    const choices = field.choices.includes(text) ? field.choices : [text, ...field.choices]
    return (
      <select className={css.field} value={text} aria-label={label} onChange={(event) => { onEdit(event.target.value) }}>
        {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    )
  }
  if (field.control === 'readonly') {
    return <code className={css.token}>{field.value === undefined ? '' : JSON.stringify(field.value)}</code>
  }
  return (
    <input
      className={css.field}
      type={field.control === 'number' ? 'number' : 'text'}
      value={text}
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => { onEdit(event.target.value) }}
    />
  )
}

/** One settings row: its name, its control, its layer, and its reset control. */
function FieldRow({
  field, draft, credential, t, onEdit, onReset,
}: {
  field: FormField
  draft: FieldDraft | undefined
  credential: boolean
  t: TranslateNS<'sidebarSources'>
  onEdit: (text: string) => void
  onReset: () => void
}): ReactNode {
  const cleared = draft?.clear === true
  // A cleared field shows what it falls back to, so the control previews the
  // document a save would leave rather than the value being removed.
  const shown = draft === undefined ? field.text : cleared ? field.clearedText : draft.text
  const invalid = draft !== undefined && !cleared && draftValue(field.control, field.choices, draft.text) === undefined
  const label = credential ? `${field.name} — ${t('settings.credentialHint')}` : field.name
  return (
    <div className={css.fieldRow} data-sources-field={field.name} data-sources-layer={field.layer}>
      <span className={css.fieldName}>{field.name}</span>
      <FieldControl field={field} text={shown} invalid={invalid} label={label} onEdit={onEdit} />
      <span className={css.badge} data-sources-field-state={field.layer}>{t(layerKey(field.layer))}</span>
      <button
        type="button"
        className={css.reset}
        aria-label={t('settings.resetField', { field: field.name })}
        data-sources-field-reset={field.name}
        disabled={field.layer !== 'user'}
        onClick={onReset}
      >
        {t('settings.discard')}
      </button>
      {field.control === 'readonly' && <span className={css.note}>{t('settings.unsupported')}</span>}
    </div>
  )
}

/**
 * One layer's dictionary key.
 * @param layer - the layer that supplies a field's value.
 * @returns the key naming that layer.
 */
function layerKey(layer: FormField['layer']): SidebarSourcesKey {
  if (layer === 'user') return 'layer.user'
  if (layer === 'base') return 'layer.base'
  return 'layer.default'
}

/** One source's settings form, rendered from the descriptor its namespace published. */
function SettingsForm({
  form, credentials, sourceKey, t, onEdit, onReset, onSave, onDiscard,
}: {
  form: SourceSettingsState
  credentials: readonly SourceCredentialView[]
  sourceKey: string
  t: TranslateNS<'sidebarSources'>
  onEdit: (field: string, text: string) => void
  onReset: (field: string) => void
  onSave: (ops: readonly SettingsPathOpView[]) => void
  onDiscard: () => void
}): ReactNode {
  if (form.status !== 'ready') {
    return (
      <p className={css.note} data-sources-settings-state={form.status}>
        {form.status === 'loading' ? t('settings.loading') : t('settings.unavailable')}
      </p>
    )
  }
  const ops = formWrites(form.fields, form.drafts)
  const credentialFields = new Set(credentials.map(credential => credential.field))
  const dirty = Object.keys(form.drafts).length > 0
  // The handler exists only when there is something storable to send, so the
  // control's disabled state and its click cannot disagree.
  const send = ops === undefined || ops.length === 0 || !form.writable || form.saving
    ? undefined
    : () => { onSave(ops) }
  return (
    <div className={css.form} data-sources-settings-state="ready">
      {form.fields.map(field => (
        <FieldRow
          key={field.name}
          field={field}
          draft={form.drafts[field.name]}
          credential={credentialFields.has(field.name)}
          t={t}
          onEdit={(text) => { onEdit(field.name, text) }}
          onReset={() => { onReset(field.name) }}
        />
      ))}
      <div className={css.formActions}>
        <button
          type="button"
          className={css.action}
          data-sources-save={sourceKey}
          disabled={send === undefined}
          onClick={send}
        >
          {form.saving ? t('settings.saving') : t('settings.save')}
        </button>
        <button
          type="button"
          className={css.action}
          data-sources-discard={sourceKey}
          disabled={!dirty || form.saving}
          onClick={onDiscard}
        >
          {t('settings.discard')}
        </button>
        {dirty && <span className={css.note} data-sources-dirty>{t('settings.dirty')}</span>}
        {form.failed && <span className={css.note} data-sources-save-failed>{t('settings.failed')}</span>}
        {form.writable ? null : <span className={css.note} data-sources-settings-readonly>{t('settings.readonly')}</span>}
      </div>
    </div>
  )
}

/** The keys of the sources this design deliberately does not build, in the order it records them. */
const ABSENT_SOURCES: readonly SidebarSourcesKey[] = [
  'absent.360', 'absent.netease', 'absent.quark', 'absent.baidu', 'absent.360ai',
]

/**
 * The explanatory block below the list: which sources are deliberately not
 * built and why, with no control for any of them.
 */
function AbsentSources({ t }: { t: TranslateNS<'sidebarSources'> }): ReactNode {
  return (
    <details className={css.explanation} data-sources-absent>
      <summary className={css.summary}>{t('absent.title')}</summary>
      <p className={css.note}>{t('absent.note')}</p>
      <ul className={css.limitList}>
        {ABSENT_SOURCES.map(key => <li key={key} className={css.note}>{t(key)}</li>)}
      </ul>
      <p className={css.note}>{t('absent.alternatives')}</p>
    </details>
  )
}

/** One source's card: its state, its controls, its credentials, its form, and its limits. */
function SourceCard({
  entry, probing, t, onProbe, onEdit, onReset, onSave, onDiscard,
}: {
  entry: SourceEntry
  probing: boolean
  t: TranslateNS<'sidebarSources'>
  onProbe: () => void
  onEdit: (field: string, text: string) => void
  onReset: (field: string) => void
  onSave: (ops: readonly SettingsPathOpView[]) => void
  onDiscard: () => void
}): ReactNode {
  const { view, probe, failure } = entry
  const state = stateOf(t, view.state)
  return (
    <section className={css.card} data-sources-card={view.key} data-sources-kind={view.kind} data-sources-state={view.state}>
      <header className={css.cardHead}>
        <StateDot state={state.dot} />
        <span className={css.sourceName}>{kindLabel(t, view.kind)}</span>
        <span className={css.note} data-sources-instance>{view.id}</span>
        <span className={css.badge} data-sources-state-label>{state.label}</span>
        <button type="button" className={css.action} data-sources-action="probe" disabled={probing} onClick={onProbe}>
          {t('probe')}
        </button>
      </header>
      {view.lastError === undefined
        ? null
        : <p className={css.note} data-sources-last-error>{t('lastError', { message: view.lastError })}</p>}
      {failure === undefined
        ? null
        : <p className={css.note} data-sources-failure={failure.code}>{failureLine(t, failure, view.kind)}</p>}
      {probe === undefined ? null : (
        <div className={css.note} data-sources-probe={probe.ok ? 'ok' : 'failed'}>
          {probe.ok ? <p>{t('probe.ok')}</p> : <p>{t('probe.failed', { message: probe.message ?? '' })}</p>}
        </div>
      )}
      <p className={css.note} data-sources-capabilities>
        <span className={css.fieldName}>{t('capabilities.title')}</span>
        {' '}
        {capabilityLines(t, view.capabilities).join(' · ')}
      </p>
      <div className={css.credentials} data-sources-credentials>
        <span className={css.fieldName}>{t('credentials.title')}</span>
        <ul className={css.credentialList}>
          {view.credentials.map(credential => <CredentialRow key={credential.field} t={t} credential={credential} />)}
        </ul>
        <span className={css.note} data-sources-credentials-note>{t('credentials.note')}</span>
      </div>
      <div className={css.settings} data-sources-settings={view.namespace}>
        <span className={css.fieldName}>{t('settings.title')}</span>
        <SettingsForm
          form={entry.form}
          credentials={view.credentials}
          sourceKey={view.key}
          t={t}
          onEdit={onEdit}
          onReset={onReset}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      </div>
      <details className={css.explanation} data-sources-limits={view.kind}>
        <summary className={css.summary}>{t('limits.title')}</summary>
        <ul className={css.limitList}>
          {limitLines(t, view.kind, view.capabilities.description).map(line => <li key={line} className={css.note}>{line}</li>)}
        </ul>
      </details>
    </section>
  )
}

/** The panel's body: one tab's source list, drawn for whichever state it settled in. */
export function SourcesBody({
  useTabInfo, useStore, actions, start, reload, probe, save, t,
}: SourcesBodyProps): ReactNode {
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
      <div className={css.status} data-sources-panel-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.status} data-sources-panel-state="failed" data-sources-code={state.failure.code}>
        <p className={css.statusLine}>{t('error.failed', { message: state.failure.message })}</p>
      </div>
    )
  }
  return (
    <div className={css.root} data-sources-panel-state="ready">
      <div className={css.head}>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          data-sources-reload
          onClick={() => { reload(tab.id, signal) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      {state.sources.length === 0
        ? <p className={css.note} data-sources-empty>{t('empty')}</p>
        : state.sources.map(entry => (
          <SourceCard
            key={entry.view.key}
            entry={entry}
            probing={state.probing === entry.view.key}
            t={t}
            onProbe={() => { probe(tab.id, signal, entry.view.key) }}
            onEdit={(field, text) => { actions.edited(tab.id, entry.view.key, field, { text, clear: false }) }}
            onReset={(field) => { actions.edited(tab.id, entry.view.key, field, { text: '', clear: true }) }}
            onSave={(ops) => { save(tab.id, signal, entry.view.key, ops) }}
            onDiscard={() => { actions.discard(tab.id, entry.view.key) }}
          />
        ))}
      <AbsentSources t={t} />
    </div>
  )
}

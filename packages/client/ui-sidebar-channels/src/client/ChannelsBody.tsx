/**
 * The panel's body: every chat channel this Host serves, with its connection
 * state, its credentials by reference name, and the settings form its own
 * schema declares.
 *
 * Everything the panel keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component renders one control
 * per field the descriptor's schema declares, so a channel this package has
 * never heard of still gets a form rather than a blank card.
 *
 * Two facts are stated rather than implied: the credential list names reference
 * names and never values, because a value never rides the wire; and a field the
 * panel cannot edit is drawn as the value it holds, not as a control that would
 * quietly write nothing.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RemoteFailure, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChannelCredentialView } from '@deepseek-ai/dsh-api-channels/types'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChannelsInjected } from './face.ts'
import {
  fieldLayer, fieldText, fieldValue, fieldWrites, layerValue, secretSlots,
  type FieldDraft, type FieldLayer, type SchemaField,
} from './schema-form.ts'
import type { SidebarChannelsKey } from './locales.ts'
import type {} from './locales.ts'
import type { ChannelEntry, ChannelSettingsState, createChannelsStore } from './store.ts'
import css from './ChannelsBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type ChannelsBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createChannelsStore>>
  & ChannelsInjected
  & PropsLocale<'sidebarChannels'>

/**
 * Say why a channel operation failed.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @param channel - the channel the call named.
 * @returns the line to show in place of the card's controls.
 */
export function failureLine(t: TranslateNS<'sidebarChannels'>, failure: RemoteFailure, channel: string): string {
  if (failure.code === 'channels/unknown') return t('error.unknown', { channel })
  // Every other code — a refused change and a carrier fault alike — reaches
  // the reader as the Host's own message.
  return t('error.failed', { message: failure.message })
}

/**
 * One channel's name, in the reader's language where this build names it.
 * @param t - namespace-bound translate.
 * @param channel - the channel id the Host registered.
 * @returns the label; an id this build does not know stays verbatim.
 */
function channelLabel(t: TranslateNS<'sidebarChannels'>, channel: string): string {
  return channel === 'tuitui' ? t('channel.tuitui') : channel
}

/** One connection state's word and dot. */
function connectionOf(
  t: TranslateNS<'sidebarChannels'>,
  connection: ChannelEntry['view']['connection'],
): { readonly label: string; readonly dot: StateDotState } {
  if (connection === 'connected') return { label: t('state.connected'), dot: 'done' }
  if (connection === 'connecting') return { label: t('state.connecting'), dot: 'ongoing' }
  if (connection === 'failed') return { label: t('state.failed'), dot: 'error' }
  return { label: t('state.stopped'), dot: 'idle' }
}

/**
 * The platform facts worth stating: what the connector says it carries, and the
 * caps it enforces.
 * @param t - namespace-bound translate.
 * @param entry - the channel whose capabilities are listed.
 * @returns one line per fact the connector declared.
 */
function capabilityLines(t: TranslateNS<'sidebarChannels'>, entry: ChannelEntry): readonly string[] {
  const declared: readonly (readonly [boolean, SidebarChannelsKey])[] = [
    [entry.view.capabilities.quoting, 'capabilities.quoting'],
    [entry.view.capabilities.inbound.images, 'capabilities.inboundImages'],
    [entry.view.capabilities.inbound.files, 'capabilities.inboundFiles'],
    [entry.view.capabilities.outbound.images, 'capabilities.outboundImages'],
    [entry.view.capabilities.outbound.files, 'capabilities.outboundFiles'],
    [entry.view.capabilities.markdown, 'capabilities.markdown'],
  ]
  const lines = declared.flatMap(([holds, key]) => holds ? [t(key)] : [])
  const caps: readonly (readonly [number | undefined, SidebarChannelsKey])[] = [
    [entry.view.capabilities.maxTextChars, 'capabilities.maxText'],
    [entry.view.capabilities.maxInboundBytes, 'capabilities.maxInbound'],
    [entry.view.capabilities.maxOutboundBytes, 'capabilities.maxOutbound'],
  ]
  for (const [value, key] of caps) if (value !== undefined) lines.push(t(key, { value }))
  return lines
}

/** The dictionary key naming one provenance layer. */
function layerKey(layer: FieldLayer): SidebarChannelsKey {
  if (layer === 'user') return 'layer.user'
  if (layer === 'base') return 'layer.base'
  return 'layer.default'
}

/** One credential reference: its field, its name, and whether it resolves. */
function CredentialRow({
  t, credential,
}: {
  t: TranslateNS<'sidebarChannels'>
  credential: ChannelCredentialView
}): ReactNode {
  return (
    <li
      className={css.credential}
      data-channels-credential={credential.field}
      data-channels-credential-state={credential.configured ? 'configured' : 'unset'}
    >
      <code className={css.token}>{credential.field}</code>
      {credential.ref === '' ? null : <code className={css.token}>{credential.ref}</code>}
      <span className={css.badge}>{credential.configured ? t('credentials.configured') : t('credentials.unset')}</span>
      {credential.source === undefined ? null : <span className={css.note}>{t('credentials.source', { source: credential.source })}</span>}
      {credential.writable ? null : <span className={css.note}>{t('credentials.readonly')}</span>}
    </li>
  )
}

/**
 * The one control a settings field renders.
 *
 * A field the panel cannot edit is drawn as the value it holds, and a secret
 * slot — whose value never rides the wire — as a write-only box. Neither
 * becomes an editable control that would quietly write nothing.
 */
function FieldControl({
  field, secret, text, value, invalid, label, t, onEdit,
}: {
  field: SchemaField
  secret: boolean
  text: string
  value: unknown
  invalid: boolean
  label: string
  t: TranslateNS<'sidebarChannels'>
  onEdit: (text: string) => void
}): ReactNode {
  if (secret) {
    return (
      <input
        className={css.field}
        type="password"
        value={text}
        placeholder={t('settings.secretUnset')}
        aria-label={label}
        onChange={(event) => { onEdit(event.target.value) }}
      />
    )
  }
  if (field.kind === 'boolean') {
    return <Switch checked={text === 'true'} label={label} onChange={(next) => { onEdit(next ? 'true' : 'false') }} />
  }
  if (field.kind === 'select') {
    // A section whose value is not one of the declared choices keeps showing
    // it, so the control never silently displays a choice the Host did not make.
    const options = field.options.includes(text) ? field.options : [text, ...field.options]
    return (
      <select className={css.field} value={text} aria-label={label} onChange={(event) => { onEdit(event.target.value) }}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  if (field.kind === 'readonly') {
    return <code className={css.token}>{value === undefined ? '' : JSON.stringify(value)}</code>
  }
  return (
    <input
      className={css.field}
      type={field.kind === 'number' ? 'number' : 'text'}
      value={text}
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => { onEdit(event.target.value) }}
    />
  )
}

/** One field's row: its name, its control, its layer, and its reset control. */
function FieldRow({
  field, secret, configured, draft, value, user, base, credential, t, onEdit, onReset,
}: {
  field: SchemaField
  secret: boolean
  configured: boolean
  draft: FieldDraft | undefined
  value: unknown
  user: unknown
  base: unknown
  credential: boolean
  t: TranslateNS<'sidebarChannels'>
  onEdit: (text: string) => void
  onReset: () => void
}): ReactNode {
  const cleared = draft?.clear === true
  // A cleared field shows what it falls back to, so the control previews the
  // document a save would leave rather than the value being removed.
  const shown = draft !== undefined && !cleared
    ? draft.text
    : fieldText(field, cleared ? fallbackValue(field, base) : value)
  const invalid = draft !== undefined && !cleared && fieldValue(field, draft.text) === undefined
  const layer = fieldLayer(user, base, field.name)
  const label = credential ? `${field.name} — ${t('settings.credentialHint')}` : field.name
  return (
    <div
      className={css.fieldRow}
      data-channels-field={field.name}
      data-channels-layer={secret ? undefined : layer}
    >
      <span className={css.fieldName}>{field.name}</span>
      <FieldControl
        field={field}
        secret={secret}
        text={shown}
        value={value}
        invalid={invalid}
        label={label}
        t={t}
        onEdit={onEdit}
      />
      <span className={css.badge} data-channels-field-state={secret ? (configured ? 'set' : 'unset') : layer}>
        {secret ? (configured ? t('settings.secretSet') : t('settings.secretUnset')) : t(layerKey(layer))}
      </span>
      {secret
        ? <span className={css.note}>{t('settings.secretNote')}</span>
        : (
          <button
            type="button"
            className={css.reset}
            aria-label={t('settings.resetField', { field: field.name })}
            data-channels-field-reset={field.name}
            disabled={layer !== 'user'}
            onClick={onReset}
          >
            {t('settings.discard')}
          </button>
        )}
      {field.kind === 'readonly' && <span className={css.note}>{t('settings.unsupported')}</span>}
    </div>
  )
}

/** The value one cleared field falls back to: the composition base, then the schema default. */
function fallbackValue(field: SchemaField, base: unknown): unknown {
  return fieldLayer(undefined, base, field.name) === 'base' ? layerValue(base, field.name) : field.fallback
}

/** One channel's settings form, rendered from the descriptor its namespace published. */
function SettingsForm({
  form, credentials, channel, t, onEdit, onReset, onSave, onDiscard,
}: {
  form: ChannelSettingsState
  credentials: readonly ChannelCredentialView[]
  channel: string
  t: TranslateNS<'sidebarChannels'>
  onEdit: (field: string, text: string) => void
  onReset: (field: string) => void
  onSave: (ops: readonly SettingsPathOpView[]) => void
  onDiscard: () => void
}): ReactNode {
  if (form.status !== 'ready') {
    return (
      <p className={css.note} data-channels-settings-state={form.status}>
        {form.status === 'loading' ? t('settings.loading') : t('settings.unavailable')}
      </p>
    )
  }
  const secrets = secretSlots(form.view.secrets)
  const ops = fieldWrites(form.fields, secrets, form.drafts, form.view)
  const credentialFields = new Set(credentials.map(credential => credential.field))
  const dirty = Object.keys(form.drafts).length > 0
  // The handler exists only when there is something storable to send, so the
  // control's disabled state and its click cannot disagree.
  const send = ops === undefined || ops.length === 0 || !form.writable || form.saving
    ? undefined
    : () => { onSave(ops) }
  return (
    <div className={css.form} data-channels-settings-state="ready">
      {form.fields.map(field => (
        <FieldRow
          key={field.name}
          field={field}
          secret={secrets.has(field.name)}
          configured={secrets.get(field.name) === true}
          draft={form.drafts[field.name]}
          value={layerValue(form.view.value, field.name)}
          user={form.view.user}
          base={form.view.base}
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
          data-channels-save={channel}
          disabled={send === undefined}
          onClick={send}
        >
          {form.saving ? t('settings.saving') : t('settings.save')}
        </button>
        <button
          type="button"
          className={css.action}
          data-channels-discard={channel}
          disabled={!dirty || form.saving}
          onClick={onDiscard}
        >
          {t('settings.discard')}
        </button>
        {dirty && <span className={css.note} data-channels-dirty>{t('settings.dirty')}</span>}
        {form.failed && <span className={css.note} data-channels-save-failed>{t('settings.failed')}</span>}
        {form.writable ? null : <span className={css.note} data-channels-settings-readonly>{t('settings.readonly')}</span>}
      </div>
    </div>
  )
}

/** One channel's card: its state, its controls, its credentials, and its form. */
function ChannelCard({
  entry, busy, t, onEnable, onDisable, onProbe, onEdit, onReset, onSave, onDiscard,
}: {
  entry: ChannelEntry
  busy: boolean
  t: TranslateNS<'sidebarChannels'>
  onEnable: () => void
  onDisable: () => void
  onProbe: () => void
  onEdit: (field: string, text: string) => void
  onReset: (field: string) => void
  onSave: (ops: readonly SettingsPathOpView[]) => void
  onDiscard: () => void
}): ReactNode {
  const { view, probe, failure } = entry
  const connection = connectionOf(t, view.connection)
  const capabilities = capabilityLines(t, entry)
  return (
    <section className={css.card} data-channels-card={view.channel} data-channels-connection={view.connection}>
      <header className={css.cardHead}>
        <StateDot state={connection.dot} />
        <span className={css.channelName}>{channelLabel(t, view.channel)}</span>
        <span className={css.badge} data-channels-connection-label>{connection.label}</span>
        <button
          type="button"
          className={css.action}
          data-channels-action={view.enabled ? 'disable' : 'enable'}
          disabled={busy}
          onClick={view.enabled ? onDisable : onEnable}
        >
          {view.enabled ? t('disable') : t('enable')}
        </button>
        <button type="button" className={css.action} data-channels-action="probe" disabled={busy} onClick={onProbe}>
          {t('probe')}
        </button>
      </header>
      {view.sessionId === '' ? null : <p className={css.note} data-channels-bound>{t('bound', { sessionId: view.sessionId })}</p>}
      {view.lastError === undefined
        ? null
        : <p className={css.note} data-channels-last-error>{t('lastError', { message: view.lastError })}</p>}
      {failure === undefined
        ? null
        : <p className={css.note} data-channels-failure={failure.code}>{failureLine(t, failure, view.channel)}</p>}
      {probe === undefined ? null : (
        <div className={css.note} data-channels-probe={probe.ok ? 'ok' : 'failed'}>
          {probe.ok ? <p>{t('probe.ok')}</p> : <p>{t('probe.failed', { message: probe.message ?? '' })}</p>}
          {probe.accountLabel === undefined ? null : <p>{t('probe.account', { account: probe.accountLabel })}</p>}
          {(probe.details ?? []).map(detail => <p key={detail} className={css.token}>{detail}</p>)}
        </div>
      )}
      {capabilities.length === 0 ? null : (
        <p className={css.note} data-channels-capabilities>
          <span className={css.fieldName}>{t('capabilities.title')}</span>
          {' '}
          {capabilities.join(' · ')}
        </p>
      )}
      <div className={css.credentials} data-channels-credentials>
        <span className={css.fieldName}>{t('credentials.title')}</span>
        <ul className={css.credentialList}>
          {view.credentials.map(credential => <CredentialRow key={credential.field} t={t} credential={credential} />)}
        </ul>
        <span className={css.note} data-channels-credentials-note>{t('credentials.note')}</span>
      </div>
      <div className={css.settings} data-channels-settings={view.settingsNamespace}>
        <span className={css.fieldName}>{t('settings.title')}</span>
        <SettingsForm
          form={entry.form}
          credentials={view.credentials}
          channel={view.channel}
          t={t}
          onEdit={onEdit}
          onReset={onReset}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      </div>
    </section>
  )
}

/** The panel's body: one tab's channel list, drawn for whichever state it settled in. */
export function ChannelsBody({
  useTabInfo, useStore, actions, start, reload, enable, disable, probe, save, t,
}: ChannelsBodyProps): ReactNode {
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
      <div className={css.status} data-channels-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.kind === 'failed') {
    return (
      <div className={css.status} data-channels-state="failed" data-channels-code={state.failure.code}>
        <p className={css.statusLine}>{t('error.failed', { message: state.failure.message })}</p>
      </div>
    )
  }
  return (
    <div className={css.root} data-channels-state="ready">
      <div className={css.head}>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          data-channels-reload
          onClick={() => { reload(tab.id, signal) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      {state.channels.length === 0
        ? <p className={css.note} data-channels-empty>{t('empty')}</p>
        : state.channels.map(entry => (
          <ChannelCard
            key={entry.view.channel}
            entry={entry}
            busy={state.busy === entry.view.channel}
            t={t}
            onEnable={() => { enable(tab.id, signal, entry.view.channel) }}
            onDisable={() => { disable(tab.id, signal, entry.view.channel) }}
            onProbe={() => { probe(tab.id, signal, entry.view.channel) }}
            onEdit={(field, text) => { actions.edited(tab.id, entry.view.channel, field, { text, clear: false }) }}
            onReset={(field) => { actions.edited(tab.id, entry.view.channel, field, { text: '', clear: true }) }}
            onSave={(ops) => { save(tab.id, signal, entry.view.channel, ops) }}
            onDiscard={() => { actions.discard(tab.id, entry.view.channel) }}
          />
        ))}
    </div>
  )
}

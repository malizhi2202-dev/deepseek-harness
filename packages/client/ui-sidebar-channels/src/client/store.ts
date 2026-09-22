/**
 * The panel's view state: every channel this Host serves, what the last control
 * did to it, and the settings descriptor each channel's namespace resolved to.
 *
 * One bucket per tab. The channel list is replaced whole by each status answer,
 * while each channel's own records — the last probe, the last control failure,
 * and the settings form — are carried forward for every channel still present,
 * so a reload does not discard what the reader is looking at.
 *
 * The settings form's descriptor-derived half (the schema's fields, the
 * resolved value, the layers) is written by the describe mirror; its staged
 * drafts are written by the reader. A save that lands clears the drafts; one
 * that does not keeps them, so the reader can correct an edit instead of
 * retyping it.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ChannelProbe, ChannelView } from '@deepseek-ai/dsh-api-channels/types'
import type { RemoteFailure, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { FieldDraft, SchemaField } from './schema-form.ts'

/** The staged edits, the in-flight flag, and the failure flag every form state carries. */
export interface ChannelFormFields {
  /** Staged edits, keyed by field name. */
  readonly drafts: Readonly<Record<string, FieldDraft>>
  /** Whether a save is crossing the wire. */
  readonly saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  readonly failed: boolean
}

/**
 * What one channel's settings form is doing right now.
 *
 * The descriptor's own fields exist only once the describe mirror answered, so
 * `view` and `fields` ride the `ready` variant rather than every state: a form
 * that has no descriptor to render cannot be asked for one.
 */
export type ChannelSettingsState =
  | ({ readonly status: 'loading'; readonly view: undefined } & ChannelFormFields)
  | ({ readonly status: 'unavailable'; readonly view: undefined } & ChannelFormFields)
  | ({
    readonly status: 'ready'
    /** Whether the Host document accepts writes. */
    readonly writable: boolean
    /** The descriptor the form renders from. */
    readonly view: SettingsNamespaceView
    /** The fields the descriptor's schema declares, in schema order. */
    readonly fields: readonly SchemaField[]
  } & ChannelFormFields)

/** The descriptor-derived half of one channel's settings form, as the mirror reports it. */
export type ChannelSettingsDescription =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
    readonly status: 'ready'
    readonly writable: boolean
    readonly view: SettingsNamespaceView
    readonly fields: readonly SchemaField[]
  }

/** One channel as the panel draws it. */
export interface ChannelEntry {
  /** The channel as the Host reports it. */
  readonly view: ChannelView
  /** The channel's settings form. */
  readonly form: ChannelSettingsState
  /** The last probe answer, or undefined while none has been asked for. */
  readonly probe: ChannelProbe | undefined
  /** The last control failure, or undefined while the last control call succeeded. */
  readonly failure: RemoteFailure | undefined
}

/** One tab's state once the channel list answered. */
export interface ChannelsReadyState {
  readonly kind: 'ready'
  /** Every registered channel, in registration order, with its own records. */
  readonly channels: readonly ChannelEntry[]
  /** The channel whose control call is in flight; undefined while none is. */
  readonly busy: string | undefined
}

/** What one tab's panel is doing right now. */
export type ChannelsTabState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }
  | ChannelsReadyState

/** Every tab's state, keyed by tab id. */
export interface ChannelsState {
  byTab: Record<TabId, ChannelsTabState>
}

/** One channel's form before the describe mirror has answered. */
function loadingForm(): ChannelSettingsState {
  return { status: 'loading', view: undefined, drafts: {}, saving: false, failed: false }
}

/** One channel's form, with the descriptor-derived half this answer supports. */
function withDescription(
  form: ChannelSettingsState,
  description: ChannelSettingsDescription,
): ChannelSettingsState {
  const carried = { drafts: form.drafts, saving: form.saving, failed: form.failed }
  if ('view' in description) {
    return {
      ...carried,
      status: 'ready',
      writable: description.writable,
      view: description.view,
      fields: description.fields,
    }
  }
  if (description.status === 'loading') return { ...carried, status: 'loading', view: undefined }
  return { ...carried, status: 'unavailable', view: undefined }
}

/**
 * One tab's ready state, carrying each channel's own records forward.
 * @param current - the tab's state before this write.
 * @param channels - the channels the Host reported.
 * @returns the next state.
 */
function readyWith(current: ChannelsTabState | undefined, channels: readonly ChannelView[]): ChannelsReadyState {
  const ready = current?.kind === 'ready' ? current : undefined
  return {
    kind: 'ready',
    channels: channels.map((view) => {
      const previous = ready?.channels.find(entry => entry.view.channel === view.channel)
      return previous === undefined
        ? { view, form: loadingForm(), probe: undefined, failure: undefined }
        : { view, form: previous.form, probe: previous.probe, failure: previous.failure }
    }),
    busy: ready?.busy,
  }
}

/**
 * One tab's ready state, or undefined when it holds no channel list.
 * @param state - the draft.
 * @param tabId - the tab being read.
 * @returns the ready state, or undefined.
 */
function readyOf(state: ChannelsState, tabId: TabId): ChannelsReadyState | undefined {
  const current = state.byTab[tabId]
  return current?.kind === 'ready' ? current : undefined
}

/**
 * Replace one channel's entry with a patched copy.
 *
 * Whole-object replacement rather than nested assignment: the state's members
 * are readonly, so every write builds the next state instead of mutating this
 * one, and immer keeps the objects a write does not touch.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @param channel - the channel whose entry is replaced.
 * @param patch - the entry to write in its place.
 */
function withEntry(
  state: ChannelsState,
  tabId: TabId,
  channel: string,
  patch: (entry: ChannelEntry) => ChannelEntry,
): void {
  const ready = readyOf(state, tabId)
  if (ready === undefined) return
  state.byTab[tabId] = {
    ...ready,
    channels: ready.channels.map(entry => entry.view.channel === channel ? patch(entry) : entry),
  }
}

/** The panel store's write set; every action names the tab it writes. */
type ChannelsActions = {
  loading: (draft: ChannelsState, tabId: TabId) => void
  failed: (draft: ChannelsState, tabId: TabId, failure: RemoteFailure) => void
  listed: (draft: ChannelsState, tabId: TabId, channels: readonly ChannelView[]) => void
  busy: (draft: ChannelsState, tabId: TabId, channel: string | undefined) => void
  probed: (draft: ChannelsState, tabId: TabId, channel: string, probe: ChannelProbe) => void
  channelFailed: (draft: ChannelsState, tabId: TabId, channel: string, failure: RemoteFailure) => void
  described: (draft: ChannelsState, tabId: TabId, channel: string, description: ChannelSettingsDescription) => void
  edited: (draft: ChannelsState, tabId: TabId, channel: string, field: string, edit: FieldDraft) => void
  saving: (draft: ChannelsState, tabId: TabId, channel: string, saving: boolean) => void
  saved: (draft: ChannelsState, tabId: TabId, channel: string, landed: boolean) => void
  discard: (draft: ChannelsState, tabId: TabId, channel: string) => void
  forget: (draft: ChannelsState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createChannelsStore(): EngineStoreHandle<ChannelsState, ChannelsActions> {
  return defineStore({
    init: (): ChannelsState => ({ byTab: {} }),
    actions: {
      /**
       * Mark one tab's channel list as loading.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      loading: (d, tabId: TabId) => {
        d.byTab[tabId] = { kind: 'loading' }
      },
      /**
       * Record why the channel list could not be read at all.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        d.byTab[tabId] = { kind: 'failed', failure }
      },
      /**
       * Replace one tab's channel list with what the Host reported.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channels - every registered channel, in registration order.
       */
      listed: (d, tabId: TabId, channels: readonly ChannelView[]) => {
        d.byTab[tabId] = readyWith(d.byTab[tabId], channels)
      },
      /**
       * Record which channel's control call is in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel being changed, or undefined when none is.
       */
      busy: (d, tabId: TabId, channel: string | undefined) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, busy: channel }
      },
      /**
       * Record one channel's probe answer, and clear the failure the last
       * control call left there.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel that was probed.
       * @param probe - what the probe found.
       */
      probed: (d, tabId: TabId, channel: string, probe: ChannelProbe) => {
        withEntry(d, tabId, channel, entry => ({ ...entry, probe, failure: undefined }))
      },
      /**
       * Record why one channel's control call failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel the failure belongs to.
       * @param failure - the settled Remote failure.
       */
      channelFailed: (d, tabId: TabId, channel: string, failure: RemoteFailure) => {
        withEntry(d, tabId, channel, entry => ({ ...entry, failure }))
      },
      /**
       * Record the settings descriptor one channel's namespace resolved to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel the descriptor belongs to.
       * @param description - the descriptor-derived half of the form.
       */
      described: (d, tabId: TabId, channel: string, description: ChannelSettingsDescription) => {
        withEntry(d, tabId, channel, entry => ({ ...entry, form: withDescription(entry.form, description) }))
      },
      /**
       * Stage one field's edit.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel whose form is edited.
       * @param field - the field name inside the settings section.
       * @param edit - the staged edit.
       */
      edited: (d, tabId: TabId, channel: string, field: string, edit: FieldDraft) => {
        withEntry(d, tabId, channel, entry => ({
          ...entry,
          form: { ...entry.form, drafts: { ...entry.form.drafts, [field]: edit }, failed: false },
        }))
      },
      /**
       * Record whether a save is crossing the wire.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel being saved.
       * @param saving - the new in-flight state.
       */
      saving: (d, tabId: TabId, channel: string, saving: boolean) => {
        withEntry(d, tabId, channel, entry => ({ ...entry, form: { ...entry.form, saving } }))
      },
      /**
       * Record how a save settled: a landed save clears the drafts, and one
       * that did not keeps them for the reader to correct.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel that was saved.
       * @param landed - whether every staged write is in the user layer.
       */
      saved: (d, tabId: TabId, channel: string, landed: boolean) => {
        withEntry(d, tabId, channel, entry => ({
          ...entry,
          form: landed
            ? { ...entry.form, drafts: {}, failed: false }
            : { ...entry.form, failed: true },
        }))
      },
      /**
       * Drop one channel's staged edits.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param channel - the channel whose form is discarded.
       */
      discard: (d, tabId: TabId, channel: string) => {
        withEntry(d, tabId, channel, entry => ({
          ...entry,
          form: { ...entry.form, drafts: {}, failed: false },
        }))
      },
      /**
       * Forget one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}

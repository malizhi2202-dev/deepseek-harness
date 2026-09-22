/**
 * The panel's view state: every remote resource source this Host serves, what
 * the last probe found, and the settings descriptor each source's namespace
 * resolved to.
 *
 * One bucket per tab. The source list is replaced whole by each status answer,
 * while each source's own records — the last probe, the last control failure,
 * and the settings form — are carried forward for every source still present, so
 * a reload does not discard what the reader is looking at.
 *
 * The settings form's descriptor-derived half (the schema's rows, the resolved
 * value, the layers) is written by the describe mirror; its staged drafts are
 * written by the reader. A save that lands clears the drafts; one that does not
 * keeps them, so the reader can correct an edit instead of retyping it.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SourceProbe, SourceView } from '@deepseek-ai/dsh-api-sources/types'
import type { RemoteFailure, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { FieldDraft, FormField } from './form.ts'

/** The staged edits, the in-flight flag, and the failure flag every form state carries. */
export interface SourceFormFields {
  /** Staged edits, keyed by field name. */
  readonly drafts: Readonly<Record<string, FieldDraft>>
  /** Whether a save is crossing the wire. */
  readonly saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  readonly failed: boolean
}

/**
 * What one source's settings form is doing right now.
 *
 * The descriptor's own rows exist only once the describe mirror answered, so
 * `view` and `fields` ride the `ready` variant rather than every state: a form
 * that has no descriptor to render cannot be asked for one.
 */
export type SourceSettingsState =
  | ({ readonly status: 'loading'; readonly view: undefined } & SourceFormFields)
  | ({ readonly status: 'unavailable'; readonly view: undefined } & SourceFormFields)
  | ({
    readonly status: 'ready'
    /** Whether the Host document accepts writes. */
    readonly writable: boolean
    /** The descriptor the form renders from. */
    readonly view: SettingsNamespaceView
    /** The rows the descriptor's schema declares, in schema order. */
    readonly fields: readonly FormField[]
  } & SourceFormFields)

/** The descriptor-derived half of one source's settings form, as the mirror reports it. */
export type SourceSettingsDescription =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
    readonly status: 'ready'
    readonly writable: boolean
    readonly view: SettingsNamespaceView
    readonly fields: readonly FormField[]
  }

/** One source as the panel draws it. */
export interface SourceEntry {
  /** The source as the Host reports it. */
  readonly view: SourceView
  /** The source's settings form. */
  readonly form: SourceSettingsState
  /** The last probe answer, or undefined while none has been asked for. */
  readonly probe: SourceProbe | undefined
  /** The last control failure, or undefined while the last control call succeeded. */
  readonly failure: RemoteFailure | undefined
}

/** One tab's state once the source list answered. */
export interface SourcesReadyState {
  readonly kind: 'ready'
  /** Every registered source, in registration order, with its own records. */
  readonly sources: readonly SourceEntry[]
  /** The source whose probe is in flight; undefined while none is. */
  readonly probing: string | undefined
}

/** What one tab's panel is doing right now. */
export type SourcesTabState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }
  | SourcesReadyState

/** Every tab's state, keyed by tab id. */
export interface SourcesState {
  byTab: Record<TabId, SourcesTabState>
}

/** One source's form before the describe mirror has answered. */
function loadingForm(): SourceSettingsState {
  return { status: 'loading', view: undefined, drafts: {}, saving: false, failed: false }
}

/**
 * One source's form, with the descriptor-derived half this answer supports.
 * @param form - the form state before this write.
 * @param description - the descriptor-derived half the mirror reported.
 * @returns the next form state, with the staged edits carried forward.
 */
function withDescription(
  form: SourceSettingsState,
  description: SourceSettingsDescription,
): SourceSettingsState {
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
 * One tab's ready state, carrying each source's own records forward.
 * @param current - the tab's state before this write.
 * @param sources - the sources the Host reported.
 * @returns the next state.
 */
function readyWith(current: SourcesTabState | undefined, sources: readonly SourceView[]): SourcesReadyState {
  const ready = current?.kind === 'ready' ? current : undefined
  return {
    kind: 'ready',
    sources: sources.map((view) => {
      const previous = ready?.sources.find(entry => entry.view.key === view.key)
      return previous === undefined
        ? { view, form: loadingForm(), probe: undefined, failure: undefined }
        : { view, form: previous.form, probe: previous.probe, failure: previous.failure }
    }),
    probing: ready?.probing,
  }
}

/**
 * One tab's ready state, or undefined when it holds no source list.
 * @param state - the draft.
 * @param tabId - the tab being read.
 * @returns the ready state, or undefined.
 */
function readyOf(state: SourcesState, tabId: TabId): SourcesReadyState | undefined {
  const current = state.byTab[tabId]
  return current?.kind === 'ready' ? current : undefined
}

/**
 * Replace one source's entry with a patched copy.
 *
 * Whole-object replacement rather than nested assignment: the state's members
 * are readonly, so every write builds the next state instead of mutating this
 * one, and immer keeps the objects a write does not touch.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @param key - the source whose entry is replaced.
 * @param patch - the entry to write in its place.
 */
function withEntry(
  state: SourcesState,
  tabId: TabId,
  key: string,
  patch: (entry: SourceEntry) => SourceEntry,
): void {
  const ready = readyOf(state, tabId)
  if (ready === undefined) return
  state.byTab[tabId] = {
    ...ready,
    sources: ready.sources.map(entry => entry.view.key === key ? patch(entry) : entry),
  }
}

/** The panel store's write set; every action names the tab it writes. */
type SourcesActions = {
  loading: (draft: SourcesState, tabId: TabId) => void
  failed: (draft: SourcesState, tabId: TabId, failure: RemoteFailure) => void
  listed: (draft: SourcesState, tabId: TabId, sources: readonly SourceView[]) => void
  probing: (draft: SourcesState, tabId: TabId, key: string | undefined) => void
  probed: (draft: SourcesState, tabId: TabId, key: string, probe: SourceProbe) => void
  sourceFailed: (draft: SourcesState, tabId: TabId, key: string, failure: RemoteFailure) => void
  described: (draft: SourcesState, tabId: TabId, key: string, description: SourceSettingsDescription) => void
  edited: (draft: SourcesState, tabId: TabId, key: string, field: string, edit: FieldDraft) => void
  saving: (draft: SourcesState, tabId: TabId, key: string, saving: boolean) => void
  saved: (draft: SourcesState, tabId: TabId, key: string, landed: boolean) => void
  discard: (draft: SourcesState, tabId: TabId, key: string) => void
  forget: (draft: SourcesState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createSourcesStore(): EngineStoreHandle<SourcesState, SourcesActions> {
  return defineStore({
    init: (): SourcesState => ({ byTab: {} }),
    actions: {
      /**
       * Mark one tab's source list as loading.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      loading: (d, tabId: TabId) => {
        d.byTab[tabId] = { kind: 'loading' }
      },
      /**
       * Record why the source list could not be read at all.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        d.byTab[tabId] = { kind: 'failed', failure }
      },
      /**
       * Replace one tab's source list with what the Host reported.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param sources - every registered source, in registration order.
       */
      listed: (d, tabId: TabId, sources: readonly SourceView[]) => {
        d.byTab[tabId] = readyWith(d.byTab[tabId], sources)
      },
      /**
       * Record which source's probe is in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source being probed, or undefined when none is.
       */
      probing: (d, tabId: TabId, key: string | undefined) => {
        const ready = readyOf(d, tabId)
        if (ready === undefined) return
        d.byTab[tabId] = { ...ready, probing: key }
      },
      /**
       * Record one source's probe answer, and clear the failure the last probe
       * left there.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source that was probed.
       * @param probe - what the probe found.
       */
      probed: (d, tabId: TabId, key: string, probe: SourceProbe) => {
        withEntry(d, tabId, key, entry => ({ ...entry, probe, failure: undefined }))
      },
      /**
       * Record why one source's control call failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source the failure belongs to.
       * @param failure - the settled Remote failure.
       */
      sourceFailed: (d, tabId: TabId, key: string, failure: RemoteFailure) => {
        withEntry(d, tabId, key, entry => ({ ...entry, failure }))
      },
      /**
       * Record the settings descriptor one source's namespace resolved to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source the descriptor belongs to.
       * @param description - the descriptor-derived half of the form.
       */
      described: (d, tabId: TabId, key: string, description: SourceSettingsDescription) => {
        withEntry(d, tabId, key, entry => ({ ...entry, form: withDescription(entry.form, description) }))
      },
      /**
       * Stage one field's edit.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source whose form is edited.
       * @param field - the field name inside the settings section.
       * @param edit - the staged edit.
       */
      edited: (d, tabId: TabId, key: string, field: string, edit: FieldDraft) => {
        withEntry(d, tabId, key, entry => ({
          ...entry,
          form: { ...entry.form, drafts: { ...entry.form.drafts, [field]: edit }, failed: false },
        }))
      },
      /**
       * Record whether a save is crossing the wire.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source being saved.
       * @param saving - the new in-flight state.
       */
      saving: (d, tabId: TabId, key: string, saving: boolean) => {
        withEntry(d, tabId, key, entry => ({ ...entry, form: { ...entry.form, saving } }))
      },
      /**
       * Record how a save settled: a landed save clears the drafts, and one
       * that did not keeps them for the reader to correct.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source that was saved.
       * @param landed - whether every staged write is in the user layer.
       */
      saved: (d, tabId: TabId, key: string, landed: boolean) => {
        withEntry(d, tabId, key, entry => ({
          ...entry,
          form: landed
            ? { ...entry.form, drafts: {}, failed: false }
            : { ...entry.form, failed: true },
        }))
      },
      /**
       * Drop one source's staged edits.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param key - the source whose form is discarded.
       */
      discard: (d, tabId: TabId, key: string) => {
        withEntry(d, tabId, key, entry => ({
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

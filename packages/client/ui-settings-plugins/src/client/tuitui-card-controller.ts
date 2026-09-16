/**
 * The tuitui card's staged form over the `tuitui` settings namespace, plus the
 * write-only `appSecret` control over that section's `role('secret')` field.
 *
 * The secret's literal never rides a response: the section's value, base, and
 * user layers are redacted on the wire, so the card learns only the Host's
 * `{ path: ['appSecret'], set }` answer from the shared describe mirror and
 * writes the literal through a settings path-op. Behavioral fields ride the
 * ordinary section and stage with the rest of the form.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  SettingsDescribeFace, SettingsDescribeView,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, arrayField, booleanField, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the Tuitui bridge. Spelled here rather than imported: a client
 * package must not depend on a Host package.
 */
export const TUITION_NS = 'tuitui'

/** Field name of the write-only app secret (schema `role('secret')`). */
const APP_SECRET_FIELD = 'appSecret'

/** The tuitui fields this card edits. */
export interface TuituiSettings {
  /** Tuitui application id. */
  appId?: string
  /** Tuitui application secret; written through a path-op and never read back. */
  appSecret?: string
  /** Tuitui IM server host. */
  host?: string
  /** Agent working directory; blank uses the process cwd. */
  cwd?: string
  /** Data directory for per-chat cwd and tree-card persistence. */
  dataDir?: string
  /** Agent preset id; blank uses the deployment default preset. */
  agentPreset?: string
  /** Permission preset id; blank uses the deployment default permission preset. */
  permissionPreset?: string
  /** Optional explicit provider route override. */
  provider?: string
  /** Optional explicit model override. */
  model?: string
  /** Tuitui accounts allowed to DM the bot; `*` allows all. */
  allowFrom?: string[]
  /** Group / team ids allowed to use the bot. */
  groupAllowFrom?: string[]
  /** Require an @-mention in groups and channels. */
  requireMention?: boolean
  /** React to inbound messages with an emoji. */
  emojiReaction?: boolean
  /** Reaction emoji text. */
  reactionEmoji?: string
  /** Send a "thinking" placeholder while the agent runs. */
  showThinking?: boolean
  /** Enable the /tree file-tree workbench. */
  treeEnabled?: boolean
  /** Entries per tree page. */
  treePageSize?: number
  /** Show hidden files in tree listings. */
  treeShowHidden?: boolean
  /** Extra names to hide in tree listings (added to the built-in ignore set). */
  treeIgnore?: string[]
  /** Allow rename / delete / copy through the tree card (always confirmed). */
  treeAllowWrite?: boolean
  /** Persist tree-card bindings so /tree resumes the same message after restart. */
  treePersist?: boolean
}

/** What the tuitui card renders. */
export interface TuituiCardState extends CardShell {
  /** Staged Tuitui application id. */
  appId: CardFieldState
  /** Write-only app secret; starts blank and never shows a stored value. */
  appSecret: CardFieldState
  /** Staged Tuitui IM server host. */
  host: CardFieldState
  /** Staged agent working directory. */
  cwd: CardFieldState
  /** Staged data directory. */
  dataDir: CardFieldState
  /** Staged agent preset id. */
  agentPreset: CardFieldState
  /** Staged permission preset id. */
  permissionPreset: CardFieldState
  /** Staged provider route override. */
  provider: CardFieldState
  /** Staged model override. */
  model: CardFieldState
  /** Staged allowed direct-message senders. */
  allowFrom: CardFieldState
  /** Staged allowed group / team ids. */
  groupAllowFrom: CardFieldState
  /** Whether group and channel messages must @-mention the bot. */
  requireMention: CardFieldState
  /** Whether the bot reacts to inbound messages. */
  emojiReaction: CardFieldState
  /** Staged reaction emoji. */
  reactionEmoji: CardFieldState
  /** Whether the bot sends a thinking placeholder. */
  showThinking: CardFieldState
  /** Whether the /tree workbench is enabled. */
  treeEnabled: CardFieldState
  /** Staged tree entries per page. */
  treePageSize: CardFieldState
  /** Whether tree listings show hidden files. */
  treeShowHidden: CardFieldState
  /** Staged extra names hidden in tree listings. */
  treeIgnore: CardFieldState
  /** Whether the tree card allows rename / delete / copy. */
  treeAllowWrite: CardFieldState
  /** Whether tree-card bindings persist across restarts. */
  treePersist: CardFieldState
  /** Whether the Host reports an app secret configured for this section. */
  appSecretConfigured: boolean
}

/** The registration-side face the tuitui card's slot entry injects. */
export interface TuituiCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useTuituiCard. */
    tuituiCard: SnapshotStore<TuituiCardState>
  }
}

/** Whether the mirror reports a value at this section's `path`. */
function secretSet(view: SettingsDescribeView | undefined, path: string): boolean {
  const row = view?.namespaces.find(candidate => candidate.ns === TUITION_NS)
  return row?.secrets.some(secret =>
    secret.path.length === 1 && secret.path[0] === path && secret.set) ?? false
}

/** Bridges the `tuitui` scope and the shared describe mirror onto the card. */
export class TuituiCardController {
  private readonly form: CardForm<TuituiSettings>
  private readonly store: SnapshotStore<TuituiCardState>
  private secretConfigured = false
  private disposed = false
  private readonly unsubscribe: () => void

  /**
   * @param scope - the bound settings scope for the `tuitui` namespace.
   * @param describe - the shared describe mirror carrying the redacted secret slots.
   */
  constructor(
    private readonly scope: SettingsScope<TuituiSettings>,
    private readonly describe: SettingsDescribeFace,
  ) {
    this.form = new CardForm(
      scope,
      [
        textField('appId'),
        textField('host'),
        textField('cwd'),
        textField('dataDir'),
        textField('agentPreset'),
        textField('permissionPreset'),
        textField('provider'),
        textField('model'),
        arrayField('allowFrom'),
        arrayField('groupAllowFrom'),
        booleanField('requireMention'),
        booleanField('emojiReaction'),
        textField('reactionEmoji'),
        booleanField('showThinking'),
        booleanField('treeEnabled'),
        numberField('treePageSize'),
        booleanField('treeShowHidden'),
        arrayField('treeIgnore'),
        booleanField('treeAllowWrite'),
        booleanField('treePersist'),
      ],
      [{ field: APP_SECRET_FIELD, write: text => this.writeSecret(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = describe.subscribe(() => { this.readSecret() })
    this.readSecret()
  }

  private projection(): TuituiCardState {
    return {
      ...this.form.shell(),
      appId: this.form.field('appId'),
      appSecret: this.form.field(APP_SECRET_FIELD),
      host: this.form.field('host'),
      cwd: this.form.field('cwd'),
      dataDir: this.form.field('dataDir'),
      agentPreset: this.form.field('agentPreset'),
      permissionPreset: this.form.field('permissionPreset'),
      provider: this.form.field('provider'),
      model: this.form.field('model'),
      allowFrom: this.form.field('allowFrom'),
      groupAllowFrom: this.form.field('groupAllowFrom'),
      requireMention: this.form.field('requireMention'),
      emojiReaction: this.form.field('emojiReaction'),
      reactionEmoji: this.form.field('reactionEmoji'),
      showThinking: this.form.field('showThinking'),
      treeEnabled: this.form.field('treeEnabled'),
      treePageSize: this.form.field('treePageSize'),
      treeShowHidden: this.form.field('treeShowHidden'),
      treeIgnore: this.form.field('treeIgnore'),
      treeAllowWrite: this.form.field('treeAllowWrite'),
      treePersist: this.form.field('treePersist'),
      appSecretConfigured: this.secretConfigured,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): TuituiCardFace {
    return { hooks: { tuituiCard: this.store }, ...this.form.actions() }
  }

  /** Stop following the mirror; called on the card plugin's teardown. */
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
  }

  /**
   * Publish the Host's answer for the secret slot when the mirror changes.
   * A redacted section carries no value for `appSecret`, so this mirror read is
   * the only place the card learns whether one is configured.
   */
  private readSecret(): void {
    if (this.disposed) return
    const next = secretSet(this.describe.getSnapshot().view, APP_SECRET_FIELD)
    if (next === this.secretConfigured) return
    this.secretConfigured = next
    this.store.set(this.projection())
  }

  /**
   * Write the staged literal through a path-op, then report whether the Host
   * now holds one. A blank draft never reaches here: the form skips it, so the
   * stored secret survives an emptied control.
   * @param value - the staged secret literal.
   * @returns whether the Host reports a configured secret afterwards.
   */
  private async writeSecret(value: string): Promise<boolean> {
    await this.scope.mutate([{ op: 'set', path: [APP_SECRET_FIELD], value }])
    this.readSecret()
    return this.secretConfigured
  }
}

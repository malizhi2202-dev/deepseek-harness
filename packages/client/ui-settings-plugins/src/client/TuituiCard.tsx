/**
 * The tuitui bridge's card: the robot credentials, agent route, access
 * control, and file-tree options. The app secret is written through the
 * section's `role('secret')` field, never read back, so the control shows only
 * whether one is configured.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { TuituiCardFace } from './tuitui-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the tuitui card. */
export type TuituiCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<TuituiCardFace>

/**
 * Render the tuitui card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function TuituiCard(props: TuituiCardProps) {
  const { t } = props
  const state = props.useTuituiCard(snapshot => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalidNumber'),
  }
  return (
    <PluginCard
      t={t}
      titleKey="tuituiTitle"
      descriptionKey="tuituiDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-tuitui-app-id"
        label={t('tuituiAppId')}
        hint={t('tuituiAppIdHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.appId}
        onEdit={(text) => { props.edit('appId', text) }}
        onReset={() => { props.resetField('appId') }}
      />
      <SecretField
        id="plugin-config-tuitui-app-secret"
        label={t('tuituiAppSecret')}
        hint={t('tuituiAppSecretHint')}
        disabled={disabled}
        text={state.appSecret.text}
        configured={state.appSecretConfigured}
        stateLabel={state.appSecretConfigured ? t('tuituiAppSecretSet') : t('tuituiAppSecretUnset')}
        onEdit={(text) => { props.edit('appSecret', text) }}
      />
      <ValueField
        id="plugin-config-tuitui-host"
        label={t('tuituiHost')}
        hint={t('tuituiHostHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.host}
        onEdit={(text) => { props.edit('host', text) }}
        onReset={() => { props.resetField('host') }}
      />
      <ValueField
        id="plugin-config-tuitui-cwd"
        label={t('tuituiCwd')}
        hint={t('tuituiCwdHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.cwd}
        onEdit={(text) => { props.edit('cwd', text) }}
        onReset={() => { props.resetField('cwd') }}
      />
      <ValueField
        id="plugin-config-tuitui-data-dir"
        label={t('tuituiDataDir')}
        hint={t('tuituiDataDirHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.dataDir}
        onEdit={(text) => { props.edit('dataDir', text) }}
        onReset={() => { props.resetField('dataDir') }}
      />
      <ValueField
        id="plugin-config-tuitui-agent-preset"
        label={t('tuituiAgentPreset')}
        hint={t('tuituiAgentPresetHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.agentPreset}
        onEdit={(text) => { props.edit('agentPreset', text) }}
        onReset={() => { props.resetField('agentPreset') }}
      />
      <ValueField
        id="plugin-config-tuitui-permission-preset"
        label={t('tuituiPermissionPreset')}
        hint={t('tuituiPermissionPresetHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.permissionPreset}
        onEdit={(text) => { props.edit('permissionPreset', text) }}
        onReset={() => { props.resetField('permissionPreset') }}
      />
      <ValueField
        id="plugin-config-tuitui-provider"
        label={t('tuituiProvider')}
        hint={t('tuituiProviderHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.provider}
        onEdit={(text) => { props.edit('provider', text) }}
        onReset={() => { props.resetField('provider') }}
      />
      <ValueField
        id="plugin-config-tuitui-model"
        label={t('tuituiModel')}
        hint={t('tuituiModelHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <ValueField
        id="plugin-config-tuitui-allow-from"
        label={t('tuituiAllowFrom')}
        hint={t('tuituiAllowFromHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.allowFrom}
        onEdit={(text) => { props.edit('allowFrom', text) }}
        onReset={() => { props.resetField('allowFrom') }}
      />
      <ValueField
        id="plugin-config-tuitui-group-allow-from"
        label={t('tuituiGroupAllowFrom')}
        hint={t('tuituiGroupAllowFromHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.groupAllowFrom}
        onEdit={(text) => { props.edit('groupAllowFrom', text) }}
        onReset={() => { props.resetField('groupAllowFrom') }}
      />
      <ToggleField
        label={t('tuituiRequireMention')}
        hint={t('tuituiRequireMentionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.requireMention}
        onEdit={(text) => { props.edit('requireMention', text) }}
        onReset={() => { props.resetField('requireMention') }}
      />
      <ToggleField
        label={t('tuituiEmojiReaction')}
        hint={t('tuituiEmojiReactionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.emojiReaction}
        onEdit={(text) => { props.edit('emojiReaction', text) }}
        onReset={() => { props.resetField('emojiReaction') }}
      />
      <ValueField
        id="plugin-config-tuitui-reaction-emoji"
        label={t('tuituiReactionEmoji')}
        hint={t('tuituiReactionEmojiHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.reactionEmoji}
        onEdit={(text) => { props.edit('reactionEmoji', text) }}
        onReset={() => { props.resetField('reactionEmoji') }}
      />
      <ToggleField
        label={t('tuituiShowThinking')}
        hint={t('tuituiShowThinkingHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.showThinking}
        onEdit={(text) => { props.edit('showThinking', text) }}
        onReset={() => { props.resetField('showThinking') }}
      />
      <ToggleField
        label={t('tuituiTreeEnabled')}
        hint={t('tuituiTreeEnabledHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.treeEnabled}
        onEdit={(text) => { props.edit('treeEnabled', text) }}
        onReset={() => { props.resetField('treeEnabled') }}
      />
      <ValueField
        id="plugin-config-tuitui-tree-page-size"
        label={t('tuituiTreePageSize')}
        hint={t('tuituiTreePageSizeHint')}
        numeric
        disabled={disabled}
        {...fieldProps}
        {...state.treePageSize}
        onEdit={(text) => { props.edit('treePageSize', text) }}
        onReset={() => { props.resetField('treePageSize') }}
      />
      <ToggleField
        label={t('tuituiTreeShowHidden')}
        hint={t('tuituiTreeShowHiddenHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.treeShowHidden}
        onEdit={(text) => { props.edit('treeShowHidden', text) }}
        onReset={() => { props.resetField('treeShowHidden') }}
      />
      <ValueField
        id="plugin-config-tuitui-tree-ignore"
        label={t('tuituiTreeIgnore')}
        hint={t('tuituiTreeIgnoreHint')}
        disabled={disabled}
        {...fieldProps}
        {...state.treeIgnore}
        onEdit={(text) => { props.edit('treeIgnore', text) }}
        onReset={() => { props.resetField('treeIgnore') }}
      />
      <ToggleField
        label={t('tuituiTreeAllowWrite')}
        hint={t('tuituiTreeAllowWriteHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.treeAllowWrite}
        onEdit={(text) => { props.edit('treeAllowWrite', text) }}
        onReset={() => { props.resetField('treeAllowWrite') }}
      />
      <ToggleField
        label={t('tuituiTreePersist')}
        hint={t('tuituiTreePersistHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        {...state.treePersist}
        onEdit={(text) => { props.edit('treePersist', text) }}
        onReset={() => { props.resetField('treePersist') }}
      />
    </PluginCard>
  )
}

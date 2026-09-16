// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TuituiCard } from '../src/client/TuituiCard.tsx'
import type { TuituiCardProps } from '../src/client/TuituiCard.tsx'
import type { TuituiCardState } from '../src/client/tuitui-card-controller.ts'
import type { CardFieldState, CardShell } from '../src/client/card-form.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: CardShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function field(text: string, rest: Partial<CardFieldState> = {}): CardFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderTuitui(state: Partial<TuituiCardState> = {}) {
  const store = createSnapshotStore<TuituiCardState>({
    ...settled,
    appId: field(''),
    appSecret: field(''),
    host: field(''),
    cwd: field(''),
    dataDir: field(''),
    agentPreset: field(''),
    permissionPreset: field(''),
    provider: field(''),
    model: field(''),
    allowFrom: field(''),
    groupAllowFrom: field(''),
    requireMention: field('false'),
    emojiReaction: field('false'),
    reactionEmoji: field(''),
    showThinking: field('false'),
    treeEnabled: field('false'),
    treePageSize: field(''),
    treeShowHidden: field('false'),
    treeIgnore: field(''),
    treeAllowWrite: field('false'),
    treePersist: field('false'),
    appSecretConfigured: false,
    ...state,
  })
  const actions = cardActions()
  const props = { ...actions, t, useTuituiCard: bindSnapshotSelector(store) } as unknown as TuituiCardProps
  render(<TuituiCard {...props} />)
  return actions
}

describe('TuituiCard', () => {
  it('renders nothing while its namespace is unavailable', () => {
    renderTuitui({ available: false })

    expect(screen.queryByText(en.tuituiTitle)).toBeNull()
  })

  it('shows the plugin and reveals its fields only once expanded', () => {
    renderTuitui()
    expect(screen.getByText(en.tuituiTitle)).toBeTruthy()
    expect(screen.queryByLabelText(en.tuituiHost)).toBeNull()

    fireEvent.click(screen.getByText(en.tuituiTitle))

    expect(screen.getByLabelText(en.tuituiHost)).toBeTruthy()
    expect(screen.getByLabelText(en.tuituiAppId)).toBeTruthy()
    expect(screen.getByLabelText(en.tuituiAppSecret)).toBeTruthy()
  })

  it('stages a text edit and a boolean toggle instead of writing', () => {
    const actions = renderTuitui()
    fireEvent.click(screen.getByText(en.tuituiTitle))

    fireEvent.change(screen.getByLabelText(en.tuituiHost), { target: { value: 'im.other.test' } })
    fireEvent.click(screen.getByRole('switch', { name: en.tuituiRequireMention }))

    expect(actions.edit).toHaveBeenCalledWith('host', 'im.other.test')
    expect(actions.edit).toHaveBeenCalledWith('requireMention', 'true')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('reports the secret state without ever showing one', () => {
    renderTuitui({ appSecretConfigured: true })
    fireEvent.click(screen.getByText(en.tuituiTitle))

    expect(screen.getByText(en.tuituiAppSecretSet)).toBeTruthy()
    expect(screen.getByLabelText(en.tuituiAppSecret)).toHaveProperty('type', 'password')

    cleanup()
    renderTuitui({ appSecretConfigured: false })
    fireEvent.click(screen.getByText(en.tuituiTitle))
    expect(screen.getByText(en.tuituiAppSecretUnset)).toBeTruthy()
  })

  it('stages a secret edit', () => {
    const actions = renderTuitui()
    fireEvent.click(screen.getByText(en.tuituiTitle))

    fireEvent.change(screen.getByLabelText(en.tuituiAppSecret), { target: { value: 's3cret' } })

    expect(actions.edit).toHaveBeenCalledWith('appSecret', 's3cret')
  })

  it('offers the reset for an overridden field only', () => {
    const actions = renderTuitui({ host: field('im.override.test', { overridden: true }) })
    fireEvent.click(screen.getByText(en.tuituiTitle))

    expect(screen.getAllByText(en.overridden)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('host')
  })

  it('renders an overridden toggle with its reset', () => {
    const actions = renderTuitui({ requireMention: field('true', { overridden: true }) })
    fireEvent.click(screen.getByText(en.tuituiTitle))

    expect(screen.getAllByText(en.overridden)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('requireMention')
  })

  it('drives every field control and its reset', () => {
    const textFields = [
      ['appId', en.tuituiAppId],
      ['host', en.tuituiHost],
      ['cwd', en.tuituiCwd],
      ['dataDir', en.tuituiDataDir],
      ['agentPreset', en.tuituiAgentPreset],
      ['permissionPreset', en.tuituiPermissionPreset],
      ['provider', en.tuituiProvider],
      ['model', en.tuituiModel],
      ['allowFrom', en.tuituiAllowFrom],
      ['groupAllowFrom', en.tuituiGroupAllowFrom],
      ['reactionEmoji', en.tuituiReactionEmoji],
      ['treePageSize', en.tuituiTreePageSize],
      ['treeIgnore', en.tuituiTreeIgnore],
    ] as const
    const toggles = [
      ['requireMention', en.tuituiRequireMention],
      ['emojiReaction', en.tuituiEmojiReaction],
      ['showThinking', en.tuituiShowThinking],
      ['treeEnabled', en.tuituiTreeEnabled],
      ['treeShowHidden', en.tuituiTreeShowHidden],
      ['treeAllowWrite', en.tuituiTreeAllowWrite],
      ['treePersist', en.tuituiTreePersist],
    ] as const

    const overridden = {
      ...Object.fromEntries(textFields.map(([name]) => [name, field(name, { overridden: true })])),
      ...Object.fromEntries(toggles.map(([name]) => [name, field('false', { overridden: true })])),
    } as unknown as Partial<TuituiCardState>
    const actions = renderTuitui(overridden)
    fireEvent.click(screen.getByText(en.tuituiTitle))

    for (const [, label] of textFields) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'x' } })
    }
    for (const [, label] of toggles) {
      fireEvent.click(screen.getByRole('switch', { name: label }))
    }
    fireEvent.change(screen.getByLabelText(en.tuituiAppSecret), { target: { value: 's' } })

    const resets = screen.getAllByRole('button', { name: en.reset })
    expect(resets).toHaveLength(20)
    for (const reset of resets) fireEvent.click(reset)

    for (const [name] of textFields) expect(actions.edit).toHaveBeenCalledWith(name, 'x')
    for (const [name] of toggles) expect(actions.edit).toHaveBeenCalledWith(name, 'true')
    expect(actions.edit).toHaveBeenCalledWith('appSecret', 's')
    for (const [name] of textFields) expect(actions.resetField).toHaveBeenCalledWith(name)
    for (const [name] of toggles) expect(actions.resetField).toHaveBeenCalledWith(name)
  })

  it('disables every control while the document is read-only', () => {
    const actions = renderTuitui({ writable: false })
    fireEvent.click(screen.getByText(en.tuituiTitle))

    expect(screen.getByLabelText(en.tuituiHost)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.tuituiAppSecret)).toHaveProperty('disabled', true)
    const toggle = screen.getByRole('switch', { name: en.tuituiRequireMention }) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    fireEvent.click(toggle)
    expect(actions.edit).not.toHaveBeenCalled()
  })
})

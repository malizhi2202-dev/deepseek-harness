// Keyless assembled-browser coverage for the remote-control panel: the shipped
// right Sidebar's `channels` tab over the real Host Typert Remote flow.
//
// The scenario applies no overlay, so the surface is the product's own
// composition: the web bundle's `channel`, `channel-bridge`, `channel-tuitui`,
// and `api-channels` rows serve the panel, and the panel's own client row draws
// it. It opens the tab from the guide and reads what the Host's connector
// registry reports — the Tuitui channel, its stopped connection, its credential
// references by name, and the settings form its own schema declares — then
// reloads the same facts through the panel's own control.
//
// Nothing here enables a channel: enabling opens a real transport to a chat
// platform, which this lane owns no fixture for. The credential and settings
// assertions read the descriptor, never a secret value, which is also what the
// panel promises.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/sidebar-channels', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'panel.expected.md')
const MODE = webSnapshotMode()

/** The connector this repository ships, and the id the panel draws for it. */
const CHANNEL = 'tuitui'

/**
 * Open the remote-control tab on a settled session: the right Sidebar starts
 * collapsed behind the header button, and the guide is picked to reach the
 * entry the channels type registered.
 */
async function openChannelsTab(page: Page): Promise<Locator> {
  const column = page.locator('[data-rightbar-col]')
  await page.locator('[data-sidebar-right-expand]').click()
  await column.locator('[data-sidebar-right-open]').waitFor({ timeout: 10_000 })
  await column.locator('[data-dockkit-pane]').first()
    .locator('[data-dockkit-tab]').filter({ hasText: 'Start' }).click()
  await column.locator('[data-sidebar-right-guide-entry="channels"]').click()
  return column
}

describe('web e2e: remote-control panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    // A settled session is what keys the surface: seed one turn through the
    // real append path so the frame seats the sidebar before it is driven.
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('connected workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show the remote-control panel.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Ready.').waitFor({ timeout: 10_000 })
    await page.locator('[data-sidebar-right-expand]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the channel this Host serves, with its settings form', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-channels'))
    const column = await openChannelsTab(page)
    const state = column.locator('[data-channels-state="ready"]')
    await state.waitFor({ timeout: 15_000 })

    // The tab is the type's own, titled from its dictionary.
    await expect.poll(async () =>
      await column.locator('[data-dockkit-tab-title]').allInnerTexts()).toContain('Remote control')

    // The Host's own connector registry answers: the shipped Tuitui connector
    // is listed, and it is not connected because this session never enabled it.
    const card = state.locator(`[data-channels-card="${CHANNEL}"]`)
    await card.waitFor({ timeout: 10_000 })
    expect(await card.locator('[data-channels-connection-label]').innerText()).toBe('Not connected')
    expect(await card.locator('[data-channels-action="enable"]').innerText()).toBe('Enable')
    expect(await card.locator('[data-channels-action="probe"]').innerText()).toBe('Test credentials')
    expect(await card.locator('[data-channels-bound]').count()).toBe(0)
    expect(await card.locator('[data-channels-last-error]').count()).toBe(0)

    // Credentials are reference names only, and the panel says so itself.
    expect(await card.locator('[data-channels-credentials-note]').count()).toBe(1)
    expect(await card.locator('[data-channels-credentials]').count()).toBe(1)

    // The form is the channel's own schema: the connector registered these
    // fields, and the panel renders a control per field without knowing them.
    const fields = await card.locator('[data-channels-field]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-channels-field')))
    expect(fields).toEqual(['enabled', 'sessionId', 'markdown', 'finalReplyOnly', 'host', 'appId', 'appSecretRef'])
    expect(await card.locator('[data-channels-settings]').getAttribute('data-channels-settings'))
      .not.toBeNull()
    // The settings document came back over the wire, so the form is editable
    // and offers the save control.
    expect(await card.locator('[data-channels-settings-state]').getAttribute('data-channels-settings-state'))
      .toBe('ready')
    expect(await card.locator('[data-channels-save]').count()).toBe(1)
    expect(await card.locator('[data-channels-settings-readonly]').count()).toBe(0)

    // The reload control re-reads the same Host: the settled facts stay.
    await column.locator('[data-channels-reload]').click()
    await column.locator('[data-channels-state="ready"]').waitFor({ timeout: 15_000 })

    const snapshot = await captureStableAria(page, '[data-channels-state="ready"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('reads the channel\'s settings document over the same Remote', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-channels-settings'))
    // The CONTROL shape of this panel: the wire is the suspect when a form
    // stays empty, so the Host's own namespace is read in-process beside it.
    const settings = (scaffold.ctx as unknown as {
      get(name: string): {
        describe(): readonly { ns: string }[]
      } | undefined
    }).get('settings')
    if (settings === undefined) throw new Error('the host settings service is not provided')
    const namespace = settings.describe().find(entry => entry.ns === `chat-channel-${CHANNEL}`)
    // The connector's namespace is registered by the connector row, and the
    // panel's form is that namespace's schema — not a panel-owned copy.
    expect(namespace).toBeDefined()

    const column = page.locator('[data-rightbar-col]')
    await column.locator(`[data-channels-card="${CHANNEL}"] [data-channels-field="enabled"]`)
      .waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md'])
  })
})

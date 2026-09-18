// Keyless assembled-browser coverage for the git observation panel: the
// shipped right Sidebar's `git` tab over the real Host Typert Remote flow.
//
// The scenario seeds the scaffold's own workspace as a real git repository
// (init, one commit, one dirty and one untracked file) through node's execFile
// — the same no-shell argv discipline the provider itself uses — then opens the
// tab from the guide and reads the observation the host's own git produced.
// The absent answer has its own case on its own page: a second workspace the
// scenario never inits, so the toplevel probe answers exit 128.
//
// The golden replaces the commit's oid and day with tokens, because both are
// facts of when this run's `git commit` executed, not of the panel.
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const run = promisify(execFile)

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/sidebar-git', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'panel.expected.md')
const MODE = webSnapshotMode()

/** Run one git command in a directory, through the same no-shell argv form. */
async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
}

/**
 * Open the git tab on a fresh settled session: the right Sidebar starts
 * collapsed behind the header button, and the guide is picked to reach the
 * entry the git type registered.
 */
async function openGitTab(page: Page): Promise<Locator> {
  const column = page.locator('[data-rightbar-col]')
  await page.locator('[data-sidebar-right-expand]').click()
  await column.locator('[data-sidebar-right-open]').waitFor({ timeout: 10_000 })
  await column.locator('[data-dockkit-pane]').first()
    .locator('[data-dockkit-tab]').filter({ hasText: 'Start' }).click()
  await column.locator('[data-sidebar-right-guide-entry="git"]').click()
  return column
}

describe('web e2e: git observation panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  /** The seed commit's short oid and day, read from the repository itself. */
  let seedOid = ''
  let seedDay = ''

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The repository lives in the workspace the session connects to, so the
    // endpoint resolves the same root the host's git observes.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await git(workspace, 'init')
    // This host's git predates --initial-branch; the panel spells the branch
    // it finds, not a convention.
    await git(workspace, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    await git(workspace, 'config', 'user.email', 'e2e@invalid')
    await git(workspace, 'config', 'user.name', 'e2e')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const first = 1\n')
    await git(workspace, 'add', 'src/app.ts')
    await git(workspace, 'commit', '-m', 'first')
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const first = 2\n')
    await writeFile(join(workspace, 'notes.txt'), 'untracked\n')
    const head = await run('git', ['-C', workspace, 'rev-parse', 'HEAD'])
    seedOid = head.stdout.trim().slice(0, 7)
    const day = await run('git', ['-C', workspace, 'log', '-1', '--format=%aI'])
    seedDay = day.stdout.trim().slice(0, 10)
    // A settled session is what keys the surface: seed one turn through the
    // real append path so the frame seats the sidebar before it is driven.
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('connected workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show the git panel.' }],
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

  it('draws the repository the workspace lives in', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-git'))
    const column = await openGitTab(page)
    await column.locator('[data-git-state="repository"]').waitFor({ timeout: 15_000 })

    // The panel observes the workspace the session connected: the same root
    // the host's git probed, spelled in the strip's own tab.
    expect(await column.locator('[data-git-root]').getAttribute('data-git-root')).toBe(join(scaffold.workspaceCwd, 'workspace'))
    await expect.poll(async () =>
      await column.locator('[data-dockkit-tab-title]').allInnerTexts()).toContain('Git')

    const state = column.locator('[data-git-state="repository"]')
    await state.locator('[data-git-branches-current]').getByText('main').waitFor()
    await state.locator('[data-git-worktree="src/app.ts"][data-git-worktree-kind="changed"]').waitFor()
    await state.locator('[data-git-worktree="notes.txt"][data-git-worktree-kind="untracked"]').waitFor()

    // The reload control re-reads the same repository: the settled facts stay.
    await column.locator('[data-git-reload]').click()
    await column.locator('[data-git-state="repository"]').waitFor({ timeout: 15_000 })

    const snapshot = await captureStableAria(page, '[data-git-state="repository"]', scaffold.workspaceCwd, {
      replacements: [[seedOid, '{{seedOid}}'], [seedDay, '{{seedDay}}']],
    })
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('answers absent for a workspace outside any repository', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-git-absent'))
    // Its own page: a fresh session connecting a directory the scenario never
    // inits, so the toplevel probe answers exit 128 and the panel says so.
    const second = await newEnglishPage(browser)
    const secondTripwire = watchConsole(second)
    try {
      // The directory exists before the picker adopts it, like every workspace.
      await mkdir(join(scaffold.workspaceCwd, 'plain'), { recursive: true })
      await second.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await second.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      // The app already knows the first workspace, so the second connection
      // enters through the rail's add-workspace flow rather than the hero's
      // blank-session picker.
      const dialog = second.getByRole('dialog', { name: 'Select Workspace Directory' })
      await second.getByRole('button', { name: 'Add workspace' }).click()
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('button', { name: 'Edit path' }).click()
      const pathInput = dialog.locator('input[aria-label="Edit path"]')
      await pathInput.fill(join(scaffold.workspaceCwd, 'plain'))
      await pathInput.press('Enter')
      await dialog.getByRole('button', { name: 'Open', exact: true }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      // The adopted workspace keys its own blank session; settle one turn on
      // it so the frame seats the second page's sidebar too.
      const plainRoot = join(scaffold.workspaceCwd, 'plain')
      let plain = scaffold.ctx.agents.list().find(candidate => candidate.session.header.cwd === plainRoot)
      for (let attempt = 0; plain === undefined && attempt < 50; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
        plain = scaffold.ctx.agents.list().find(candidate => candidate.session.header.cwd === plainRoot)
      }
      if (plain === undefined) throw new Error('adopting the plain workspace did not create an Agent')
      plain.session.append('turn/start', { turn: 1 })
      plain.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Show the git panel.' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      plain.session.append('step/start', { turn: 1, step: 1 })
      plain.session.append('assistant/message', {
        stream: [],
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'Ready.' }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        }),
      }, { surfaceOp: 'append' })
      plain.session.append('step/end', { turn: 1, step: 1 })
      plain.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await scaffold.ctx.sessions.flush(plain.session)
      await second.getByText('Ready.').waitFor({ timeout: 10_000 })
      await second.locator('[data-sidebar-right-expand]').waitFor({ timeout: 15_000 })
      const column = await openGitTab(second)
      await column.locator('[data-git-state="absent"]').waitFor({ timeout: 15_000 })
      expect(await column.getByText('This session\'s workspace is not inside a git repository.').count()).toBe(1)
      expect(secondTripwire.pageErrors).toEqual([])
    } finally {
      await second.close()
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md'])
  })
})

/** The `write` endpoint: the guarded full-file replace, its version guard, and the read gates it shares. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import { agent, failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-write-')
})

afterEach(async () => {
  await harness.dispose()
})

/** Write `notes.txt` with `text` and answer the version a reader would have seen. */
async function seed(text: string): Promise<string> {
  await writeFile(join(harness.workspace, 'notes.txt'), text, 'utf8')
  return (await harness.endpoint().stat(agent, 'notes.txt', signal())).version
}

/** The file's content on disk, as the caller's own text. */
async function onDisk(): Promise<string> {
  return readFile(join(harness.workspace, 'notes.txt'), 'utf8')
}

describe('workspaceFiles.write — the guarded replace', () => {
  it('replaces the whole file and returns its absolute path, new version, and byte size', async () => {
    const version = await seed('one\n')
    const result = await harness.endpoint().write(agent, 'notes.txt', 'one\ntwo\n', version, signal())
    expect(await onDisk()).toBe('one\ntwo\n')
    expect(result.bytes).toBe(8)
    expect(result.version.length).toBeGreaterThan(0)
    expect(result.version).not.toBe(version)
    expect(result.absolutePath.endsWith('notes.txt')).toBe(true)
  })

  it('answers with the version the next read of the same file reports', async () => {
    const version = await seed('one\n')
    const written = await harness.endpoint().write(agent, 'notes.txt', 'two\n', version, signal())
    const page = await harness.endpoint().read(agent, 'notes.txt', {}, signal())
    expect(page.version).toBe(written.version)
    expect(page).toMatchObject({ text: 'two', lines: 1, eof: true, bytes: 4 })
  })

  it('truncates to an empty file and counts its zero bytes', async () => {
    const version = await seed('one\n')
    const result = await harness.endpoint().write(agent, 'notes.txt', '', version, signal())
    expect(await onDisk()).toBe('')
    expect(result.bytes).toBe(0)
  })

  it('accepts a nested path relative to the workspace root', async () => {
    await mkdir(join(harness.workspace, 'src'), { recursive: true })
    await writeFile(join(harness.workspace, 'src', 'a.ts'), 'export {}\n', 'utf8')
    const before = await harness.endpoint().stat(agent, 'src/a.ts', signal())
    await harness.endpoint().write(agent, 'src/a.ts', 'export const a = 1\n', before.version, signal())
    expect(await readFile(join(harness.workspace, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1\n')
  })

  it('counts the content bytes, not its characters', async () => {
    const version = await seed('x\n')
    const result = await harness.endpoint().write(agent, 'notes.txt', '侧栏\n', version, signal())
    expect(result.bytes).toBe(7)
    expect(await onDisk()).toBe('侧栏\n')
  })
})

describe('workspaceFiles.write — the version guard', () => {
  it('refuses a write whose expected version is not the file\'s, leaving the content alone', async () => {
    const stale = await seed('one\n')
    await writeFile(join(harness.workspace, 'notes.txt'), 'someone else\n', 'utf8')
    const failure = await failureOf(harness.endpoint().write(agent, 'notes.txt', 'mine\n', stale, signal()))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(failure.details).toMatchObject({ path: 'notes.txt' })
    expect(await onDisk()).toBe('someone else\n')
  })

  it('refuses a write when the file changed between the stat and the write', async () => {
    const version = await seed('one\n')
    const fs = harness.ctx.fs
    const stat = fs.stat.bind(fs)
    // The gate's stat is the last thing the service reads before it writes, so
    // mutating behind it is exactly the window the backend's own guard covers.
    vi.spyOn(fs, 'stat').mockImplementation(async (target, s) => {
      const info = await stat(target, s)
      await writeFile(join(harness.workspace, 'notes.txt'), 'concurrent\n', 'utf8')
      return info
    })
    const failure = await failureOf(harness.endpoint().write(agent, 'notes.txt', 'mine\n', version, signal()))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(await onDisk()).toBe('concurrent\n')
  })

  it('refuses content above the byte cap, leaving the content alone', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'one\n', 'utf8')
    const service = harness.endpoint({ maxBytes: 64 })
    const version = (await service.stat(agent, 'notes.txt', signal())).version
    const failure = await failureOf(service.write(agent, 'notes.txt', 'x'.repeat(65), version, signal()))
    expect(failure.code).toBe('workspace-file/too-large')
    expect(failure.details).toMatchObject({ path: 'notes.txt', limit: 64 })
    expect(await onDisk()).toBe('one\n')
  })

  it('accepts content exactly at the cap, because the cap is inclusive', async () => {
    const service = harness.endpoint({ maxBytes: 64 })
    const version = await seed('one\n')
    const content = 'x'.repeat(64)
    expect((await service.write(agent, 'notes.txt', content, version, signal())).bytes).toBe(64)
    expect(await onDisk()).toBe(content)
  })
})

describe('workspaceFiles.write — the backend call', () => {
  it('fences the write by the session\'s resolved sandbox policy', async () => {
    const version = await seed('one\n')
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    await harness.endpoint().write(agent, 'notes.txt', 'two\n', version, signal())
    expect(writeText.mock.calls[0]?.[4]).toEqual({ mode: 'workspace-write', workspaceRoot: harness.workspace })
  })

  it('passes a backend failure that is not a stale refusal through unchanged', async () => {
    const version = await seed('one\n')
    vi.spyOn(harness.ctx.fs, 'writeText').mockRejectedValue(new FsError('disk full', 'FS_IO_ERROR'))
    await expect(harness.endpoint().write(agent, 'notes.txt', 'two\n', version, signal()))
      .rejects.toMatchObject({ code: 'FS_IO_ERROR' })
  })
})

describe('workspaceFiles.write — the read gates', () => {
  it('rejects a symlink, a directory, an outside path, a missing path, and an empty path', async () => {
    await writeFile(join(harness.outside, 'secret.txt'), 'no', 'utf8')
    await symlink(join(harness.outside, 'secret.txt'), join(harness.workspace, 'link.txt'))
    await mkdir(join(harness.workspace, 'src'))
    const service = harness.endpoint()
    const version = await seed('one\n')
    expect(await failureOf(service.write(agent, 'link.txt', 'x', version, signal()))).toMatchObject({
      code: 'workspace-file/not-regular-file',
      details: { kind: 'symlink' },
    })
    expect((await failureOf(service.write(agent, 'src', 'x', version, signal()))).details).toMatchObject({ kind: 'directory' })
    expect((await failureOf(service.write(agent, join(harness.outside, 'secret.txt'), 'x', version, signal()))).code)
      .toBe('workspace-file/outside-workspace')
    expect((await failureOf(service.write(agent, 'nope.txt', 'x', version, signal()))).code).toBe('workspace-file/not-found')
    expect((await failureOf(service.write(agent, '', 'x', version, signal()))).code).toBe('gateway/bad-request')
    expect(await onDisk()).toBe('one\n')
  })
})

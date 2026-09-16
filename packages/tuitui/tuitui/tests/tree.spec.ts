/** Unit coverage for the file-tree helpers: intent parsing, listing, and card persistence round-trips. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  formatSize,
  intentFromAiJson,
  listEntries,
  parseIntent,
  pendingFromDict,
  pendingToDict,
  resolvePath,
} from '../src/tree.ts'

let root: string
let srcDir: string
let readmePath: string
let configPath: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-tuitui-tree-'))
  srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  readmePath = join(root, 'README.md')
  configPath = join(root, 'config.yaml')
  writeFileSync(readmePath, '# Hello\n\nworld\n')
  writeFileSync(configPath, 'a: 1\n')
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'node_modules'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('formatSize', () => {
  it('scales bytes, kilobytes, and megabytes', () => {
    expect(formatSize(512)).toBe('512B')
    expect(formatSize(2048)).toBe('2.0KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0MB')
  })
})

describe('resolvePath', () => {
  it('resolves relative and absolute paths against a base', () => {
    expect(resolvePath(root, 'src')).toBe(srcDir)
    expect(resolvePath(srcDir, '../README.md')).toBe(readmePath)
    expect(resolvePath(root, 'missing', false)).toBe(join(root, 'missing'))
  })

  it('returns empty for a missing required path', () => {
    expect(resolvePath(root, 'does-not-exist')).toBe('')
  })
})

describe('listEntries', () => {
  it('filters hidden and ignored names and sorts directories first', () => {
    const entries = listEntries(root)
    const names = entries.map(entry => entry.name)
    expect(names).toContain('README.md')
    expect(names).toContain('config.yaml')
    expect(names).toContain('src')
    expect(names).not.toContain('.git')
    expect(names).not.toContain('node_modules')
    expect(entries[0]?.isDir).toBe(true)
  })

  it('filters by a case-insensitive query', () => {
    const entries = listEntries(root, false, new Set(['.git', 'node_modules']), 'readme')
    expect(entries.map(entry => entry.name)).toEqual(['README.md'])
  })
})

describe('parseIntent', () => {
  it('recognizes navigation, paging, and search', () => {
    expect(parseIntent('刷新', root)?.kind).toBe('refresh')
    expect(parseIntent('返回', root)?.kind).toBe('up')
    expect(parseIntent('下一页', root)?.page).toBe(-2)
    expect(parseIntent('上一页', root)?.page).toBe(-1)
    expect(parseIntent('第 3 页', root)?.page).toBe(3)
    expect(parseIntent('搜索 server', root)).toMatchObject({ kind: 'search', query: 'server' })
  })

  it('enters a directory and focuses a file', () => {
    expect(parseIntent('打开 src', root)).toMatchObject({ kind: 'enter', path: srcDir })
    expect(parseIntent('查看 README.md', root)).toMatchObject({ kind: 'focus', path: readmePath })
  })

  it('copies, renames, and deletes with confirmation', () => {
    expect(parseIntent('复制 config.yaml 为 config.bak.yaml', root)).toMatchObject({ kind: 'copy', needsConfirm: true, path: configPath })
    expect(parseIntent('重命名 README.md 为 README2.md', root)).toMatchObject({ kind: 'rename', needsConfirm: true, path: readmePath })
    expect(parseIntent('删除 config.yaml', root)).toMatchObject({ kind: 'delete', needsConfirm: true, path: configPath })
  })

  it('sets a working directory via 切到', () => {
    expect(parseIntent('切到 src', root)).toMatchObject({ kind: 'set_cwd', path: srcDir, needsConfirm: true })
  })

  it('returns null for unrecognized text', () => {
    expect(parseIntent('please explain this codebase', root)).toBeNull()
  })
})

describe('intentFromAiJson', () => {
  it('parses a JSON intent, tolerating a prose wrapper', () => {
    const raw = 'Here is the intent: {"kind": "enter", "path": "/tmp"}'
    expect(intentFromAiJson(raw, root)?.kind).toBe('enter')
  })

  it('maps an agent fallback intent', () => {
    expect(intentFromAiJson('{"kind": "agent", "text": "summarize"}', root)).toMatchObject({ kind: 'agent', text: 'summarize' })
  })
})

describe('pending round-trip', () => {
  it('serializes and restores one pending intent', () => {
    const intent = parseIntent('删除 config.yaml', root)!
    const restored = pendingFromDict(pendingToDict(intent))
    expect(restored).toMatchObject({ kind: 'delete', path: configPath, needsConfirm: true })
  })

  it('returns null for an absent pending intent', () => {
    expect(pendingToDict(null)).toBeNull()
    expect(pendingFromDict(undefined)).toBeNull()
  })
})

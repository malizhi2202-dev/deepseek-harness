/**
 * Regression detection for `uniqueRepoFiles` symlink discovery: a `**` glob
 * that reaches a symlink to a file must not raise ENOTDIR, must still find
 * the symlink's real target, and must dedupe both paths to one entry without
 * dropping regular files.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { uniqueRepoFiles } from './repo-files.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('uniqueRepoFiles symlink discovery', () => {
  it('does not descend into a symlink to a file and deduplicates its target', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo-files-'))
    roots.push(root)
    mkdirSync(join(root, 'snapshots', 'session', 'read-image'), { recursive: true })
    mkdirSync(join(root, 'snapshots', 'acp', 'image-compaction'), { recursive: true })
    writeFileSync(join(root, 'snapshots', 'session', 'read-image', 'system-prompt.expected.md'), '# real\n')
    symlinkSync(
      '../../session/read-image/system-prompt.expected.md',
      join(root, 'snapshots', 'acp', 'image-compaction', 'system-prompt.expected.md'),
    )

    // Would raise ENOTDIR before the traversal guard.
    const files = uniqueRepoFiles(root, ['snapshots/**/system-prompt.expected.md'])

    expect(files.map(f => f.real)).toEqual([
      join(root, 'snapshots', 'session', 'read-image', 'system-prompt.expected.md'),
    ])
  })

  it('still matches every regular file under a `**` pattern', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo-files-'))
    roots.push(root)
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'a.md'), '# a\n')
    writeFileSync(join(root, 'docs', 'b.md'), '# b\n')

    const files = uniqueRepoFiles(root, ['docs/**/*.md'])

    expect(files.map(f => f.real)).toEqual([join(root, 'docs', 'a.md'), join(root, 'docs', 'b.md')])
  })
})

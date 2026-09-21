/**
 * Tests for the reply-file candidate list: which path-shaped tokens a reply
 * contains, and which of those could denote a workspace file at all.
 */
import { describe, expect, it } from 'vitest'
import { replyFileMentions, workspaceRelativePath } from '../src/mentions.ts'

describe('workspaceRelativePath', () => {
  it('keeps a plain relative path', () => {
    expect(workspaceRelativePath('src/a.ts')).toBe('src/a.ts')
  })

  it('strips a leading ./ and normalizes backslashes', () => {
    expect(workspaceRelativePath('./src/a.ts')).toBe('src/a.ts')
    expect(workspaceRelativePath('src\\a.ts')).toBe('src/a.ts')
  })

  it('refuses a URL', () => {
    expect(workspaceRelativePath('https://host.invalid/a.ts')).toBeNull()
  })

  it('refuses anything containing whitespace', () => {
    expect(workspaceRelativePath('src/a b.ts')).toBeNull()
  })

  it('refuses an absolute path', () => {
    expect(workspaceRelativePath('/etc/hosts')).toBeNull()
    expect(workspaceRelativePath('\\\\host\\share\\a.ts')).toBeNull()
  })

  it('refuses a home path', () => {
    expect(workspaceRelativePath('~/.ssh/id_rsa')).toBeNull()
  })

  it('refuses a Windows drive path', () => {
    expect(workspaceRelativePath('C:\\Users\\a.ts')).toBeNull()
  })

  it('refuses a path that climbs out of the workspace', () => {
    expect(workspaceRelativePath('a/../b.ts')).toBeNull()
  })

  it('refuses a path with an empty segment', () => {
    expect(workspaceRelativePath('a//b.ts')).toBeNull()
  })

  it('refuses a token that denotes nothing after normalization', () => {
    expect(workspaceRelativePath('./')).toBeNull()
  })
})

describe('replyFileMentions', () => {
  it('finds a backtick-quoted path', () => {
    expect(replyFileMentions('wrote `src/a.ts` just now')).toEqual([{ mentioned: 'src/a.ts', rel: 'src/a.ts' }])
  })

  it('finds a bare path-shaped token', () => {
    expect(replyFileMentions('wrote src/a.ts just now')).toEqual([{ mentioned: 'src/a.ts', rel: 'src/a.ts' }])
  })

  it('finds a path at the very start of the reply', () => {
    expect(replyFileMentions('src/a.ts is written')).toEqual([{ mentioned: 'src/a.ts', rel: 'src/a.ts' }])
  })

  it('skips a token that is only whitespace', () => {
    expect(replyFileMentions('a `   ` b')).toEqual([])
  })

  it('deduplicates tokens that denote the same path', () => {
    expect(replyFileMentions('`src/a.ts` and src/a.ts')).toEqual([{ mentioned: 'src/a.ts', rel: 'src/a.ts' }])
  })

  it('deduplicates tokens that denote nothing, by what they spelled', () => {
    expect(replyFileMentions('`~/.ssh/id_rsa` and ~/.ssh/id_rsa')).toEqual([
      { mentioned: '~/.ssh/id_rsa', rel: null },
    ])
  })

  it('keeps a token that cannot denote a workspace file, with a null path', () => {
    expect(replyFileMentions('see `/etc/hosts`')).toEqual([{ mentioned: '/etc/hosts', rel: null }])
  })

  it('keeps distinct tokens in the order the reply spelled them', () => {
    expect(replyFileMentions('`b.ts` then `a.ts`')).toEqual([
      { mentioned: 'b.ts', rel: 'b.ts' },
      { mentioned: 'a.ts', rel: 'a.ts' },
    ])
  })
})

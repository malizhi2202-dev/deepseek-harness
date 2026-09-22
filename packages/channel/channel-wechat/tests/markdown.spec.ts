/**
 * Pins WeChat's own Markdown downgrade and chunking: every marker the platform
 * cannot render is removed while its content survives, a fenced code block keeps
 * its fence, an image is dropped because the platform has nowhere to show it,
 * and chunking lands on paragraph and line boundaries at exact limits.
 */
import { describe, expect, it } from 'vitest'
import { chunkWechatText, downgradeWechatMarkdown } from '../src/markdown.ts'

describe('downgradeWechatMarkdown', () => {
  it('strips headings and block-quote markers', () => {
    expect(downgradeWechatMarkdown('# Title\n## Sub\n> quoted\ntext')).toBe('Title\nSub\nquoted\ntext')
  })

  it('drops an image entirely', () => {
    expect(downgradeWechatMarkdown('before ![alt](https://example.invalid/a.png) after'))
      .toBe('before  after')
  })

  it('reduces a link to its text and target', () => {
    expect(downgradeWechatMarkdown('see [the docs](https://example.invalid/d)'))
      .toBe('see the docs (https://example.invalid/d)')
  })

  it('removes bold, italic, strikethrough, and inline-code markers', () => {
    expect(downgradeWechatMarkdown('**bold** _italic_ ~~gone~~ `code`'))
      .toBe('bold italic gone code')
  })

  it('keeps a fenced code block verbatim', () => {
    const source = 'text\n```ts\nconst a = 1\n```\nafter'
    expect(downgradeWechatMarkdown(source)).toBe(source)
  })

  it('downgrades the text around a fence and leaves the fence alone', () => {
    expect(downgradeWechatMarkdown('**before**\n```\n# not a heading\n```\n**after**'))
      .toBe('before\n```\n# not a heading\n```\nafter')
  })
})

describe('chunkWechatText', () => {
  it('returns nothing for text that carries nothing to send', () => {
    expect(chunkWechatText('', 10)).toEqual([])
    expect(chunkWechatText('   \n ', 10)).toEqual([])
  })

  it('returns the whole text when it fits exactly', () => {
    expect(chunkWechatText('abcde', 5)).toEqual(['abcde'])
  })

  it('splits one character past the limit', () => {
    expect(chunkWechatText('abcdef', 5)).toEqual(['abcde', 'f'])
  })

  it('splits at a paragraph boundary when one is inside the window', () => {
    expect(chunkWechatText('one\n\ntwo\n\nthree', 8)).toEqual(['one\n\ntwo', 'three'])
  })

  it('splits at a line boundary when no blank line is inside the window', () => {
    expect(chunkWechatText('one\ntwo\nthree', 8)).toEqual(['one\ntwo', 'three'])
  })

  it('splits at the cap when neither boundary is inside the window', () => {
    expect(chunkWechatText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('holds at a limit of one character', () => {
    expect(chunkWechatText('abc', 1)).toEqual(['a', 'b', 'c'])
  })

  it('drops the leading blank lines rather than spending a chunk on them', () => {
    expect(chunkWechatText('\n\nabcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })

  it('returns nothing for a body that is only blank lines after its text', () => {
    expect(chunkWechatText(`ab${'\n'.repeat(10)}`, 3)).toEqual(['ab'])
  })

  it('takes a paragraph boundary from the window\'s back half', () => {
    expect(chunkWechatText('aaaaaa\n\nbb', 8)).toEqual(['aaaaaa', 'bb'])
  })
})

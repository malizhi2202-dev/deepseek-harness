/**
 * Pins QQ's own Markdown downgrade and chunking: the fence markers go and the
 * code stays, an image keeps its description and URL, the remaining markers are
 * removed with their content kept, and chunking packs whole paragraphs before
 * cutting one that is itself too long.
 */
import { describe, expect, it } from 'vitest'
import { chunkQqText, downgradeQqMarkdown } from '../src/markdown.ts'

describe('downgradeQqMarkdown', () => {
  it('strips headings and block-quote markers', () => {
    expect(downgradeQqMarkdown('# Title\n> quoted\ntext')).toBe('Title\nquoted\ntext')
  })

  it('keeps an image description and URL', () => {
    expect(downgradeQqMarkdown('![a cat](https://example.invalid/c.png)')).toBe('a cat (https://example.invalid/c.png)')
  })

  it('reduces a link to its text and target', () => {
    expect(downgradeQqMarkdown('see [the docs](https://example.invalid/d)')).toBe('see the docs (https://example.invalid/d)')
  })

  it('removes bold, italic, strikethrough, and inline-code markers', () => {
    expect(downgradeQqMarkdown('**bold** _italic_ ~~gone~~ `code`')).toBe('bold italic gone code')
  })

  it('removes a fenced block and keeps its code', () => {
    expect(downgradeQqMarkdown('before\n```ts\nconst a = 1\n```\nafter')).toBe('before\nconst a = 1\nafter')
  })

  it('downgrades the text around a fence', () => {
    expect(downgradeQqMarkdown('**before**\n```\ncode\n```\n**after**')).toBe('before\ncode\nafter')
  })

  it('treats an unterminated fence as decoration and keeps its content', () => {
    expect(downgradeQqMarkdown('```\n**code**')).toBe('\ncode')
  })
})

describe('chunkQqText', () => {
  it('returns nothing for text that carries nothing to send', () => {
    expect(chunkQqText('', 10)).toEqual([])
    expect(chunkQqText('  \n ', 10)).toEqual([])
  })

  it('returns the whole text when it fits exactly', () => {
    expect(chunkQqText('abcde', 5)).toEqual(['abcde'])
  })

  it('packs several paragraphs into one chunk while they fit', () => {
    expect(chunkQqText('one\n\ntwo', 10)).toEqual(['one\n\ntwo'])
  })

  it('starts a new chunk when the next paragraph would not fit', () => {
    expect(chunkQqText('one\n\ntwo', 5)).toEqual(['one', 'two'])
  })

  it('cuts a paragraph that is itself longer than the budget', () => {
    expect(chunkQqText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })

  it('continues packing after an oversized paragraph', () => {
    expect(chunkQqText('abcdefgh\n\nij', 3)).toEqual(['abc', 'def', 'gh', 'ij'])
  })

  it('drops a trailing empty paragraph', () => {
    expect(chunkQqText('a\n\n\n\n', 2)).toEqual(['a'])
  })

  it('holds at a limit of one character', () => {
    expect(chunkQqText('abc', 1)).toEqual(['a', 'b', 'c'])
  })
})

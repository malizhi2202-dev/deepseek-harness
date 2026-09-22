import { describe, expect, it } from 'vitest'
import { ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'
import { renderDingTalkMarkdown, titleOf, toDingTalkMarkdown } from '../src/markdown.ts'

describe('toDingTalkMarkdown', () => {
  it('removes fence delimiters and keeps the code they enclosed', () => {
    expect(toDingTalkMarkdown('```js\nconst a = 1\n```')).toBe('const a = 1')
    expect(toDingTalkMarkdown('before\n```\nplain\n```\nafter')).toBe('before\nplain\nafter')
    expect(toDingTalkMarkdown('  ~~~\nindented\n  ~~~')).toBe('indented')
    expect(toDingTalkMarkdown('```\n```')).toBe('')
  })

  it('leaves an unterminated fence exactly as written', () => {
    expect(toDingTalkMarkdown('```\nconst a = 1')).toBe('```\nconst a = 1')
  })

  it('leaves headings, lists, and emphasis as written because DingTalk renders them', () => {
    expect(toDingTalkMarkdown('# Title\n- item\n**bold**')).toBe('# Title\n- item\n**bold**')
    expect(toDingTalkMarkdown('')).toBe('')
  })
})

describe('renderDingTalkMarkdown', () => {
  it('accepts a rendered message exactly at the byte ceiling', () => {
    expect(renderDingTalkMarkdown('```\nabc\n```', 3)).toBe('abc')
  })

  it('refuses a rendered message one byte past the ceiling, which the bridge resends plainly', () => {
    expect(() => renderDingTalkMarkdown('```\nabcd\n```', 3)).toThrow(ChatFormatRejectedError)
    expect(() => renderDingTalkMarkdown('```\nabcd\n```', 3)).toThrow(
      'the rendered message is 4 bytes, past the 3 this channel accepts',
    )
  })

  it('measures bytes rather than characters, so Chinese costs three times the ceiling', () => {
    expect(renderDingTalkMarkdown('中中中', 9)).toBe('中中中')
    expect(() => renderDingTalkMarkdown('中中中', 8)).toThrow(
      'the rendered message is 9 bytes, past the 8 this channel accepts',
    )
  })
})

describe('titleOf', () => {
  it('takes the first non-empty line, trimmed and truncated', () => {
    expect(titleOf('\n\n  Hello world  \nmore text', 16)).toBe('Hello world')
    expect(titleOf('abcdefghijklmnopqrstuvwxyz', 16)).toBe('abcdefghijklmnop')
  })

  it('reports an empty title when the message has no non-empty line', () => {
    expect(titleOf('\n\n   ', 16)).toBe('')
    expect(titleOf('', 16)).toBe('')
  })
})

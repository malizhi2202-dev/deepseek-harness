import { describe, expect, it } from 'vitest'
import { ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'
import { renderLarkMarkdown, toLarkMarkdown } from '../src/markdown.ts'

describe('toLarkMarkdown', () => {
  it('turns each heading into a bold line because lark_md has no headings', () => {
    expect(toLarkMarkdown('# Title')).toBe('**Title**')
    expect(toLarkMarkdown('### Deep')).toBe('**Deep**')
    expect(toLarkMarkdown('  ## Indented')).toBe('**Indented**')
    expect(toLarkMarkdown('#Title')).toBe('#Title')
    expect(toLarkMarkdown('    #### Four spaces')).toBe('    #### Four spaces')
    expect(toLarkMarkdown('####### Seven hashes')).toBe('####### Seven hashes')
  })

  it('renders a heading with no text as an empty bold line', () => {
    expect(toLarkMarkdown('#')).toBe('****')
  })

  it('drops fence delimiters and keeps the code they enclosed', () => {
    expect(toLarkMarkdown('before\n```js\nconst a = 1\n```\nafter')).toBe('before\nconst a = 1\nafter')
    expect(toLarkMarkdown('~~~\nplain\n~~~')).toBe('plain')
  })

  it('leaves a heading inside a fence as written', () => {
    expect(toLarkMarkdown('```\n# not a heading\n```')).toBe('# not a heading')
  })

  it('leaves text outside headings and fences unchanged', () => {
    expect(toLarkMarkdown('**bold** and [a link](https://example.invalid)\n- item')).toBe(
      '**bold** and [a link](https://example.invalid)\n- item',
    )
    expect(toLarkMarkdown('')).toBe('')
  })
})

describe('renderLarkMarkdown', () => {
  it('accepts a rendered message exactly at the ceiling', () => {
    expect(renderLarkMarkdown('# x', 5)).toBe('**x**')
  })

  it('refuses a rendered message past the ceiling, which the bridge resends plainly', () => {
    expect(() => renderLarkMarkdown('# x', 4)).toThrow(ChatFormatRejectedError)
    expect(() => renderLarkMarkdown('# x', 4)).toThrow(
      'the rendered message is 5 characters, past the 4 this channel accepts',
    )
  })

  it('measures the converted text, not the text it was given', () => {
    expect(renderLarkMarkdown('# abc', 7)).toBe('**abc**')
    expect(() => renderLarkMarkdown('# abc', 6)).toThrow(ChatFormatRejectedError)
  })
})

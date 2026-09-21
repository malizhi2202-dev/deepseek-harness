/**
 * Tests for the output-window fold: one bounded scrollback page becomes either
 * the text a panel has not seen or the whole page as a replacement view.
 */

import { describe, expect, it } from 'vitest'
import { advanceConsoleOutput, EMPTY_OUTPUT_WINDOW } from '../src/output-window.ts'

describe('advanceConsoleOutput', () => {
  it('reports idle when the page repeats what was already sent', () => {
    const window = { text: 'one\ntwo' }
    expect(advanceConsoleOutput(window, 'one\ntwo')).toEqual({ kind: 'idle', window })
  })

  it('appends the whole first page to an empty window', () => {
    expect(advanceConsoleOutput(EMPTY_OUTPUT_WINDOW, 'prompt$ ')).toEqual({
      kind: 'append',
      window: { text: 'prompt$ ' },
      text: 'prompt$ ',
    })
  })

  it('appends only the text past what was already sent', () => {
    expect(advanceConsoleOutput({ text: 'one\n' }, 'one\ntwo\n')).toEqual({
      kind: 'append',
      window: { text: 'one\ntwo\n' },
      text: 'two\n',
    })
  })

  it('replaces the view when the page no longer begins with what was sent', () => {
    expect(advanceConsoleOutput({ text: 'one\ntwo' }, 'two\nthree')).toEqual({
      kind: 'replace',
      window: { text: 'two\nthree' },
      text: 'two\nthree',
    })
  })

  it('replaces the view when the retained page shrank below what was sent', () => {
    expect(advanceConsoleOutput({ text: 'one\ntwo' }, 'two')).toEqual({
      kind: 'replace',
      window: { text: 'two' },
      text: 'two',
    })
  })

  it('reports idle for two empty pages', () => {
    expect(advanceConsoleOutput(EMPTY_OUTPUT_WINDOW, '')).toEqual({ kind: 'idle', window: EMPTY_OUTPUT_WINDOW })
  })
})

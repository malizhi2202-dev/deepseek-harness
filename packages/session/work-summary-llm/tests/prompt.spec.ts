import { describe, expect, it } from 'vitest'
import { frameRequest, parseProposal, systemPrompt } from '@deepseek-ai/dsh-work-summary-llm'
import type { WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'

const REQUEST: WorkSummaryRequest = {
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  turn: 4,
  endReason: 'completed',
  paths: [
    { path: 'src/a.ts', insertions: 2, deletions: 1, binary: false },
    { path: 'logo.png', insertions: 0, deletions: 0, binary: true },
  ],
}

describe('systemPrompt', () => {
  it('requires a conventional-commit subject and forbids invented content', () => {
    const prompt = systemPrompt()
    expect(prompt).toContain('conventional-commit header')
    expect(prompt).toContain('do not invent files')
  })
})

describe('frameRequest', () => {
  it('frames the work unit as JSON carrying every diff fact', () => {
    const framed = frameRequest(REQUEST)
    expect(framed.startsWith('Summarize this work unit:\n{')).toBe(true)
    const payload = JSON.parse(framed.slice(framed.indexOf('{'))) as {
      sessionId: string
      files: { path: string; binary: boolean }[]
    }
    expect(payload.sessionId).toBe('sess-1')
    expect(payload.files).toEqual([
      { path: 'src/a.ts', insertions: 2, deletions: 1, binary: false },
      { path: 'logo.png', insertions: 0, deletions: 0, binary: true },
    ])
  })
})

describe('parseProposal', () => {
  it('takes the first non-empty line as the subject and the rest as the body', () => {
    expect(parseProposal('feat: add it\n\nwhy it matters\nmore detail', 5)).toEqual({
      subject: 'feat: add it',
      body: ['why it matters', 'more detail'],
    })
  })

  it('ignores leading blank lines and trailing blank lines', () => {
    expect(parseProposal('\n\n  feat: add it  \n\nbody\n\n\n', 5)).toEqual({
      subject: 'feat: add it',
      body: ['body'],
    })
  })

  it('drops a surrounding Markdown fence', () => {
    expect(parseProposal('```\nfeat: add it\n```\n', 5)).toEqual({ subject: 'feat: add it', body: [] })
    expect(parseProposal('```markdown\nfeat: add it\n```', 5)).toEqual({ subject: 'feat: add it', body: [] })
  })

  it('strips a trailing carriage return', () => {
    expect(parseProposal('feat: add it\r\nbody\r\n', 5)).toEqual({ subject: 'feat: add it', body: ['body'] })
  })

  it('bounds the body to the configured line count', () => {
    expect(parseProposal('feat: add it\n\na\nb\nc', 2)).toEqual({ subject: 'feat: add it', body: ['a', 'b'] })
  })

  it('returns undefined when the reply carries no non-empty line', () => {
    expect(parseProposal('', 5)).toBe(undefined)
    expect(parseProposal('  \n \n', 5)).toBe(undefined)
  })

  it('returns undefined for a reply that is only a fence', () => {
    expect(parseProposal('```\n```', 5)).toBe(undefined)
  })

  it('keeps a body that is only blank lines out of the proposal', () => {
    expect(parseProposal('feat: add it\n\n\n', 5)).toEqual({ subject: 'feat: add it', body: [] })
  })
})

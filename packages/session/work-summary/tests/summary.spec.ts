import { describe, expect, it } from 'vitest'
import {
  assembleMessage,
  commonPathScope,
  describePath,
  mechanicalMessage,
  renderMessage,
  resolveMessagePolicy,
  truncateUtf8,
  unitTrailer,
  validateProposal,
  type MessagePolicy,
} from '@deepseek-ai/dsh-work-summary'
import type { WorkSummaryMessage, WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'

const policy: MessagePolicy = {
  commitTypes: ['feat', 'fix', 'chore'],
  allowBreaking: false,
  fallbackType: 'chore',
  maxSubjectBytes: 72,
  maxBodyLines: 50,
  maxMessageBytes: 4096,
  trailerName: 'Dsh-Unit',
}

const request: WorkSummaryRequest = {
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  turn: 7,
  endReason: 'stop',
  paths: [
    { path: 'src/a.ts', insertions: 3, deletions: 1, binary: false },
    { path: 'src/b.ts', insertions: 0, deletions: 2, binary: false },
  ],
}

describe('truncateUtf8', () => {
  it('returns an empty string for a non-positive budget', () => {
    expect(truncateUtf8('abc', 0)).toBe('')
    expect(truncateUtf8('abc', -5)).toBe('')
  })

  it('cuts on a code-point boundary rather than a byte boundary', () => {
    expect(truncateUtf8('中文', 3)).toBe('中')
    expect(truncateUtf8('中文', 4)).toBe('中')
    expect(truncateUtf8('中文', 6)).toBe('中文')
  })

  it('keeps the whole string when it fits exactly', () => {
    expect(truncateUtf8('abcd', 4)).toBe('abcd')
  })
})

describe('commonPathScope', () => {
  it('returns the deepest shared directory', () => {
    expect(commonPathScope(['src/a.ts', 'src/b.ts'])).toBe('src')
    expect(commonPathScope(['packages/git/a.ts', 'packages/git/b.ts', 'packages/git/c/d.ts'])).toBe('packages/git')
  })

  it('returns undefined when the paths share no directory', () => {
    expect(commonPathScope(['a.ts', 'b.ts'])).toBe(undefined)
    expect(commonPathScope(['src/a.ts', 'tests/b.ts'])).toBe(undefined)
  })

  it('returns undefined for an empty path list', () => {
    expect(commonPathScope([])).toBe(undefined)
  })

  it('returns undefined for one path with no directory', () => {
    expect(commonPathScope(['README.md'])).toBe(undefined)
  })
})

describe('unitTrailer', () => {
  it('names the session and turn', () => {
    expect(unitTrailer('sess-1', 7, policy)).toBe('Dsh-Unit: sess-1/7')
  })
})

describe('describePath', () => {
  it('reports line counts for a text path and no counts for a binary one', () => {
    expect(describePath({ path: 'a.ts', insertions: 3, deletions: 1, binary: false })).toBe('a.ts | +3/-1')
    expect(describePath({ path: 'logo.png', insertions: 0, deletions: 0, binary: true })).toBe('logo.png | binary')
  })
})

describe('mechanicalMessage', () => {
  it('states only facts the path facts carry', () => {
    const message = mechanicalMessage(request, policy)
    expect(message.subject).toBe('chore(src): update 2 file(s), +3/-3')
    expect(message.body).toEqual(['src/a.ts | +3/-1', 'src/b.ts | +0/-2'])
    expect(message.trailer).toBe('Dsh-Unit: sess-1/7')
  })

  it('omits the scope when the paths share no directory', () => {
    const message = mechanicalMessage({ ...request, paths: [{ path: 'a.ts', insertions: 1, deletions: 0, binary: false }] }, policy)
    expect(message.subject).toBe('chore: update 1 file(s), +1/-0')
  })

  it('cuts the subject to the subject byte budget', () => {
    const message = mechanicalMessage(request, { ...policy, maxSubjectBytes: 5 })
    expect(message.subject).toBe('chore')
  })
})

describe('assembleMessage', () => {
  it('separates subject, body, and trailer with blank lines', () => {
    const message: WorkSummaryMessage = { subject: 'feat: x', body: ['one', 'two'], trailer: 'Dsh-Unit: s/1' }
    expect(assembleMessage(message)).toBe('feat: x\n\none\ntwo\n\nDsh-Unit: s/1')
  })

  it('omits the body block when there are no body lines', () => {
    expect(assembleMessage({ subject: 'feat: x', body: [], trailer: 'Dsh-Unit: s/1' }))
      .toBe('feat: x\n\nDsh-Unit: s/1')
  })
})

describe('renderMessage', () => {
  const message: WorkSummaryMessage = {
    subject: 'feat: add a thing',
    body: ['one', 'two'],
    trailer: 'Dsh-Unit: s/1',
  }

  it('returns an empty string for a non-positive budget', () => {
    expect(renderMessage(message, { ...policy, maxMessageBytes: 0 })).toBe('')
  })

  it('keeps the subject alone when the trailer does not fit', () => {
    expect(renderMessage(message, { ...policy, maxMessageBytes: 5 })).toBe('feat:')
  })

  it('keeps the subject alone when the trailer cannot be reserved', () => {
    // room = 14 - 13 - 2 = -1, so the trailer is dropped.
    expect(renderMessage(message, { ...policy, maxMessageBytes: 14 })).toBe('feat: add a th')
  })

  it('keeps the trailer and as many body lines as fit exactly', () => {
    const exact = Buffer.byteLength('feat: add a thing\n\none\n\nDsh-Unit: s/1', 'utf8')
    expect(renderMessage(message, { ...policy, maxMessageBytes: exact }))
      .toBe('feat: add a thing\n\none\n\nDsh-Unit: s/1')
  })

  it('drops every body line when one byte less than the first body line is allowed', () => {
    const withFirst = Buffer.byteLength('feat: add a thing\n\none\n\nDsh-Unit: s/1', 'utf8')
    expect(renderMessage(message, { ...policy, maxMessageBytes: withFirst - 1 }))
      .toBe('feat: add a thing\n\nDsh-Unit: s/1')
  })

  it('applies the body line budget before the byte budget', () => {
    expect(renderMessage(message, { ...policy, maxBodyLines: 1 }))
      .toBe('feat: add a thing\n\none\n\nDsh-Unit: s/1')
  })
})

describe('validateProposal', () => {
  it('accepts a subject whose type is declared', () => {
    const verdict = validateProposal({ subject: 'fix(scope): correct it', body: ['why'] }, request, policy)
    expect(verdict).toEqual({
      kind: 'accepted',
      message: { subject: 'fix(scope): correct it', body: ['why'], trailer: 'Dsh-Unit: sess-1/7' },
    })
  })

  it('rejects an empty subject', () => {
    expect(validateProposal({ subject: '   ', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'empty-subject' })
  })

  it('rejects a subject carrying a newline', () => {
    expect(validateProposal({ subject: 'fix: a\nb', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'multiline-subject' })
    expect(validateProposal({ subject: 'fix: a\rb', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'multiline-subject' })
  })

  it('rejects a subject that is not a conventional-commit header', () => {
    expect(validateProposal({ subject: 'Fix the thing', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'malformed-subject' })
  })

  it('rejects a type the deployment did not declare', () => {
    expect(validateProposal({ subject: 'wip: something', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'unknown-type' })
  })

  it('rejects a breaking marker the deployment did not allow', () => {
    expect(validateProposal({ subject: 'feat!: drop it', body: [] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'breaking-not-allowed' })
  })

  it('rejects a breaking trailer in the body the deployment did not allow', () => {
    expect(validateProposal({ subject: 'feat: drop it', body: ['BREAKING CHANGE: gone'] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'breaking-not-allowed' })
    expect(validateProposal({ subject: 'feat: drop it', body: ['BREAKING-CHANGE: gone'] }, request, policy))
      .toEqual({ kind: 'rejected', reason: 'breaking-not-allowed' })
  })

  it('accepts a breaking marker when the deployment allows it', () => {
    const verdict = validateProposal({ subject: 'feat!: drop it', body: [] }, request, { ...policy, allowBreaking: true })
    expect(verdict.kind).toBe('accepted')
  })

  it('rejects a subject past the subject byte budget', () => {
    expect(validateProposal({ subject: 'fix: abcdef', body: [] }, request, { ...policy, maxSubjectBytes: 5 }))
      .toEqual({ kind: 'rejected', reason: 'subject-too-long' })
  })

  it('rejects a body past the body line budget', () => {
    expect(validateProposal({ subject: 'fix: it', body: ['a', 'b'] }, request, { ...policy, maxBodyLines: 1 }))
      .toEqual({ kind: 'rejected', reason: 'too-many-body-lines' })
  })

  it('rejects a proposal whose complete message exceeds the message byte budget', () => {
    expect(validateProposal({ subject: 'fix: it', body: [] }, request, { ...policy, maxMessageBytes: 10 }))
      .toEqual({ kind: 'rejected', reason: 'message-too-long' })
  })
})

describe('resolveMessagePolicy', () => {
  it('resolves the documented defaults', () => {
    expect(resolveMessagePolicy({})).toEqual({
      commitTypes: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'],
      allowBreaking: false,
      fallbackType: 'chore',
      maxSubjectBytes: 72,
      maxBodyLines: 50,
      maxMessageBytes: 4096,
      trailerName: 'Dsh-Unit',
    })
  })

  it('rejects an empty type vocabulary', () => {
    expect(() => resolveMessagePolicy({ commitTypes: [] })).toThrow('commitTypes must not be empty')
  })

  it('rejects a type that is not a conventional-commit type', () => {
    expect(() => resolveMessagePolicy({ commitTypes: ['Feat'] })).toThrow('lowercase conventional-commit type')
  })

  it('rejects a fallback type outside the vocabulary', () => {
    expect(() => resolveMessagePolicy({ fallbackType: 'wip' })).toThrow('is not one of commitTypes')
  })

  it('rejects an empty trailer key', () => {
    expect(() => resolveMessagePolicy({ trailerName: ' ' })).toThrow('trailerName must be a non-empty')
  })

  it('rejects a trailer key carrying a colon or newline', () => {
    expect(() => resolveMessagePolicy({ trailerName: 'A:B' })).toThrow('trailerName must be a non-empty')
    expect(() => resolveMessagePolicy({ trailerName: 'A\nB' })).toThrow('trailerName must be a non-empty')
  })
})

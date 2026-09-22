import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { attributablePaths, parseArguments, toRepoRelative } from '@deepseek-ai/dsh-workspace-automation'

/** One `tool/call` event, as the session log records it. */
function call(turn: number, callId: string, name: string, args: unknown): SessionEvent {
  return {
    type: 'tool/call',
    data: { turn, step: 1, callId, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  } as unknown as SessionEvent
}

/** One `tool/result` event, as the session log records it. */
function result(callId: string, failed = false): SessionEvent {
  return {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: { content: [{ toolCallId: callId, isError: failed }] },
      ...(failed ? { error: { name: 'ToolError', code: 'failed' } } : {}),
    },
  } as unknown as SessionEvent
}

const WORKSPACE = '/work/repo'
const ROOT = '/work/repo'

describe('parseArguments', () => {
  it('parses a JSON object', () => {
    expect(parseArguments('{"file_path":"a.ts"}')).toEqual({ file_path: 'a.ts' })
  })

  it('rejects a non-object, an array, and unusable JSON', () => {
    expect(parseArguments('null')).toBe(undefined)
    expect(parseArguments('"text"')).toBe(undefined)
    expect(parseArguments('[1]')).toBe(undefined)
    expect(parseArguments('{')).toBe(undefined)
  })
})

describe('toRepoRelative', () => {
  it('resolves a relative path against the workspace directory', () => {
    expect(toRepoRelative('src/a.ts', WORKSPACE, ROOT)).toBe('src/a.ts')
  })

  it('resolves an absolute path inside the repository', () => {
    expect(toRepoRelative('/work/repo/src/a.ts', WORKSPACE, ROOT)).toBe('src/a.ts')
  })

  it('expresses a workspace subdirectory path relative to the repository root', () => {
    expect(toRepoRelative('src/a.ts', '/work/repo/pkg', ROOT)).toBe('pkg/src/a.ts')
  })

  it('rejects a path outside the repository', () => {
    expect(toRepoRelative('/etc/passwd', WORKSPACE, ROOT)).toBe(undefined)
    expect(toRepoRelative('../../etc/passwd', WORKSPACE, ROOT)).toBe(undefined)
  })

  it('rejects the repository root itself', () => {
    expect(toRepoRelative('.', WORKSPACE, ROOT)).toBe(undefined)
  })
})

describe('attributablePaths', () => {
  it('attributes a written path proven by a successful result', () => {
    const events = [call(2, 'c1', 'write', { file_path: 'src/a.ts' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: ['src/a.ts'], unresolved: 0 })
  })

  it('attributes an edited path', () => {
    const events = [call(2, 'c1', 'edit', { file_path: 'src/a.ts' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT).paths).toEqual(['src/a.ts'])
  })

  it('attributes a content-changing str_replace_editor command', () => {
    const events = [
      call(2, 'c1', 'str_replace_editor', { command: 'str_replace', path: 'src/a.ts' }),
      result('c1'),
    ]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT).paths).toEqual(['src/a.ts'])
  })

  it('ignores a viewing str_replace_editor command', () => {
    const events = [call(2, 'c1', 'str_replace_editor', { command: 'view', path: 'src/a.ts' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('counts a call whose result never arrived as unresolved', () => {
    const events = [call(2, 'c1', 'write', { file_path: 'src/a.ts' })]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 1 })
  })

  it('counts a failed result as unresolved', () => {
    const events = [call(2, 'c1', 'write', { file_path: 'src/a.ts' }), result('c1', true)]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 1 })
  })

  it('counts a result carrying an error envelope as unresolved', () => {
    const events = [call(2, 'c1', 'write', { file_path: 'src/a.ts' }), result('c1')]
    const [failed] = [events[1] as SessionEvent]
    const withError = {
      ...failed,
      data: { ...failed.data, error: { name: 'ToolError', code: 'failed' } },
    } as unknown as SessionEvent
    expect(attributablePaths([events[0] as SessionEvent, withError], 2, WORKSPACE, ROOT).unresolved).toBe(1)
  })

  it('counts a result whose block is marked as an error', () => {
    const events = [
      call(2, 'c1', 'write', { file_path: 'src/a.ts' }),
      {
        type: 'tool/result',
        data: { turn: 2, step: 1, message: { content: [{ toolCallId: 'c1', isError: true }] } },
      } as unknown as SessionEvent,
    ]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 1 })
  })

  it('ignores calls from another turn', () => {
    const events = [call(3, 'c1', 'write', { file_path: 'src/a.ts' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('ignores tools that do not change files', () => {
    const events = [call(2, 'c1', 'read_file', { file_path: 'src/a.ts' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('ignores a call whose arguments cannot be parsed', () => {
    const events = [call(2, 'c1', 'write', '{'), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('ignores a call that names no path', () => {
    const events = [call(2, 'c1', 'write', { file_path: 7 }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('ignores a path outside the repository', () => {
    const events = [call(2, 'c1', 'write', { file_path: '/etc/passwd' }), result('c1')]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('ignores non-tool events entirely', () => {
    const events = [{ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } } as unknown as SessionEvent]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT)).toEqual({ paths: [], unresolved: 0 })
  })

  it('reports each path once in call order', () => {
    const events = [
      call(2, 'c1', 'write', { file_path: 'src/b.ts' }),
      call(2, 'c2', 'edit', { file_path: 'src/a.ts' }),
      call(2, 'c3', 'edit', { file_path: 'src/b.ts' }),
      result('c1'),
      result('c2'),
      result('c3'),
    ]
    expect(attributablePaths(events, 2, WORKSPACE, ROOT).paths).toEqual(['src/b.ts', 'src/a.ts'])
  })
})

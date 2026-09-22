/**
 * Derivation of "which paths this work unit wrote" from the session log.
 *
 * The session log is the only place a work unit's own writes are recorded, so
 * the runtime re-derives them here from `tool/call` plus a `tool/result` that
 * carries no error. A call whose result is missing or failed is counted as
 * unresolved rather than assumed to have written: an unproven write must never
 * enter an automatic commit.
 *
 * Files written by a shell command produce no first-party change-tool call and
 * are therefore never attributed; the runtime reports them as uncommitted
 * remainder instead.
 *
 * @module @deepseek-ai/dsh-workspace-automation/attribution
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Attribution } from './types.ts'

/** One first-party tool that changes a file, and where its argument names the path. */
interface ChangeTool {
  /** Registered tool name. */
  readonly name: string
  /** Argument key holding the path. */
  readonly pathField: string
  /** Commands that change content, when the tool has non-changing commands. */
  readonly commands?: readonly string[]
}

/** The first-party tools whose calls prove a file was written. */
const CHANGE_TOOLS: readonly ChangeTool[] = [
  { name: 'write', pathField: 'file_path' },
  { name: 'edit', pathField: 'file_path' },
  { name: 'str_replace_editor', pathField: 'path', commands: ['create', 'str_replace', 'insert'] },
]

/**
 * Parse a tool call's argument JSON.
 * @param raw - the argument string the log recorded.
 * @returns the parsed object, or `undefined` when it is not a JSON object.
 */
export function parseArguments(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A truncated or non-JSON argument string cannot name a path, and the call
    // is simply not attributed; nothing else in this module reads `raw`.
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/**
 * Express one tool-argument path relative to the repository root.
 * @param path - the path as the tool received it.
 * @param workspaceRoot - absolute workspace directory the path is relative to.
 * @param repoRoot - absolute repository root the result must be relative to.
 * @returns the repository-relative path, or `undefined` when it escapes the repository.
 */
export function toRepoRelative(path: string, workspaceRoot: string, repoRoot: string): string | undefined {
  const absolute = isAbsolute(path) ? path : resolve(workspaceRoot, path)
  const rel = relative(repoRoot, absolute)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/**
 * Derive the paths one turn was proven to have written.
 * @param events - the session log's events.
 * @param turn - the turn number of the work unit.
 * @param workspaceRoot - absolute workspace directory.
 * @param repoRoot - absolute repository root.
 * @returns the proven paths in call order, and the count of unresolved calls.
 */
export function attributablePaths(
  events: readonly SessionEvent[],
  turn: number,
  workspaceRoot: string,
  repoRoot: string,
): Attribution {
  const claimed = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const call = event.data
    if (call.turn !== turn) continue
    const tool = CHANGE_TOOLS.find(candidate => candidate.name === call.name)
    if (tool === undefined) continue
    const args = parseArguments(call.arguments)
    if (args === undefined) continue
    if (tool.commands !== undefined && !tool.commands.includes(String(args['command']))) continue
    const raw = args[tool.pathField]
    if (typeof raw !== 'string') continue
    const path = toRepoRelative(raw, workspaceRoot, repoRoot)
    if (path === undefined) continue
    claimed.set(call.callId, path)
  }
  if (claimed.size === 0) return { paths: [], unresolved: 0 }
  const succeeded = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    if (event.data.error !== undefined) continue
    const block = event.data.message.content[0]
    if (block.isError === true) continue
    succeeded.add(block.toolCallId)
  }
  const paths: string[] = []
  let unresolved = 0
  for (const [callId, path] of claimed) {
    if (!succeeded.has(callId)) {
      unresolved += 1
      continue
    }
    if (!paths.includes(path)) paths.push(path)
  }
  return { paths, unresolved }
}

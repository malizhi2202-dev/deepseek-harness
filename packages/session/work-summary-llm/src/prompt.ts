/**
 * Prompt construction and reply parsing for the LLM work-summary provider. The
 * reply is model output, so it is parsed here as a real boundary: anything that
 * does not reduce to one subject line and at most the configured number of body
 * lines is declined rather than repaired.
 *
 * @module @deepseek-ai/dsh-work-summary-llm/prompt
 */

import type { WorkSummaryProposal, WorkSummaryRequest } from '@deepseek-ai/dsh-work-summary'

/**
 * The fixed instruction text that frames every summarization request.
 * @returns the instruction text.
 */
export function systemPrompt(): string {
  return [
    'Write one git commit message for a work unit an AI coding assistant just finished.',
    'Answer with the subject on the first line, then an optional blank line, then optional body lines.',
    'The subject must be a conventional-commit header: type, optional (scope), optional !, then ": " and a short description.',
    'State only what the supplied file list supports; do not invent files, tests, or motivations.',
    'Answer in plain text with no quotes, fences, prefix, or explanation.',
  ].join('\n')
}

/**
 * Frame one work unit as the JSON the model answers about.
 * @param request - the work unit's identity and diff facts.
 * @returns the framed request text.
 */
export function frameRequest(request: WorkSummaryRequest): string {
  return `Summarize this work unit:\n${JSON.stringify({
    workspaceId: request.workspaceId,
    sessionId: request.sessionId,
    turn: request.turn,
    endReason: request.endReason,
    files: request.paths.map(fact => ({
      path: fact.path,
      insertions: fact.insertions,
      deletions: fact.deletions,
      binary: fact.binary,
    })),
  })}`
}

/**
 * Reduce a model reply to one proposal.
 *
 * A leading or trailing Markdown fence is dropped because it carries no
 * message content; the first non-empty line becomes the subject and the
 * remaining lines become the body, bounded to `maxBodyLines`. A reply with no
 * non-empty line is declined.
 * @param text - the model's reply text.
 * @param maxBodyLines - maximum body lines the reply may contribute.
 * @returns the proposal, or `undefined` when the reply carries no subject.
 */
export function parseProposal(text: string, maxBodyLines: number): WorkSummaryProposal | undefined {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  const trimBlankEdges = (): void => {
    while (lines.length > 0 && (lines[0] as string).trim().length === 0) lines.shift()
    while (lines.length > 0 && (lines[lines.length - 1] as string).trim().length === 0) lines.pop()
  }
  trimBlankEdges()
  while (lines.length > 0 && (lines[0] as string).trim().startsWith('```')) lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '```') lines.pop()
  trimBlankEdges()
  const subject = lines.shift()
  if (subject === undefined || subject.trim().length === 0) return undefined
  const body = lines.slice()
  while (body.length > 0 && (body[0] as string).trim().length === 0) body.shift()
  return { subject: subject.trim(), body: body.slice(0, maxBodyLines) }
}

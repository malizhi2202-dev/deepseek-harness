/**
 * Pure message construction for the work-summary seam: the mechanical fallback
 * built from diff facts alone, the validation an accepted provider proposal must
 * pass, and the byte and line bounds applied to the complete rendered message.
 *
 * The provider's proposal is model output, so it is validated here as a real
 * boundary: a subject whose type is not in the deployment's vocabulary, a
 * breaking-change marker the deployment did not allow, or a message past the
 * bounds is rejected rather than trimmed into something the provider did not say.
 *
 * @module @deepseek-ai/dsh-work-summary/summary
 */

import type {
  WorkPathFact,
  WorkSummaryMessage,
  WorkSummaryProposal,
  WorkSummaryRequest,
} from './types.ts'

/** Every deployment-varying bound and vocabulary one message is built under. */
export interface MessagePolicy {
  /** Conventional-commit types an accepted subject may declare. */
  readonly commitTypes: readonly string[]
  /** Whether a proposal may declare a breaking change. */
  readonly allowBreaking: boolean
  /** Type the mechanical fallback declares. */
  readonly fallbackType: string
  /** Maximum UTF-8 bytes of a subject line. */
  readonly maxSubjectBytes: number
  /** Maximum body lines, excluding the trailer. */
  readonly maxBodyLines: number
  /** Maximum UTF-8 bytes of the complete rendered message. */
  readonly maxMessageBytes: number
  /** Trailer key that marks a commit as produced by one work unit. */
  readonly trailerName: string
}

/** A conventional-commit subject: type, optional scope, optional breaking marker, description. */
const SUBJECT = /^(?<type>[a-z][a-z0-9]*)(?:\((?<scope>[^()\r\n]+)\))?(?<breaking>!)?: (?<description>\S.*)$/

/** Trailer keys that declare a breaking change in the body. */
const BREAKING_TRAILER = /^(?:BREAKING[ -]CHANGE):/

/**
 * Cut a string to a UTF-8 byte budget on a code-point boundary.
 * @param text - the string to cut.
 * @param maxBytes - maximum bytes the result may occupy.
 * @returns the longest prefix within the budget, or an empty string when it is zero.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let bytes = 0
  let result = ''
  for (const point of text) {
    const size = Buffer.byteLength(point, 'utf8')
    if (bytes + size > maxBytes) break
    bytes += size
    result += point
  }
  return result
}

/**
 * The deepest directory every path shares, used as the mechanical subject's scope.
 * @param paths - repository-relative paths of the work unit.
 * @returns the shared directory, or `undefined` when the paths share none.
 */
export function commonPathScope(paths: readonly string[]): string | undefined {
  const first = paths[0]
  if (first === undefined) return undefined
  const segments = first.split('/')
  segments.pop()
  let shared = segments
  for (const path of paths.slice(1)) {
    const candidate = path.split('/')
    candidate.pop()
    let length = 0
    while (length < shared.length && length < candidate.length && shared[length] === candidate[length]) length += 1
    shared = shared.slice(0, length)
  }
  return shared.length === 0 ? undefined : shared.join('/')
}

/**
 * The trailer that marks one commit as produced by one work unit.
 * @param sessionId - session the work unit belongs to.
 * @param turn - turn number that closed the work unit.
 * @param policy - the trailer key to use.
 * @returns the complete trailer line.
 */
export function unitTrailer(sessionId: string, turn: number, policy: MessagePolicy): string {
  return `${policy.trailerName}: ${sessionId}/${turn}`
}

/**
 * Assemble one message exactly as proposed, without applying any bound.
 * @param message - subject, body lines, and trailer.
 * @returns the assembled message.
 */
export function assembleMessage(message: WorkSummaryMessage): string {
  const body = message.body.length === 0 ? '' : `\n\n${message.body.join('\n')}`
  return `${message.subject}${body}\n\n${message.trailer}`
}

/**
 * Render one message within the complete-message byte bound.
 *
 * The trailer is reserved first, because it is what makes the commit
 * recognizable to a deployment-side push predicate; body lines are then added
 * while they fit. A budget too small even for the trailer keeps the subject
 * alone, so the byte bound holds for every configured limit.
 * @param message - subject, body lines, and trailer.
 * @param policy - the bounds to apply.
 * @returns the rendered message, always within `maxMessageBytes`.
 */
export function renderMessage(message: WorkSummaryMessage, policy: MessagePolicy): string {
  const max = policy.maxMessageBytes
  if (max <= 0) return ''
  const room = max - Buffer.byteLength(message.trailer, 'utf8') - 2
  if (room < 1) return truncateUtf8(message.subject, max)
  const subject = truncateUtf8(message.subject, Math.min(policy.maxSubjectBytes, room))
  const accepted: string[] = []
  for (const line of message.body.slice(0, policy.maxBodyLines)) {
    if (Buffer.byteLength(assembleMessage({ ...message, subject, body: [...accepted, line] }), 'utf8') > max) break
    accepted.push(line)
  }
  return assembleMessage({ ...message, subject, body: accepted })
}

/**
 * Build the mechanical fallback message from diff facts alone.
 *
 * Every fact it states comes from the supplied path facts: the file count, the
 * added and deleted line totals, and the shared directory used as the scope. It
 * claims nothing the facts do not carry.
 * @param request - the work unit's identity and path facts.
 * @param policy - the vocabulary and bounds to build under.
 * @returns the fallback message.
 */
export function mechanicalMessage(request: WorkSummaryRequest, policy: MessagePolicy): WorkSummaryMessage {
  const scope = commonPathScope(request.paths.map(fact => fact.path))
  const insertions = request.paths.reduce((total, fact) => total + fact.insertions, 0)
  const deletions = request.paths.reduce((total, fact) => total + fact.deletions, 0)
  const header = `${policy.fallbackType}${scope === undefined ? '' : `(${scope})`}: update ${request.paths.length} file(s), +${insertions}/-${deletions}`
  return {
    subject: truncateUtf8(header, policy.maxSubjectBytes),
    body: request.paths.map(describePath),
    trailer: unitTrailer(request.sessionId, request.turn, policy),
  }
}

/**
 * Describe one path's diff facts as one body line.
 * @param fact - the path and its line accounting.
 * @returns the body line.
 */
export function describePath(fact: WorkPathFact): string {
  return fact.binary
    ? `${fact.path} | binary`
    : `${fact.path} | +${fact.insertions}/-${fact.deletions}`
}

/** Why a provider proposal was refused. */
export type ProposalRejection =
  | 'empty-subject'
  | 'multiline-subject'
  | 'malformed-subject'
  | 'unknown-type'
  | 'breaking-not-allowed'
  | 'subject-too-long'
  | 'too-many-body-lines'
  | 'message-too-long'

/** One validated proposal, or the reason it was refused. */
export type ProposalVerdict =
  | { readonly kind: 'accepted'; readonly message: WorkSummaryMessage }
  | { readonly kind: 'rejected'; readonly reason: ProposalRejection }

/**
 * Validate one provider proposal and turn it into a message.
 *
 * A proposal is accepted only when its subject parses as a conventional-commit
 * header whose type the deployment declared, it declares no breaking change the
 * deployment did not allow, and the complete rendered message fits the bounds.
 * @param proposal - the provider's proposal.
 * @param request - the work unit the message is for.
 * @param policy - the vocabulary and bounds to validate against.
 * @returns the accepted message, or the rejection reason.
 */
export function validateProposal(
  proposal: WorkSummaryProposal,
  request: WorkSummaryRequest,
  policy: MessagePolicy,
): ProposalVerdict {
  const subject = proposal.subject
  if (subject.trim().length === 0) return { kind: 'rejected', reason: 'empty-subject' }
  if (subject.includes('\n') || subject.includes('\r')) return { kind: 'rejected', reason: 'multiline-subject' }
  const match = SUBJECT.exec(subject)
  if (match?.groups === undefined) return { kind: 'rejected', reason: 'malformed-subject' }
  if (!policy.commitTypes.includes(match.groups['type'] as string)) {
    return { kind: 'rejected', reason: 'unknown-type' }
  }
  const declaresBreaking = match.groups['breaking'] !== undefined
    || proposal.body.some(line => BREAKING_TRAILER.test(line.trim()))
  if (declaresBreaking && !policy.allowBreaking) return { kind: 'rejected', reason: 'breaking-not-allowed' }
  if (Buffer.byteLength(subject, 'utf8') > policy.maxSubjectBytes) {
    return { kind: 'rejected', reason: 'subject-too-long' }
  }
  if (proposal.body.length > policy.maxBodyLines) {
    return { kind: 'rejected', reason: 'too-many-body-lines' }
  }
  const message: WorkSummaryMessage = {
    subject,
    body: [...proposal.body],
    trailer: unitTrailer(request.sessionId, request.turn, policy),
  }
  if (Buffer.byteLength(assembleMessage(message), 'utf8') > policy.maxMessageBytes) {
    return { kind: 'rejected', reason: 'message-too-long' }
  }
  return { kind: 'accepted', message }
}

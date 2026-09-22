/**
 * Vocabulary for the work-summary capability seam (`ctx.workSummary`). Types
 * only: the service, its providers, and its consumer import this module without
 * runtime code.
 *
 * @module @deepseek-ai/dsh-work-summary/types
 */

/** One path's line accounting for the work unit being summarized. */
export interface WorkPathFact {
  /** Repository-relative path. */
  readonly path: string
  /** Lines added; `0` for a binary entry. */
  readonly insertions: number
  /** Lines deleted; `0` for a binary entry. */
  readonly deletions: number
  /** Whether the path is binary, which carries no line counts. */
  readonly binary: boolean
}

/** Everything one summary generation is asked about. */
export interface WorkSummaryRequest {
  /** Workspace the work unit ran in. */
  readonly workspaceId: string
  /** Session the work unit belongs to. */
  readonly sessionId: string
  /** Turn number that closed the work unit. */
  readonly turn: number
  /** How the turn ended, as the session log recorded it. */
  readonly endReason: string
  /** Paths the work unit wrote, with their diff facts. */
  readonly paths: readonly WorkPathFact[]
}

/** One provider's proposed commit message. */
export interface WorkSummaryProposal {
  /** Proposed subject line; a conventional-commit header. */
  readonly subject: string
  /** Proposed body lines; may be empty. */
  readonly body: readonly string[]
}

/** What one provider call answered. */
export type WorkSummaryProviderResult =
  | { readonly kind: 'proposed'; readonly proposal: WorkSummaryProposal }
  | { readonly kind: 'declined'; readonly reason: string }

/**
 * One summary provider. A provider proposes a message from the diff facts it is
 * given and must never claim a change the facts do not carry; it may decline.
 */
export interface WorkSummaryProvider {
  /** Stable provider identifier used in diagnostics. */
  readonly id: string
  /**
   * Propose one commit message for the request.
   * @param request - the work unit's identity and diff facts.
   * @returns the proposal, or a decline with its reason.
   */
  generate(request: WorkSummaryRequest): Promise<WorkSummaryProviderResult>
}

/** The complete commit message one summary generation produced. */
export interface WorkSummaryMessage {
  /** Subject line, without a trailing newline. */
  readonly subject: string
  /** Body lines, without the trailer. */
  readonly body: readonly string[]
  /** The unit trailer identifying the work unit that produced the commit. */
  readonly trailer: string
}

/** Which producer supplied the accepted subject and body. */
export type WorkSummarySource = 'provider' | 'mechanical'

/** The answer to one summary generation. */
export interface WorkSummaryResult {
  /** The message to commit with. */
  readonly message: WorkSummaryMessage
  /** Whether a provider or the mechanical fallback supplied it. */
  readonly source: WorkSummarySource
  /** Whether a provider proposed a message that failed validation. */
  readonly proposalRejected: boolean
  /** Why every consulted provider declined or was rejected, in consultation order. */
  readonly notes: readonly string[]
}

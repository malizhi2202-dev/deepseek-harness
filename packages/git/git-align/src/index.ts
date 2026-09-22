/**
 * Service Definition for the git alignment capability seam (`ctx.gitAlign`): the
 * repository operations that mutate a work tree, beside the read-only
 * observation seam `ctx.git`.
 *
 * The seam is deliberately narrow. Every operation answers a discriminated
 * value — a completed write, a bounded conflict report, or a classified
 * failure — so the consumer records the answer in a durable ledger instead of
 * catching an exception and guessing what happened. The only throw is a caller
 * cancellation, which is the caller's own decision, and a rejected
 * {@link GitAligner.resolve} call, which is a malformed request rather than a
 * git outcome.
 *
 * Three things are absent by construction and must stay absent: there is no
 * push, no rebase, and no history rewrite anywhere in the operation set. Their
 * absence is the enforcement, not a default value.
 *
 * @module @deepseek-ai/dsh-git-align
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  AlignRequest,
  AlignSpec,
  AlignStrategy,
  ApplyResult,
  ChangeFactsResult,
  CommitRequest,
  CommitResult,
  FetchResult,
  GitAlignFailureCode,
  IgnoreResult,
  ProbeRequest,
  ProbeResult,
  PushedResult,
} from './types.ts'

export type {
  AlignRequest,
  AlignSpec,
  AlignStrategy,
  ApplyResult,
  ChangeFact,
  ChangeFacts,
  ChangeFactsResult,
  CommitRequest,
  CommitResult,
  ConflictPaths,
  FetchResult,
  GitAlignFailure,
  GitAlignFailureCode,
  IgnoreResult,
  ProbeRequest,
  ProbeResult,
  PushedResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitAlign: GitAligner
  }
}

/**
 * A request the seam cannot turn into an {@link AlignSpec}: the tracked branch
 * is not in the `remote/ref` spelling the fetch needs, or a path set is empty
 * where an operation requires one.
 */
export class GitAlignRequestError extends HarnessError {
  override readonly code: GitAlignFailureCode = 'command-failed'

  /**
   * @param message - Which part of the request cannot be resolved.
   */
  constructor(message: string) {
    super(message, 'command-failed')
    this.name = 'GitAlignRequestError'
  }
}

/**
 * Abstract git alignment service. Subclass it, implement every operation, and
 * load the subclass as a plugin — it registers as `ctx.gitAlign` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Every operation resolves a classified value for an expected git failure;
 *   only a caller cancellation rejects, with the abort reason.
 * - A cancelled call must not leave a merge in progress in the work tree.
 * - {@link probe} never modifies the target work tree, its index, or its refs.
 * - {@link commit} contains exactly the supplied paths and no others.
 * - Nothing in the implementation pushes, rebases, or rewrites history.
 */
export abstract class GitAligner extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gitAlign')
  }

  /**
   * Resolve one raw request into the target every operation uses.
   *
   * The split of `upstream` into a remote and a ref name happens once, here, so
   * no operation re-derives it and a request that cannot be split fails before
   * any command runs.
   * @param request - the coordinates observed by the consumer.
   * @returns the resolved target.
   * @throws {GitAlignRequestError} when the tracked branch has no `remote/ref` spelling.
   */
  abstract resolve(request: AlignRequest): AlignSpec

  /**
   * Fetch the target's upstream ref from its remote — the seam's only network operation.
   * @param spec - the resolved target.
   * @param signal - caller cancellation, which must bound the fetch.
   * @returns the classified fetch answer.
   */
  abstract fetch(spec: AlignSpec, signal: AbortSignal): Promise<FetchResult>

  /**
   * Report whether the upstream merges into HEAD cleanly, without touching the
   * target work tree, its index, or its refs.
   * @param spec - the resolved target.
   * @param request - scratch-tree location and the conflict-list bound.
   * @param signal - caller cancellation.
   * @returns the classified probe answer.
   */
  abstract probe(spec: AlignSpec, request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult>

  /**
   * Align HEAD to the upstream using the requested strategy, or roll the
   * attempt back and report it.
   * @param spec - the resolved target.
   * @param strategy - how the attempt reaches the upstream revision.
   * @param signal - caller cancellation.
   * @returns the classified write answer.
   */
  abstract apply(spec: AlignSpec, strategy: AlignStrategy, signal: AbortSignal): Promise<ApplyResult>

  /**
   * Read diff facts for exactly one path set, relative to HEAD.
   * @param spec - the resolved target.
   * @param paths - repository-relative paths, already bounded by the consumer.
   * @param signal - caller cancellation.
   * @returns the classified facts answer.
   */
  abstract changeFacts(
    spec: AlignSpec,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<ChangeFactsResult>

  /**
   * Report which of the given paths git's own ignore rules match.
   * @param spec - the resolved target.
   * @param paths - repository-relative paths, already bounded by the consumer.
   * @param signal - caller cancellation.
   * @returns the classified ignore answer.
   */
  abstract ignoredPaths(
    spec: AlignSpec,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<IgnoreResult>

  /**
   * Create one commit containing exactly the supplied paths.
   * @param spec - the resolved target.
   * @param request - the path set, the message, and whether repository hooks run.
   * @param signal - caller cancellation.
   * @returns the classified commit answer.
   */
  abstract commit(spec: AlignSpec, request: CommitRequest, signal: AbortSignal): Promise<CommitResult>

  /**
   * Report whether any remote-tracking ref already contains one commit — the
   * fact that decides whether a created commit can still be withdrawn.
   * @param spec - the resolved target.
   * @param oid - full object id of the commit to test.
   * @param signal - caller cancellation.
   * @returns the classified answer.
   */
  abstract pushedToRemote(spec: AlignSpec, oid: string, signal: AbortSignal): Promise<PushedResult>
}

export default GitAligner

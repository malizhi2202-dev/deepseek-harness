/**
 * UI Sidebar Agents-owned projection of the session list into the current
 * session's derivation forest.
 *
 * The forest is the complete durable picture the session list holds: every
 * session reported with `origin: 'subagent'` and a parent appears under that
 * parent, finished, failed, or running alike. Nothing here asks the host for a
 * child listing, so the tree is readable before any catalog arrives and never
 * treats an unread catalog as an empty one.
 *
 * UI Subagent and UI Workspace each hold their own projection of the same
 * summaries, and this is the third: a client feature package may not
 * value-import another plugin's module, so the fold is repeated rather than
 * exported from `session-controller`.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * How deep the forest is walked.
 *
 * The bound holds the panel's work — and the catalog reads its branches
 * trigger — to a fixed cost whatever a session's history contains: the walk,
 * and every recursion derived from it, stops here. A node at the bound that
 * still has children reports `truncated` instead of dropping them silently.
 */
export const MAX_LINEAGE_DEPTH = 8

/**
 * How many child catalogs one panel reads at a time.
 *
 * Catalogs arrive over the wire, so the panel opens a branch's read only while
 * fewer than this many reads are outstanding; each settled read releases the
 * slot for the next branch.
 */
export const MAX_CONCURRENT_CATALOG_READS = 3

/** The summary facts one forest node reads. */
interface LineageEntry {
  readonly id: SessionId
  readonly parentId?: SessionId
  readonly origin?: 'subagent'
  /** Human-facing label the session list already drew for this session. */
  readonly displayTitle: string
  readonly running: boolean
}

/** One session in the derivation forest. */
export interface LineageNode {
  readonly id: SessionId
  /** The parent this session was derived from, absent for the root. */
  readonly parentId: SessionId | undefined
  /** What the row says. */
  readonly label: string
  readonly running: boolean
  /** The sessions derived from this one, in sibling order. */
  readonly children: readonly LineageNode[]
  /** Distance from the root; the root is `0`. */
  readonly depth: number
  /**
   * `true` when the walk stopped here at `MAX_LINEAGE_DEPTH` while this session
   * still has derived sessions the panel is not drawing.
   */
  readonly truncated: boolean
}

/**
 * Build the derivation forest rooted at one session.
 *
 * Siblings rank in the session list's own order, and anything the list omits
 * ranks last; a tie breaks on id, so the tree is deterministic. A summary
 * reachable twice — a malformed pair of sessions naming each other as parent
 * and child — is placed once, which is also what terminates the walk.
 * @param rootId - the session the panel is open in.
 * @param summaries - the session list's summaries, keyed by id.
 * @param listed - the session list's own id order, used to rank siblings.
 * @returns the root node, or `undefined` when the list does not report the session.
 */
export function buildLineageForest(
  rootId: SessionId,
  summaries: Readonly<Record<SessionId, LineageEntry>>,
  listed: readonly SessionId[],
): LineageNode | undefined {
  const root = summaries[rootId]
  if (root === undefined) return undefined
  const rank = new Map<SessionId, number>()
  for (const [index, id] of listed.entries()) rank.set(id, index)
  const derived = new Map<SessionId, LineageEntry[]>()
  for (const summary of Object.values(summaries)) {
    if (summary.origin !== 'subagent' || summary.parentId === undefined) continue
    const bucket = derived.get(summary.parentId)
    if (bucket === undefined) derived.set(summary.parentId, [summary])
    else bucket.push(summary)
  }
  const rankOf = (entry: LineageEntry): number => rank.get(entry.id) ?? Number.MAX_SAFE_INTEGER
  for (const bucket of derived.values()) {
    bucket.sort((left, right) => rankOf(left) - rankOf(right) || left.id.localeCompare(right.id))
  }
  const placed = new Set<SessionId>([rootId])
  const walk = (entry: LineageEntry, depth: number): LineageNode => {
    const present = derived.get(entry.id) ?? []
    const cut = depth >= MAX_LINEAGE_DEPTH && present.some(child => !placed.has(child.id))
    const children: LineageNode[] = []
    for (const child of cut ? [] : present) {
      if (placed.has(child.id)) continue
      placed.add(child.id)
      children.push(walk(child, depth + 1))
    }
    return {
      id: entry.id,
      parentId: entry.parentId,
      label: entry.displayTitle,
      running: entry.running,
      children,
      depth,
      truncated: cut,
    }
  }
  return walk(root, 0)
}

/**
 * Whether a session this node derived is running anywhere below it.
 *
 * A true answer is what opens a branch without a gesture: the chain that is
 * still working is the one a user came to watch.
 * @param node - one forest node.
 * @returns whether any descendant is running.
 */
export function hasRunningDescendant(node: LineageNode): boolean {
  return node.children.some(child => child.running || hasRunningDescendant(child))
}

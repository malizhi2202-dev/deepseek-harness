/**
 * Which files a reply named, and which of those names could denote a workspace
 * file at all.
 *
 * This is a candidate list, not a decision. Naming a path in a reply proves
 * nothing about whether it is the round's own output, so the bridge resolves
 * each candidate against the session workspace and keeps only what the round
 * actually wrote. Without that second step a steerable reply would become a
 * read primitive: the model could be talked into naming any readable path.
 *
 * @module @deepseek-ai/dsh-channel-bridge
 */

/** One path-shaped token a reply contained. */
export interface FileMention {
  /** The token exactly as the reply spelled it, for the missing-file log. */
  readonly mentioned: string
  /** The workspace-relative path it denotes, or null when it cannot denote one. */
  readonly rel: string | null
}

/** Backtick-quoted token, or a bare path-shaped token delimited by whitespace and punctuation. */
const PATH_TOKEN = /`[^`\n]{1,200}`|(?:^|[\s("'[])[A-Za-z0-9_.@-][\w./@-]*\.[A-Za-z0-9]{1,8}/g

/** A drive-letter prefix, which is a host path rather than a workspace path. */
const DRIVE_LETTER = /^[A-Za-z]:/

/**
 * Every path-shaped token in one reply, in order, deduplicated by what it
 * denotes.
 * @param text - the reply text.
 * @returns one entry per distinct token; `rel` is null for a token that cannot be workspace-relative.
 */
export function replyFileMentions(text: string): readonly FileMention[] {
  const seen = new Set<string>()
  const mentions: FileMention[] = []
  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = match[0]
    const mentioned = (token.startsWith('`') ? token.slice(1, -1) : token.replace(/^[\s("'[]/, '')).trim()
    if (mentioned === '') continue
    const rel = workspaceRelativePath(mentioned)
    const key = rel ?? mentioned
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({ mentioned, rel })
  }
  return mentions
}

/**
 * The workspace-relative path one token denotes.
 * @param token - one path-shaped token.
 * @returns the normalized relative path, or null for an absolute path, a home
 *   path, a URL, a Windows drive path, or anything containing a `..` segment.
 */
export function workspaceRelativePath(token: string): string | null {
  if (token.includes('://') || /\s/.test(token)) return null
  const rel = token.replace(/\\/g, '/').replace(/^\.\//, '')
  if (rel === '' || rel.startsWith('/') || rel.startsWith('~') || DRIVE_LETTER.test(rel)) return null
  if (rel.split('/').some(segment => segment === '' || segment === '..')) return null
  return rel
}

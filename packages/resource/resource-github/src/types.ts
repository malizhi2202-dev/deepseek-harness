/**
 * Instance vocabulary for the GitHub source kind. A GitHub source is one API
 * endpoint reached with one personal access token, plus the repositories that
 * source is allowed to expose; a repository the grant list does not name is
 * invisible, because a token's own scope is usually wider than the source
 * should be.
 *
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-resource-github/types
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SourceConfig } from '@deepseek-ai/dsh-resource'

/** One configured GitHub source, as the settings schema declares it. */
export interface GitHubInstance {
  /** Credential reference holding the personal access token. */
  readonly tokenRef?: string
  /** REST API base; defaults to the public GitHub API. */
  readonly baseUrl?: string
  /** Repositories this source exposes, as `owner/name`; anything unlisted is not found. */
  readonly repositories?: string[]
}

/** One GitHub source as the provider serves it: the address plus the values every operation reads. */
export interface GitHubSourceConfig extends SourceConfig {
  /** Credential reference holding the personal access token. */
  readonly tokenRef?: CredentialRef
  /** REST API base. */
  readonly baseUrl: string
  /** Repositories this source exposes, as `owner/name`. */
  readonly repositories: readonly string[]
}

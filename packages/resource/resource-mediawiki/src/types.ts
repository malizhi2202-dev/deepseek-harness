/**
 * Instance vocabulary for the MediaWiki source kind. A MediaWiki source is one
 * wiki's Action API endpoint; the wiki is public unless a bot password is
 * configured, and the password itself never appears here — only the name of the
 * credential that holds it.
 *
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-resource-mediawiki/types
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SourceConfig } from '@deepseek-ai/dsh-resource'

/** One configured wiki, as the settings schema declares it. */
export interface MediaWikiInstance {
  /** Action API endpoint, such as `https://en.wikipedia.org/w/api.php`. */
  readonly baseUrl: string
  /** Bot-password user name from `Special:BotPasswords`, such as `Example@reader`. */
  readonly username?: string
  /** Credential reference holding the bot password; resolved per operation. */
  readonly passwordRef?: string
}

/** One wiki as the provider serves it: the address plus the values every operation reads. */
export interface MediaWikiSourceConfig extends SourceConfig {
  /** Action API endpoint. */
  readonly baseUrl: string
  /** Bot-password user name; absent for anonymous access. */
  readonly username?: string
  /** Credential reference holding the bot password; absent for anonymous access. */
  readonly passwordRef?: CredentialRef
}

# Agent Note: Remote resource library host half

Status: implemented

English | [中文](2026-09-22-remote-resource-library-host-half.zh.md)

## Problem

A deployment's own knowledge lives in collections the harness could not reach: a wiki, a code host, a database. The web seam answers a search query with documents from a search index, and the filesystem seam answers paths inside one workspace; neither can address one page of one wiki, one file of one repository, or one table of one database. The [resource library design](../../../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md) freezes the vocabulary for a third kind of access and states the wave split: this change implements the host half — the seam, the three providers, and the model-facing consumer — while the `sources` panel and its Remote namespace belong to a separate change.

The seam has to serve three protocols that agree on almost nothing. A wiki addresses pages by title and answers full-text search with snippets; a code host addresses files by `owner/name:path`, searches code under a request quota, and returns no inline content above about a megabyte; a database addresses structure by identifier, has no full-text search at all, and is the only one of the three where a wrong statement is destructive. The vocabulary therefore normalizes only what a caller does — search, read, list — and leaves addressing, limits, and failure text to the provider that owns the kind.

## Decision

Five packages under `packages/resource/`: `@deepseek-ai/dsh-resource` (the Service Definition and the `ctx.sources` registry), `@deepseek-ai/dsh-resource-mediawiki`, `@deepseek-ai/dsh-resource-github`, and `@deepseek-ai/dsh-resource-mysql` (the providers), and `@deepseek-ai/dsh-tool-resource` (the Consumer). The seam is complete in the three roles the repository requires of a capability seam, and each provider registers itself as an effect on its own fiber.

**A kind declares what it can answer.** `capabilities` carries `search`, `browse`, `read`, `maxReadBytes`, `maxListItems`, and a model-facing `description` that states the kind's limits. A kind contributes a tool only when it declares the capability, implements the method, and has at least one configured instance, so no model ever sees a tool that cannot work.

**One settings namespace per kind, secrets by name.** Each provider reads its instances from `resource-<kind>` and resolves `passwordRef` or `tokenRef` through `dsh-credentials` on every operation, so a rotated secret reaches the next call and no secret value enters configuration. No new persistence domain appears: `dsh-settings` already owns namespace sections and its file provider persists them.

**MySQL is read-only by classification.** Every statement passes one query entry that accepts only `SELECT`, `SHOW`, and `DESCRIBE`, rejects a second statement, and rejects a read-shaped statement that writes or locks. A rejected statement raises `SOURCE_DENIED` before the session is called. Underneath, the connector sets `SET SESSION TRANSACTION READ ONLY`, never enables multiple statements, and the account is expected to hold only read privileges. Identifiers come from the configuration's grant text, never from a model's handle, and a database the server reports but the configuration does not grant stays invisible.

**GitHub is default-deny.** The instance names the repositories it grants; a search carries one `repo:` qualifier per granted repository and its hits are filtered again on the way back; a read or a listing of anything outside the list fails with `SOURCE_NOT_FOUND` before a request is sent. Octokit is constructed with `redirect: 'error'`, so the token cannot be forwarded to another origin.

**The frozen design needed eight corrections, recorded here rather than silently.** The provider interface gained `instances()` because the design's `Sources` cannot enumerate the configured instances a tool description must name. `SourceCapabilities` gained a required `description` and a `maxListItems`, because the design's `list` carries no caller limit and its `SourceHit` carries no truncation signal; the listing cap moved from per-instance to per-kind so it could be declared. `SourceItemRef` is a branded handle rather than a bare string, per the repository rule for opaque cross-boundary ids. The registry publishes a `sources/changed` event, which the design did not have, because the derived tool set must follow a settings edit. `register()` returns a plain disposer because the design's `Disposer` type does not exist in the vendored cordis. A kind name must match a lower-case grammar, because it becomes a tool-name segment and a settings namespace segment. And no `dsh-resource://<source>/` address domain is registered: the roadmap proposed one, while the frozen design gives the panel a page type that claims no address, so this change implements the design and records the conflict.

**Dependencies.** `@octokit/rest` 22.0.1 and `mysql2` 3.24.4 were taken because the repository prefers a maintained client over hand-written transport, and each deletes request construction, response parsing, and connection handling that would otherwise be owned code.

## Alternatives considered

**One generic HTTP provider configured with URL templates.** Rejected: the three kinds differ in addressing, in what a limit means, and in which failures a model must be able to act on, so a template provider would move protocol knowledge into configuration and lose the declared capabilities that keep an unusable tool unregistered.

**Reuse the web seam.** Rejected: a web search returns documents from a search index with no stable handle, while a source answers structured handles and supports reading one named item. Merging them would force one provider-selection policy onto collections that are configured individually.

**Register every operation and fail at call time.** Rejected: a tool that cannot work costs tokens in every request and teaches a model to distrust the tool set. The conditional derivation is what makes the registered set honest.

**Let a model send SQL.** Rejected: no whitelist can bound what a model writes, and the destructive case is the one that matters. The provider issues a projection of one granted table with a row cap, and search matches granted names without issuing a statement.

**Keep the secret in the settings section.** Rejected: settings sections are readable, exportable, and shown in a configuration surface. Only the credential name enters configuration, and the value is resolved per operation.

**Add a persistence domain for source configuration.** Rejected: `dsh-settings` already owns per-namespace sections with a file provider, and a second store would be a second place for one instance's configuration to be wrong.

## Consequences

- **A deployment chooses its kinds.** Mounting the seam alone registers no tool and makes nothing model-visible; each provider a deployment mounts adds its own tools once it has a configured instance.
- **Model-visible text is derived, so it changes with settings.** A settings edit that alters an instance list or a limits statement rewrites the request prefix rather than only the arguments a model may pass. This is recorded in the consumer's Known Limitations.
- **The tool set is conditional in a way a model can observe.** Adding a provider adds tools, and a kind that loses its last configured instance loses them, without any remount.
- **A write is refused by classification, and the test proves it through the entry.** The denial test drives the query entry with a recording session that must stay empty, so the proof covers the operation that makes the decision rather than a helper beside it.
- **No live call was made against any of the three backends.** No GitHub token, no MySQL server, and no wiki exist here. Every suite drives a stubbed transport: a stub Octokit client, an injected `mysql2` driver, and an injected MediaWiki exchange. The redirect policy is pinned by asserting the `redirect: 'error'` init and the authorization header on a stubbed global `fetch`, and the real `mysql2` adapter is exercised once against a closed loopback port, which fails as expected.
- **`pnpm run duplication` cannot run on this host.** The pinned jscpd v5 binary needs GLIBC 2.32 or newer and this host provides 2.31, so this change records no duplication result.
- **The canonical coverage command cannot run yet.** `tsconfig.base.json`'s generated `paths` region lacks the five new aliases until `pnpm run gen-tsconfig-paths` runs at integration; the suites were run through an equivalent scratch configuration with explicit aliases, and the parent must regenerate and re-run the canonical command.

## Testing

`packages/resource` holds 189 tests across 14 files, at per-file 100% statements, branches, functions, and lines for every source file in the five packages. The seam's suites pin the byte bound at exact and tiny limits, a multibyte budget, the registry's kind grammar, its duplicate-kind failure, the change event on join and disposal, and the fiber-disposal proof that a provider and its event listener are gone. The MediaWiki suites pin the wire guards, the login and anonymous paths, the cookie jar, and the redirect policy. The GitHub suites pin the response guards, the request construction for search and content, the grant-list filtering in both directions, and the redirect and authorization facts on a stubbed `fetch`. The MySQL suites pin the statement whitelist's accept and refuse sets, a denial driven through the query entry with a recording session that stays empty, an injected identifier refused before any statement exists, three-level listings, row and byte truncation, and session closure on failure. The consumer's suites pin the conditional derivation for every capability and method combination, the serialized re-derivation when two changes overlap, the rendered bound at the kind's cap, and the disposal proof that the fiber's tools are unregistered.

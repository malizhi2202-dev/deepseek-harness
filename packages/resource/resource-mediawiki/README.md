---
description: "The MediaWiki source provider for ctx.sources: full-text search, page reads, and category listings over the Action API, with the wiki credential resolved per operation."
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-mediawiki

English | [中文](README.zh.md)

## Summary

With `dsh-resource-mediawiki`, a model can search, read, and browse one or more MediaWiki wikis through the same source seam as every other remote collection. The provider speaks the Action API: `list=search` for full-text queries, `action=parse` for a whole page, `list=categorymembers` for a category's members, and `list=allcategories` for the wiki's categories. A wiki that needs a login authenticates with a bot account whose password is resolved by name from `dsh-credentials` on every operation, so a rotated secret reaches the next call without a restart and no secret value enters configuration. An anonymous wiki needs no credential at all. The provider refuses HTTP redirects, so a credentialed request cannot be forwarded to another origin. The model-facing tools live in `dsh-tool-resource`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the source registry, then this provider. Each wiki is one instance under the `resource-mediawiki` settings namespace, and the instance id is the `source` argument the model passes to a tool.

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
  config:
    maxReadBytes: 200000
    instances:
      handbook:
        baseUrl: https://wiki.internal
        username: Bot@Reader
        passwordRef: WIKI_BOT_PASSWORD
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxReadBytes` | `200000` | Cap on one read, in bytes; the provider cuts the complete document and appends the truncation marker |
| `maxListItems` | `50` | Cap on one listing, in items |
| `instances.<id>.baseUrl` | required | The wiki's base URL, including any script path such as `/w`; only `http` and `https` are accepted |
| `instances.<id>.username` | omitted | Bot account name; when present, `passwordRef` is required and the login must succeed |
| `instances.<id>.passwordRef` | omitted | The name of the credential holding the bot password, resolved through `ctx.credentials` per operation |

An instance is configured when its URL parses and, if it names a username, its credential currently resolves to a non-empty value. An unconfigured instance registers no tool and fails `check` with `SOURCE_UNCONFIGURED` before any connection is opened.

### What a configured source answers

A configured wiki answers three operations, and the model-facing tool set follows from them.

- `search` runs a full-text query and returns page hits with a snippet.
- `read` returns one page's wikitext, cut at the read cap.
- `list` returns the members of a category, or the wiki's categories when no container is named.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider owns the wiki protocol and nothing else. Tool schemas, rendering, and presentation belong to the consumer.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, settings section, provider registration |
| [`src/provider.ts`](src/provider.ts) | `MediaWikiSourceProvider`: instance resolution, the three operations, limits |
| [`src/client.ts`](src/client.ts) | `MediaWikiClient`: request dispatch, cookie jar, login, redirect refusal |
| [`src/wire.ts`](src/wire.ts) | Response guards that narrow Action API payloads and raise `SOURCE_PROVIDER_ERROR` on an unusable one |
| [`src/types.ts`](src/types.ts) | Instance and resolved-configuration types |
| — | No runtime invariant companion is published; the provider owns no relation an independent observation could contradict. |

### Authentication and redirects

A wiki with a username logs in once per session: the client fetches a login token, posts the credentials, and keeps the returned cookies for the following requests. A wiki without one issues anonymous requests. Every request is sent with `redirect: 'error'`, so a redirect response fails the call instead of forwarding the credential-bearing request to whatever origin the wiki named.

### Settings and change notification

The kind reads its configuration per operation, so a committed settings change reaches the next call without re-registration. The provider emits `sources/changed` for its kind when the section changes, which is how the tool consumer learns to re-derive the instance list its tool descriptions name.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level description is not enough.

- [Resource package map](../README.md) — the five-package family and each role.
- [dsh-resource](../resource/README.md) — the seam this provider registers into.
- [dsh-tool-resource](../tool-resource/README.md) — the model-facing tools derived from this provider.
- [dsh-resource-github](../resource-github/README.md) — the code repository provider.
- [dsh-resource-mysql](../resource-mysql/README.md) — the read-only database provider.

-----

<a id="model-experience"></a>
## Model Experience

### The wiki source tools

#### What the model sees

One `source_mediawiki_search`, one `source_mediawiki_read`, and one `source_mediawiki_list` tool, each carrying the kind's limits statement and the ids of the configured wikis as its `source` argument description. Results arrive as rendered lines of the form `- <title> [<handle>] — <summary>`; a read renders the page title, its handle, and its wikitext.

#### Token effect

Registration adds three tool definitions per kind, whose size grows with the number of configured wikis. Each result is bounded: a read is cut at `maxReadBytes` and a listing at `maxListItems`, so one call cannot flood the conversation.

#### KV Cache effect

Append-only. A tool definition sits in the request prefix, so a settings change that alters the instance list rewrites the prefix from the first changed description and invalidates the cached span after it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the provider.

- **Read-only.** The provider issues no edit, move, delete, or upload, and it exposes no API for them.
- **A private wiki needs a bot account.** The login path uses the Action API's bot-password flow; an interactive or two-factor login is not supported.
- **Listings are category-level.** `list` returns the members of a category, or the wiki's categories when no container is named; there is no backlink or namespace listing.
- **A read returns wikitext, not rendered HTML.** Templates and transclusions are not expanded.
- **No page history or revision selection.** A read always returns the current revision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The client keeps its cookie jar per session, which is per operation here; a wiki with a high request volume would benefit from a session that outlives one operation, at the cost of holding credentials longer.

</details>

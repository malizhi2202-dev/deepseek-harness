---
description: "The GitHub source provider for ctx.sources: code search and file reads inside an explicit repository grant list, through the Octokit REST client."
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-github

English | [中文](README.zh.md)

## Summary

With `dsh-resource-github`, a model can search code and read files from a fixed set of repositories. The provider uses `@octokit/rest` rather than hand-written requests, authenticates with a personal access token resolved by name from `dsh-credentials` on every operation, and refuses HTTP redirects so the token cannot be forwarded to another origin. Access is default-deny: the instance names the repositories it grants, a search is qualified with one `repo:` term per granted repository, and a hit or a read that names anything outside that list fails with `SOURCE_NOT_FOUND`. Because GitHub's code search is rate-limited to ten authenticated requests per minute, the kind's limits statement says so, and a read of a path whose content GitHub does not return inline fails loudly instead of degrading. The model-facing tools live in `dsh-tool-resource`.

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

Mount the source registry, then this provider. Each grant is one instance under the `resource-github` settings namespace, and the instance id is the `source` argument the model passes to a tool.

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-github'
  config:
    maxReadBytes: 200000
    instances:
      platform:
        tokenRef: GITHUB_TOKEN
        repositories:
          - acme/platform
          - acme/shared-lib
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxReadBytes` | `200000` | Cap on one read, in bytes; the provider cuts the complete document and appends the truncation marker |
| `maxListItems` | `50` | Cap on one listing, in items |
| `instances.<id>.tokenRef` | required | The name of the credential holding the token, resolved through `ctx.credentials` per operation |
| `instances.<id>.baseUrl` | `https://api.github.com` | REST API base; set it for an enterprise deployment, such as `https://github.example/api/v3` |
| `instances.<id>.repositories` | required | The grant list of `owner/name` repositories; an entry that is not exactly that form is dropped |

An instance is configured when its token reference is a valid credential name that currently resolves to a non-empty value, its API base parses as `http` or `https`, and at least one grant entry survives validation. An unconfigured instance registers no tool and fails `check` with `SOURCE_UNCONFIGURED` before any request is made.

### What a configured source answers

A configured grant answers three operations, and the model-facing tool set follows from them.

- `search` runs a code search restricted to the granted repositories and drops any hit that names another repository.
- `read` returns one file's decoded text, cut at the read cap.
- `list` returns a directory's entries, or the granted repositories when no container is named.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider owns the GitHub protocol and the grant list. Tool schemas, rendering, and presentation belong to the consumer.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, settings section, provider registration |
| [`src/provider.ts`](src/provider.ts) | `GitHubSourceProvider`: instance resolution, the grant list, the three operations |
| [`src/api.ts`](src/api.ts) | The REST surface this provider uses, its response guards, and the Octokit adapter |
| [`src/types.ts`](src/types.ts) | Instance and resolved-configuration types |
| — | No runtime invariant companion is published; the provider owns no relation an independent observation could contradict. |

### Default-deny addressing

A handle is `owner/name` for a repository and `owner/name:path` for something inside it. Both parts are checked against the grant list before any request is sent, so a model cannot reach a repository the configuration did not name, and an identifier a model invents never becomes part of a request. A search carries one `repo:` qualifier per granted repository and its hits are filtered again on the way back, because GitHub may answer a search with a repository the qualifier did not name.

### Redirects and credentials

Octokit is constructed with `redirect: 'error'`, so a redirect response fails the call before the target is contacted. The token is resolved per operation and never cached by the provider.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level description is not enough.

- [Resource package map](../README.md) — the five-package family and each role.
- [dsh-resource](../resource/README.md) — the seam this provider registers into.
- [dsh-tool-resource](../tool-resource/README.md) — the model-facing tools derived from this provider.
- [dsh-resource-mediawiki](../resource-mediawiki/README.md) — the wiki provider.
- [dsh-resource-mysql](../resource-mysql/README.md) — the read-only database provider.

-----

<a id="model-experience"></a>
## Model Experience

### The repository source tools

#### What the model sees

One `source_github_search`, one `source_github_read`, and one `source_github_list` tool, each carrying the kind's limits statement — including the ten-requests-per-minute code-search quota — and the ids of the configured grants as its `source` argument description. Results arrive as rendered lines of the form `- <title> [<handle>] — <summary>`; a read renders the file path, its handle, and its decoded text.

#### Token effect

Registration adds three tool definitions per kind, whose size grows with the number of configured grants. Each result is bounded: a read is cut at `maxReadBytes` and a listing at `maxListItems`, so one call cannot flood the conversation.

#### KV Cache effect

Append-only. A tool definition sits in the request prefix, so a settings change that alters the grant list rewrites the prefix from the first changed description and invalidates the cached span after it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the provider.

- **Read-only.** The provider creates no issue, comment, branch, or commit, and it exposes no API for them.
- **Code search is rate-limited.** GitHub allows ten authenticated code-search requests per minute; a call above that quota fails with the API's own error text, and the provider does not retry or queue.
- **A large file cannot be read.** GitHub returns no inline content above roughly one megabyte, so such a path fails with `SOURCE_PROVIDER_ERROR` instead of a partial body.
- **No issue, pull-request, or release reading.** The provider covers repository content only.
- **No cross-repository file addressing.** A read names one granted repository, so a shared path must be read once per repository.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The provider wraps Octokit in a narrow interface so the tests can pin request construction and the redirect policy without a live token; the adapter is the only place that casts between the two type systems.

</details>

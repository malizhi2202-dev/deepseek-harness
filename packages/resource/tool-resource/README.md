---
description: "The model-facing source tools: one search, read, and list tool per registered source kind, derived from the capabilities each provider declares."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-resource

English | [中文](README.zh.md)

## Summary

With `dsh-tool-resource`, a model reaches every configured remote source through tools named after the kind they belong to: `source_mediawiki_search`, `source_github_read`, `source_mysql_list`, and so on. The consumer derives that tool set from what the registry holds — a kind contributes an operation only when its provider declares the capability, implements the method, and has at least one configured instance — so a model never sees a tool that cannot work, and a source that stops being configured stops being addressable instead of failing on every call. The set is re-derived whenever a kind changes, which covers a settings edit, a provider joining, and a provider going away. Every tool call resolves the instance as of that call, validates the model's arguments at this wire boundary, and bounds the rendered output at the kind's read cap. This package registers tools and nothing else; the protocols live in the provider packages.

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

Mount the tool runtime, the source registry, one or more providers, then this consumer. It injects `tools` and `sources` and registers nothing until both are available.

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
- name: '@deepseek-ai/dsh-tool-resource'
  config:
    maxResults: 20
    timeoutMs: 30000
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxResults` | `20` | Upper bound on hits one search call may return; a larger `limit` argument is rejected |
| `timeoutMs` | `30000` | Cooperative tool-call budget in milliseconds, attached to each derived definition |

### Which tools exist

A kind's tool set follows mechanically from its provider, so the table below is the whole rule.

| Tool | Registered when |
|---|---|
| `source_<kind>_search` | `capabilities.search` is true and the kind has at least one configured instance |
| `source_<kind>_read` | `capabilities.read` is true, the provider implements `read`, and the kind has at least one configured instance |
| `source_<kind>_list` | `capabilities.browse` is true, the provider implements `list`, and the kind has at least one configured instance |

### Arguments and results

Each tool takes a required `source` argument naming a configured instance id; the description lists the ids that currently exist, so a model can see its options without a separate call. `search` additionally takes `query` and an optional `limit`, `read` takes the handle a previous result returned, and `list` takes an optional container handle. A result carries the same handle back, so a model can chain a listing into a read. The rendered text is cut at the kind's `maxReadBytes` with the seam's truncation marker.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The consumer owns the model-facing vocabulary: tool names, argument validation, output rendering, the output bound, and presentation. It owns no protocol.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema and the `tools`/`sources` injection |
| [`src/tools.ts`](src/tools.ts) | Tool derivation, argument validation, output rendering and bound, presentation, and the re-derivation effect |
| — | No runtime invariant companion is published; the derived set is an effect on the calling fiber, and the disposal test pins that relation. |

### Why registration is conditional

A tool that exists but cannot work costs tokens in every request and teaches a model to distrust the tool set. Deriving the set from declared capabilities, implemented methods, and configured instances keeps every registered tool callable, and re-deriving on `sources/changed` keeps that true after a settings edit. Re-derivations are serialized: a refresh a newer one superseded registers nothing, so the last change wins and no stale definition survives.

### Why arguments are validated here

A tool argument is a wire boundary: it arrives as JSON from a model, not as a typed value from another package. The consumer therefore checks that a handle is non-empty and single-line, that a search limit is an integer inside the configured bound, and that the named instance is currently configured. A handle is branded at this point, which is where an opaque handle becomes a `SourceItemRef` the providers accept.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level description is not enough.

- [Resource package map](../README.md) — the five-package family and each role.
- [dsh-resource](../resource/README.md) — the registry this consumer derives tools from.
- [dsh-resource-mediawiki](../resource-mediawiki/README.md) — the wiki provider.
- [dsh-resource-github](../resource-github/README.md) — the code repository provider.
- [dsh-resource-mysql](../resource-mysql/README.md) — the read-only database provider.

-----

<a id="model-experience"></a>
## Model Experience

### The derived source tool set

#### What the model sees

For each configured kind, up to three tools whose names carry the kind: `source_<kind>_search`, `source_<kind>_read`, and `source_<kind>_list`. Every description repeats the kind's own limits statement and lists the instance ids the model may pass as `source`. A result is rendered text: a search or a listing as `- <title> [<handle>] — <summary>` lines, and a read as the item's title, its handle, and its content.

#### Token effect

Registration adds three tool definitions per configured kind, and each definition's size grows with the number of configured instances because the ids are listed in its description. A result is bounded twice: the provider cuts it at the kind's `maxReadBytes`, and the consumer bounds the complete rendered text — header included — at the same cap.

#### KV Cache effect

Append-only, with one exception worth knowing: a tool definition sits in the request prefix, so a settings change that alters the instance list or the limits statement rewrites the prefix from the first changed description and invalidates the cached span after it. Adding an unrelated provider does the same when it changes the registered order.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the consumer.

- **The instance list is baked into each description.** A settings edit therefore changes the request prefix rather than only the arguments a model may pass.
- **No pagination.** A search returns at most `maxResults` hits and a listing at most the kind's `maxListItems`; a model narrows a query instead of paging.
- **One instance per call.** A tool names a single `source`, so a model searches or reads one source at a time and cannot ask two kinds in one call.
- **No result metadata for the client.** A presenter returns a generic card title and leaves the content to the raw result; a richer card would need presentation metadata this wave did not define.
- **The kind set is a name prefix, not a namespace.** A tool name is built from the kind, so two providers whose kinds differ only by a suffix both appear, and a deployment with many kinds has many tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Re-derivation listens to `sources/changed` rather than polling, and the refresh counter exists because two changes can overlap while `instances()` is awaited; without it the slower refresh would overwrite the newer tool set.

</details>

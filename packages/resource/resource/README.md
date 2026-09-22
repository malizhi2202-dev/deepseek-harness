---
description: "The remote source capability seam: the ctx.sources registry, the source vocabulary providers implement, the typed failures, and the read bound every provider applies."
kind: "package-reference"
---

# @deepseek-ai/dsh-resource

English | [中文](README.zh.md)

## Summary

With `dsh-resource`, the harness gains one registry for remote collections a model may consult: wikis, code repositories, and databases. This package is the Service Definition of that seam. It owns the source vocabulary (`SourceKind`, `SourceItemRef`, `SourceHit`, `SourceDocument`, `SourceCapabilities`), the `ctx.sources` registry, the typed failures a provider raises, and the helper that cuts a read at the declared byte cap. A deployment mounts it once and then mounts one provider package per kind, which registers itself on `ctx.sources`. Each kind declares what it can answer — full-text search, browsing, reading, its read byte cap, its listing item cap, and a model-facing statement of its limits — so a consumer states those limits instead of letting a model call an operation the kind does not have. The model-facing tools live in `dsh-tool-resource`; the providers live in `dsh-resource-mediawiki`, `dsh-resource-github`, and `dsh-resource-mysql`.

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

Mount the registry, then mount the providers a deployment wants. The registry holds one provider per kind and publishes no service of its own beyond `ctx.sources`.

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mediawiki'
```

### What a provider implements

A provider is the only code that knows a kind's protocol, addressing, and limits. It registers itself and receives its own resolved configuration back in every operation.

| Member | Requirement | Meaning |
|---|---|---|
| `kind` | required | The registry key and the first segment of every tool name derived from it |
| `capabilities` | required | What the kind answers, its read byte cap, its listing item cap, and the model-facing limits statement |
| `instances()` | required | Every instance the kind's settings declare, with each instance's completeness; opens no connection |
| `check(config)` | required | Probes credentials and reachability; its rejection text is the last error a configuration surface shows |
| `search(config, query, limit, signal)` | required | Returns hits in the source's own relevance order |
| `read(config, ref, signal)` | optional | Returns one item, cut at `capabilities.maxReadBytes` |
| `list(config, ref, signal)` | optional | Returns a container's children; `ref` is `undefined` for the source's roots |

A kind that omits `read` or `list` registers no tool for that operation. Registration is an effect on the calling fiber: disposing the fiber removes the provider and emits `sources/changed`, which is how the model-facing tools notice a kind that appeared, changed, or went away.

### What the registry offers

| Call | Returns |
|---|---|
| `ctx.sources.register(provider)` | The disposer that unregisters the provider |
| `ctx.sources.list()` | Every registered provider, in registration order |
| `ctx.sources.get(kind)` | One provider, or `undefined` when the kind is not registered |

A kind name is lower-case and starts with a letter, because it becomes a tool-name segment and a settings namespace segment. Registering a malformed kind raises `SOURCE_PROVIDER_ERROR`; registering a second provider for the same kind raises `SOURCE_DUPLICATE_PROVIDER`.

### Failures and bounds

Providers raise `SourceError` with a code a consumer routes on: `SOURCE_UNCONFIGURED` when the instance's settings lack a required value, `SOURCE_PROVIDER_ERROR` when the backend refused or answered something unusable, `SOURCE_NOT_FOUND` when a handle names nothing the caller may see, `SOURCE_DUPLICATE_PROVIDER` for a repeated kind, and `SOURCE_DENIED` when an operation is outside what the source permits and nothing reached the backend. `truncateUtf8` and `boundDocumentContent` cut a value at a byte cap and append `SOURCE_TRUNCATION_MARKER`, so a cut result says so instead of silently losing text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The registry is deliberately thin: it stores providers, publishes changes, and owns the vocabulary. Everything protocol-specific stays in the provider.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The seam vocabulary: kinds, handles, capabilities, hits, documents, configurations, the provider interface, and the registry interface |
| [`src/index.ts`](src/index.ts) | The `SourceRegistry` service: registration as an effect, kind-name validation, lookup, and the `sources/changed` event |
| [`src/error.ts`](src/error.ts) | `SourceError` and the five stable failure codes |
| [`src/bounds.ts`](src/bounds.ts) | `truncateUtf8`, `boundDocumentContent`, and the one truncation marker every provider appends |
| — | No runtime invariant companion is published; the registry owns no relation an independent observation could contradict beyond its own map, which the disposal test pins. |

### Why capabilities are required

A model cannot discover that a kind has no search by trying one. Declaring `search`, `browse`, and `read` as booleans lets the tool consumer derive exactly the operations a kind implements and leave the rest unregistered, so a model never sees a tool that cannot work. `maxReadBytes`, `maxListItems`, and `description` travel with those booleans because the derived tool description must state the limits the provider enforces.

### Why the read bound lives here

Every provider cuts a read at the same declared cap and appends the same marker, so a model can recognize a cut result regardless of the kind it came from. Keeping one implementation in the seam is what makes that guarantee hold across three unrelated protocols.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level description is not enough.

- [Resource package map](../README.md) — the five-package family and each role.
- [dsh-tool-resource](../tool-resource/README.md) — the model-facing tools derived from these providers.
- [dsh-resource-mediawiki](../resource-mediawiki/README.md) — the wiki provider.
- [dsh-resource-github](../resource-github/README.md) — the code repository provider.
- [dsh-resource-mysql](../resource-mysql/README.md) — the read-only database provider.
- [Resource library design](../../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md) — the frozen vocabulary and the deviations this wave recorded.

-----

<a id="model-experience"></a>
## Model Experience

### Registration is model-invisible

#### What the model sees

Nothing. This package registers no tool, no prompt section, and no session event. What a model eventually sees for a source is derived by `dsh-tool-resource` from the providers this registry holds.

#### Token effect

Zero. Mounting the registry adds no prompt text and no tool definition; every model-visible byte belongs to a provider's declared capabilities and to the consumer that renders them.

#### KV Cache effect

None. The registry contributes no request prefix, so mounting it or registering a provider changes no cached span.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the seam, not deferred features of a provider.

- **No address domain for a source.** The roadmap proposed registering a `dsh-resource://<source>/` address per source; the frozen design gives the `sources` panel a page type that claims no address, so this wave implements neither. Nothing here can be linked to by address.
- **`instances()` is an addition to the frozen registry interface.** The design's `Sources` type carries `register`, `list`, and `get` only, which cannot enumerate the configured instances a tool description must name. The provider interface gained `instances()`; the registry interface kept the design's three calls.
- **The registry calls no provider.** It never probes reachability and holds no cache, so a configured-but-unreachable source reports its error on the operation that used it, not at registration.
- **One kind per provider, and no cross-kind search.** A caller names a kind and an instance, so a model searches one source at a time.
- **Capabilities are fixed per kind, not per instance.** The read cap and the listing cap come from the kind's settings section, so two instances of one kind cannot declare different caps.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The registry keeps providers in insertion order because a tool description lists instance ids in that order; reordering the map would reorder model-visible text without any behavior change.

</details>

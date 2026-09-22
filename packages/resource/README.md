---
description: "Package map for the remote resource family: the ctx.sources seam, its wiki/code/database providers, and the model-facing source tools."
kind: "package-group"
---

# resource/ — remote resource family

English | [中文](README.zh.md)

## Summary

The `resource/` group gives the harness remote sources a model may consult: a wiki, a code repository, and a database. One seam (`ctx.sources`) owns the vocabulary, the registry, and the typed failures; one provider package per kind owns that kind's protocol, addressing, and limits; and one consumer derives the model-facing tools. Five packages split the family: the `resource/` seam, three providers, and `tool-resource/`, which registers one `search`, one `read`, and one `list` tool per kind that actually implements them. Each provider reads its settings from its own `dsh-settings` namespace and resolves its secret by name through `dsh-credentials`, so no credential value is stored in configuration and no new persistence domain appears. The group owns read access only: no provider writes to its backend, and each kind keeps its own resource caps.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Five packages play the resource roles; each provider README owns its kind's configuration and limits.

| Package | Role | ctx key |
|---|---|---|
| [`resource/`](resource/README.md) | Source registry: the vocabulary, `ctx.sources`, typed failures, and the read bound every provider applies | `ctx.sources` |
| [`resource-mediawiki/`](resource-mediawiki/README.md) | Searches, reads, and lists pages of a MediaWiki wiki | registers on `ctx.sources` |
| [`resource-github/`](resource-github/README.md) | Searches code and reads files inside granted repositories | registers on `ctx.sources` |
| [`resource-mysql/`](resource-mysql/README.md) | Reads granted databases, tables, and rows through a read-only view | registers on `ctx.sources` |
| [`tool-resource/`](tool-resource/README.md) | Derives the model-facing `source_<kind>_<operation>` tools from the registered providers | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the group's subsystem reference, then the tool contract the consumer implements, then the services these providers read their configuration and secrets from.

- [Resource library subsystem](../../docs/subsystems/resource-library.md) — the source vocabulary, the `ctx.sources` registry semantics, the shared read bound, the failure codes, and the `sources` Remote endpoint.
- [Tools subsystem](../../docs/subsystems/tools.md) — the tool definition, schema DSL, registration and disposal rules, and presentation vocabulary the source tools implement.
- [Settings subsystem](../../docs/subsystems/settings.md) — the namespace sections each provider reads its instances from.
- [Credentials subsystem](../../docs/subsystems/credentials.md) — the credential-reference resolution each provider performs per operation.
- [Resource library design](../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md) — the frozen vocabulary, the three provider kinds, and the deviations this wave recorded.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

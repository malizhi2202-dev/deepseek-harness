---
description: "The MySQL source provider for ctx.sources: read-only structure and row access inside an explicit database and table grant list, with a statement whitelist at the query entry."
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-mysql

English | [中文](README.zh.md)

## Summary

With `dsh-resource-mysql`, a model can inspect the structure of granted databases and read granted tables without any path to a write. Access is default-deny at two levels: the instance names the databases and tables it grants, and the provider's query entry accepts only `SELECT`, `SHOW`, and `DESCRIBE`, refusing everything else before a session is opened. A write is refused by classification, not by hoping the server rejects it: the connector also sets `SET SESSION TRANSACTION READ ONLY` on every session and never enables multiple statements, and a second statement smuggled into one string is refused as well. Every identifier in a statement comes from the configuration's own grant text, so a handle a model invents is rejected before any SQL exists. Row and byte caps bound each result. The model-facing tools live in `dsh-tool-resource`.

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

Mount the source registry, then this provider. Each grant is one instance under the `resource-mysql` settings namespace, and the instance id is the `source` argument the model passes to a tool.

```yaml
- name: '@deepseek-ai/dsh-resource'
- name: '@deepseek-ai/dsh-resource-mysql'
  config:
    maxReadBytes: 200000
    instances:
      reporting:
        host: 127.0.0.1
        port: 3306
        user: dsh_reader
        passwordRef: MYSQL_READER_PASSWORD
        databases:
          - analytics
        tables:
          - analytics.daily_orders
        maxRows: 100
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxReadBytes` | `200000` | Cap on one read, in bytes; the provider cuts the complete rendered result and appends the truncation marker |
| `maxListItems` | `50` | Cap on one listing, in items |
| `instances.<id>.host` | `127.0.0.1` | Server host |
| `instances.<id>.port` | `3306` | Server port |
| `instances.<id>.user` | required | The database account, which should itself hold only read privileges |
| `instances.<id>.passwordRef` | required | The name of the credential holding the password, resolved through `ctx.credentials` per operation |
| `instances.<id>.databases` | omitted | Granted databases; a database the server reports but this list omits stays invisible |
| `instances.<id>.tables` | required | Granted tables as `database.table`; at least one must survive validation |
| `instances.<id>.maxRows` | `100` | Rows one read may return before it is marked truncated |

An instance is configured when it names a user, its credential reference is valid and currently resolves to a non-empty value, and at least one granted table is well formed. An unconfigured instance registers no tool and fails `check` with `SOURCE_UNCONFIGURED` before a connection is opened.

### What a configured source answers

A configured grant answers three operations, and the model-facing tool set follows from them.

- `search` matches granted table names. This kind has no full-text search over row contents, and its search issues no statement at all.
- `read` returns a granted table's rows, or one column of it, as tab-separated text under a header line.
- `list` returns the granted databases the server reports, one database's granted tables, or one table's columns.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider owns the SQL it issues and the grant list. Tool schemas, rendering, and presentation belong to the consumer.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, settings section, provider registration |
| [`src/provider.ts`](src/provider.ts) | `MySqlSourceProvider`: instance resolution, the grant list, the three operations, row and byte caps |
| [`src/sql.ts`](src/sql.ts) | The statement whitelist, the read-only query entry, identifier quoting, and row rendering |
| [`src/mysql2-connector.ts`](src/mysql2-connector.ts) | The `mysql2` connection: single-statement, read-only session, rows normalized |
| [`src/types.ts`](src/types.ts) | Instance, configuration, connection, and session types |
| — | No runtime invariant companion is published; the provider owns no relation an independent observation could contradict. |

### How a write is refused

Every statement the provider issues passes through one entry that classifies it first. The entry accepts a statement that begins with `SELECT`, `SHOW`, or `DESCRIBE`, rejects a second statement, and rejects a read-shaped statement that writes or locks, such as `INTO OUTFILE` or `FOR UPDATE`. A rejected statement raises `SOURCE_DENIED` and never reaches the session, which the tests prove with a recording session that must stay empty. Underneath, the session itself is read-only and multiple statements are disabled, so a classification mistake would still not produce a write.

### How visibility is default-deny

A handle is `database`, `database.table`, or `database.table.column`. The provider looks the handle up in the configuration's grant list before it builds any statement, and it takes the identifier text from the grant entry rather than from the handle. A database the server reports but the configuration does not grant is dropped from a listing, so the model never learns it exists.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level description is not enough.

- [Resource package map](../README.md) — the five-package family and each role.
- [dsh-resource](../resource/README.md) — the seam this provider registers into.
- [dsh-tool-resource](../tool-resource/README.md) — the model-facing tools derived from this provider.
- [dsh-resource-mediawiki](../resource-mediawiki/README.md) — the wiki provider.
- [dsh-resource-github](../resource-github/README.md) — the code repository provider.

-----

<a id="model-experience"></a>
## Model Experience

### The database source tools

#### What the model sees

One `source_mysql_search`, one `source_mysql_read`, and one `source_mysql_list` tool, each carrying the kind's limits statement — including that only `SELECT`, `SHOW`, and `DESCRIBE` are issued and that no write operation exists — and the ids of the configured grants as its `source` argument description. Results arrive as rendered lines of the form `- <title> [<handle>] — <summary>`; a read renders the table handle and a tab-separated header line followed by one line per row, with `NULL` for a missing value.

#### Token effect

Registration adds three tool definitions per kind, whose size grows with the number of configured grants. Each result is bounded: a read returns at most `maxRows` rows and is then cut at `maxReadBytes`, and a listing is cut at `maxListItems`, so one call cannot flood the conversation.

#### KV Cache effect

Append-only. A tool definition sits in the request prefix, so a settings change that alters the grant list rewrites the prefix from the first changed description and invalidates the cached span after it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the provider.

- **Read-only.** No `INSERT`, `UPDATE`, `DELETE`, or DDL statement can be issued; the provider has no code path that would send one.
- **Search matches table names only.** There is no full-text search over row contents, and the search issues no statement.
- **No arbitrary SQL.** A model cannot join tables, aggregate, or filter by a value; a read returns a projection of one granted table, bounded by `maxRows`.
- **Values are rendered as text.** A binary value becomes a byte count, an object or array becomes its JSON text, and a value the renderer does not know becomes a placeholder.
- **The row cap is per instance, the byte cap per kind.** `maxRows` is instance configuration while `maxReadBytes` and `maxListItems` belong to the kind's settings section.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The connector opens no pinned database, so every statement carries its schema explicitly; that keeps a granted table addressable even when the account's default database differs from the grant.

</details>

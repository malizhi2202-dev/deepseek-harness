---
description: "The sources Remote namespace for client consumers reading remote-resource source status, and for maintainers of the host endpoint that derives it and probes one instance."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-sources

English | [中文](README.zh.md)

## Summary

`dsh-api-sources` owns the `sources` Remote namespace: `status` reports every remote-resource instance this Host serves, and `probe` tests one instance against the settings and credentials its provider resolved. It is the configuration panel's only way to reach the resource seam, and it holds no configuration of its own — every answer is read from `ctx.sources`, the settings provider, and the credential seam at call time.

Credential references cross as names and presence only. A source kind's settings schema marks which fields name a `dsh-credentials` reference; this endpoint reports whether something is stored behind each name, never what.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Client code calls the namespace through the Remote carrier the [dsh-api-remotes](../remotes/README.md) client assembly already mounts; no plugin loads this package in the browser directly. `status` takes no argument and returns every instance; `probe` takes the `key` a `status` answer reported. An instance this Host does not serve crosses the wire as the declared `sources/unknown` code, while a source that simply could not be reached is answered as `ok: false` with the reason.

Host compositions mount the package beside `ctx.sources`, `ctx.credentials`, `ctx.settings`, and `ctx.typert`; it injects exactly those.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/types.ts` carries the wire types and re-exports `SourceCapabilities` from `src/seam.ts` rather than restating it, so the panel's declaration and the provider's declaration stay one type. `SourceView` carries one instance's identity, the settings namespace that configures its kind, where it stands, the last error with its time, the declared capabilities, and one credential fact per reference the instance names.

`src/seam.ts` is a local mirror of the resource seam's provider contract, because this package adds no dependency: the service it rides is provided by another package, and the mirror documents the one-line swap to `@deepseek-ai/dsh-resource/types` when that dependency is taken.

`src/index.ts` is the endpoint. `status` asks every registered provider for the instances its own configuration declares, so a provider that read its settings a moment ago is reported at those values rather than at a copy; each instance's state comes from the provider's own `configured` answer plus the last probe this process observed, and an instance edited since its probe reads as unchecked again because the outcome describes settings that no longer stand. `probe` hands the provider the instance that provider resolved and answers `ok: false` with the reason rather than refusing, because "the credentials are wrong" is exactly what the panel exists to show.

The credential fields are read structurally: the settings provider publishes a schema as JSON, where a nested node is either inline or an index into a shared `refs` table, and the endpoint walks the containers a reference can be declared through — `object`, `dict`, `array`, and `intersect` — collecting the fields whose node declares `meta.role === 'credential-ref'`. The field names are then read off the instance the provider resolved, so a reference the user changed a moment ago is reported at its new value without this endpoint caching anything.

<a id="model-experience"></a>
## Model Experience

### Remote source status

#### What the model sees

Nothing directly. The endpoint registers no tool, prompt section, or session event, and no answer it returns reaches a model request. What a source can answer reaches the model through the resource seam's own consumers — the tools that search and read a source — and this endpoint only reports that same `capabilities` declaration to a human-facing panel.

#### Token effect

None on its own. A `status` or `probe` answer adds no tokens to any request; a source a person configures here changes what those other consumers can return, and their own token accounting covers it.

#### KV Cache effect

No direct invalidation; nothing here assembles or shapes a model request.

## Known Limitations and Deferred Work

- **The settings namespace is derived, not declared.** Each provider package names its own namespace `resource-<kind>` and resolves its instances from it, but neither the seam nor the settings domain exposes a kind-to-namespace member, so this endpoint composes the name. A provider that names its namespace differently still reports its instances, and its configuration surface reads as unavailable rather than showing a form for a namespace that does not exist. The fix belongs to the seam: a `settings` or `namespace` member on `SourceProvider`.
- **Probe outcomes live in this process only.** The design adds no durable domain for them, so a restart reports every configured instance as unchecked until someone probes it again.
- **A credential reference this build cannot read is reported as unset.** A reference declared on a field the schema walk does not reach — one buried in a union branch or a transform — is not reported at all, and one whose value is not a reference name is reported with an empty name rather than silently omitted.
- **No enable or disable.** The design derives whether a source connects from whether it is configured, so the namespace moves no activation state and offers no control that could not work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: the endpoint is a thin derivation whose state mapping and schema walk are pinned by its own suite against scripted providers, settings descriptors, and credential facts.

The suite builds serialized settings schemas by hand in the same `{uid, refs}` form the settings provider publishes, so each container the credential walk descends is covered by a case rather than by a real provider's current schema.

</details>

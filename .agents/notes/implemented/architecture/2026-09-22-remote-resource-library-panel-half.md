# Agent Note: Remote resource library panel half

Status: implemented

English | [中文](2026-09-22-remote-resource-library-panel-half.zh.md)

## Problem

The [resource library design](../../../../discovery/remote-control-and-sources-2026-09-21/04-resource-library-design.md) freezes the vocabulary for reaching a deployment's own collections — a wiki, a code host, a database — and splits the wave: the [host half](2026-09-22-remote-resource-library-host-half.md) ships the seam, the three providers, and the model-facing consumer, while the configuration surface a person uses to make a source work belongs to a separate change. Without that surface the seam is only reachable by editing a settings document by hand, and a source that is misconfigured reports itself to a model as unusable with nothing in the GUI that says why.

The surface has to answer three questions the seam does not, and answer them without becoming a second source of truth. Which instances exist is the provider's own answer, and one kind can declare several, so an instance needs an identity that survives a settings edit. Whether an instance is configured is the provider's answer too, and a source builds no connection of its own, so there is no activation state for a panel to move. And a credential is named, never inlined, so the panel must show whether a name resolves without ever holding a value — a rule the settings provider's secret redaction does not cover, because a credential reference is not declared as a secret.

## Decision

Two packages, mirroring the chat-channel pair that already solves this shape. `@deepseek-ai/dsh-api-sources` owns the `sources` Remote namespace: `status` reports every instance the registry serves, and `probe` tests one. `@deepseek-ai/dsh-client-ui-sidebar-sources` registers `sources` as a right-Sidebar tab type — `order: 700`, `visibility: 'available'`, a page type that claims no address and declares no pattern — whose body draws the list, each instance's state, its credential references, a settings form derived from the kind's own schema, and that kind's hard limits.

**An instance is addressed by `kind/id`, and the key is opaque.** A `status` answer carries `key`, `kind`, `id`, and the settings namespace; every later call names the key and never parses it. The panel's store keeps its per-instance records — the last probe, the last control failure, the staged drafts — under that key, so one kind declaring two instances keeps two forms and two outcomes apart, and a reload carries each instance's records forward.

**The panel derives state instead of owning it.** `unconfigured` is the provider's own `configured: false`; `unchecked` is a configured instance no probe has observed at the kind's current settings revision; `usable` and `unusable` come from the last probe this process observed. An instance edited after its probe reads as unchecked again, because the outcome describes settings that no longer stand, and a failure is not cleared by a later success. No enable or disable exists, because the design derives whether a source connects from whether it is configured and a control that could not work must not be offered.

**Credential references are discovered structurally and reported by name.** The settings provider publishes a schema as JSON in which a nested node is either inline or an index into a shared `refs` table, and `redactSecrets` covers `role('secret')` but never `role('credential-ref')`. The endpoint therefore walks the containers a reference can be declared through — `object`, `dict`, `array`, `intersect` — collects the fields whose node declares that role, and reads each field's value off the instance the provider itself resolved. It reports the reference name, whether something is stored behind it, the layer it came from, and whether this Host could write it; a value that is not a reference name is reported as unset rather than silently dropped.

**The settings namespace is derived from the provider convention.** Every shipped provider names its namespace `resource-<kind>` and resolves its instances from it, and the seam exposes no kind-to-namespace member, so the endpoint composes the name. A kind whose namespace is registered differently still reports its instances, and its configuration surface reads as unavailable rather than rendering a form for a namespace that does not exist.

**The seam is mirrored locally rather than depended on.** This wave may add no dependency, so `packages/api/sources/src/seam.ts` restates the provider contract the endpoint consumes — kinds, capabilities, configs, descriptions, and the registry's two reads — with the operations the panel never calls (`search`, `read`, `list`) deliberately absent. Taking `@deepseek-ai/dsh-resource/types` as a devDependency, referencing its project, and replacing the mirror with one type-only import is the whole change; the endpoint is already written against those names.

**Sources the design deliberately does not build are stated with their reason and no control.** 360云盘, 网易云盘, 夸克云盘, and 百度云 are listed in a collapsible block with what the record says about each, and the WebDAV/S3/local-mount alternative is named. 360AI云盘 is listed as undecided: the design record and the request record disagree about whether it was ruled out or left open, so the panel reports that it is not built in this wave and takes no position.

## Alternatives considered

**Key an instance by kind.** Rejected: a kind can declare several instances, so two instances would share one form, one probe outcome, and one React key. The channels panel can key by kind because a channel is one binding; a resource kind is a collection of instances.

**Report a source's configuration by reading the settings section directly.** Rejected: the section holds the reference *names* a person typed, while the provider holds the values it resolved — including the composition layer and the default an unset field falls back to. Reading the section would report a reference the provider never resolved, and would put a second interpretation of the configuration in the panel.

**Render the form from the endpoint's own view of the schema.** Rejected: the settings domain already publishes a per-namespace descriptor with its layers, its revision, and a bound write scope, and its mirror is shared with the settings panel. Deriving rows from the descriptor keeps one reader of the document and makes a kind this build has never heard of still get a form.

**Show a credential's value so a person can confirm it.** Rejected: the design forbids inlining a secret, and a panel that renders one would put it in the DOM, in a screenshot, and in any export of the page. Presence, origin, and writability answer the question a person actually has.

**Offer enable and disable per source.** Rejected: the design derives connection from configuration, so such a control would write state nothing reads. The wave that adds an activation domain can add the control.

**Reuse the channels panel's form module.** Rejected for this wave: the two packages are separate features, a feature plugin must not runtime-import another's values, and promoting the shared part into a static owner needs sign-off this change does not have. The resource form is decomposed differently and covers a smaller surface.

## Consequences

- **A kind this build does not name is still configurable.** The form comes from the descriptor and the labels fall back to the kind verbatim, so a provider mounted by a deployment gets a working card without a change here. Its hard limits are shown as the provider's own model-facing `description`, which is the only truthful wording available; the panel's own limit copy exists for GitHub, MySQL, and MediaWiki.
- **One coupling is guessed and degrades visibly.** The `resource-<kind>` namespace convention is not declared by the seam, so a provider that names its namespace differently loses its form. The fix belongs to the seam — a `settings` or `namespace` member on `SourceProvider` — and is recorded in the endpoint's Known Limitations.
- **Probe outcomes are process-local.** A restart reports every configured instance as unchecked until someone probes it again; the design adds no durable domain for them.
- **The panel's settings plumbing parallels the channels panel.** `form.ts` is decomposed differently and has a smaller surface, and the rest is not measured for duplication: `pnpm run duplication` cannot run on this host, because the pinned jscpd binary needs GLIBC 2.32 and this host provides 2.31. No duplication result is claimed.
- **Two new packages need the parent's wiring.** `packages/api/sources` needs its host aggregate reference, its `tsconfig.base.json` aliases, and its Remote service mounted into the client assembly; `packages/client/ui-sidebar-sources` needs its `tsconfig.client.json` reference, its aliases, a `dsh.client` row in the Web bundle's patch layer, and that bundle's dependency entry. Until those land, the client aggregate reports the package's files as outside its project file list.
- **The generated Typert artifacts are build residue.** `lib/typert.host.*` and `lib/typert.remote-client.*` were emitted from a scratch host configuration because the package is not yet in the canonical aggregate; the parent must regenerate them through the repository generator after wiring.

## Testing

`packages/api/sources` holds 34 tests across two files, and `packages/client/ui-sidebar-sources` holds 76 across six, at per-file 100% statements, branches, functions, and lines for every source file in both packages.

The endpoint's suites drive scripted providers, settings descriptors, and credential facts. They pin one view per declared instance with kinds and instances in registration order, the minimal key order of a wire view, state derivation for each of the four states including a revision that moved after a probe and a failure a later success did not clear, and the credential walk against hand-written serialized schemas covering a flat root object, a dictionary of instances, an intersection, an array, a nested object, an unresolvable reference, and a value that is not a reference name. Probe cases pin that the provider receives the instance it resolved, that an unknown key crosses as `sources/unknown`, and that a refusal is answered as a value.

The panel's suites mount the body over a real store instance, a scripted Remote, and a scripted settings port. They pin every state the read can settle in, one card per instance, credentials by reference name and never by value, the limits each kind states including a kind this build does not name, a save that sends exactly the staged operations under the revision it read, a save that did not land keeping its drafts, and the absent-source block offering no control. The tab type is asserted against the slot declaration contract the right Sidebar publishes, and `verify-sidebar-right-tab-types` reports `sources` at order 700 as an available page type.

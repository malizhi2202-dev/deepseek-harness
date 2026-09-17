# Agent Note: Discovery Refuses an Undeclared Wire Protocol

Status: implemented

English | [中文](2026-09-17-discovery-refuses-undeclared-protocol.zh.md)

## Problem

Model discovery for a route the installed catalog does not describe asks the endpoint at `GET {baseURL}/models`, and the wire protocol decides that request's headers, its listing URL, and whether the reply parses at all. A discovery request that names no protocol still went out, asked as `openai-completions`, and the code documented that choice as a guess: an Anthropic gateway answers 401 to a completions probe, "which reads as a credential problem".

Two defects followed from one guess. The probe misdirected every endpoint speaking another protocol, and the failure notice then made the misdirection worse: a 401 or 403 response appended `check the API key` unconditionally, so the operator was sent to re-check a credential that was never the cause, with no trace of what actually went wrong. The package's own README already required `api`, `baseURL`, and a non-empty `models` list of a route pi-ai does not ship, so the discovery path contradicted a requirement its own package documented.

## Decision

`discoverModels` refuses a request that names no protocol, before anything goes out, with `DISCOVERY_UNSUPPORTED` and a message naming the missing field, the protocols this build can ask, and hand-entry as the remaining way out. The protocol is the one input the caller owns, so the path no longer substitutes one. Because the refusal happens before the network, the same code covers the request-shape gap the caller must close and the request-shape gap the module owns.

A rejected listing at 401 or 403 now names both candidates rather than concluding the first: `check the credential, and that api "<api>" is the wire protocol this endpoint speaks`. A credential the endpoint refuses and a route whose declared protocol is wrong present identically at that status, so the message stops short of asserting which one it is. Other statuses carry no hint, as before.

`LISTABLE_PROTOCOL_NAMES` is the single in-package declaration of the protocols this build can list models for; `LISTABLE_PROTOCOLS` is its membership test and `listableProtocols()` renders it for the refusals. `PROTOCOLS` in `provider.ts` owns the wire protocols the adapter can speak and this list is the subset with a model-listing endpoint, which the constant's JSDoc states.

Neither the request type nor the settings page changed. `LlmModelDiscoveryRequest.api` stays optional in the vocabulary, because a route the catalog already answers needs no protocol; the field is required only of a request that interrogates an endpoint. The models settings page already carries a protocol selector on the custom-provider card and passes it as `api`, so an operator who has chosen a protocol is unaffected.

## Alternatives considered

**Keep the default and fix only the notice.** This leaves the probe itself misdirected: an endpoint that speaks another protocol is still asked the wrong question, and the operator still learns about it through a failure rather than through the request that could have named the protocol up front. It also leaves the code contradicting the package README.

**Condition the credential hint on the protocol having been explicitly declared.** After the refusal lands, an undeclared protocol can no longer reach the rejection path, so the condition would be satisfied by every request that gets there and the hint would stay unconditional in effect. The declaration can also be wrong, which is the case the hint was misdescribing.

**Probe the endpoint to learn its protocol, or retry another protocol after a failure.** A request the endpoint rejects as bad reproduces itself against any other protocol and buries the real cause; protocol mismatch is not a failover trigger, and an implementation that settles the protocol by probing is not a pattern any surveyed gateway or specification provides. Deciding the protocol before the request keeps one request per interrogation and one cause per diagnostic.

**Make `api` required in `LlmModelDiscoveryRequest`.** The type would then demand a protocol from catalog routes that never interrogate an endpoint, and from callers that hold no protocol to give. The refusal belongs where the endpoint is actually asked.

## Consequences

A draft route that has not chosen a protocol cannot discover models until it does. That is the intended cost: the action is withheld from a caller who has one field left to fill, and the refusal says which field and what values it accepts. The models page's protocol selector is the answer the refusal points at.

The 401 and 403 notice no longer asserts a credential cause, so an operator with a genuinely wrong key is asked to consider two candidates instead of one. The trade is deliberate: a wrong key is recoverable and self-evident once tried, while a wrong protocol produced an investigation that could not converge, and both share one status code.

The underlying misdirection is reduced, not eliminated. A route whose declared protocol is wrong still fails, and its notice now names the possibility rather than resolving it; nothing in the discovery path can verify that an endpoint speaks the protocol its route declares. `LISTABLE_PROTOCOL_NAMES` and `PROTOCOLS` remain two declarations with a stated relationship rather than a derived one, so a future protocol added to one and not the other still drifts silently.

## Testing

`packages/llm/llm-pi-ai/tests/discovery.spec.ts` covers the refusal by asserting both its message and its `DISCOVERY_UNSUPPORTED` code, and asserts the 401/403 notice names the declared protocol while a server fault names neither. Every request in that spec that reaches an endpoint now names its protocol explicitly; the spec's catalog tests still pass no protocol and still resolve from the catalog. The file holds 100% statement, branch, function, and line coverage, and the package's 13 spec files pass.

## Related

The capability seam this sits on is the model-discovery registration in `packages/llm/llm/src/index.ts`, assembled by `packages/llm/llm-pi-ai/src/index.ts` and consumed by `packages/client/ui-settings-models`. `PROTOCOLS` lives in `packages/llm/llm-pi-ai/src/provider.ts`.

# Agent Note: Apply the tuitui card's model route to a resumed Session

Status: implemented

English | [中文](2026-09-16-tuitui-route-validation-and-resumed-session.zh.md)

## Problem

The tuitui settings card carries `provider` and `model` as free text, and the bridge passed them to `ctx.agents.create` as the only route signal. Three failures followed.

A card that set neither field produced `agentOptions: {}`, so `context.agent.options.model` stayed undefined and system-prompt assembly failed on a deployment `personaPrefix` containing `{{model}}` with `prompt variable "{{model}}" has no value for this assembly`. A card that held a provider display name (`360`, for the registered route `deepseek360`) opened a Session whose every request failed with `no adapter registered for provider "360"`; a model display name (`deepseek-v4.1-flash-360`, for the id `deepseek/deepseek-v4.1-flash`) failed the same way one layer deeper. Correcting the card did not help, because a Session keeps the route recorded in its `request/header`: `ctx.agents.create` with the chat's stable `sessionId` resumes the persisted Session, where creation-time options no longer decide routing. The recorded failure then repeated on every message.

## Decision

`TuituiBridge` keeps one `ModelSelectionRef` per chat and installs it with `installModelSelection` (`@deepseek-ai/dsh-agent`) inside the Agent `setup` the bridge already owns. That helper overrides `agent/request` unconditionally and injects `provider`/`model` into `system-prompt/assemble`, so a resumed Session routes where the bridge says and `{{model}}` always resolves.

`handleAgentMessage` re-resolves the route through `resolveAgentOptions()` on every message and writes it to `chat.selection.current` before the turn. `resolveAgentOptions()` takes `ctx.agentDefaultModel.currentSelection()` when the card sets neither field, rejects a card that sets exactly one, and otherwise checks the provider against `ctx.llm.listProviders()` and the model against `ctx.llm.listModels(provider)` — the catalog `llm-pi-ai` resolves a request against — suggesting an id when the value equals a registered display name. A catalog that cannot be listed is left to the request. The rejection replies to the chat through the existing `[错误]` path, which previously could not report it because the throw escaped `getOrCreateChat` as an unhandled rejection.

## Alternatives considered

**Drop the in-memory chat sessions when the route changes.** Tried first and it does not work: the next message re-creates an Agent under the same `sessionId`, which resumes the same Session and therefore the same recorded route. It also discards per-chat history for no benefit.

**Give each route its own `sessionId` so a route change starts a fresh Session.** Effectively correct, but it forks every chat's history, leaves the superseded Session files behind, and treats a model change as a new conversation rather than the model switch the Web GUI performs in place.

**Match the webhook ingress exactly: creation-time `agentOptions` plus an `agent/request` waterfall that yields once a durable request header exists.** The webhook mints a fresh `webhook-<uuid>` Session per delivery, so it never resumes; a chat bridge that keeps one Session per chat needs the override to stay authoritative.

**Validate only the provider.** The deployment-default fallback alone fixes the `{{model}}` failure, but the provider carries one display name while every model carries one, so a display-name mistake is far more likely in `model`.

## Consequences

A card holding an unresolvable route fails in the chat with the registered providers or the provider's configured models, and names the id when the value is a display name. Leaving both fields empty is a first-class choice that tracks the deployment default at each message.

A saved route change reaches every live chat on its next message with history intact, and `installModelSelection` appends its durable `[model changed: …]` notice so the transcript records where the switch happened. The route is resolved and validated per message, which costs one in-memory catalog lookup per turn.

`packages/tuitui/tuitui/tests/loader-composition.spec.ts` covers the deployment-default route, the unregistered provider, and the model display name through the real Loader; `packages/tuitui/tuitui/tests/settings.spec.ts` drives a settings change and asserts the existing Session's assembled variables move to the new model without a second `agents.create`.

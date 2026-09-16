# Agent Note: Chat Sessions Never Request Approval

Status: implemented

English | [中文](2026-09-16-tuitui-approval-policy-never.zh.md)

## Problem

A tuitui Session was created under the deployment permission preset, whose approval knob is `'ask'`. Under `'ask'` the approval service delegates to every composed answerer, and a `dsh web` deployment composes the Web GUI's answerer — which waits for a person looking at that Session's approval card. Nobody was, because the Session belonged to an IM chat.

The turn therefore never ended. The bridge's per-chat `busy` flag, which only `turn/end` clears, stayed set, so every later message was answered with `上一条还在处理中，请稍等。发送 /new 可中断当前任务。` and the chat was bricked until `/new`. The Session log shows the exact stall: the model ran `pwd` through `bash`, the host had no usable `workspace-write` sandbox backend, the model retried with `sandbox_permissions: danger-full-access`, and `approval/asked` was the last event in the log.

`'ask'` is only safe when an answerer can answer. A chat ingress cannot, and the failure mode is an indefinite hold rather than a refusal, so the bridge must not leave the policy to the deployment preset.

## Decision

`getOrCreateChat` appends `'never'` to the new Session's approval policy with `setApprovalPolicy` (`@deepseek-ai/dsh-user-approval`), after the configured permission preset has written its own knobs. The append is last, so the session's policy fold resolves to `'never'`.

`'never'` resolves every ask `'rejected'` before any answerer sees it, so the escalation fails immediately and the turn ends with a denial the model can adapt to. The approval plugin already states that stance in the system prompt (`Approval prompts are disabled in this session: … do not request sandbox escalation`), so the model is told not to ask. `setApprovalPolicy` is the documented initialization writer: the live-agent `setPolicy` alternative would inject a model-visible "the approval policy changed" notice into a Session that never had a different one.

The Session's sandbox still comes from the card's `permissionPreset`, so granting the chat wider access stays an explicit deployment choice rather than a side effect of removing the prompt.

The pin reuses the established answer for a Session nobody can answer: [delegated subagents](2026-08-10-subagent-approval-pinned-never.md) pin `'never'` for the same reason, through a durable `approval/policy` event. That note's `source: 'delegation'` is deliberately not reused — the event declares `source` as that one delegation marker and reads an absent source as a runtime switch, which is what an ingress switching a Session's policy at creation is.

## Alternatives considered

**Ask for approval in the chat and accept a reply.** The capability a chat bridge actually wants, and the natural follow-up: it needs a message-correlation state where a turn is waiting on a decision, plus partial-answer handling. Out of scope for the stall.

**Set the preset's approval knob from the card.** The permission preset already writes approval from its own spec, so a separate card field would restate a knob the chosen preset owns, and the default preset would still leave `'ask'` in place unless every deployment edited it.

**Leave `'ask'` and rely on the fail-closed fallback.** The fallback only applies when no answerer is composed. `dsh web` always composes one, so the deployment this bridge targets never reaches it.

**Grade the empty-catch: hold `busy` with a timeout.** Time-slicing the stall hides the deadlock, still loses the turn, and leaves the approval request unanswered.

## Consequences

A chat Session cannot block on approval. A tool needing escalation fails with a denial, and the model reports what it could not do — the observed `pwd` case ends with an explanation instead of a bricked chat.

The preset's approval knob is inert for these Sessions. `permissionPreset` still selects the sandbox mode, so a deployment that wants escalation-free full access picks the preset carrying `danger-full-access`.

The same class of hold remains for `ask_user_question` under a preset that mounts `tool-ask-user`; it is recorded in the package README's Known Limitations and is unaddressed.

`packages/tuitui/tuitui/tests/loader-composition.spec.ts` asserts the created Session records `approval/policy` as `'never'`.

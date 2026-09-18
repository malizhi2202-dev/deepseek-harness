# Agent Note: Right Sidebar tab-type metadata and the default-visible set

Status: implemented

English | [中文](2026-09-17-sidebar-right-default-visible-set.zh.md)

## Problem

The right Sidebar opened as one pane holding the guide, and every other type — the file tree, a file's text, the session's tasks — had to be found in the guide page or the strip's add control before it showed anything. The [tab-type definition](2026-09-05-sidebar-tab-types-and-navigation.md) could state which addresses a type views and nothing about the column: no ranking, no glyph, no way to say that one type is worth opening for the user. Two consequences followed.

What a session shows first had no home in the declaration, so `ui-sidebar-right` would have had to name the kinds it opens itself — a hardcoded list of types from other packages, which is exactly the knowledge the plugin boundary keeps out of the surface and which drifts the moment a kind is renamed. And the addresses a type claims were the only statement of its identity, so nothing stopped a new kind from claiming a slice of another kind's `dsh-resource://` domain, or from claiming several.

## Decision

`SidebarRightTabDefinition` gains three optional fields, and the column derives what it opens from them rather than from a list:

```ts ignore-check
interface SidebarRightTabDefinition {
  // …id, kind, patterns, priority, canOpen, title, guide
  readonly icon?: ComponentType<IconProps>          // the glyph the type picker draws for this type
  readonly order?: number                           // rank among the page types; core 0–999, outside 1000+
  readonly visibility?: SidebarRightTabVisibility    // 'default-on' | 'available' (default) | 'hidden'
}
```

`order` is what the type picker lists by and what a fresh surface opens its default-visible tabs in. `visibility` states how much of the column a type wants before a user asks for it: `default-on` opens its page on every fresh surface, `available` lists it in the picker and opens it only on request, and `hidden` keeps it out of the picker while its guide entry boxes and `openTab` still reach it. `icon` is drawn on the picker's row for the type.

### The default-visible set

`ctx.sidebarRightTabs.defaultTabs()` answers with the registered page types whose visibility is `default-on`, sorted by `order`, as `{ kind, contentId, title }` — the same seed shape the store already used for the guide (`contract/seed.ts`). `ui-sidebar-right`'s store takes a `SurfaceSeed` (`{ title, tabs }`) and reads it through `createSurface`, so the set is read afresh for every session's surface: a type registered before a session opens is seated in it.

Those tabs are laid out inside the initial state, in order after the guide, with the first one focused. They are therefore absent from the recorded sequence: stepping back stops at the surface a session was born with, and closing a default-visible tab is not undone by the settle that follows. The alternative — seeding them as ordinary recorded opens — would make undo reopen tabs the user had closed and let the sequence's first entries differ per session for reasons no user action explains.

### The budget

At most `MAX_DEFAULT_VISIBLE_TABS` (3) types may declare `default-on`, and the number lives once, in `packages/client/ui-sidebar-right/src/client/contract/visibility.ts`, beside the order bands (`DEFAULT_ORDER` 100 for the first position a type a user must open can hold, `DEFAULT_ON_ORDER_MAX` 99 for the last position inside the default-visible band, `THIRD_PARTY_ORDER_MIN` 1000 for a type from outside the product). Two consumers read that one constant: the registry throws at registration when a `default-on` declaration would exceed the budget, naming the budget, and `verify-sidebar-right-tab-types` refuses the same declaration in review. The gate reads those numbers out of that module's source rather than importing them, because `scripts/` belongs to the Host program and the contract lives in a Client package; a module with no runtime imports at all keeps that reading to a plain constant scan.

The registry refuses two more combinations at the same point rather than seating fewer tabs than the declaration promised: a `default-on` type that declares `patterns` (a viewer resolves addresses on demand and has no page of its own to open) and a `default-on` type without an `icon` (a tab the user did not ask for has to stay recognizable). A kind that an extension takes over counts once, because the budget is a statement about the column, not about registrations.

### The strip's type picker

A type the surface does not open is still reachable: the panel's chrome carries a type picker whose rows are the registered page types, in ascending `order`, with the declared `icon`, calling `openTab(kind, { paneId })` for the pane the button sits in. It omits the guide, which the strip's own add control opens, and every `hidden` type. It lists page types only — a viewer is opened by resolving an address, so a menu of kinds has nothing to hand it.

### Admission for a new kind

A kind is admitted on one condition: it owns exactly one `dsh-resource://<type>/` address domain, and claims no other. A page type is exempt, because it is opened by kind and recognizes no address at all; the shipped `guide`, `files`, and `tasks` types declare no `patterns` for that reason. The rule is new in this change — no code enforced it before, and no shipped definition relies on an exception to it. `verify-sidebar-right-tab-types` enforces it over every shipped definition, along with the budget, the order bands, explicit and unique orders, one definition per kind, and the `default-on` rules.

## Alternatives considered

**A hardcoded default set inside `ui-sidebar-right`.** A `kinds` array or an `isDefaultVisible(kind)` helper naming the types a fresh surface opens would work and needs no new field. Rejected: it puts other packages' kind names in the surface package, it needs a code change in two packages to add a type, and it gives a type no way to state its own intent. `visibility` keeps the product decision in the declaration and the mechanism in the surface.

**Registration order as the default set.** Opening the first N registered page types needs no metadata at all. Rejected: registration order is activation order, which depends on the loader, the profile, and HMR — not on what the product wants a user to see.

**A `defaultVisible?: boolean` flag without a budget.** The smallest field that expresses "open this by itself". Rejected: nothing would stop three extensions from opening six tabs, and the failure would appear as a crowded column rather than a load error. The budget makes the over-budget registration fail where it is made.

**A `Config` field for the budget, edited in the settings UI.** Considered, because a deployment may want a different ceiling. Deferred rather than rejected: no consumer asks for it yet, a settings surface would have to own the resulting per-user difference, and a constant with one home is the honest state until one does. The package README records the limit as current.

**A whitelist of kinds allowed to be `default-on`.** Considered as a way to bound the set. Rejected: a whitelist is the hardcoded list this decision exists to remove, and the budget already bounds the set.

**`badge` and `section` fields in the same round.** Both were on the table: a `badge` thunk per type and a `section` grouping above the picker's rows. Deferred under the Rule of Three — a badge needs a live count with no surface asking for one, and four page types do not justify a second grouping axis in a menu. Adding either later is an optional field, so no shipped definition changes.

**Putting the metadata on the guide entry instead of the definition.** A guide entry already carries `order` and an optional `icon`. Rejected: a guide entry describes the box the guide page draws, not the type's standing in the column. A type may want a rank and a glyph without a guide entry, and `hidden` is exactly the case where the two disagree.

## Consequences

- What a session shows first is now a property of the type that supplies it; `ui-sidebar-right` names no kind other than its own guide, and a fifth page type declares where it belongs.
- Every shipped definition states its `order` explicitly, and two definitions may not share one, so the picker's sequence is a decision rather than a sort tiebreak.
- The budget is a fixed product ceiling. A deployment cannot raise it, which is recorded as a limit rather than left implicit.
- Undo semantics stay honest: what a session was born with is not something the user did, so it is not in the sequence, and the store's seed (`SurfaceSeed`) is the single path by which a surface gets it.
- The gate reads declarations out of source rather than trusting a runtime registration, so a definition that becomes unreadable — a computed `kind`, a returned variable — fails the same check that reads the others. That coupling is the cost of a gate that prints the roster without booting a browser.

## Testing

`ui-sidebar-right` registry specs cover `defaultTabs()` ordering and titles, the empty set, the page-type and `icon` refusals, the budget with its over-budget and kind-taken-over cases, and the budget a disposal frees; store specs cover the seeded initial layout, the seed read per surface, and that seeded tabs cannot be stepped away or reseeded after closing; seat specs drive the real plugin graph to seat a `default-on` type into a session opened after it registered, and drive the picker's rows, glyphs, hidden and viewer exclusions, ordering, pick, and close behavior. `scripts/verify-sidebar-right-tab-types.spec.ts` proves each rule rejects an illegal declaration and that the shipped roster passes. The Web suite moves with the surface: `sidebar-right.e2e.ts` asserts the seeded strip, the tab the surface focuses, the picker's rows, and that an emptied pane still reseeds the guide alone; `details-session-lifecycle.e2e.ts`, `navigation-panes.e2e.ts`, and `seeded-history.e2e.ts` count the extra tab; and the recorded `snapshots/web/details-session-lifecycle/sidebar.expected.md` gained the `Tasks` entry in each checkpoint. All keyless.

## Deferred

- A deployment-chosen default-visible budget, and any settings surface for it.
- A `badge` thunk and a `section` grouping on the definition, and the picker UI each would need.
- Glyphs anywhere but the type picker: tab chips draw the title alone.
- A second product page type declaring `default-on`; the budget leaves room for two more.

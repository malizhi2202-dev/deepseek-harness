/**
 * The guide tab's identity, the page-address scheme, and the seed factory.
 *
 * These live in the contract because two sides need them and neither may read
 * the other: the store seeds every new pane with a guide tab and a fresh
 * surface with the default-visible types' page tabs, and the types themselves
 * register under the same kinds.
 *
 * The docking kit treats `kind` as opaque, so these strings mean something only
 * here and in the registry. Both types go through the same two stages any other
 * type would use — the guide is not special in the machinery, only in being
 * always available.
 */
import type { TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'

/** The guide tab's kind. */
export const GUIDE_KIND = 'guide'

/**
 * The address a page tab is recorded under: `sidebar://<kind>`. The scheme is
 * this package's bookkeeping for `openTab`, spelled here and nowhere else; a
 * caller names the kind and never sees or composes the address.
 * @param kind - the page type's kind.
 * @returns the page's address.
 */
export function pageAddress(kind: string): string {
  return `sidebar://${kind}`
}

/**
 * Build the guide tab a new pane is seeded with.
 *
 * The title is captured at mint time because it goes into the surface's
 * operation sequence, which records what happened and must not change meaning
 * later. A language change relabels the type, not tabs already open.
 * @param id - tab id minted by the caller.
 * @param title - the guide type's display name at mint time.
 * @returns the guide tab record.
 */
export function makeGuideTab(id: TabId, title: string): TabRecord {
  return { id, kind: GUIDE_KIND, contentId: pageAddress(GUIDE_KIND), title }
}

/** One page tab a fresh surface opens beside the guide, for a type declared `default-on`. */
export interface SidebarRightSeedTab {
  /** The page type's kind. */
  readonly kind: string
  /** The page address the tab is recorded under, so a second open of that kind finds this tab. */
  readonly contentId: string
  /** The chip text, read at mint time like every other title. */
  readonly title: string
}

/**
 * Build one default-visible type's seed tab.
 *
 * The kind is named and never the address: the page-address family is spelled
 * here, and the caller passes its own title thunk, so the text is read in the
 * language in force when the surface is minted.
 * @param kind - the page type's kind.
 * @param title - the type's chip text for an address.
 * @returns the tab a fresh surface opens for that type.
 */
export function pageSeedTab(kind: string, title: (address: string) => string): SidebarRightSeedTab {
  const contentId = pageAddress(kind)
  return { kind, contentId, title: title(contentId) }
}

/**
 * The tab system's visibility vocabulary: how much of the column a type asks
 * for before a user opens it, the order bands those types rank in, and the
 * budget the default-open set has to fit inside.
 *
 * These numbers live in the contract because three sides need the same ones: the
 * registry that admits a declaration, the store that seeds a surface from it,
 * and `verify-sidebar-right-tab-types`, which reads them out of this file
 * because `scripts/` belongs to the Host program and this module to a Client
 * package. A type shipped from outside this repository spells the same literal
 * strings and imports nothing.
 */

/**
 * How much of the column a type asks for before a user opens it.
 *
 * - `default-on` — a fresh surface opens this type's page tab, so it is on
 *   screen without a gesture. A page type only, because a viewer needs an
 *   address it cannot invent, and only while the shipped set fits
 *   `MAX_DEFAULT_VISIBLE_TABS`.
 * - `available` — nothing opens by itself; the strip's type picker lists the
 *   type, and its `guide` entries are its boxes on the guide page. What a
 *   definition that names none gets.
 * - `hidden` — nothing opens and the type picker omits it. Its `guide` entries
 *   remain a user's route to it, and `openTab`/`openResource` still open it.
 */
export type SidebarRightTabVisibility = 'default-on' | 'available' | 'hidden'

/** The visibility a definition that names none has. */
export const DEFAULT_VISIBILITY: SidebarRightTabVisibility = 'available'

/** The order a definition that names none has: the first slot of the band for types a user opens. */
export const DEFAULT_ORDER = 100

/** The highest order in the default-visible band, below every type a user has to open. */
export const DEFAULT_ON_ORDER_MAX = 99

/** The first order reserved for types shipped from outside this product, so a shipped slot never has to move. */
export const THIRD_PARTY_ORDER_MIN = 1000

/** How many types one surface may open by itself, the ceiling that keeps the strip readable. */
export const MAX_DEFAULT_VISIBLE_TABS = 3

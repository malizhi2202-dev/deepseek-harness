/**
 * The remote-source capability seam's vocabulary, restated locally for the
 * members this endpoint reads.
 *
 * The seam itself is `@deepseek-ai/dsh-resource`; this wave may add no
 * dependency, so the members the panel uses are mirrored here under the seam
 * package's own names and contracts. Replacing this file with one type-only
 * import from `@deepseek-ai/dsh-resource/types` naming the same members, adding
 * that package as a devDependency, and referencing its project is the whole
 * change: the endpoint is already written against it. The operations the
 * panel never calls (`search`, `read`, `list`) are deliberately absent, so this
 * mirror cannot drift on them.
 *
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-api-sources/seam
 */
export {};
//# sourceMappingURL=seam.js.map
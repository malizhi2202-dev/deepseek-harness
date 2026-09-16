/**
 * Narrow unknown durable/wire JSON values to plain primitives.
 *
 * These helpers sit at the parser and durable-file boundaries where values are
 * `unknown`; they return a safe empty value instead of throwing, so callers can
 * keep a single fallback chain rather than branching on every field.
 */

/**
 * Narrow an unknown JSON value to a string, or `''` when absent or non-string.
 * @param value - the unknown value to narrow.
 * @returns the string value, or `''`.
 */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Narrow an unknown JSON value to a finite number, or `0` when absent or non-number.
 * @param value - the unknown value to narrow.
 * @returns the finite numeric value, or `0`.
 */
export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Narrow an unknown JSON value to a plain object record, or `undefined`.
 * @param value - the unknown value to narrow.
 * @returns a `Record<string, unknown>` for a non-null, non-array object, else `undefined`.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Narrow an unknown JSON value to an array, or `[]` when absent.
 * @param value - the unknown value to narrow.
 * @returns the array value, or `[]`.
 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

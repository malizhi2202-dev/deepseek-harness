/**
 * The reader this provider validates DingTalk's JSON with.
 *
 * The Stream SDK hands over a callback body as an unparsed string, so every
 * field this package reads is checked before use rather than assumed from a
 * declaration.
 *
 * @module @deepseek-ai/dsh-channel-dingtalk
 */

/**
 * Read one value as a JSON object.
 * @param value - the value to read.
 * @returns the object, or null for anything that is not one.
 */
export function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Read one value as a non-empty string.
 * @param value - the value to read.
 * @returns the string, or undefined for anything that is not a non-empty string.
 */
export function jsonString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

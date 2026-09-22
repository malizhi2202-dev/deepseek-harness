/**
 * Reading the JSON the QQ bot open platform answers with.
 *
 * Every call answers HTTP 200, including the ones that failed: a response is
 * successful only when its `err_code` is absent or zero, and the failure's
 * `message` is prose the platform changes without notice, so nothing here
 * branches on it.
 *
 * @module @deepseek-ai/dsh-channel-qq
 */

/** The failure envelope's success value. */
const NO_ERROR = 0

/**
 * Parse one response body as a JSON object.
 * @param raw - the response body text.
 * @param call - the call name a failure names, so a reader can find the call that returned it.
 * @returns the parsed object.
 * @throws {Error} when the body is not a JSON object.
 */
export function readJsonObject(raw: string, call: string): Record<string, unknown> {
  const parsed = parseBody(raw, call)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${call} returned a JSON value that is not an object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Parse one response body, naming the call when the body is not JSON at all.
 * @param raw - the response body text.
 * @param call - the call name a failure names.
 * @returns the parsed JSON value.
 * @throws {Error} when the body is not JSON.
 */
function parseBody(raw: string, call: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // The only throw here is JSON.parse refusing the body, and the call name is
    // what a reader needs to find the endpoint that returned it.
    throw new Error(`${call} returned a body that is not JSON`)
  }
}

/**
 * Read one field the platform states as a string.
 * @param record - the parsed object.
 * @param key - the field to read.
 * @returns the string, or the empty string when the field is absent or another type.
 */
export function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Read the failure code one response carries.
 *
 * The token endpoint reports `code` and every OpenAPI call reports `err_code`;
 * both are read here so one check covers a response from either.
 * @param record - the parsed object.
 * @returns the code, or zero when the response reports no failure.
 */
export function readFailureCode(record: Record<string, unknown>): number {
  for (const key of ['err_code', 'code']) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return NO_ERROR
}

/**
 * Read the lifetime one access-token response states.
 *
 * The platform documents this field as a number and its own example returns it
 * as a string, so both spellings are read.
 * @param record - the parsed token response.
 * @returns the lifetime in seconds, or zero when the response states none.
 */
export function readExpiresIn(record: Record<string, unknown>): number {
  const value = record['expires_in']
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const seconds = Number.parseInt(typeof value === 'string' ? value : '', 10)
  return Number.isSafeInteger(seconds) ? seconds : NO_ERROR
}

/**
 * Read one field the platform states as a positive number.
 * @param record - the parsed object.
 * @param key - the field to read.
 * @returns the number, or undefined when the field is absent, not a number, or not positive.
 */
export function readPositive(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Read one field the platform states as an object.
 * @param record - the parsed object.
 * @param key - the field to read.
 * @returns the object, or an empty object when the field is absent or another type.
 */
export function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

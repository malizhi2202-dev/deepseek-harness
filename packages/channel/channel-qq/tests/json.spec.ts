/**
 * Pins the QQ wire readers: a body that is not a JSON object fails loudly and
 * names the call, the failure code is read from either key the platform uses,
 * and the token lifetime is read from either spelling the platform documents.
 */
import { describe, expect, it } from 'vitest'
import { readExpiresIn, readFailureCode, readJsonObject, readObject, readPositive, readText } from '../src/json.ts'

describe('readJsonObject', () => {
  it('parses an object', () => {
    expect(readJsonObject('{"err_code":0}', 'call')).toEqual({ err_code: 0 })
  })

  it('refuses a body that is not JSON, naming the call', () => {
    expect(() => readJsonObject('not json', 'getUpdates'))
      .toThrow('getUpdates returned a body that is not JSON')
  })

  it('refuses a JSON value that is not an object', () => {
    expect(() => readJsonObject('[1]', 'call')).toThrow('call returned a JSON value that is not an object')
    expect(() => readJsonObject('null', 'call')).toThrow('call returned a JSON value that is not an object')
  })
})

describe('readText', () => {
  it('reads a string and falls back to empty for anything else', () => {
    expect(readText({ a: 'x' }, 'a')).toBe('x')
    expect(readText({ a: 1 }, 'a')).toBe('')
    expect(readText({}, 'a')).toBe('')
  })
})

describe('readFailureCode', () => {
  it('reads err_code, then code, and reports zero when neither is a number', () => {
    expect(readFailureCode({ err_code: 11244 })).toBe(11244)
    expect(readFailureCode({ code: 100007 })).toBe(100007)
    expect(readFailureCode({ err_code: 'x', code: 5 })).toBe(5)
    expect(readFailureCode({})).toBe(0)
  })
})

describe('readExpiresIn', () => {
  it('reads the lifetime from either spelling the platform documents', () => {
    expect(readExpiresIn({ expires_in: 7200 })).toBe(7200)
    expect(readExpiresIn({ expires_in: '7200' })).toBe(7200)
  })

  it('reports zero for a lifetime the platform did not state', () => {
    expect(readExpiresIn({})).toBe(0)
    expect(readExpiresIn({ expires_in: 'soon' })).toBe(0)
    expect(readExpiresIn({ expires_in: Number.NaN })).toBe(0)
  })
})

describe('readPositive', () => {
  it('reads a positive number and refuses anything else', () => {
    expect(readPositive({ d: 45000 }, 'd')).toBe(45000)
    expect(readPositive({ d: 0 }, 'd')).toBeUndefined()
    expect(readPositive({ d: -1 }, 'd')).toBeUndefined()
    expect(readPositive({ d: 'x' }, 'd')).toBeUndefined()
    expect(readPositive({}, 'd')).toBeUndefined()
  })
})

describe('readObject', () => {
  it('reads an object and yields an empty one for anything else', () => {
    expect(readObject({ d: { a: 1 } }, 'd')).toEqual({ a: 1 })
    expect(readObject({ d: [1] }, 'd')).toEqual({})
    expect(readObject({}, 'd')).toEqual({})
  })
})

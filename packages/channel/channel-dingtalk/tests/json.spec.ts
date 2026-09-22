import { describe, expect, it } from 'vitest'
import { jsonObject, jsonString } from '../src/json.ts'

describe('jsonObject', () => {
  it('reads an object and refuses everything else', () => {
    const value = { a: 1 }
    expect(jsonObject(value)).toBe(value)
    expect(jsonObject(null)).toBeNull()
    expect(jsonObject([1, 2])).toBeNull()
    expect(jsonObject('{}')).toBeNull()
    expect(jsonObject(7)).toBeNull()
    expect(jsonObject(undefined)).toBeNull()
  })
})

describe('jsonString', () => {
  it('reads a non-empty string and refuses everything else', () => {
    expect(jsonString('value')).toBe('value')
    expect(jsonString('')).toBeUndefined()
    expect(jsonString(0)).toBeUndefined()
    expect(jsonString(null)).toBeUndefined()
    expect(jsonString(undefined)).toBeUndefined()
  })
})

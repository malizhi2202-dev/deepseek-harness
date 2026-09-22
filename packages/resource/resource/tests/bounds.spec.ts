import { describe, expect, it } from 'vitest'
import {
  SOURCE_TRUNCATION_MARKER,
  boundDocumentContent,
  truncateUtf8,
} from '@deepseek-ai/dsh-resource'

const encoder = new TextEncoder()

/** The marker's own byte length, which its ASCII text makes equal to its length. */
const MARKER_BYTES = encoder.encode(SOURCE_TRUNCATION_MARKER).length

describe('truncateUtf8', () => {
  it('returns text that already fits unchanged', () => {
    expect(truncateUtf8('hello', 5)).toEqual({ text: 'hello', truncated: false })
    expect(truncateUtf8('', 0)).toEqual({ text: '', truncated: false })
  })

  it('cuts at an exact byte boundary without splitting a code point', () => {
    expect(truncateUtf8('abc', 2)).toEqual({ text: 'ab', truncated: true })
  })

  it('backs up over the continuation bytes of a split code point', () => {
    // "é" is two bytes; a two-byte budget lands inside it, so the cut keeps
    // only the "h" that precedes it.
    expect(truncateUtf8('héllo', 2)).toEqual({ text: 'h', truncated: true })
    expect(encoder.encode(truncateUtf8('héllo', 2).text).length).toBeLessThanOrEqual(2)
  })

  it('yields the empty string when the budget lands inside the first code point', () => {
    expect(truncateUtf8('é', 1)).toEqual({ text: '', truncated: true })
  })

  it('treats a non-positive budget as zero bytes', () => {
    expect(truncateUtf8('abc', 0)).toEqual({ text: '', truncated: true })
    expect(truncateUtf8('abc', -5)).toEqual({ text: '', truncated: true })
  })
})

describe('boundDocumentContent', () => {
  it('returns content that fits unchanged', () => {
    expect(boundDocumentContent('short', 100)).toEqual({ content: 'short', truncated: false })
  })

  it('keeps the original prefix and appends the marker within the cap', () => {
    const content = 'x'.repeat(500)
    const bounded = boundDocumentContent(content, 100)
    expect(bounded.truncated).toBe(true)
    expect(bounded.content.endsWith(SOURCE_TRUNCATION_MARKER)).toBe(true)
    expect(bounded.content.startsWith('x'.repeat(100 - MARKER_BYTES))).toBe(true)
    expect(encoder.encode(bounded.content).length).toBe(100)
  })

  it('never exceeds an exact cap', () => {
    const content = 'y'.repeat(MARKER_BYTES + 10)
    const bounded = boundDocumentContent(content, MARKER_BYTES + 10)
    expect(bounded).toEqual({ content, truncated: false })
    const cut = boundDocumentContent(content, MARKER_BYTES + 9)
    expect(encoder.encode(cut.content).length).toBe(MARKER_BYTES + 9)
  })

  it('returns the marker prefix when the budget is smaller than the marker', () => {
    const bounded = boundDocumentContent('z'.repeat(50), 10)
    expect(bounded.truncated).toBe(true)
    expect(bounded.content).toBe(truncateUtf8(SOURCE_TRUNCATION_MARKER, 10).text)
    expect(encoder.encode(bounded.content).length).toBeLessThanOrEqual(10)
  })

  it('respects a multibyte byte budget', () => {
    const bounded = boundDocumentContent('é'.repeat(100), MARKER_BYTES + 33)
    expect(bounded.truncated).toBe(true)
    expect(encoder.encode(bounded.content).length).toBeLessThanOrEqual(MARKER_BYTES + 33)
    expect(bounded.content.endsWith(SOURCE_TRUNCATION_MARKER)).toBe(true)
  })

  it('cuts an oversized single chunk rather than returning it whole', () => {
    const chunk = 'q'.repeat(1_000_000)
    const bounded = boundDocumentContent(chunk, 1_000)
    expect(encoder.encode(bounded.content).length).toBeLessThanOrEqual(1_000)
    expect(bounded.truncated).toBe(true)
  })
})

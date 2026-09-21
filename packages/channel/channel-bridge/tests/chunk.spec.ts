/**
 * Tests for outbound chunking: a reply is split to the platform's character
 * budget, the split preserves code fences, links, and entities, and the tail of
 * an over-budget reply is combined rather than dropped.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHUNK_CHARS, capToReplyBudget, chunkChatText } from '../src/chunk.ts'

describe('chunkChatText', () => {
  it('returns a reply that fits as one chunk', () => {
    expect(chunkChatText('short reply', 20)).toEqual(['short reply'])
  })

  it('returns nothing for an empty reply', () => {
    expect(chunkChatText('', 20)).toEqual([])
  })

  it('uses the default budget when none is given', () => {
    const text = 'a'.repeat(DEFAULT_CHUNK_CHARS + 1)
    expect(chunkChatText(text)).toEqual(['a'.repeat(DEFAULT_CHUNK_CHARS), 'a'])
  })

  it('splits a long unbroken reply at the budget', () => {
    expect(chunkChatText('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)])
  })

  it('prefers a newline in the window back half and drops the one it cut at', () => {
    expect(chunkChatText('aaaaaa\nbbbbbbbb', 10)).toEqual(['aaaaaa', 'bbbbbbbb'])
  })

  it('walks a cut back out of an open code fence', () => {
    const chunks = chunkChatText('```\nabcdefghijklmnopqrst', 10)
    expect(chunks[0]).toBe('``')
    expect(chunks.slice(1).join('')).toContain('abcdefghijklmnopqrst')
  })

  it('walks a cut back out of an unterminated link text', () => {
    const chunks = chunkChatText('[abcdefghijklmnopqrst', 10)
    expect(chunks[0]).toBe('[abcdefghi')
    expect(chunks).toHaveLength(3)
  })

  it('walks a cut back out of an unterminated link destination', () => {
    const chunks = chunkChatText('x](abcdefghijklmnop', 10)
    expect(chunks[0]).toBe('x]')
    expect(chunks.join('')).toBe('x](abcdefghijklmnop')
  })

  it('walks a cut back out of a short unterminated entity', () => {
    const chunks = chunkChatText('&amp' + 'x'.repeat(20), 10)
    expect(chunks[0]).toBe('&ampxxxxxx')
    expect(chunks).toHaveLength(3)
  })

  it('treats a long ampersand run as prose rather than an entity', () => {
    const text = 'x'.repeat(7) + '&' + 'y'.repeat(30)
    expect(chunkChatText(text, 20)[0]).toBe(text.slice(0, 20))
  })

  it('treats a terminated entity as complete', () => {
    const text = 'x&aaa;' + 'y'.repeat(30)
    expect(chunkChatText(text, 20)[0]).toBe(text.slice(0, 20))
  })

  it('treats whitespace after an ampersand as prose rather than an entity', () => {
    const text = 'x& a' + 'y'.repeat(20)
    expect(chunkChatText(text, 12)[0]).toBe(text.slice(0, 12))
  })

  it('falls back to the whole window when no cut inside it is safe', () => {
    expect(chunkChatText('['.repeat(30), 10)[0]).toBe('['.repeat(10))
  })
})

describe('capToReplyBudget', () => {
  it('keeps every chunk when the platform sets no budget', () => {
    expect(capToReplyBudget(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c'])
  })

  it('keeps every chunk when the budget is not positive', () => {
    expect(capToReplyBudget(['a', 'b'], 0)).toEqual(['a', 'b'])
  })

  it('keeps every chunk when they already fit', () => {
    expect(capToReplyBudget(['a', 'b'], 2)).toEqual(['a', 'b'])
  })

  it('combines the tail into the last allowed message rather than dropping it', () => {
    expect(capToReplyBudget(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b\n\nc\n\nd'])
  })

  it('combines everything into one message when only one is allowed', () => {
    expect(capToReplyBudget(['a', 'b'], 1)).toEqual(['a\n\nb'])
  })

  it('detaches the array it returns', () => {
    const chunks = ['a', 'b']
    const capped = capToReplyBudget(chunks, undefined)
    expect(capped).not.toBe(chunks)
    expect(capped).toEqual(chunks)
  })
})

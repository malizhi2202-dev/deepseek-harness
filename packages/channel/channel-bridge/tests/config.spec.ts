/**
 * Pins the bridge's configuration surface: the plugin `Config` schema and its
 * defaults, `resolveBridgeConfig` over an empty and a fully specified document,
 * and `readBindingFields` refusing every section that did not compose the
 * shared schema the bridge owns.
 */
import { describe, expect, it } from 'vitest'
import { ChatConfigError } from '@deepseek-ai/dsh-channel'
import { Config, readBindingFields, resolveBridgeConfig } from '../src/index.ts'

/** Every default the schema resolves for an empty configuration document. */
const DEFAULTS = {
  chunkChars: 4000,
  dedupeSize: 64,
  maxReplyFiles: 5,
  mtimeGraceMs: 2000,
  maxInboundFileBytes: 30 * 1024 * 1024,
  maxOutboundFileBytes: 30 * 1024 * 1024,
}

describe('Config schema', () => {
  it('resolves every default for an empty document', () => {
    expect(Config({})).toEqual(DEFAULTS)
  })

  it('keeps every supplied value', () => {
    expect(Config({
      chunkChars: 200,
      dedupeSize: 1,
      maxReplyFiles: 1,
      mtimeGraceMs: 0,
      maxInboundFileBytes: 1,
      maxOutboundFileBytes: 2,
    })).toEqual({
      chunkChars: 200,
      dedupeSize: 1,
      maxReplyFiles: 1,
      mtimeGraceMs: 0,
      maxInboundFileBytes: 1,
      maxOutboundFileBytes: 2,
    })
  })

  it('refuses a chunk size under the protocol minimum', () => {
    expect(() => Config({ chunkChars: 199 })).toThrow()
  })

  it('refuses a non-natural grace window', () => {
    expect(() => Config({ mtimeGraceMs: 1.5 })).toThrow()
  })

  it('refuses a negative dedupe ring', () => {
    expect(() => Config({ dedupeSize: -1 })).toThrow()
  })
})

describe('resolveBridgeConfig', () => {
  it('resolves every default from an empty configuration', () => {
    expect(resolveBridgeConfig({})).toEqual(DEFAULTS)
  })

  it('keeps every overridden field and defaults the rest', () => {
    expect(resolveBridgeConfig({
      chunkChars: 1000,
      dedupeSize: 8,
      maxReplyFiles: 2,
      mtimeGraceMs: 50,
      maxInboundFileBytes: 1024,
      maxOutboundFileBytes: 2048,
    })).toEqual({
      chunkChars: 1000,
      dedupeSize: 8,
      maxReplyFiles: 2,
      mtimeGraceMs: 50,
      maxInboundFileBytes: 1024,
      maxOutboundFileBytes: 2048,
    })
  })

  it('resolves a zero grace window rather than falling back', () => {
    expect(resolveBridgeConfig({ mtimeGraceMs: 0 }).mtimeGraceMs).toBe(0)
  })
})

describe('readBindingFields', () => {
  it('reads the four shared fields', () => {
    expect(readBindingFields({ enabled: true, sessionId: 's-1', markdown: false, finalReplyOnly: true }))
      .toEqual({ enabled: true, sessionId: 's-1', markdown: false, finalReplyOnly: true })
  })

  it('ignores fields the connector owns', () => {
    expect(readBindingFields({ enabled: false, sessionId: '', markdown: true, finalReplyOnly: false, token: 'x' }))
      .toEqual({ enabled: false, sessionId: '', markdown: true, finalReplyOnly: false })
  })

  it('refuses a section that is not an object', () => {
    expect(() => readBindingFields('not a section')).toThrow(ChatConfigError)
    expect(() => readBindingFields(null)).toThrow(ChatConfigError)
    expect(() => readBindingFields(undefined)).toThrow(ChatConfigError)
  })

  it('names the enabled field when it is not a boolean', () => {
    expect(() => readBindingFields({ enabled: 'yes', sessionId: '', markdown: true, finalReplyOnly: false }))
      .toThrow(new ChatConfigError('enabled', 'expected a boolean'))
  })

  it('names the sessionId field when it is not a string', () => {
    expect(() => readBindingFields({ enabled: true, sessionId: 7, markdown: true, finalReplyOnly: false }))
      .toThrow(new ChatConfigError('sessionId', 'expected a session id string'))
  })

  it('names the markdown field when it is not a boolean', () => {
    expect(() => readBindingFields({ enabled: true, sessionId: '', markdown: 'yes', finalReplyOnly: false }))
      .toThrow(new ChatConfigError('markdown', 'expected a boolean'))
  })

  it('names the finalReplyOnly field when it is not a boolean', () => {
    expect(() => readBindingFields({ enabled: true, sessionId: '', markdown: true, finalReplyOnly: 'yes' }))
      .toThrow(new ChatConfigError('finalReplyOnly', 'expected a boolean'))
  })
})

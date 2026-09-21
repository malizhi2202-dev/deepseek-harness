/**
 * Tests for the seam's typed failures and the one classification point: a
 * refusal is `expected` only when this code understands it and the site is one
 * that tells the chat.
 */
import { describe, expect, it } from 'vitest'
import {
  ChatChannelError,
  ChatConfigError,
  ChatFormatRejectedError,
  ChatMediaTooLargeError,
  ChatPermissionError,
  ChatUnsupportedError,
  chatErrorKind,
} from '../src/errors.ts'
import type { ChatErrorSite } from '../src/errors.ts'

/** Every capture point the seam names, so each classification path is exercised. */
const SITES: readonly ChatErrorSite[] = ['inbound-image', 'inbound-file', 'outbound-text', 'outbound-file', 'connect', 'probe']

describe('chat-channel errors', () => {
  it('carries a stable code and its own name on the base class', () => {
    const error = new ChatChannelError('CHAT_TEST', 'a reason')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ChatChannelError')
    expect(error.code).toBe('CHAT_TEST')
    expect(error.message).toBe('a reason')
  })

  it('names the ceiling a size refusal happened at', () => {
    const error = new ChatMediaTooLargeError(1024)
    expect(error.name).toBe('ChatMediaTooLargeError')
    expect(error.code).toBe('CHAT_MEDIA_TOO_LARGE')
    expect(error.maxBytes).toBe(1024)
    expect(error.message).toBe('attachment exceeds 1024 bytes')
  })

  it('keeps the platform reason on a format refusal', () => {
    const error = new ChatFormatRejectedError('bad markdown')
    expect(error.name).toBe('ChatFormatRejectedError')
    expect(error.code).toBe('CHAT_FORMAT_REJECTED')
    expect(error.message).toBe('bad markdown')
  })

  it('keeps what the platform cannot carry on an unsupported refusal', () => {
    const error = new ChatUnsupportedError('no quoting')
    expect(error.name).toBe('ChatUnsupportedError')
    expect(error.code).toBe('CHAT_UNSUPPORTED')
    expect(error.message).toBe('no quoting')
  })

  it('keeps the scopes and the grant page on a permission refusal', () => {
    const error = new ChatPermissionError('missing scope', ['im:message'], 'https://console.invalid/scopes')
    expect(error.name).toBe('ChatPermissionError')
    expect(error.code).toBe('CHAT_PERMISSION')
    expect(error.scopes).toEqual(['im:message'])
    expect(error.grantUrl).toBe('https://console.invalid/scopes')
  })

  it('keeps a null grant page when the platform has none', () => {
    expect(new ChatPermissionError('missing scope', [], null).grantUrl).toBeNull()
  })

  it('names the field a configuration refusal needs fixed', () => {
    const error = new ChatConfigError('appId', 'appId is required')
    expect(error.name).toBe('ChatConfigError')
    expect(error.code).toBe('CHAT_CONFIG')
    expect(error.field).toBe('appId')
    expect(error.message).toBe('appId is required')
  })
})

describe('chatErrorKind', () => {
  it('counts a size refusal and an unsupported refusal as expected at every site', () => {
    for (const site of SITES) {
      expect(chatErrorKind(new ChatMediaTooLargeError(1), site)).toBe('expected')
      expect(chatErrorKind(new ChatUnsupportedError('cannot carry this'), site)).toBe('expected')
      expect(chatErrorKind(new ChatConfigError('host', 'host is required'), site)).toBe('expected')
    }
  })

  it('counts a permission refusal as expected only where the chat is told', () => {
    const error = new ChatPermissionError('missing scope', ['im:message'], null)
    expect(chatErrorKind(error, 'inbound-image')).toBe('expected')
    expect(chatErrorKind(error, 'inbound-file')).toBe('expected')
    expect(chatErrorKind(error, 'outbound-file')).toBe('expected')
    expect(chatErrorKind(error, 'outbound-text')).toBe('unexpected')
    expect(chatErrorKind(error, 'connect')).toBe('unexpected')
    expect(chatErrorKind(error, 'probe')).toBe('unexpected')
  })

  it('counts a format refusal as unexpected, because the bridge resends it plainly', () => {
    for (const site of SITES) {
      expect(chatErrorKind(new ChatFormatRejectedError('bad markdown'), site)).toBe('unexpected')
    }
  })

  it('counts an unrecognized failure as unexpected, which is the safe direction', () => {
    for (const site of SITES) {
      expect(chatErrorKind(new Error('socket closed'), site)).toBe('unexpected')
      expect(chatErrorKind(new ChatChannelError('CHAT_OTHER', 'other'), site)).toBe('unexpected')
      expect(chatErrorKind('not an error', site)).toBe('unexpected')
    }
  })
})

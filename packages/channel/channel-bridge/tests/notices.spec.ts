/**
 * Tests for the one table of chat notices: every notice carries both languages,
 * the two dynamic fields interpolate their facts, and a platform's own failure
 * reason is flattened and bounded before it reaches a chat.
 */
import { describe, expect, it } from 'vitest'
import { CHAT_NOTICES } from '../src/notices.ts'

/** Every fixed-string notice, so both languages are pinned in one place. */
const FIXED = {
  unsupportedMessage: CHAT_NOTICES.unsupportedMessage,
  queued: CHAT_NOTICES.queued,
  approvalWaiting: CHAT_NOTICES.approvalWaiting,
}

describe('CHAT_NOTICES', () => {
  it('carries Latin and Han text in every fixed notice', () => {
    for (const notice of Object.values(FIXED)) {
      expect(notice).toMatch(/[\u4e00-\u9fff]/)
      expect(notice).toMatch(/[A-Za-z]/)
    }
  })

  it('names the run failure in both languages', () => {
    const notice = CHAT_NOTICES.runFailed('provider refused')
    expect(notice).toContain('provider refused')
    expect(notice.match(/provider refused/g)).toHaveLength(2)
  })

  it('flattens a platform reason onto one line', () => {
    expect(CHAT_NOTICES.runFailed('line one\n  line two')).toContain('line one line two')
  })

  it('bounds a verbose platform reason to one chat-sized line', () => {
    const notice = CHAT_NOTICES.runFailed('x'.repeat(500))
    expect(notice).toContain(`${'x'.repeat(199)}…`)
    expect(notice).not.toContain('x'.repeat(201))
  })

  it('rounds an inbound image cap down to whole mebibytes', () => {
    expect(CHAT_NOTICES.imageTooLarge(5 * 1024 * 1024 + 512)).toContain('5MB')
  })

  it('never names a limit below one mebibyte', () => {
    expect(CHAT_NOTICES.imageTooLarge(1024)).toContain('1MB')
  })

  it('names the image failure in both languages', () => {
    expect(CHAT_NOTICES.imageFailed('timeout').match(/timeout/g)).toHaveLength(2)
  })

  it('names the missing scopes and the console page on an image permission failure', () => {
    const notice = CHAT_NOTICES.imagePermission(['im:message'], 'https://console.invalid/scopes')
    expect(notice).toContain('im:message')
    expect(notice).toContain('https://console.invalid/scopes')
  })

  it('falls back to a generic scope phrase and omits a missing console page', () => {
    const notice = CHAT_NOTICES.imagePermission([], null)
    expect(notice).toContain('an application scope')
    expect(notice).not.toContain('(')
  })

  it('names the file and the cap on an oversized inbound file', () => {
    const notice = CHAT_NOTICES.fileTooLarge('report.pdf', 30 * 1024 * 1024)
    expect(notice.match(/report\.pdf/g)).toHaveLength(2)
    expect(notice).toContain('30MB')
  })

  it('names the file and the failure on an inbound file failure', () => {
    expect(CHAT_NOTICES.fileFailed('report.pdf', 'timeout').match(/timeout/g)).toHaveLength(2)
  })

  it('names the file, the scopes, and the page on an inbound file permission failure', () => {
    const notice = CHAT_NOTICES.filePermission('report.pdf', ['im:file'], 'https://console.invalid/files')
    expect(notice).toContain('report.pdf')
    expect(notice).toContain('im:file')
    expect(notice).toContain('https://console.invalid/files')
  })

  it('falls back to a generic scope phrase on an inbound file permission failure', () => {
    expect(CHAT_NOTICES.filePermission('report.pdf', [], null)).toContain('an application scope')
  })

  it('names the outbound file and the cap the chat accepts', () => {
    expect(CHAT_NOTICES.fileSendTooLarge('report.pdf', 1024)).toContain('1MB')
  })

  it('names the outbound file and the failure on a send failure', () => {
    expect(CHAT_NOTICES.fileSendFailed('report.pdf', 'rejected').match(/rejected/g)).toHaveLength(2)
  })

  it('names the outbound file, the scopes, and the page on a send permission failure', () => {
    const notice = CHAT_NOTICES.fileSendPermission('report.pdf', ['im:file'], 'https://console.invalid/files')
    expect(notice).toContain('im:file')
    expect(notice).toContain('https://console.invalid/files')
  })

  it('counts the files a reply could not deliver', () => {
    expect(CHAT_NOTICES.filesSkipped(3)).toContain('3')
  })
})

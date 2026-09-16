/** Unit coverage for the Tuitui wire parser and message chunking. */

import { describe, expect, it } from 'vitest'
import { guessChatType, parseEvent, parseInteractiveCallback, splitMessage } from '../src/client.ts'

describe('guessChatType', () => {
  it('classifies team channels, 16-digit group ids, and DMs', () => {
    expect(guessChatType('teams_123_456')).toBe('channel')
    expect(guessChatType('1234567890123456')).toBe('group')
    expect(guessChatType('user_account_1')).toBe('dm')
  })
})

describe('splitMessage', () => {
  it('returns short content unchanged', () => {
    expect(splitMessage('hello')).toEqual(['hello'])
  })

  it('splits long content into bounded chunks on paragraph boundaries', () => {
    const long = 'a'.repeat(30) + '\n\n' + 'b'.repeat(30)
    const chunks = splitMessage(long, 40)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40)
    expect(chunks.join('\n\n').replace(/\n+/g, '\n\n')).toContain('aaa')
  })
})

describe('parseEvent', () => {
  it('parses a single chat text message', () => {
    const message = parseEvent('single_chat', {
      user_account: 'u1',
      user_name: 'U One',
      data: { msg_type: 'text', text: '你好', msgid: 'm1' },
    })
    expect(message).toMatchObject({ chatId: 'u1', chatType: 'dm', text: '你好', userId: 'u1', messageId: 'm1' })
  })

  it('parses a group chat message', () => {
    const message = parseEvent('group_chat', {
      user_account: 'u1',
      user_name: 'U One',
      data: { group_id: '1234567890123456', group_name: 'G', msg_type: 'text', text: 'hi', msgid: 'm2' },
    })
    expect(message).toMatchObject({ chatId: '1234567890123456', chatType: 'group', chatName: 'G' })
  })

  it('parses a team post into a channel identity', () => {
    const message = parseEvent('teams_post_create', {
      user_account: 'u1',
      data: { team_id: 't1', channel_id: 'c1', post_id: 'p1', content: 'post', channel_name: 'general' },
    })
    expect(message).toMatchObject({ chatType: 'channel', chatId: 'teams_t1_c1_p1', text: 'post' })
  })

  it('returns null for unsupported events', () => {
    expect(parseEvent('keepalive', { user_account: 'u1', data: {} })).toBeNull()
  })
})

describe('parseInteractiveCallback', () => {
  it('parses a button callback with an action value', () => {
    const callback = parseInteractiveCallback({
      data: {
        msgid: 'card1',
        message: {
          msgid: 'card1',
          action: [{ name: 'tree', value: '{"t":"up"}' }],
          user: { account: 'u1', name: 'U One' },
          conversation: { type: 'single', targeted: 'u1' },
        },
      },
    })
    expect(callback).toMatchObject({ chatId: 'u1', chatType: 'dm', messageId: 'card1', actionValue: '{"t":"up"}' })
  })

  it('returns null when no action is present', () => {
    expect(parseInteractiveCallback({ data: { msgid: 'card1', message: { msgid: 'card1' } } })).toBeNull()
  })
})

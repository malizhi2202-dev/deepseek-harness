import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatFormatRejectedError, ChatUnsupportedError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatId } from '@deepseek-ai/dsh-channel'
import {
  DINGTALK_CAPABILITIES,
  DINGTALK_MAX_TEXT_BYTES,
  DINGTALK_MAX_TEXT_CHARS,
  DingTalkChatClient,
  DingTalkWebhooks,
  readDingTalkConfig,
} from '../src/client.ts'
import type { DingTalkChannelConfig } from '../src/client.ts'
import type { DingTalkStream } from '../src/types.ts'

const CHAT_ID = 'cid-1' as ChatId

/** One Stream client that records the calls a probe makes and grants a token. */
function stream(granted = true): DingTalkStream {
  return {
    connected: true,
    getAccessToken: () => granted ? Promise.resolve('token') : Promise.reject(new Error('refused')),
    registerAllEventListener: () => {},
    connect: () => Promise.resolve(),
    disconnect: () => {},
  }
}

/** One resolved configuration section, overridden per test. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { clientId: 'ding-app-key', clientSecretRef: 'DINGTALK_CLIENT_SECRET', ...overrides }
}

/** One client over a Stream stub and the validated fields of `section()`. */
function client(overrides: ChatChannelConfig = {}, webhooks = new DingTalkWebhooks()): DingTalkChatClient {
  const config: DingTalkChannelConfig = readDingTalkConfig(section(overrides))
  return new DingTalkChatClient(config, stream(), webhooks)
}

/** One recorded `fetch` call. */
interface Posted {
  readonly url: string
  readonly body: unknown
}

/** Stub the global `fetch` with a programmable response and record what was posted. */
function stubFetch(
  response: { ok?: boolean; status?: number; body?: unknown; json?: () => Promise<unknown> },
): Posted[] {
  const posted: Posted[] = []
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
    posted.push({ url, body: JSON.parse(init.body) })
    return Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json ?? (() => Promise.resolve(response.body ?? { errcode: 0, errmsg: 'ok' })),
    })
  })
  return posted
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DINGTALK_CAPABILITIES', () => {
  it('declares text and Markdown only, with a character ceiling that cannot exceed the byte one', () => {
    expect(DINGTALK_CAPABILITIES).toEqual({
      quoting: false,
      inbound: { images: false, files: false },
      outbound: { images: false, files: false },
      markdown: true,
      maxTextChars: DINGTALK_MAX_TEXT_CHARS,
    })
    expect(DINGTALK_MAX_TEXT_CHARS * 4).toBe(DINGTALK_MAX_TEXT_BYTES)
  })
})

describe('readDingTalkConfig', () => {
  it('narrows a complete section', () => {
    expect(readDingTalkConfig(section())).toEqual({
      clientId: 'ding-app-key',
      clientSecretRef: 'DINGTALK_CLIENT_SECRET',
    })
  })

  it('names a required field that is absent, empty, or not a string', () => {
    expect(() => readDingTalkConfig(section({ clientId: undefined })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'clientId' }))
    expect(() => readDingTalkConfig(section({ clientId: '' })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'clientId' }))
    expect(() => readDingTalkConfig(section({ clientId: 7 })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'clientId' }))
    expect(() => readDingTalkConfig(section({ clientSecretRef: '' })))
      .toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'clientSecretRef',
        message: 'clientSecretRef is required to reach DingTalk',
      }))
  })
})

describe('DingTalkWebhooks', () => {
  it('answers a conversation through the webhook its inbound message carried', () => {
    const webhooks = new DingTalkWebhooks()

    webhooks.record('cid-1', 'https://example.invalid/a', 2_000)

    expect(webhooks.urlFor('cid-1', 1_999)).toBe('https://example.invalid/a')
  })

  it('replaces an earlier webhook for the same conversation', () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record('cid-1', 'https://example.invalid/a', 2_000)
    webhooks.record('cid-1', 'https://example.invalid/b', 3_000)

    expect(webhooks.urlFor('cid-1', 2_500)).toBe('https://example.invalid/b')
  })

  it('has no webhook for a conversation nothing arrived in', () => {
    expect(new DingTalkWebhooks().urlFor('cid-1', 1)).toBeUndefined()
  })

  it('drops a webhook at its own expiry stamp and forgets it', () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record('cid-1', 'https://example.invalid/a', 2_000)

    expect(webhooks.urlFor('cid-1', 2_000)).toBeUndefined()
    expect(webhooks.urlFor('cid-1', 1_999)).toBeUndefined()
  })
})

describe('DingTalkChatClient.checkCredentials', () => {
  it('exchanges the credentials through the SDK and reports the application', async () => {
    const getAccessToken = vi.fn(() => Promise.resolve('token'))
    const client = new DingTalkChatClient(readDingTalkConfig(section()), { ...stream(), getAccessToken }, new DingTalkWebhooks())

    await expect(client.checkCredentials()).resolves.toEqual({ accountLabel: 'app ding-app-key' })
    expect(getAccessToken).toHaveBeenCalledOnce()
  })

  it('propagates the SDK’s own refusal', async () => {
    const client = new DingTalkChatClient(readDingTalkConfig(section()), stream(false), new DingTalkWebhooks())

    await expect(client.checkCredentials()).rejects.toThrow('refused')
  })
})

describe('DingTalkChatClient.sendText', () => {
  it('posts plain text to the conversation’s live webhook', async () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record(CHAT_ID, 'https://example.invalid/hook', Date.now() + 60_000)
    const posted = stubFetch({})

    await client({}, webhooks).sendText(CHAT_ID, 'hello')

    expect(posted).toEqual([{
      url: 'https://example.invalid/hook',
      body: { msgtype: 'text', text: { content: 'hello' } },
    }])
  })

  it('posts Markdown as a Markdown message whose title is the first line', async () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record(CHAT_ID, 'https://example.invalid/hook', Date.now() + 60_000)
    const posted = stubFetch({})

    await client({}, webhooks).sendText(CHAT_ID, '# Title\nbody', { markdown: true })

    expect(posted).toEqual([{
      url: 'https://example.invalid/hook',
      body: { msgtype: 'markdown', markdown: { title: '# Title', text: '# Title\nbody' } },
    }])
  })

  it('refuses a rendered message past the byte ceiling before posting anything', async () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record(CHAT_ID, 'https://example.invalid/hook', Date.now() + 60_000)
    const posted = stubFetch({})

    await expect(client({}, webhooks).sendText(CHAT_ID, '中'.repeat(7_000), { markdown: true }))
      .rejects.toThrow(ChatFormatRejectedError)
    expect(posted).toEqual([])
  })

  it('refuses a send into a conversation with no live webhook', async () => {
    const posted = stubFetch({})

    await expect(client().sendText(CHAT_ID, 'hello'))
      .rejects.toThrow(`no live DingTalk session webhook for ${CHAT_ID}; DingTalk issues one with each inbound message and it expires`)
    expect(posted).toEqual([])
  })

  it('raises an HTTP refusal as a failure naming the status', async () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record(CHAT_ID, 'https://example.invalid/hook', Date.now() + 60_000)
    stubFetch({ ok: false, status: 429 })

    await expect(client({}, webhooks).sendText(CHAT_ID, 'hello'))
      .rejects.toThrow('DingTalk refused the message with HTTP 429')
  })

  it('raises the platform’s own reason, and its fallback when it gave none', async () => {
    const webhooks = new DingTalkWebhooks()
    webhooks.record(CHAT_ID, 'https://example.invalid/hook', Date.now() + 60_000)

    stubFetch({ body: { errcode: 300001, errmsg: 'webhook is invalid' } })
    await expect(client({}, webhooks).sendText(CHAT_ID, 'hello')).rejects.toThrow('webhook is invalid')

    stubFetch({ body: { errcode: 300001 } })
    await expect(client({}, webhooks).sendText(CHAT_ID, 'hello')).rejects.toThrow('DingTalk refused the message')

    stubFetch({ json: () => Promise.resolve(null) })
    await expect(client({}, webhooks).sendText(CHAT_ID, 'hello')).rejects.toThrow('DingTalk refused the message')
  })
})

describe('DingTalkChatClient unsupported operations', () => {
  it('refuses a quoted reply, which the declared capabilities already rule out', async () => {
    await expect(client().replyText()).rejects.toThrow(ChatUnsupportedError)
    await expect(client().replyText()).rejects.toThrow('DingTalk cannot quote a specific message')
  })

  it('refuses a file, which the declared capabilities already rule out', async () => {
    await expect(client().sendFile()).rejects.toThrow(ChatUnsupportedError)
    await expect(client().sendFile()).rejects.toThrow('DingTalk cannot send files')
  })
})

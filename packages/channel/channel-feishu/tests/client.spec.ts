import { describe, expect, it } from 'vitest'
import { ChatFormatRejectedError } from '@deepseek-ai/dsh-channel'
import type { ChatChannelConfig, ChatId, ChatMessageId } from '@deepseek-ai/dsh-channel'
import {
  FEISHU_CAPABILITIES,
  FEISHU_MAX_ATTACHMENT_BYTES,
  FEISHU_MAX_TEXT_CHARS,
  FeishuChatClient,
  readFeishuConfig,
} from '../src/client.ts'
import type { FeishuChannelConfig } from '../src/client.ts'
import { StubFeishuApi } from './stub.ts'

const APP_ID = 'cli_0123456789abcdef'

/** One resolved configuration section, overridden per test. */
function section(overrides: ChatChannelConfig = {}): ChatChannelConfig {
  return { appId: APP_ID, domain: 'feishu', appSecretRef: 'FEISHU_APP_SECRET', ...overrides }
}

/** One client over a stub API and the validated fields of `section()`. */
function client(api: StubFeishuApi, overrides: ChatChannelConfig = {}): FeishuChatClient {
  const config: FeishuChannelConfig = readFeishuConfig(section(overrides))
  return new FeishuChatClient(api, config, 'app-secret')
}

describe('FEISHU_CAPABILITIES', () => {
  it('declares every direction this connector implements and no other', () => {
    expect(FEISHU_CAPABILITIES).toEqual({
      quoting: true,
      inbound: { images: true, files: true },
      outbound: { images: false, files: true },
      markdown: true,
      maxTextChars: FEISHU_MAX_TEXT_CHARS,
      maxInboundBytes: FEISHU_MAX_ATTACHMENT_BYTES,
      maxOutboundBytes: FEISHU_MAX_ATTACHMENT_BYTES,
    })
  })
})

describe('readFeishuConfig', () => {
  it('narrows a complete section', () => {
    expect(readFeishuConfig(section())).toEqual({
      appId: APP_ID,
      domain: 'feishu',
      appSecretRef: 'FEISHU_APP_SECRET',
    })
    expect(readFeishuConfig(section({ domain: 'lark' })).domain).toBe('lark')
  })

  it('names a required field that is absent, empty, or not a string', () => {
    expect(() => readFeishuConfig(section({ appId: undefined })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
    expect(() => readFeishuConfig(section({ appId: '' })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
    expect(() => readFeishuConfig(section({ appId: 7 })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'appId' }))
    expect(() => readFeishuConfig(section({ appSecretRef: '' })))
      .toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'appSecretRef',
        message: 'appSecretRef is required to reach Feishu',
      }))
  })

  it('refuses an application id the official SDK would silently decline', () => {
    for (const appId of ['app-test', 'cli_0123456789abcde', 'cli_0123456789abcdef0', 'cli_0123456789abcdeg']) {
      expect(() => readFeishuConfig(section({ appId })))
        .toThrow(expect.objectContaining({
          code: 'CHAT_CONFIG',
          field: 'appId',
          message: 'appId is not a Feishu application id (cli_ followed by 16 hexadecimal digits)',
        }))
    }
  })

  it('refuses a domain that is neither deployment', () => {
    expect(() => readFeishuConfig(section({ domain: 'feishu-cn' })))
      .toThrow(expect.objectContaining({
        code: 'CHAT_CONFIG',
        field: 'domain',
        message: 'domain must be feishu or lark',
      }))
    expect(() => readFeishuConfig(section({ domain: undefined })))
      .toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', field: 'domain' }))
  })
})

describe('FeishuChatClient.checkCredentials', () => {
  it('reports the application and the token lifetime Feishu granted', async () => {
    const api = new StubFeishuApi()

    await expect(client(api).checkCredentials()).resolves.toEqual({
      accountLabel: `app ${APP_ID}`,
      details: ['tenant access token valid for 7200s'],
    })
    expect(api.tokenRequests).toEqual([{ appId: APP_ID, appSecret: 'app-secret' }])
  })

  it('reports the application alone when Feishu stated no lifetime', async () => {
    const api = new StubFeishuApi()
    api.tokenResponse = { code: 0, msg: 'ok' }

    await expect(client(api).checkCredentials()).resolves.toEqual({ accountLabel: `app ${APP_ID}` })
  })

  it('raises the platform’s own reason, and its fallback when it gave none', async () => {
    const refused = new StubFeishuApi()
    refused.tokenResponse = { code: 10003, msg: 'invalid app_secret' }
    await expect(client(refused).checkCredentials())
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', message: 'invalid app_secret' }))

    const silent = new StubFeishuApi()
    silent.tokenResponse = { code: 10003 }
    await expect(client(silent).checkCredentials())
      .rejects.toThrow(expect.objectContaining({ code: 'CHAT_CONFIG', message: 'Feishu refused the credentials' }))
  })
})

describe('FeishuChatClient.sendText', () => {
  const chatId = 'oc-test' as ChatId

  it('sends plain text as a text message addressed by chat id', async () => {
    const api = new StubFeishuApi()

    await client(api).sendText(chatId, 'hello')

    expect(api.created).toEqual([{
      receiveId: 'oc-test',
      msgType: 'text',
      content: JSON.stringify({ text: 'hello' }),
    }])
  })

  it('sends Markdown as an interactive card carrying the downgraded text', async () => {
    const api = new StubFeishuApi()

    await client(api).sendText(chatId, '# Title', { markdown: true })

    expect(api.created).toEqual([{
      receiveId: 'oc-test',
      msgType: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: '**Title**' } }],
      }),
    }])
  })

  it('refuses a rendered card past the platform ceiling before sending anything', async () => {
    const api = new StubFeishuApi()

    await expect(client(api).sendText(chatId, 'x'.repeat(FEISHU_MAX_TEXT_CHARS + 1), { markdown: true }))
      .rejects.toThrow(ChatFormatRejectedError)
    expect(api.created).toEqual([])
  })

  it('files a refused card as a format rejection, which the bridge resends plainly', async () => {
    const api = new StubFeishuApi()
    api.createResponse = { code: 230001, msg: 'content is invalid' }

    await expect(client(api).sendText(chatId, 'hello', { markdown: true }))
      .rejects.toThrow(ChatFormatRejectedError)
    await expect(client(api).sendText(chatId, 'hello', { markdown: true }))
      .rejects.toThrow('content is invalid')
  })

  it('raises a refused plain message as an ordinary failure, with its fallback when Feishu gave none', async () => {
    const api = new StubFeishuApi()
    api.createResponse = { code: 230002, msg: 'bot is not in the chat' }
    await expect(client(api).sendText(chatId, 'hello')).rejects.toThrow('bot is not in the chat')

    api.createResponse = { code: 230002 }
    await expect(client(api).sendText(chatId, 'hello')).rejects.toThrow('Feishu refused the text message')
  })
})

describe('FeishuChatClient.replyText', () => {
  const messageId = 'om-test' as ChatMessageId

  it('replies under the inbound message, threading the answer', async () => {
    const api = new StubFeishuApi()

    await client(api).replyText(messageId, 'hello')

    expect(api.replied).toEqual([{
      messageId: 'om-test',
      msgType: 'text',
      content: JSON.stringify({ text: 'hello' }),
    }])
  })

  it('renders a Markdown reply as an interactive card', async () => {
    const api = new StubFeishuApi()

    await client(api).replyText(messageId, '## Answer', { markdown: true })

    expect(api.replied[0]?.msgType).toBe('interactive')
    expect(JSON.parse(api.replied[0]?.content ?? '')).toMatchObject({
      elements: [{ text: { content: '**Answer**' } }],
    })
  })

  it('files a refused card as a format rejection and a refused plain reply as a failure', async () => {
    const api = new StubFeishuApi()
    api.replyResponse = { code: 230001, msg: 'content is invalid' }
    await expect(client(api).replyText(messageId, 'x', { markdown: true }))
      .rejects.toThrow(ChatFormatRejectedError)

    api.replyResponse = { code: 230002, msg: 'message is gone' }
    await expect(client(api).replyText(messageId, 'x')).rejects.toThrow('message is gone')

    api.replyResponse = { code: 230002 }
    await expect(client(api).replyText(messageId, 'x')).rejects.toThrow('Feishu refused the text message')
  })
})

describe('FeishuChatClient.sendFile', () => {
  const chatId = 'oc-test' as ChatId

  it('uploads the bytes and then sends the key Feishu returned', async () => {
    const api = new StubFeishuApi()

    await client(api).sendFile(chatId, { fileName: 'report.pdf', data: new Uint8Array([1, 2, 3]) })

    expect(api.uploaded).toEqual([{ fileName: 'report.pdf', fileType: 'stream', bytes: 3 }])
    expect(api.created).toEqual([{
      receiveId: 'oc-test',
      msgType: 'file',
      content: JSON.stringify({ file_key: 'file-key' }),
    }])
  })

  it('refuses when Feishu declined the upload', async () => {
    const api = new StubFeishuApi()
    api.uploadResponse = null

    await expect(client(api).sendFile(chatId, { fileName: 'report.pdf', data: new Uint8Array([1]) }))
      .rejects.toThrow('Feishu refused the upload of report.pdf')
    expect(api.created).toEqual([])
  })

  it('raises a refused file message, with its fallback when Feishu gave none', async () => {
    const api = new StubFeishuApi()
    api.createResponse = { code: 230002, msg: 'file_key is invalid' }
    await expect(client(api).sendFile(chatId, { fileName: 'report.pdf', data: new Uint8Array([1]) }))
      .rejects.toThrow('file_key is invalid')

    api.createResponse = { code: 230002 }
    await expect(client(api).sendFile(chatId, { fileName: 'report.pdf', data: new Uint8Array([1]) }))
      .rejects.toThrow('Feishu refused the file message')
  })
})

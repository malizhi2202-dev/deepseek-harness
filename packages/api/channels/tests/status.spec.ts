/**
 * Tests for `Channels.status`: the endpoint settles the bridge registry before
 * it reads, assembles one panel view per registered channel from the bridge
 * statuses and the redacted settings descriptors, and reports each credential
 * reference its own configuration section names by presence only.
 */

import { describe, expect, it } from 'vitest'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  CAPABILITIES,
  CHANNEL,
  NAMESPACE,
  SESSION,
  channelStatus,
  descriptor,
  harness,
} from './harness.ts'

describe('the channels Remote namespace', () => {
  it('publishes its four Remote methods from the channels service key', () => {
    const { endpoint } = harness()
    expect(endpoint.typertRemote).toMatchObject({ serviceKey: 'channels', namespace: 'channels' })
    expect(remoteMethods(endpoint)).toEqual([
      { method: 'status', invocation: { kind: 'direct' } },
      { method: 'probe', invocation: { kind: 'direct' } },
      { method: 'enable', invocation: { kind: 'direct' } },
      { method: 'disable', invocation: { kind: 'direct' } },
    ])
  })
})

describe('Channels.status', () => {
  it('reports no channels while the bridge has bound none', async () => {
    const { endpoint } = harness()
    await expect(endpoint.status()).resolves.toEqual({ channels: [] })
  })

  it('settles the registry and reads redacted descriptors before assembling the views', async () => {
    const { endpoint, settings, log } = harness({
      descriptors: [descriptor(NAMESPACE, {})],
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE })],
    })
    await endpoint.status()
    expect(log).toEqual(['chatBridge.sync', 'settings.describe', 'chatBridge.statuses'])
    expect(settings.describeOptions).toEqual([{ redactSecrets: true }])
  })

  it('carries every optional binding fact the bridge reports', async () => {
    const capabilities = { ...CAPABILITIES, quoting: true, maxTextChars: 4000 }
    const { endpoint } = harness({
      descriptors: [descriptor(NAMESPACE, {})],
      statuses: () => [channelStatus({
        settingsNamespace: NAMESPACE,
        enabled: true,
        sessionId: SESSION,
        connection: 'connected',
        capabilities,
        lastError: 'the platform refused the token',
        lastErrorAt: '2026-01-02T03:04:05.000Z',
        lastInboundAt: '2026-01-02T03:04:06.000Z',
        lockedChatId: 'chat-test',
        replyBudget: 3,
      })],
    })
    await expect(endpoint.status()).resolves.toEqual({
      channels: [{
        channel: CHANNEL,
        enabled: true,
        sessionId: SESSION,
        connection: 'connected',
        lastError: 'the platform refused the token',
        lastErrorAt: '2026-01-02T03:04:05.000Z',
        lastInboundAt: '2026-01-02T03:04:06.000Z',
        lockedChatId: 'chat-test',
        replyBudget: 3,
        capabilities,
        settingsNamespace: NAMESPACE,
        credentials: [],
      }],
    })
  })

  it('omits every binding fact the bridge did not report', async () => {
    const { endpoint } = harness({
      descriptors: [descriptor(NAMESPACE, {})],
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE })],
    })
    const view = (await endpoint.status()).channels[0]
    expect(view).toEqual({
      channel: CHANNEL,
      enabled: false,
      sessionId: '',
      connection: 'stopped',
      capabilities: CAPABILITIES,
      settingsNamespace: NAMESPACE,
      credentials: [],
    })
    expect(Object.keys(view ?? {})).toEqual([
      'channel',
      'enabled',
      'sessionId',
      'connection',
      'capabilities',
      'settingsNamespace',
      'credentials',
    ])
  })

  it('resolves each channel against its own settings namespace, in the bridge order', async () => {
    const { endpoint } = harness({
      descriptors: [
        descriptor('channel-first', { appSecret: 'FIRST_APP_SECRET' }),
        descriptor('channel-second', { appSecret: 'SECOND_APP_SECRET' }),
      ],
      statuses: () => [
        channelStatus({
          channel: 'channel-first',
          settingsNamespace: 'channel-first',
          credentialFields: ['appSecret'],
        }),
        channelStatus({
          channel: 'channel-second',
          settingsNamespace: 'channel-second',
          credentialFields: ['appSecret'],
        }),
      ],
      credentialInfo: async () => ({ configured: true, source: 'env', writable: true }),
    })
    const answer = await endpoint.status()
    expect(answer.channels.map(view => [view.channel, view.credentials[0]?.ref])).toEqual([
      ['channel-first', 'FIRST_APP_SECRET'],
      ['channel-second', 'SECOND_APP_SECRET'],
    ])
  })
})

describe('Channels.status credential presence', () => {
  it('reports a configured reference with the layer that supplies it', async () => {
    const { endpoint, credentials } = harness({
      descriptors: [descriptor(NAMESPACE, { appSecret: 'TUITUI_APP_SECRET' })],
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE, credentialFields: ['appSecret'] })],
      credentialInfo: async () => ({ configured: true, source: 'env', writable: true }),
    })
    const view = (await endpoint.status()).channels[0]
    expect(view?.credentials).toEqual([{
      field: 'appSecret',
      ref: 'TUITUI_APP_SECRET',
      configured: true,
      source: 'env',
      writable: true,
    }])
    expect(credentials.described).toEqual(['TUITUI_APP_SECRET'])
  })

  it('reports an unconfigured reference without a supplying layer', async () => {
    const { endpoint, credentials } = harness({
      descriptors: [descriptor(NAMESPACE, { appSecret: 'TUITUI_APP_SECRET' })],
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE, credentialFields: ['appSecret'] })],
      credentialInfo: async () => ({ configured: false, writable: true }),
    })
    const view = (await endpoint.status()).channels[0]
    expect(view?.credentials).toEqual([{
      field: 'appSecret',
      ref: 'TUITUI_APP_SECRET',
      configured: false,
      writable: true,
    }])
    expect(credentials.described).toEqual(['TUITUI_APP_SECRET'])
  })

  it('reports a field that names no reference as unconfigured and unwritable without asking the provider', async () => {
    const { endpoint, credentials } = harness({
      descriptors: [descriptor(NAMESPACE, { appSecret: 'not a var', appId: 42 })],
      statuses: () => [channelStatus({
        settingsNamespace: NAMESPACE,
        credentialFields: ['appSecret', 'appId', 'appMissing'],
      })],
    })
    const view = (await endpoint.status()).channels[0]
    expect(view?.credentials).toEqual([
      { field: 'appSecret', ref: 'not a var', configured: false, writable: false },
      { field: 'appId', ref: '', configured: false, writable: false },
      { field: 'appMissing', ref: '', configured: false, writable: false },
    ])
    expect(credentials.described).toEqual([])
  })

  it('reports no reference for a channel whose settings section is not an object', async () => {
    for (const section of ['configuration is not loaded yet', null]) {
      const { endpoint } = harness({
        descriptors: [descriptor(NAMESPACE, section)],
        statuses: () => [channelStatus({ settingsNamespace: NAMESPACE, credentialFields: ['appSecret'] })],
      })
      const view = (await endpoint.status()).channels[0]
      expect(view?.credentials).toEqual([
        { field: 'appSecret', ref: '', configured: false, writable: false },
      ])
    }
  })

  it('reports no credential entries for a channel whose settings namespace is unregistered', async () => {
    const { endpoint, credentials } = harness({
      descriptors: [descriptor('channel-other', { appSecret: 'TUITUI_APP_SECRET' })],
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE, credentialFields: ['appSecret'] })],
    })
    const view = (await endpoint.status()).channels[0]
    expect(view?.credentials).toEqual([
      { field: 'appSecret', ref: '', configured: false, writable: false },
    ])
    expect(credentials.described).toEqual([])
  })

  it('reads the reference the channel section holds now, not a cached one', async () => {
    const descriptors: SettingsDescriptor[] = [descriptor(NAMESPACE, { appSecret: 'TUITUI_APP_SECRET' })]
    const { endpoint, credentials } = harness({
      descriptors,
      statuses: () => [channelStatus({ settingsNamespace: NAMESPACE, credentialFields: ['appSecret'] })],
      credentialInfo: async () => ({ configured: true, source: 'file', writable: true }),
    })
    expect((await endpoint.status()).channels[0]?.credentials).toEqual([
      { field: 'appSecret', ref: 'TUITUI_APP_SECRET', configured: true, source: 'file', writable: true },
    ])
    descriptors.splice(0, 1, descriptor(NAMESPACE, { appSecret: 'TUITUI_SECOND_SECRET' }))
    expect((await endpoint.status()).channels[0]?.credentials).toEqual([
      { field: 'appSecret', ref: 'TUITUI_SECOND_SECRET', configured: true, source: 'file', writable: true },
    ])
    expect(credentials.described).toEqual(['TUITUI_APP_SECRET', 'TUITUI_SECOND_SECRET'])
  })
})

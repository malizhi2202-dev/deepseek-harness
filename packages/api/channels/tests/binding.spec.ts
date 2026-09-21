/**
 * Tests for `Channels.probe`, `Channels.enable`, and `Channels.disable`: the
 * endpoint addresses only a registered channel, forwards exactly one binding
 * change to the bridge, answers a probe that failed as a value, and carries a
 * bridge refusal across the wire as the declared `channels/unknown` or
 * `channels/failed` code.
 */

import { describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { CAPABILITIES, CHANNEL, NAMESPACE, OTHER_CHANNEL, SESSION, channelStatus, harness } from './harness.ts'

/** The one registered channel every binding test addresses. */
const registered = (): ReturnType<typeof channelStatus>[] => [
  channelStatus({ settingsNamespace: NAMESPACE }),
]

describe('Channels.probe', () => {
  it('answers what the bridge found for the named channel', async () => {
    const { endpoint, bridge } = harness({
      statuses: registered,
      probe: async () => ({ ok: true }),
    })
    await expect(endpoint.probe(CHANNEL)).resolves.toEqual({ ok: true })
    expect(bridge.probes).toEqual([CHANNEL])
  })

  it('carries the account and detail lines a successful probe returned', async () => {
    const { endpoint } = harness({
      statuses: registered,
      probe: async () => ({
        ok: true,
        accountLabel: 'tuitui-bot',
        details: ['the client was built from the configured reference'],
      }),
    })
    await expect(endpoint.probe(CHANNEL)).resolves.toEqual({
      ok: true,
      accountLabel: 'tuitui-bot',
      details: ['the client was built from the configured reference'],
    })
  })

  it('answers a probe that could not build a client as a value, not a refusal', async () => {
    const { endpoint } = harness({
      statuses: registered,
      probe: async () => ({ ok: false, message: 'TUITUI_APP_SECRET is not configured' }),
    })
    await expect(endpoint.probe(CHANNEL)).resolves.toEqual({
      ok: false,
      message: 'TUITUI_APP_SECRET is not configured',
    })
  })

  it('refuses a channel that is not registered as channels/unknown', async () => {
    const { endpoint, bridge } = harness({ statuses: registered })
    const failure = await endpoint.probe('channel-ghost').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/unknown',
      message: 'no channel named channel-ghost is registered',
      details: {},
    })
    expect(bridge.probes).toEqual([])
  })
})

describe('Channels.enable', () => {
  it('points the named channel at the Session and answers the status after the change', async () => {
    let bound = false
    const { endpoint, bridge } = harness({
      statuses: () => [
        channelStatus({
          settingsNamespace: NAMESPACE,
          enabled: bound,
          sessionId: bound ? SESSION : '',
          connection: bound ? 'connecting' : 'stopped',
        }),
      ],
      enable: async () => {
        bound = true
      },
    })
    await expect(endpoint.enable(CHANNEL, SESSION)).resolves.toEqual({
      channels: [{
        channel: CHANNEL,
        enabled: true,
        sessionId: SESSION,
        connection: 'connecting',
        capabilities: CAPABILITIES,
        settingsNamespace: NAMESPACE,
        credentials: [],
      }],
    })
    expect(bridge.enables).toEqual([{ channel: CHANNEL, sessionId: SESSION }])
  })

  it('refuses an unregistered channel as channels/unknown without asking the bridge to bind', async () => {
    const { endpoint, bridge } = harness({ statuses: registered })
    const failure = await endpoint.enable('channel-ghost', SESSION).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/unknown',
      message: 'no channel named channel-ghost is registered',
      details: {},
    })
    expect(bridge.enables).toEqual([])
  })

  it('carries a bridge refusal for a Session that does not exist as channels/failed', async () => {
    const refused = new Error(`session ${SESSION} does not exist; open it before binding a channel to it`)
    const { endpoint } = harness({
      statuses: registered,
      enable: async () => {
        throw refused
      },
    })
    const failure = await endpoint.enable(CHANNEL, SESSION).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/failed',
      message: `session ${SESSION} does not exist; open it before binding a channel to it`,
      details: {},
    })
    expect((failure as Error).cause).toBe(refused)
  })

  it('carries a bridge refusal for a Session another channel already serves as channels/failed', async () => {
    const { endpoint } = harness({
      statuses: () => [
        ...registered(),
        channelStatus({ channel: OTHER_CHANNEL, settingsNamespace: 'channel-tuitui-other' }),
      ],
      enable: async () => {
        throw new Error(
          `channel ${OTHER_CHANNEL} already serves session ${SESSION}; disable it before binding another channel to the same session`,
        )
      },
    })
    const failure = await endpoint.enable(CHANNEL, SESSION).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/failed',
      message: `channel ${OTHER_CHANNEL} already serves session ${SESSION}; disable it before binding another channel to the same session`,
    })
  })

  it('carries a bridge refusal that is not an Error as channels/failed, naming it', async () => {
    const { endpoint } = harness({
      statuses: registered,
      enable: async () => {
        throw 'the binding was refused'
      },
    })
    const failure = await endpoint.enable(CHANNEL, SESSION).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/failed',
      message: 'the binding was refused',
    })
  })
})

describe('Channels.disable', () => {
  it('closes the named channel and answers the status after the change', async () => {
    let bound = true
    const { endpoint, bridge } = harness({
      statuses: () => [
        channelStatus({
          settingsNamespace: NAMESPACE,
          enabled: bound,
          sessionId: bound ? SESSION : '',
        }),
      ],
      disable: async () => {
        bound = false
      },
    })
    await expect(endpoint.disable(CHANNEL)).resolves.toEqual({
      channels: [{
        channel: CHANNEL,
        enabled: false,
        sessionId: '',
        connection: 'stopped',
        capabilities: CAPABILITIES,
        settingsNamespace: NAMESPACE,
        credentials: [],
      }],
    })
    expect(bridge.disables).toEqual([CHANNEL])
  })

  it('refuses an unregistered channel as channels/unknown without asking the bridge to close', async () => {
    const { endpoint, bridge } = harness({ statuses: registered })
    const failure = await endpoint.disable('channel-ghost').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/unknown',
      message: 'no channel named channel-ghost is registered',
    })
    expect(bridge.disables).toEqual([])
  })

  it('carries a bridge refusal that is not an Error as channels/failed, naming it', async () => {
    const { endpoint } = harness({
      statuses: registered,
      disable: async () => {
        throw 'the store refused'
      },
    })
    const failure = await endpoint.disable(CHANNEL).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'channels/failed',
      message: 'the store refused',
    })
  })
})

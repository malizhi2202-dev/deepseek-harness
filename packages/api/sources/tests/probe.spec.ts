/**
 * Tests for `SourcePanel.probe`: the endpoint addresses only an instance this
 * Host declares, hands its provider that provider's own resolved instance,
 * answers a source that could not be reached as a value, and carries an unknown
 * instance across the wire as the declared `sources/unknown` code.
 */

import { describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SourceConfig } from '../src/seam.ts'
import { KIND, NAMESPACE, descriptor, harness, instance, provider } from './harness.ts'

describe('SourcePanel.probe', () => {
  it('answers what the provider found and hands it the instance that provider resolved', async () => {
    const seen: SourceConfig[] = []
    const { endpoint } = harness({
      providers: () => [provider({
        instances: async () => [instance('main', { tokenRef: 'GITHUB_TOKEN' })],
        check: async (config) => {
          seen.push(config)
          return { label: 'the-account', detail: 'https://api.github.com' }
        },
      })],
      descriptors: () => [descriptor(NAMESPACE, {})],
    })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toEqual({
      ok: true,
      label: 'the-account',
      detail: 'https://api.github.com',
    })
    expect(seen).toEqual([{ ref: { kind: KIND, id: 'main' }, configured: true, tokenRef: 'GITHUB_TOKEN' }])
  })

  it('answers a probe that established nothing beyond reachability without a detail line', async () => {
    const { endpoint } = harness({ providers: () => [provider()] })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toEqual({ ok: true, label: 'the-account' })
  })

  it('answers a source the provider refused as a value, not a refusal', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ check: async () => { throw new Error('the token was refused') } })],
    })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toEqual({ ok: false, message: 'the token was refused' })
  })

  it('names a refusal that is not an Error', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ check: async () => { throw 'the host is unreachable' } })],
    })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toEqual({ ok: false, message: 'the host is unreachable' })
  })

  it('addresses the instance the key names, not the first one the kind declares', async () => {
    const seen: string[] = []
    const { endpoint } = harness({
      providers: () => [provider({
        instances: async () => [instance('one'), instance('two')],
        check: async (config) => {
          seen.push(config.ref.id)
          return { label: config.ref.id }
        },
      })],
    })
    await expect(endpoint.probe(`${KIND}/two`)).resolves.toEqual({ ok: true, label: 'two' })
    expect(seen).toEqual(['two'])
  })

  it('refuses an instance this Host does not declare as sources/unknown', async () => {
    let checks = 0
    const { endpoint } = harness({
      providers: () => [provider({
        check: async () => {
          checks += 1
          return { label: 'the-account' }
        },
      })],
    })
    const failure = await endpoint.probe('github/ghost').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'sources/unknown',
      message: 'no source named github/ghost is registered',
      details: {},
    })
    expect(checks).toBe(0)
  })

  it('refuses a kind that is not registered at all', async () => {
    const { endpoint } = harness({ providers: () => [] })
    const failure = await endpoint.probe('github/main').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'sources/unknown' })
  })

  it('records the failure so the next status reports it', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ check: async () => { throw new Error('the token was refused') } })],
      descriptors: () => [descriptor(NAMESPACE, {})],
    })
    await endpoint.probe(`${KIND}/main`)
    const view = (await endpoint.status()).sources[0]
    expect(view?.lastError).toBe('the token was refused')
    expect(view?.lastErrorAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('probes an instance whose kind registers no settings namespace', async () => {
    const { endpoint } = harness({ providers: () => [provider()] })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toMatchObject({ ok: true })
    await expect(endpoint.status()).resolves.toMatchObject({ sources: [{ state: 'usable' }] })
  })
})

/**
 * Tests for `SourcePanel.status`: the endpoint reads the resource registry, asks
 * every provider for the instances its own configuration declares, reads the
 * redacted settings descriptors for the credential-reference fields each kind's
 * schema marks, and derives where every instance stands from those facts plus
 * the probes this process observed.
 */

import { describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  CAPABILITIES,
  KIND,
  NAMESPACE,
  OTHER_KIND,
  OTHER_NAMESPACE,
  descriptor,
  flatSchema,
  harness,
  instance,
  instanceSchema,
  provider,
} from './harness.ts'

describe('the sources Remote namespace', () => {
  it('publishes its two Remote methods from the panel service key under the sources namespace', () => {
    const { endpoint } = harness()
    expect(endpoint.typertRemote).toMatchObject({ serviceKey: 'sourcesPanel', namespace: 'sources' })
    expect(remoteMethods(endpoint)).toEqual([
      { method: 'status', invocation: { kind: 'direct' } },
      { method: 'probe', invocation: { kind: 'direct' } },
    ])
  })
})

describe('SourcePanel.status', () => {
  it('reports no sources while the registry holds no provider', async () => {
    const { endpoint } = harness()
    await expect(endpoint.status()).resolves.toEqual({ sources: [] })
  })

  it('reads redacted descriptors before assembling the views', async () => {
    const { endpoint, settings, log } = harness({ descriptors: () => [descriptor(NAMESPACE, {})] })
    await endpoint.status()
    expect(log).toEqual(['settings.describe', 'sources.list'])
    expect(settings.describeOptions).toEqual([{ redactSecrets: true }])
  })

  it('carries every fact the provider and its configuration report', async () => {
    const capabilities = { ...CAPABILITIES, browse: false, maxReadBytes: 4096 }
    const { endpoint } = harness({
      providers: () => [provider({
        capabilities,
        instances: async () => [instance('main', { tokenRef: 'GITHUB_TOKEN' })],
      })],
      descriptors: () => [descriptor(NAMESPACE, { instances: { main: { tokenRef: 'GITHUB_TOKEN' } } }, {
        schema: instanceSchema(['tokenRef']),
      })],
      credentialInfo: async () => ({ configured: true, source: 'env', writable: true }),
    })
    await expect(endpoint.status()).resolves.toEqual({
      sources: [{
        key: `${KIND}/main`,
        kind: KIND,
        id: 'main',
        namespace: NAMESPACE,
        state: 'unchecked',
        capabilities,
        credentials: [{
          field: 'tokenRef',
          ref: 'GITHUB_TOKEN',
          configured: true,
          source: 'env',
          writable: true,
        }],
      }],
    })
  })

  it('reports the minimal fact set in one stable key order', async () => {
    const { endpoint } = harness({ providers: () => [provider()] })
    const status = await endpoint.status()
    expect(Object.keys(status.sources[0] ?? {})).toEqual([
      'key', 'kind', 'id', 'namespace', 'state', 'capabilities', 'credentials',
    ])
  })

  it('reports one view per declared instance, kinds in registration order', async () => {
    const { endpoint } = harness({
      providers: () => [
        provider({ instances: async () => [instance('one'), instance('two', {}, false)] }),
        provider({
          kind: OTHER_KIND,
          instances: async () => [instance('wiki')],
        }),
      ],
      descriptors: () => [
        descriptor(NAMESPACE, {}),
        descriptor(OTHER_NAMESPACE, {}),
      ],
    })
    const status = await endpoint.status()
    expect(status.sources.map(view => [view.key, view.namespace, view.state])).toEqual([
      [`${KIND}/one`, NAMESPACE, 'unchecked'],
      [`${KIND}/two`, NAMESPACE, 'unconfigured'],
      [`${OTHER_KIND}/wiki`, OTHER_NAMESPACE, 'unchecked'],
    ])
  })

  it('reads the registry fresh on every call', async () => {
    let providers = [provider({ instances: async () => [instance('one')] })]
    const { endpoint } = harness({ providers: () => providers })
    await expect(endpoint.status()).resolves.toMatchObject({ sources: [{ id: 'one' }] })
    providers = [provider({ instances: async () => [instance('two')] })]
    await expect(endpoint.status()).resolves.toMatchObject({ sources: [{ id: 'two' }] })
  })

  it('reports the provider\'s own resolved values, not the raw section', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', { tokenRef: 'RESOLVED_REF' })] })],
      descriptors: () => [descriptor(NAMESPACE, { instances: { main: { tokenRef: 'RAW_REF' } } }, {
        schema: instanceSchema(['tokenRef']),
      })],
      credentialInfo: async () => ({ configured: true, writable: true }),
    })
    const status = await endpoint.status()
    expect(status.sources[0]?.credentials).toEqual([
      { field: 'tokenRef', ref: 'RESOLVED_REF', configured: true, writable: true },
    ])
  })

  it('leaves a namespace this Host does not register without credentials', async () => {
    const { endpoint, credentials } = harness({ providers: () => [provider()] })
    const status = await endpoint.status()
    expect(status.sources[0]?.namespace).toBe(NAMESPACE)
    expect(status.sources[0]?.credentials).toEqual([])
    expect(credentials.described).toEqual([])
  })
})

describe('SourcePanel.status credential fields', () => {
  /**
   * Read the credential facts one schema yields for one instance value.
   * @param schema - the serialized schema to publish.
   * @param values - the instance's own resolved values.
   * @returns the credential views the endpoint reported.
   */
  async function credentialsFor(
    schema: unknown,
    values: Record<string, unknown>,
  ): Promise<unknown> {
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', values)] })],
      descriptors: () => [descriptor(NAMESPACE, {}, { schema })],
      credentialInfo: async () => ({ configured: true, source: 'env', writable: true }),
    })
    return (await endpoint.status()).sources[0]?.credentials
  }

  it('finds a credential reference declared on a flat root object', async () => {
    await expect(credentialsFor(flatSchema('tokenRef'), { tokenRef: 'GITHUB_TOKEN' })).resolves.toEqual([
      { field: 'tokenRef', ref: 'GITHUB_TOKEN', configured: true, source: 'env', writable: true },
    ])
  })

  it('finds a credential reference declared inside a dictionary of instances', async () => {
    await expect(credentialsFor(instanceSchema(['passwordRef']), { passwordRef: 'MYSQL_PASSWORD' })).resolves.toEqual([
      { field: 'passwordRef', ref: 'MYSQL_PASSWORD', configured: true, source: 'env', writable: true },
    ])
  })

  it('finds a credential reference declared inside an intersection or an array', async () => {
    const intersect = {
      uid: 5,
      refs: {
        '1': { type: 'string', meta: { role: 'credential-ref' } },
        '2': { type: 'object', meta: {}, dict: { tokenRef: 1 } },
        '3': { type: 'object', meta: {}, dict: {} },
        '5': { type: 'intersect', meta: {}, list: [2, 3] },
      },
    }
    await expect(credentialsFor(intersect, { tokenRef: 'A_REF' })).resolves.toMatchObject([{ field: 'tokenRef' }])
    const array = {
      uid: 5,
      refs: {
        '1': { type: 'string', meta: { role: 'credential-ref' } },
        '2': { type: 'object', meta: {}, dict: { passwordRef: 1 } },
        '3': { type: 'array', meta: {}, inner: 2 },
        '5': { type: 'object', meta: {}, dict: { accounts: 3 } },
      },
    }
    await expect(credentialsFor(array, { passwordRef: 'B_REF' })).resolves.toMatchObject([{ field: 'passwordRef' }])
  })

  it('descends a nested object that is not itself a credential reference', async () => {
    const nested = {
      uid: 4,
      refs: {
        '1': { type: 'string', meta: { role: 'credential-ref' } },
        '2': { type: 'object', meta: {}, dict: { tokenRef: 1 } },
        '4': { type: 'object', meta: {}, dict: { auth: 2 } },
      },
    }
    await expect(credentialsFor(nested, { tokenRef: 'NESTED_REF' })).resolves.toMatchObject([{ field: 'tokenRef' }])
  })

  it('ignores a schema node that declares no field, no members, or an unresolvable reference', async () => {
    const shapes: readonly unknown[] = [
      undefined,
      'not a schema',
      {},
      { uid: 2, refs: { '2': { type: 'dict', meta: {} } } },
      { uid: 2, refs: { '2': { type: 'object', meta: {} } } },
      { uid: 2, refs: { '2': { type: 'object', meta: {}, dict: { tokenRef: 9 } } } },
      { uid: 2, refs: { '2': { type: 'object', meta: {}, dict: { tokenRef: 'inline' } } } },
      { uid: 2, refs: { '2': { type: 'object', meta: {}, dict: { tokenRef: 1 } } } },
      { uid: 2, refs: { '2': { type: 'intersect', meta: {} } } },
      { uid: 2, refs: { '2': { type: 'intersect', meta: {}, list: [9, 'inline'] } } },
    ]
    for (const schema of shapes) {
      await expect(credentialsFor(schema, { tokenRef: 'A_REF' })).resolves.toEqual([])
    }
  })

  it('reports a credential field the instance holds no reference for as unset', async () => {
    await expect(credentialsFor(flatSchema('tokenRef'), {})).resolves.toEqual([
      { field: 'tokenRef', ref: '', configured: false, writable: false },
    ])
    await expect(credentialsFor(flatSchema('tokenRef'), { tokenRef: 42 })).resolves.toEqual([
      { field: 'tokenRef', ref: '', configured: false, writable: false },
    ])
    await expect(credentialsFor(flatSchema('tokenRef'), { tokenRef: 'not a name' })).resolves.toEqual([
      { field: 'tokenRef', ref: 'not a name', configured: false, writable: false },
    ])
  })

  it('reports a reference the credential provider cannot write as unwritable and without a source', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', { tokenRef: 'GITHUB_TOKEN' })] })],
      descriptors: () => [descriptor(NAMESPACE, {}, { schema: flatSchema('tokenRef') })],
      credentialInfo: async () => ({ configured: false, writable: false }),
    })
    const status = await endpoint.status()
    expect(status.sources[0]?.credentials).toEqual([
      { field: 'tokenRef', ref: 'GITHUB_TOKEN', configured: false, writable: false },
    ])
  })

  it('names every credential field once, in schema order', async () => {
    const schema = {
      uid: 6,
      refs: {
        '1': { type: 'string', meta: { role: 'credential-ref' } },
        '2': { type: 'string', meta: { role: 'credential-ref' } },
        '3': { type: 'object', meta: {}, dict: { second: 2, first: 1 } },
        '4': { type: 'object', meta: {}, dict: { first: 1 } },
        '5': { type: 'object', meta: {}, dict: { auth: 3 } },
        '6': { type: 'intersect', meta: {}, list: [5, 4] },
      },
    }
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', { first: 'F', second: 'S' })] })],
      descriptors: () => [descriptor(NAMESPACE, {}, { schema })],
      credentialInfo: async () => ({ configured: true, writable: true }),
    })
    const status = await endpoint.status()
    expect(status.sources[0]?.credentials.map(credential => credential.field)).toEqual(['second', 'first'])
  })
})

describe('SourcePanel.status states', () => {
  /**
   * Report one instance's state after a scripted probe.
   * @param configured - what the provider reports about the instance.
   * @param probe - the probe to run first, when a case needs one.
   * @param revisions - the descriptor revisions to report, oldest first.
   * @returns the state the endpoint drew.
   */
  async function stateAfter(
    configured: boolean,
    probe?: (endpoint: ReturnType<typeof harness>['endpoint']) => Promise<unknown>,
    revisions: readonly number[] = [1],
  ): Promise<string | undefined> {
    let index = 0
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', {}, configured)] })],
      descriptors: () => {
        const revision = revisions[Math.min(index, revisions.length - 1)] ?? 1
        return [descriptor(NAMESPACE, {}, { revision })]
      },
    })
    if (probe !== undefined) await probe(endpoint)
    index = revisions.length - 1
    const status = await endpoint.status()
    return status.sources[0]?.state
  }

  it('reports an instance its provider calls incomplete as unconfigured', async () => {
    await expect(stateAfter(false)).resolves.toBe('unconfigured')
  })

  it('reports a configured instance nothing has probed as unchecked', async () => {
    await expect(stateAfter(true)).resolves.toBe('unchecked')
  })

  it('reports a configured instance whose probe succeeded as usable', async () => {
    await expect(stateAfter(true, async endpoint => await endpoint.probe(`${KIND}/main`))).resolves.toBe('usable')
  })

  it('reports a configured instance whose probe failed as unusable, with the error it recorded', async () => {
    const { endpoint } = harness({
      providers: () => [provider({
        instances: async () => [instance('main')],
        check: async () => { throw new Error('the token was refused') },
      })],
      descriptors: () => [descriptor(NAMESPACE, {})],
    })
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toEqual({ ok: false, message: 'the token was refused' })
    const status = await endpoint.status()
    expect(status.sources[0]).toMatchObject({ state: 'unusable', lastError: 'the token was refused' })
    expect(status.sources[0]?.lastErrorAt).toEqual(expect.any(String))
  })

  it('reads an instance edited since its probe as unchecked again', async () => {
    let revision = 1
    const { endpoint } = harness({
      providers: () => [provider()],
      descriptors: () => [descriptor(NAMESPACE, {}, { revision })],
    })
    await endpoint.probe(`${KIND}/main`)
    await expect(endpoint.status()).resolves.toMatchObject({ sources: [{ state: 'usable' }] })
    revision = 2
    await expect(endpoint.status()).resolves.toMatchObject({ sources: [{ state: 'unchecked' }] })
  })

  it('keeps the failure a later successful probe did not clear', async () => {
    let refuse = true
    const { endpoint } = harness({
      providers: () => [provider({
        check: async () => {
          if (refuse) throw new Error('the carrier dropped')
          return { label: 'the-account' }
        },
      })],
      descriptors: () => [descriptor(NAMESPACE, {})],
    })
    await endpoint.probe(`${KIND}/main`)
    refuse = false
    await expect(endpoint.probe(`${KIND}/main`)).resolves.toMatchObject({ ok: true })
    const status = await endpoint.status()
    expect(status.sources[0]).toMatchObject({ state: 'usable', lastError: 'the carrier dropped' })
  })

  it('reports a source with no registered settings namespace from its provider alone', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [instance('main', {}, false)] })],
    })
    await expect(endpoint.status()).resolves.toMatchObject({
      sources: [{ namespace: NAMESPACE, state: 'unconfigured', credentials: [] }],
    })
  })

  it('reports nothing for a kind whose settings declare no instance', async () => {
    const { endpoint } = harness({
      providers: () => [provider({ instances: async () => [] })],
      descriptors: () => [descriptor(NAMESPACE, {})],
    })
    await expect(endpoint.status()).resolves.toEqual({ sources: [] })
  })
})

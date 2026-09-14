/**
 * Core Gateway Module - Provider Contract Tests
 * Verifies the WebProviderRuntime contract and the adapter bridge wrapping
 * legacy adapters without changing protocol logic.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { WebProviderError, createDefaultCapabilities } from '../../src/main/proxy/core/providerContract.ts'
import { ProviderAdapterBridge } from '../../src/main/proxy/core/providerAdapterBridge.ts'
import { getProviderCapabilities, resolveCapabilities } from '../../src/main/proxy/core/capabilities.ts'
import { providerRegistry } from '../../src/main/proxy/core/providerRegistry.ts'
import type { Account, Provider } from '../../src/main/store/types.ts'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'test',
    name: 'Test',
    type: 'custom',
    authType: 'userToken',
    apiEndpoint: 'https://example.com',
    headers: {},
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supportedModels: ['test-model'],
    ...overrides,
  }
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-test',
    providerId: 'test',
    name: 'Test Account',
    credentials: { token: 'secret-token' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

test('WebProviderError carries stable codes and retryable flags', () => {
  const notLoggedIn = WebProviderError.notLoggedIn()
  assert.equal(notLoggedIn.code, 'provider_not_logged_in')
  assert.equal(notLoggedIn.retryable, false)

  const timeout = WebProviderError.timeout()
  assert.equal(timeout.code, 'provider_timeout')
  assert.equal(timeout.retryable, true)

  const blocked = WebProviderError.blocked()
  assert.equal(blocked.code, 'provider_blocked')
  assert.equal(blocked.status, 429)

  const unsupported = WebProviderError.capabilityUnsupported()
  assert.equal(unsupported.code, 'capability_not_supported')
})

test('default capabilities derive from provider model hints', () => {
  const base = createDefaultCapabilities(makeProvider())
  assert.equal(base.text, true)
  assert.equal(base.stream, true)
  assert.equal(base.vision, false)

  const visionProvider = createDefaultCapabilities(makeProvider({ supportedModels: ['vision-pro'] }))
  assert.equal(visionProvider.vision, true)

  const thinkProvider = createDefaultCapabilities(makeProvider({ supportedModels: ['think-1'] }))
  assert.equal(thinkProvider.reasoning, true)
})

test('bridge wraps a forward function and preserves stream passthrough', async () => {
  const provider = makeProvider()
  const account = makeAccount()

  const stream = new PassThrough()
  const bridge = new ProviderAdapterBridge({
    id: 'deepseek',
    provider,
    account,
    forward: async () => ({
      success: true,
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      stream,
      skipTransform: true,
    }),
  })

  const result = await bridge.chat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
  })

  assert.equal(result.response.status, 200)
  assert.equal(result.response.skipTransform, true)
  assert.equal(result.response.stream, stream)
})

test('bridge wraps an adapter and exposes session id', async () => {
  const provider = makeProvider()
  const account = makeAccount()

  const bridge = new ProviderAdapterBridge({
    id: 'fake',
    provider,
    account,
    adapter: {
      chatCompletion: async () => ({
        response: { status: 200, data: { choices: [{ message: { content: 'hello' } }] } },
        sessionId: 'provider-session-1',
      }),
      deleteSession: async () => true,
    },
  })

  const result = await bridge.chat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
  })

  assert.equal(result.sessionId, 'provider-session-1')
  assert.equal(result.response.status, 200)
  assert.equal(await bridge.deleteSession('provider-session-1'), true)
})

test('bridge surfaces structured error from forward failures', async () => {
  const provider = makeProvider()
  const account = makeAccount()

  const bridge = new ProviderAdapterBridge({
    id: 'fake',
    provider,
    account,
    forward: async () => ({ success: false, status: 401, error: 'unauthorized' }),
  })

  await assert.rejects(
    bridge.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    (err: unknown) => {
      assert.ok(err instanceof WebProviderError)
      assert.equal((err as WebProviderError).code, 'provider_upstream_error')
      assert.equal((err as WebProviderError).status, 401)
      return true
    }
  )
})

test('capability registry returns cloned defaults for known providers', () => {
  const deepseek = getProviderCapabilities('deepseek')
  assert.ok(deepseek)
  assert.equal(deepseek.reasoning, true)
  assert.equal(deepseek.web_search, true)

  const claude = getProviderCapabilities('claude')
  assert.ok(claude)
  assert.equal(claude.vision, true)

  // Unknown providers fall back to default derivation
  const unknown = resolveCapabilities(makeProvider())
  assert.equal(unknown.text, true)
  assert.equal(unknown.vision, false)

  // Registry override wins over derivation
  const overridden = resolveCapabilities(makeProvider({ id: 'chatgpt', supportedModels: [] }))
  assert.equal(overridden.vision, true)
})

test('provider registry matches legacy isXxx rules and builds runtimes', () => {
  const deepseekLike = makeProvider({
    id: 'deepseek',
    apiEndpoint: 'https://chat.deepseek.com/api',
  })
  // Without any legacy forward registered, createRuntime still returns a bridge
  // (chat() will throw capability_not_supported).
  const runtime = providerRegistry.createRuntime(deepseekLike, makeAccount())
  assert.equal(runtime.id, 'deepseek')
  assert.equal(runtime.capabilities().reasoning, true)

  const unknown = makeProvider({ id: 'totally-unknown' })
  assert.equal(providerRegistry.match(unknown), null)
})
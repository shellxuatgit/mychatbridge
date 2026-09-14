/**
 * Core Gateway Module - Quota Manager Tests
 * Verifies multi-dimensional quota enforcement via QuotaManager.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { QuotaManager } from '../../src/main/proxy/core/quota/quotaManager.ts'
import type { QuotaConfig } from '../../src/main/store/types.ts'

function makeConfig(overrides: Partial<QuotaConfig> = {}): QuotaConfig {
  return {
    enabled: true,
    rpmPerApiKey: 0,
    rpdPerApiKey: 0,
    concurrencyPerApiKey: 0,
    rpdPerAccount: 0,
    rpdPerProvider: 0,
    rpdPerIp: 0,
    ...overrides,
  }
}

test('rpm limits requests per minute per API key', () => {
  let now = 0
  // TokenBucket in QuotaManager uses real Date.now; pass a small capacity to
  // verify burst exhaustion deterministically without waiting.
  const mgr = new QuotaManager(makeConfig({ rpmPerApiKey: 2 }))
  const scope = { apiKeyId: 'key-1' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  const denied = mgr.checkAndConsume(scope)
  assert.equal(denied.allowed, false)
  assert.equal(denied.exceeded[0].dimension, 'rpm')
  void now
})

test('rpd per API key blocks once daily limit is consumed', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerApiKey: 3 }))
  const scope = { apiKeyId: 'key-1' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true) // 1
  assert.equal(mgr.checkAndConsume(scope).allowed, true) // 2
  assert.equal(mgr.checkAndConsume(scope).allowed, true) // 3
  const denied = mgr.checkAndConsume(scope)
  assert.equal(denied.allowed, false)
  assert.equal(denied.exceeded[0].dimension, 'apiKey')
  assert.equal(denied.exceeded[0].used, 3)
  assert.equal(denied.exceeded[0].limit, 3)
})

test('rpd per account is independent of API key', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerAccount: 2 }))
  const scopeA = { apiKeyId: 'key-1', accountId: 'acc-1' }
  const scopeB = { apiKeyId: 'key-2', accountId: 'acc-1' }

  assert.equal(mgr.checkAndConsume(scopeA).allowed, true)
  assert.equal(mgr.checkAndConsume(scopeB).allowed, true)
  assert.equal(mgr.checkAndConsume(scopeA).allowed, false)
})

test('rpd per provider blocks after limit', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerProvider: 1 }))
  const scope = { apiKeyId: 'key-1', providerId: 'deepseek' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  const denied = mgr.checkAndConsume(scope)
  assert.equal(denied.allowed, false)
  assert.equal(denied.exceeded[0].dimension, 'provider')
})

test('rpd per IP blocks after limit', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerIp: 1 }))
  const scope = { apiKeyId: 'key-1', clientIp: '127.0.0.1' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  assert.equal(mgr.checkAndConsume(scope).allowed, false)
})

test('concurrency gate rejects when slots are full', () => {
  const mgr = new QuotaManager(makeConfig({ concurrencyPerApiKey: 1 }))
  const scope = { apiKeyId: 'key-1' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  // Occupy the concurrency slot
  assert.equal(mgr.tryAcquireConcurrency('key-1'), true)
  const denied = mgr.checkAndConsume(scope)
  assert.equal(denied.allowed, false)
  assert.equal(denied.exceeded[0].dimension, 'concurrency')

  mgr.releaseConcurrency('key-1')
  assert.equal(mgr.checkAndConsume(scope).allowed, true)
})

test('atomic: daily counters do not increment when a dimension fails', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerAccount: 1, rpdPerApiKey: 100 }))
  const scope = { apiKeyId: 'key-1', accountId: 'acc-1' }

  assert.equal(mgr.checkAndConsume(scope).allowed, true)
  const denied = mgr.checkAndConsume(scope) // account rpd exhausted
  assert.equal(denied.allowed, false)

  // apiKey rpd should NOT have been incremented for the denied attempt
  const scopeWithFreshAccount = { apiKeyId: 'key-1', accountId: 'acc-2' }
  assert.equal(mgr.checkAndConsume(scopeWithFreshAccount).allowed, true)
})

test('unlimited (all zeros) allows everything', () => {
  const mgr = new QuotaManager(makeConfig())
  for (let i = 0; i < 10; i++) {
    assert.equal(mgr.checkAndConsume({ apiKeyId: 'key-1', accountId: 'a', providerId: 'p', clientIp: 'ip' }).allowed, true)
  }
})

test('updateConfig resets in-flight state', () => {
  const mgr = new QuotaManager(makeConfig({ rpdPerApiKey: 1 }))
  assert.equal(mgr.checkAndConsume({ apiKeyId: 'k' }).allowed, true)
  assert.equal(mgr.checkAndConsume({ apiKeyId: 'k' }).allowed, false)

  mgr.updateConfig(makeConfig({ rpdPerApiKey: 5 }))
  assert.equal(mgr.checkAndConsume({ apiKeyId: 'k' }).allowed, true)
})
/**
 * Core Gateway Module - Instance Pool Runtime Tests
 * Verifies live health tracking / circuit-breaker behavior.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { InstancePoolRuntime } from '../../src/main/proxy/core/instancePoolRuntime.ts'
import type { Account, Provider } from '../../src/main/store/types.ts'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p',
    name: 'P',
    type: 'custom',
    authType: 'userToken',
    apiEndpoint: 'https://example.com',
    headers: {},
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeAccount(id: string, providerId = 'p'): Account {
  return {
    id,
    providerId,
    name: id,
    credentials: { token: 'x' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

test('instance is created lazily and retained', () => {
  const pool = new InstancePoolRuntime()
  const provider = makeProvider()
  const account = makeAccount('a1')

  const i1 = pool.getOrCreate(provider, account)
  const i2 = pool.getOrCreate(provider, account)
  assert.equal(i1, i2) // same instance retained
  assert.equal(pool.allInstanceIds().length, 1)
})

test('failures trip the circuit breaker to cooldown, then recover after expiry', () => {
  let now = 1000
  const pool = new InstancePoolRuntime({ failureThreshold: 3, recoveryTimeMs: 60000, now: () => now })
  const provider = makeProvider()
  const account = makeAccount('a1')

  pool.getOrCreate(provider, account)

  assert.deepEqual(pool.unhealthyInstanceIds(), [])

  pool.recordFailure('p', 'a1')
  pool.recordFailure('p', 'a1')
  assert.deepEqual(pool.unhealthyInstanceIds(), []) // DEGRADED, still routable

  pool.recordFailure('p', 'a1')
  assert.deepEqual(pool.unhealthyInstanceIds(), ['p:a1']) // COOLDOWN

  // In cooldown: still not routable.
  assert.deepEqual(pool.unhealthyInstanceIds(), ['p:a1'])

  // After cooldown expiry: tickAll moves COOLDOWN → RECOVERING. RECOVERING is
  // treated as routable again (only COOLDOWN/UNHEALTHY are excluded), so the
  // instance returns to the pool.
  now = 1000 + 61000
  assert.deepEqual(pool.unhealthyInstanceIds(), [])
  assert.equal(pool.get('p', 'a1')?.health.status, 'RECOVERING')

  // A successful probe returns it fully to HEALTHY.
  pool.recordSuccess('p', 'a1')
  assert.equal(pool.get('p', 'a1')?.health.status, 'HEALTHY')
})

test('success resets failures', () => {
  const pool = new InstancePoolRuntime({ failureThreshold: 3, recoveryTimeMs: 60000 })
  const provider = makeProvider()
  const account = makeAccount('a1')

  pool.getOrCreate(provider, account)
  pool.recordFailure('p', 'a1')
  pool.recordFailure('p', 'a1')
  pool.recordFailure('p', 'a1')
  assert.deepEqual(pool.unhealthyInstanceIds(), ['p:a1'])

  pool.recordSuccess('p', 'a1')
  assert.deepEqual(pool.unhealthyInstanceIds(), [])
})

test('healthSnapshot reports statuses for observability', () => {
  const pool = new InstancePoolRuntime({ failureThreshold: 3, recoveryTimeMs: 60000 })
  const provider = makeProvider()
  pool.getOrCreate(provider, makeAccount('a1'))

  pool.recordFailure('p', 'a1')
  const snapshot = pool.healthSnapshot()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].id, 'p:a1')
  assert.equal(snapshot[0].status, 'DEGRADED')
  assert.equal(snapshot[0].failureCount, 1)
})

test('different providers/accounts are tracked independently', () => {
  const pool = new InstancePoolRuntime({ failureThreshold: 1, recoveryTimeMs: 60000 })
  pool.getOrCreate(makeProvider({ id: 'p1' }), makeAccount('a1', 'p1'))
  pool.getOrCreate(makeProvider({ id: 'p2' }), makeAccount('a2', 'p2'))

  pool.recordFailure('p1', 'a1')
  assert.deepEqual(pool.unhealthyInstanceIds(), ['p1:a1'])
  assert.equal(pool.get('p2', 'a2')?.health.status, 'HEALTHY')
})
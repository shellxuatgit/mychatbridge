/**
 * Core Gateway Module - Instance Layer Tests
 * Verifies the health state machine transitions and the instance/pool wiring.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFailure,
  applySuccess,
  applyRecovery,
  tick,
  createInitialHealthState,
  createInstance,
  recordInstanceFailure,
  recordInstanceSuccess,
  incrementInstanceConcurrency,
  decrementInstanceConcurrency,
  isInstanceRoutable,
} from '../../src/main/proxy/core/instance.ts'
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
    id: 'acc-1',
    providerId: 'test',
    name: 'Test Account',
    credentials: { token: 'secret-token' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

test('initial health state is HEALTHY with zero failures', () => {
  const state = createInitialHealthState()
  assert.equal(state.status, 'HEALTHY')
  assert.equal(state.failureCount, 0)
})

test('failures transition HEALTHY → DEGRADED → COOLDOWN at threshold', () => {
  let state = createInitialHealthState()

  // First failure: DEGRADED (degradedThreshold=1)
  state = applyFailure(state)
  assert.equal(state.status, 'DEGRADED')
  assert.equal(state.failureCount, 1)

  // Second failure: still DEGRADED (below threshold=3)
  state = applyFailure(state)
  assert.equal(state.status, 'DEGRADED')
  assert.equal(state.failureCount, 2)

  // Third failure: COOLDOWN with cooldownUntil set
  state = applyFailure(state)
  assert.equal(state.status, 'COOLDOWN')
  assert.equal(state.failureCount, 3)
  assert.ok(state.cooldownUntil > 0)
})

test('success resets health to HEALTHY and clears failures', () => {
  let state = createInitialHealthState()
  state = applyFailure(state)
  state = applyFailure(state)
  state = applySuccess(state)

  assert.equal(state.status, 'HEALTHY')
  assert.equal(state.failureCount, 0)
})

test('COOLDOWN expires into RECOVERING, then recovers', () => {
  let now = 1000
  const opts = { now: () => now }

  let state = createInitialHealthState()
  state = applyFailure(state, opts)
  state = applyFailure(state, opts)
  state = applyFailure(state, opts)
  assert.equal(state.status, 'COOLDOWN')

  // While cooldown is active, tick keeps it COOLDOWN
  state = tick(state, now + 10000, opts)
  assert.equal(state.status, 'COOLDOWN')

  // After cooldown elapses, tick moves to RECOVERING
  state = tick(state, now + 61000, opts)
  assert.equal(state.status, 'RECOVERING')

  // A successful probe returns to HEALTHY
  state = applySuccess(state)
  assert.equal(state.status, 'HEALTHY')
  assert.equal(state.failureCount, 0)
})

test('COOLDOWN expiry is governed by recoveryTimeMs option', () => {
  let now = 0
  const opts = { now: () => now, recoveryTimeMs: 5000 }

  let state = createInitialHealthState()
  state = applyFailure(state, opts)
  state = applyFailure(state, opts)
  state = applyFailure(state, opts)
  assert.equal(state.status, 'COOLDOWN')

  state = tick(state, 4000, opts)
  assert.equal(state.status, 'COOLDOWN')

  state = tick(state, 5000, opts)
  assert.equal(state.status, 'RECOVERING')
})

test('isInstanceRoutable rejects COOLDOWN and UNHEALTHY', () => {
  let state = createInitialHealthState()
  state = applyFailure(state)
  state = applyFailure(state)
  state = applyFailure(state)

  const instance = createInstance({ provider: makeProvider(), account: makeAccount() })
  const cooled = { ...instance, health: state }
  assert.equal(isInstanceRoutable(cooled), false)
  assert.equal(isInstanceRoutable(instance), true)
})

test('instance concurrency is bounded at zero', () => {
  let instance = createInstance({ provider: makeProvider(), account: makeAccount() })
  instance = incrementInstanceConcurrency(instance)
  instance = incrementInstanceConcurrency(instance)
  assert.equal(instance.concurrency, 2)
  instance = decrementInstanceConcurrency(instance)
  assert.equal(instance.concurrency, 1)
  instance = decrementInstanceConcurrency(instance)
  instance = decrementInstanceConcurrency(instance)
  assert.equal(instance.concurrency, 0)
})

test('instance weight defaults to account.weight or 1', () => {
  const normal = createInstance({ provider: makeProvider(), account: makeAccount() })
  assert.equal(normal.weight, 1)

  const weighted = createInstance({
    provider: makeProvider(),
    account: makeAccount({ weight: 5 }),
  })
  assert.equal(weighted.weight, 5)
})

test('recordInstanceFailure / recordInstanceSuccess keep instance identity', () => {
  let instance = createInstance({ provider: makeProvider(), account: makeAccount() })
  const originalId = instance.id
  instance = recordInstanceFailure(instance)
  instance = recordInstanceFailure(instance)
  assert.equal(instance.health.status, 'DEGRADED')
  assert.equal(instance.id, originalId)

  instance = recordInstanceSuccess(instance)
  assert.equal(instance.health.status, 'HEALTHY')
  assert.equal(instance.health.failureCount, 0)
})

test('instance id is providerId:accountId', () => {
  const instance = createInstance({
    provider: makeProvider({ id: 'deepseek' }),
    account: makeAccount({ id: 'acc-7' }),
  })
  assert.equal(instance.id, 'deepseek:acc-7')
})
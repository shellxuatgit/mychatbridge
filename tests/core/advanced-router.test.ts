/**
 * Core Gateway Module - Advanced Routing Strategy Tests
 * Verifies cost-aware and least-load strategies, and the expanded registry.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { router, Router } from '../../src/main/proxy/core/router/index.ts'
import { CostAwareStrategy } from '../../src/main/proxy/core/router/strategies/costAware.ts'
import { LeastLoadStrategy } from '../../src/main/proxy/core/router/strategies/leastLoad.ts'
import { createInstance, recordInstanceLatency } from '../../src/main/proxy/core/instance.ts'
import type { RoutableCandidate } from '../../src/main/proxy/core/instancePool.ts'
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

function makeAccount(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    providerId: 'p',
    name: id,
    credentials: { token: 'x' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function candidate(providerId: string, accountId: string, opts: { cost?: number; concurrency?: number; latencyMs?: number } = {}): RoutableCandidate {
  let instance = createInstance({
    provider: makeProvider({ id: providerId, name: providerId }),
    account: makeAccount(accountId, { providerId, costPerRequest: opts.cost }),
  })
  if (opts.concurrency) {
    for (let i = 0; i < opts.concurrency; i++) {
      instance = { ...instance, concurrency: instance.concurrency + 1 }
    }
  }
  if (opts.latencyMs !== undefined) {
    instance = recordInstanceLatency(instance, opts.latencyMs)
  }
  return { instance, actualModel: 'm' }
}

const ctx = { model: 'm' }

test('cost-aware prefers the lowest cost instance', () => {
  const strategy = new CostAwareStrategy()
  const candidates = [
    candidate('p', 'expensive', { cost: 5 }),
    candidate('p', 'cheap', { cost: 1 }),
    candidate('p', 'mid', { cost: 2 }),
  ]
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'cheap')
})

test('cost-aware breaks ties by concurrency then latency', () => {
  const strategy = new CostAwareStrategy()
  const equalCost = [
    candidate('p', 'busy', { cost: 1, concurrency: 5 }),
    candidate('p', 'idle', { cost: 1 }),
  ]
  assert.equal(strategy.select(equalCost, ctx)?.instance.account.id, 'idle')

  const tie = [
    candidate('p', 'slow', { cost: 1, latencyMs: 2000 }),
    candidate('p', 'fast', { cost: 1, latencyMs: 300 }),
  ]
  assert.equal(strategy.select(tie, ctx)?.instance.account.id, 'fast')
})

test('cost-aware defaults cost to 1 when unspecified', () => {
  const strategy = new CostAwareStrategy()
  const candidates = [candidate('p', 'a'), candidate('p', 'b', { cost: 3 })]
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'a')
})

test('least-load prefers the instance with fewest in-flight requests', () => {
  const strategy = new LeastLoadStrategy()
  const candidates = [
    candidate('p', 'busy', { concurrency: 4 }),
    candidate('p', 'free', { concurrency: 1 }),
  ]
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'free')
})

test('least-load breaks ties by EWMA latency', () => {
  const strategy = new LeastLoadStrategy()
  const candidates = [
    candidate('p', 'slow', { latencyMs: 1500 }),
    candidate('p', 'fast', { latencyMs: 200 }),
  ]
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'fast')
})

test('router registry resolves the new strategy ids', () => {
  const r = new Router()
  assert.equal(r.resolve('cost-aware').id, 'cost-aware')
  assert.equal(r.resolve('least-load').id, 'least-load')
  // Unknown still falls back to round-robin.
  assert.equal(r.resolve('does-not-exist').id, 'round-robin')
})

test('singleton router lists all strategies', () => {
  const ids = router.list()
  assert.ok(ids.includes('cost-aware'))
  assert.ok(ids.includes('least-load'))
  assert.ok(ids.includes('weighted'))
})

test('recordInstanceLatency computes an EWMA', () => {
  let instance = createInstance({
    provider: makeProvider(),
    account: makeAccount('a', { providerId: 'p' }),
  })
  instance = recordInstanceLatency(instance, 100)
  instance = recordInstanceLatency(instance, 300)
  // alpha=0.2: 0.2*300 + 0.8*100 = 140
  assert.ok(Math.abs(instance.ewmaLatencyMs - 140) < 0.001)
})

test('createInstance exposes cost from account.costPerRequest', () => {
  const instance = createInstance({
    provider: makeProvider(),
    account: makeAccount('a', { providerId: 'p', costPerRequest: 2.5 }),
  })
  assert.equal(instance.cost, 2.5)

  const defaultInstance = createInstance({
    provider: makeProvider(),
    account: makeAccount('b', { providerId: 'p' }),
  })
  assert.equal(defaultInstance.cost, 1)
})
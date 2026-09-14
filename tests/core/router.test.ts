/**
 * Core Gateway Module - Router Strategy Tests
 * Verifies the pluggable routing strategies and the registry fallback.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { router, Router } from '../../src/main/proxy/core/router/index.ts'
import { RoundRobinStrategy } from '../../src/main/proxy/core/router/strategies/roundRobin.ts'
import { FillFirstStrategy } from '../../src/main/proxy/core/router/strategies/fillFirst.ts'
import { FailoverStrategy } from '../../src/main/proxy/core/router/strategies/failover.ts'
import { WeightedStrategy } from '../../src/main/proxy/core/router/strategies/weighted.ts'
import { createInstance } from '../../src/main/proxy/core/instance.ts'
import type { GatewayInstance } from '../../src/main/proxy/core/instance.ts'
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

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'a',
    providerId: 'p',
    name: 'A',
    credentials: { token: 'x' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function candidate(providerId: string, accountId: string, opts: { weight?: number; todayUsed?: number; lastUsed?: number; status?: string } = {}): RoutableCandidate {
  const instance = createInstance({
    provider: makeProvider({ id: providerId, name: providerId }),
    account: makeAccount({
      id: accountId,
      providerId,
      weight: opts.weight,
      todayUsed: opts.todayUsed,
      lastUsed: opts.lastUsed,
      status: (opts.status as any) ?? 'active',
    }),
  })
  return { instance, actualModel: 'm' }
}

const ctx = { model: 'm' }

test('round-robin cycles through candidates', () => {
  const strategy = new RoundRobinStrategy()
  const candidates = [candidate('p1', 'a1'), candidate('p2', 'a2'), candidate('p3', 'a3')]

  const first = strategy.select(candidates, ctx)
  const second = strategy.select(candidates, ctx)
  const third = strategy.select(candidates, ctx)
  const fourth = strategy.select(candidates, ctx)

  assert.equal(first?.instance.account.id, 'a1')
  assert.equal(second?.instance.account.id, 'a2')
  assert.equal(third?.instance.account.id, 'a3')
  assert.equal(fourth?.instance.account.id, 'a1') // wraps
})

test('round-robin returns null for empty candidates', () => {
  const strategy = new RoundRobinStrategy()
  assert.equal(strategy.select([], ctx), null)
})

test('fill-first picks the account with least usage, then oldest lastUsed', () => {
  const strategy = new FillFirstStrategy()
  const candidates = [
    candidate('p', 'a1', { todayUsed: 5, lastUsed: 200 }),
    candidate('p', 'a2', { todayUsed: 2, lastUsed: 100 }),
    candidate('p', 'a3', { todayUsed: 2, lastUsed: 50 }),
  ]
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'a3')
})

test('failover prefers healthy candidates, then fewest failures', () => {
  const strategy = new FailoverStrategy()
  const c1 = candidate('p', 'a1')
  const c2 = candidate('p', 'a2')
  const c3 = candidate('p', 'a3')

  strategy.recordFailure(c2.instance.id)
  strategy.recordFailure(c2.instance.id)

  const selected = strategy.select([c1, c2, c3], ctx)
  assert.equal(selected?.instance.account.id, 'a1')
})

test('weighted strategy distributes by weight deterministically', () => {
  // Seeded deterministic random: returns values in [0, 1)
  const seq = [0.1, 0.9, 0.5, 0.0, 0.99]
  let i = 0
  const random = () => seq[i++ % seq.length]

  const strategy = new WeightedStrategy(random)
  const candidates = [
    candidate('p', 'heavy', { weight: 10 }),
    candidate('p', 'light', { weight: 1 }),
  ]

  // roll = 0.1 * 11 = 1.1 → heavy (1.1 - 10 < 0)
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'heavy')
  // roll = 0.9 * 11 = 9.9 → after heavy weight (9.9-10 < 0) still heavy
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'heavy')
  // roll = 0.5 * 11 = 5.5 → heavy
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'heavy')
  // roll = 0.0 → heavy
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'heavy')
  // roll = 0.99 * 11 = 10.89 → light (10.89 - 10 >= 0, 10.89 - 11 < 0)
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'light')
})

test('weighted strategy ignores invalid weights (defaults to 1)', () => {
  const strategy = new WeightedStrategy(() => 0)
  const candidates = [
    candidate('p', 'a1', { weight: -1 }),
    candidate('p', 'a2', { weight: 0 }),
    candidate('p', 'a3', { weight: 5 }),
  ]
  // roll=0 always picks first candidate
  assert.equal(strategy.select(candidates, ctx)?.instance.account.id, 'a1')
})

test('router resolves known and unknown strategy ids', () => {
  const r = new Router()
  assert.equal(r.resolve('round-robin').id, 'round-robin')
  assert.equal(r.resolve('weighted').id, 'weighted')
  // Unknown id falls back to round-robin (backward compatible)
  assert.equal(r.resolve('does-not-exist').id, 'round-robin')
})

test('router.route selects an instance and reports strategy', () => {
  const r = new Router()
  const candidates = [candidate('p', 'a1'), candidate('p', 'a2')]
  const result = r.route('round-robin', candidates, ctx)
  assert.ok(result)
  assert.equal(result.strategy, 'round-robin')
  assert.ok(result.instance instanceof Object)
  assert.equal(result.instance.account.id, 'a1')
})

test('router.route returns null when no candidates', () => {
  const r = new Router()
  assert.equal(r.route('round-robin', [], ctx), null)
})

test('singleton router lists all strategies', () => {
  const ids = router.list()
  assert.ok(ids.includes('round-robin'))
  assert.ok(ids.includes('fill-first'))
  assert.ok(ids.includes('failover'))
  assert.ok(ids.includes('weighted'))
})
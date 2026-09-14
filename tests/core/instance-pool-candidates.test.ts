/**
 * Core Gateway Module - Instance Pool Candidate Tests
 * Verifies the candidate generator supports runtime health overrides and
 * explicit instance exclusion (for rerouting after a failure).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { getCandidateInstances } from '../../src/main/proxy/core/instancePool.ts'
import type { PoolData } from '../../src/main/proxy/core/instancePool.ts'
import type { Account, AppConfig, EffectiveModel, Provider } from '../../src/main/store/types.ts'

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
    supportedModels: ['m'],
    ...overrides,
  }
}

function makeAccount(id: string, providerId = 'p', overrides: Partial<Account> = {}): Account {
  return {
    id,
    providerId,
    name: id,
    credentials: { token: 'x' },
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makePoolData(providers: Provider[], accounts: Account[]): PoolData {
  return {
    getProviders: () => providers,
    getAccounts: (providerId: string) => accounts.filter(a => a.providerId === providerId),
    getEffectiveModels: () => [],
    getConfig: () => ({ modelMappings: {} }) as Pick<AppConfig, 'modelMappings'>,
  }
}

test('healthOverride marks an instance as COOLDOWN and it is excluded for routing', () => {
  const data = makePoolData([makeProvider()], [makeAccount('a1'), makeAccount('a2')])

  const candidates = getCandidateInstances(data, 'm', {
    excludeCooldown: true,
    healthOverride: (id) => {
      if (id === 'p:a1') return 'COOLDOWN'
      return 'HEALTHY'
    },
  })

  const accountIds = candidates.map(c => c.instance.account.id)
  assert.deepEqual(accountIds, ['a2'])
})

test('healthOverride does not mutate instances when undefined', () => {
  const data = makePoolData([makeProvider()], [makeAccount('a1'), makeAccount('a2')])

  const candidates = getCandidateInstances(data, 'm', {
    excludeCooldown: true,
    healthOverride: () => undefined,
  })

  assert.equal(candidates.length, 2)
  assert.ok(candidates.every(c => c.instance.health.status === 'HEALTHY'))
})

test('excludeInstanceIds removes specific instances for rerouting', () => {
  const data = makePoolData([makeProvider()], [makeAccount('a1'), makeAccount('a2'), makeAccount('a3')])

  const candidates = getCandidateInstances(data, 'm', {
    excludeInstanceIds: ['p:a2'],
  })

  const accountIds = candidates.map(c => c.instance.account.id)
  assert.deepEqual(accountIds, ['a1', 'a3'])
})

test('excludeInstanceIds works together with preferredAccountId (hard pin)', () => {
  const data = makePoolData([makeProvider()], [makeAccount('a1'), makeAccount('a2')])

  // preferredAccountId is a hard pin at the pool level: when the pinned account
  // is excluded, the candidate set is empty. The soft fallback to other
  // accounts happens at the loadbalancer/router layer (it drops the preference
  // when the pinned instance is excluded).
  const candidates = getCandidateInstances(data, 'm', {
    preferredAccountId: 'a1',
    excludeInstanceIds: ['p:a1'],
  })

  assert.deepEqual(candidates.map(c => c.instance.account.id), [])
})

test('excludeInstanceIds with preferred present still yields the preferred', () => {
  const data = makePoolData([makeProvider()], [makeAccount('a1'), makeAccount('a2')])

  const candidates = getCandidateInstances(data, 'm', {
    preferredAccountId: 'a1',
    excludeInstanceIds: ['p:a2'],
  })

  assert.deepEqual(candidates.map(c => c.instance.account.id), ['a1'])
})
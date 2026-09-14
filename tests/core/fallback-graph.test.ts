/**
 * Core Gateway Module - Fallback Graph Tests
 * Verifies the error-type → next-hop decision matrix.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FallbackGraph,
  resolveFallback,
  DEFAULT_FALLBACK_GRAPH,
} from '../../src/main/proxy/core/fallbackGraph.ts'
import type { FallbackGraphConfig } from '../../src/main/proxy/core/fallbackGraph.ts'

function ctx(overrides: any = {}): any {
  return {
    failedProviderId: 'p1',
    failedAccountId: 'a1',
    errorClass: 'server_error',
    totalAttempts: 1,
    alreadySwitchedAccount: false,
    ...overrides,
  }
}

test('default graph maps each error class to an action', () => {
  assert.equal(DEFAULT_FALLBACK_GRAPH.auth_error, 'next_provider')
  assert.equal(DEFAULT_FALLBACK_GRAPH.rate_limited, 'next_provider')
  assert.equal(DEFAULT_FALLBACK_GRAPH.server_error, 'next_account_then_provider')
  assert.equal(DEFAULT_FALLBACK_GRAPH.timeout, 'next_provider')
  assert.equal(DEFAULT_FALLBACK_GRAPH.invalid_request, 'abort')
  assert.equal(DEFAULT_FALLBACK_GRAPH.unknown, 'next_account_then_provider')
})

test('resolve returns the mapped action', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  assert.equal(g.resolve('auth_error'), 'next_provider')
  assert.equal(g.resolve('invalid_request'), 'abort')
})

test('invalid_request aborts immediately', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, ctx({ errorClass: 'invalid_request' }))
  assert.equal(d.abort, true)
  assert.equal(d.action, 'abort')
})

test('server_error tries another account first (same provider)', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, ctx({ errorClass: 'server_error', alreadySwitchedAccount: false }))
  assert.equal(d.abort, false)
  assert.equal(d.action, 'next_account_then_provider')
  assert.equal(d.clearPreferredProvider, false)
  assert.equal(d.excludeInstance, true)
})

test('server_error escalates to next provider after account switch', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, ctx({ errorClass: 'server_error', alreadySwitchedAccount: true }))
  assert.equal(d.action, 'next_provider')
  assert.equal(d.clearPreferredProvider, true)
})

test('auth_error clears preferred provider (try a different provider)', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, ctx({ errorClass: 'auth_error' }))
  assert.equal(d.action, 'next_provider')
  assert.equal(d.clearPreferredProvider, true)
  assert.equal(d.excludeInstance, true)
})

test('total retry budget exhaustion aborts', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 2 })
  const d = resolveFallback(g, ctx({ errorClass: 'server_error', totalAttempts: 2 }))
  assert.equal(d.abort, true)
})

test('config node overrides merge with the default graph', () => {
  const g = new FallbackGraph({
    enabled: true,
    maxTotalRetries: 3,
    nodes: { auth_error: 'abort' },
  })
  assert.equal(g.resolve('auth_error'), 'abort')
  // Other classes keep defaults
  assert.equal(g.resolve('server_error'), 'next_account_then_provider')
})

test('disabled graph reports isEnabled false', () => {
  const g = new FallbackGraph({ enabled: false, maxTotalRetries: 3 })
  assert.equal(g.isEnabled(), false)
})

test('unknown error class falls back to next_account_then_provider', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  assert.equal(g.resolve('unknown' as any), 'next_account_then_provider')
})
/**
 * Core Gateway Module - Quota Middleware Tests
 * Verifies the Koa middleware gates requests and returns 429 on quota
 * exhaustion, using a minimal fake context.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { extractQuotaScope, QuotaMiddleware } from '../../src/main/proxy/middleware/quota.ts'
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

function fakeCtx(overrides: any = {}): any {
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    ip: '127.0.0.1',
    state: { apiKey: { id: 'key-1', name: 'k1' } },
    status: 200,
    body: null,
    set: (name: string, value: string) => { overrides.headersSet = { ...overrides.headersSet, [name]: value } },
    ...overrides,
  }
}

test('extractQuotaScope reads apiKey from ctx.state', () => {
  const ctx = fakeCtx()
  const scope = extractQuotaScope(ctx)
  assert.equal(scope.apiKeyId, 'key-1')
  assert.equal(scope.clientIp, '127.0.0.1')
})

test('middleware passes through when quota allows', async () => {
  const mw = new QuotaMiddleware(makeConfig({ rpdPerApiKey: 10 }))
  const ctx = fakeCtx()
  let called = false

  await mw.middleware()(ctx, async () => { called = true })

  assert.equal(called, true)
  assert.equal(ctx.status, 200)
})

test('middleware returns 429 when daily quota is exhausted', async () => {
  const mw = new QuotaMiddleware(makeConfig({ rpdPerApiKey: 1 }))
  const ctx1 = fakeCtx()
  let called = false
  await mw.middleware()(ctx1, async () => { called = true })
  assert.equal(called, true)

  // Second request: quota exhausted (same apiKey + daily counter)
  const ctx2 = fakeCtx()
  let called2 = false
  await mw.middleware()(ctx2, async () => { called2 = true })

  assert.equal(called2, false)
  assert.equal(ctx2.status, 429)
  assert.equal(ctx2.body.error.code, 'rate_limit_exceeded')
})

test('middleware returns 429 on concurrency limit', async () => {
  const mw = new QuotaMiddleware(makeConfig({ concurrencyPerApiKey: 1 }))

  // Occupy the single concurrency slot for the API key BEFORE the request.
  assert.equal(mw['manager'].tryAcquireConcurrency('key-1'), true)

  const ctx = fakeCtx()
  let called = false
  await mw.middleware()(ctx, async () => { called = true })

  assert.equal(called, false)
  assert.equal(ctx.status, 429)
  assert.equal(ctx.body.error.code, 'concurrency_limit_exceeded')
})

test('middleware releases the concurrency slot on success', async () => {
  const mw = new QuotaMiddleware(makeConfig({ concurrencyPerApiKey: 1 }))
  const ctx = fakeCtx()
  await mw.middleware()(ctx, async () => undefined)

  // Slot should be released back; a second request is allowed.
  const ctx2 = fakeCtx()
  let called = false
  await mw.middleware()(ctx2, async () => { called = true })
  assert.equal(called, true)
})

test('non-chat paths are not rate limited', async () => {
  const mw = new QuotaMiddleware(makeConfig({ rpdPerApiKey: 0 }))
  const ctx = fakeCtx({ path: '/v1/models', method: 'GET' })
  let called = false
  await mw.middleware()(ctx, async () => { called = true })
  assert.equal(called, true)
})

test('updateConfig applies new limits', async () => {
  const mw = new QuotaMiddleware(makeConfig({ rpdPerApiKey: 1 }))
  const ctx1 = fakeCtx()
  await mw.middleware()(ctx1, async () => undefined)
  const ctx2 = fakeCtx()
  await mw.middleware()(ctx2, async () => undefined)
  assert.equal(ctx2.status, 429)

  mw.updateConfig(makeConfig({ rpdPerApiKey: 100 }))
  const ctx3 = fakeCtx()
  let called = false
  await mw.middleware()(ctx3, async () => { called = true })
  assert.equal(called, true)
})
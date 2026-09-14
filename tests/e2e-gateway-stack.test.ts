/**
 * E2E Gateway Stack Test (Standalone)
 *
 * Tests the full gateway stack by booting a minimal Koa server inline,
 * making real HTTP requests, and verifying responses. No Electron required.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import Koa from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'

import { QuotaMiddleware } from '../src/main/proxy/middleware/quota.ts'
import { FallbackGraph, resolveFallback } from '../src/main/proxy/core/fallbackGraph.ts'
import { classifyError } from '../src/main/proxy/core/errorClassification.ts'
import { aggregate, aggregateRace, aggregateParallel, aggregateVote } from '../src/main/proxy/core/multiLlmAggregator.ts'
import { createInstance, recordInstanceLatency, recordInstanceFailure, recordInstanceSuccess } from '../src/main/proxy/core/instance.ts'
import { router } from '../src/main/proxy/core/router/index.ts'
import { getCandidateInstances } from '../src/main/proxy/core/instancePool.ts'
import type { PoolData } from '../src/main/proxy/core/instancePool.ts'
import type { Provider, Account, AppConfig } from '../src/main/store/types.ts'
import type { ProviderResult } from '../src/main/proxy/core/multiLlm.ts'

// ─── Fake store ────────────────────────────────────────────────────────
const fakeProviders: Provider[] = [
  { id: 'deepseek', name: 'DeepSeek', type: 'builtin', authType: 'userToken', apiEndpoint: 'https://chat.deepseek.com/api', headers: {}, enabled: true, createdAt: Date.now(), updatedAt: Date.now(), supportedModels: ['deepseek-v4-flash'] },
  { id: 'glm', name: 'GLM', type: 'builtin', authType: 'refresh_token', apiEndpoint: 'https://chatglm.cn', headers: {}, enabled: true, createdAt: Date.now(), updatedAt: Date.now(), supportedModels: ['GLM-5.1'] },
]
const fakeAccounts: Account[] = [
  { id: 'acc-ds-1', providerId: 'deepseek', name: 'DS1', credentials: { token: 't1' }, status: 'active', createdAt: Date.now(), updatedAt: Date.now(), costPerRequest: 1, weight: 3 },
  { id: 'acc-ds-2', providerId: 'deepseek', name: 'DS2', credentials: { token: 't2' }, status: 'active', createdAt: Date.now(), updatedAt: Date.now(), costPerRequest: 3, weight: 1 },
  { id: 'acc-glm-1', providerId: 'glm', name: 'GLM1', credentials: { token: 'g1' }, status: 'active', createdAt: Date.now(), updatedAt: Date.now(), costPerRequest: 1, weight: 1 },
]
const fakePool: PoolData = {
  getProviders: () => fakeProviders,
  getAccounts: (pid) => fakeAccounts.filter(a => a.providerId === pid),
  getEffectiveModels: () => [],
  getConfig: () => ({ modelMappings: {} }) as Pick<AppConfig, 'modelMappings'>,
}

// ─── Unit tests (no server needed) ─────────────────────────────────────

test('FallbackGraph aborts on invalid_request', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, {
    failedProviderId: 'p1', failedAccountId: 'a1',
    errorClass: 'invalid_request', totalAttempts: 1, alreadySwitchedAccount: false,
  })
  assert.equal(d.abort, true)
})

test('FallbackGraph escalates to next_provider after account switch', () => {
  const g = new FallbackGraph({ enabled: true, maxTotalRetries: 3 })
  const d = resolveFallback(g, {
    failedProviderId: 'p1', failedAccountId: 'a1',
    errorClass: 'server_error', totalAttempts: 2, alreadySwitchedAccount: true,
  })
  assert.equal(d.clearPreferredProvider, true)
})

test('classifyError handles 401 as auth_error', () => {
  const e = classifyError({ status: 401 })
  assert.equal(e.errorClass, 'auth_error')
  assert.equal(e.retryable, true)
})

test('classifyError handles 5xx as server_error', () => {
  const e = classifyError({ status: 502 })
  assert.equal(e.errorClass, 'server_error')
  assert.equal(e.retryable, true)
})

test('recordInstanceFailure + EWMA latency + health state', () => {
  let inst = createInstance({ provider: fakeProviders[0], account: fakeAccounts[0] })
  inst = recordInstanceLatency(inst, 100)
  inst = recordInstanceLatency(inst, 300)
  assert.ok(inst.ewmaLatencyMs > 0)
  assert.equal(inst.cost, 1)

  inst = recordInstanceFailure(inst, { failureThreshold: 3, recoveryTimeMs: 60000, degradedThreshold: 1 })
  inst = recordInstanceFailure(inst)
  assert.equal(inst.health.status, 'DEGRADED')
  inst = recordInstanceFailure(inst)
  assert.equal(inst.health.status, 'COOLDOWN')

  inst = recordInstanceSuccess(inst)
  assert.equal(inst.health.status, 'HEALTHY')
})

test('getCandidateInstances returns enabled provider accounts', () => {
  const candidates = getCandidateInstances(fakePool, 'deepseek-v4-flash', {})
  assert.ok(candidates.length >= 2)
})

test('router cost-aware picks cheapest', () => {
  const candidates = getCandidateInstances(fakePool, 'deepseek-v4-flash', {})
  const result = router.route('cost-aware', candidates, { model: 'deepseek-v4-flash' })
  assert.ok(result)
  assert.equal(result!.strategy, 'cost-aware')
  assert.equal(result!.instance.account.id, 'acc-ds-1')
})

test('router weighted works', () => {
  const candidates = getCandidateInstances(fakePool, 'deepseek-v4-flash', {})
  const result = router.route('weighted', candidates, { model: 'deepseek-v4-flash' })
  assert.ok(result)
  assert.equal(result!.strategy, 'weighted')
})

test('router least-load works', () => {
  const candidates = getCandidateInstances(fakePool, 'deepseek-v4-flash', {})
  const result = router.route('least-load', candidates, { model: 'deepseek-v4-flash' })
  assert.ok(result)
  assert.equal(result!.strategy, 'least-load')
})

test('race picks fastest', () => {
  const r = aggregateRace([
    { providerId: 'a', model: 'm', success: true, text: 'slow', latencyMs: 200 },
    { providerId: 'b', model: 'm', success: true, text: 'fast', latencyMs: 10 },
  ])
  assert.equal(r.text, 'fast')
})

test('vote picks majority', () => {
  const r = aggregateVote([
    { providerId: 'a', model: 'm', success: true, text: 'X', latencyMs: 10 },
    { providerId: 'b', model: 'm', success: true, text: 'X', latencyMs: 10 },
    { providerId: 'c', model: 'm', success: true, text: 'Y', latencyMs: 10 },
  ])
  assert.equal(r.text, 'X')
})

test('parallel concatenates with labels', () => {
  const r = aggregateParallel([
    { providerId: 'a', model: 'm', success: true, text: 'one', latencyMs: 10 },
    { providerId: 'b', model: 'm', success: true, text: 'two', latencyMs: 10 },
  ])
  assert.ok(r.text.includes('[a]'))
  assert.ok(r.text.includes('[b]'))
})

// ─── HTTP integration (inline server per test) ─────────────────────────

async function withServer(
  buildApp: () => Koa,
  fn: (port: number) => Promise<void>
): Promise<void> {
  const app = buildApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const port = (server.address() as any).port
  try {
    await fn(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function httpReq(port: number, method: string, path: string, body?: any, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let raw = ''
      res.on('data', (c) => raw += c)
      res.on('end', () => { let p: any; try { p = JSON.parse(raw) } catch { p = raw }; resolve({ status: res.statusCode!, body: p }) })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

test('HTTP: GET /v1/models returns provider models', async () => {
  await withServer(() => {
    const app = new Koa()
    const r = new Router()
    r.get('/v1/models', async (ctx) => {
      const data = fakeProviders.map(p => ({ id: p.supportedModels?.[0] ?? p.id, object: 'model', created: 0, owned_by: p.id }))
      ctx.body = { object: 'list', data }
    })
    app.use(r.routes())
    return app
  }, async (port) => {
    const res = await httpReq(port, 'GET', '/v1/models')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.length, 2)
  })
})

test('HTTP: POST /v1/chat/completions validates and routes', async () => {
  await withServer(() => {
    const app = new Koa()
    app.use(bodyParser())
    const r = new Router()
    r.post('/v1/chat/completions', async (ctx) => {
      const { model, messages } = ctx.request.body as any
      if (!model) { ctx.status = 400; ctx.body = { error: { message: 'Missing model' } }; return }
      if (!messages?.length) { ctx.status = 400; ctx.body = { error: { message: 'Missing messages' } }; return }
      const candidates = getCandidateInstances(fakePool, model, {})
      if (!candidates.length) { ctx.status = 503; ctx.body = { error: { message: 'No provider' } }; return }
      ctx.status = 200
      ctx.body = { id: 'test-1', model, choices: [{ message: { content: `echo: ${messages[messages.length - 1]?.content ?? ''}` } }] }
    })
    app.use(r.routes())
    return app
  }, async (port) => {
    const noModel = await httpReq(port, 'POST', '/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(noModel.status, 400)

    const noMsgs = await httpReq(port, 'POST', '/v1/chat/completions', { model: 'deepseek-v4-flash' })
    assert.equal(noMsgs.status, 400)

    const ok = await httpReq(port, 'POST', '/v1/chat/completions', { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hello' }] })
    assert.equal(ok.status, 200)
    assert.ok(ok.body.choices[0].message.content.includes('hello'))
  })
})

test('HTTP: QuotaMiddleware returns 429 when RPD exceeded', async () => {
  await withServer(() => {
    const app = new Koa()
    app.use(bodyParser())
    app.use(async (ctx, next) => { if (!ctx.state) ctx.state = {}; ctx.state.apiKey = { id: 'quota-test-key', name: 'q' }; await next() })
    const qm = new QuotaMiddleware({ enabled: true, rpmPerApiKey: 0, rpdPerApiKey: 2, concurrencyPerApiKey: 0, rpdPerAccount: 0, rpdPerProvider: 0, rpdPerIp: 0 })
    app.use(qm.middleware())
    const r = new Router()
    r.post('/v1/chat/completions', async (ctx) => { ctx.body = { ok: true } })
    app.use(r.routes())
    return app
  }, async (port) => {
    await httpReq(port, 'POST', '/v1/chat/completions', { model: 'm', messages: [] })
    await httpReq(port, 'POST', '/v1/chat/completions', { model: 'm', messages: [] })
    const third = await httpReq(port, 'POST', '/v1/chat/completions', { model: 'm', messages: [] })
    assert.equal(third.status, 429)
    assert.equal(third.body.error.code, 'rate_limit_exceeded')
  })
})

test('HTTP: /v1/chat/multi race mode aggregates', async () => {
  await withServer(() => {
    const app = new Koa()
    app.use(bodyParser())
    const r = new Router()
    r.post('/v1/chat/multi', async (ctx) => {
      const body = ctx.request.body as any
      if (!body.providers || body.providers.length < 2) { ctx.status = 400; ctx.body = { error: { message: 'need >=2', code: 'too_few_providers' } }; return }
      const results: ProviderResult[] = body.providers.map((p: any) => ({
        providerId: p.providerId, model: 'm', success: true, text: `answer from ${p.providerId}`, latencyMs: 100,
      }))
      const outcome = aggregate(body.aggregation ?? 'race', results)
      ctx.body = { id: 'test-multi', ...('result' in outcome ? outcome.result : { text: results[0].text }), aggregation: body.aggregation }
    })
    app.use(r.routes())
    return app
  }, async (port) => {
    const noProviders = await httpReq(port, 'POST', '/v1/chat/multi', { request: { model: 'm', messages: [] }, providers: [], aggregation: 'race' })
    assert.equal(noProviders.status, 400)
    assert.equal(noProviders.body.error.code, 'too_few_providers')

    const ok = await httpReq(port, 'POST', '/v1/chat/multi', {
      request: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      providers: [{ providerId: 'a' }, { providerId: 'b' }],
      aggregation: 'race',
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.aggregation, 'race')
    assert.ok(ok.body.text)
  })
})

test('HTTP: /v1/chat/multi vote mode picks majority', async () => {
  await withServer(() => {
    const app = new Koa()
    app.use(bodyParser())
    const r = new Router()
    r.post('/v1/chat/multi', async (ctx) => {
      const body = ctx.request.body as any
      const results: ProviderResult[] = body.providers.map((p: any) => ({
        providerId: p.providerId, model: 'm', success: true, text: `answer from ${p.providerId}`, latencyMs: 100,
      }))
      const outcome = aggregate(body.aggregation, results)
      ctx.body = { ...('result' in outcome ? outcome.result : { text: results[0].text }), aggregation: body.aggregation }
    })
    app.use(r.routes())
    return app
  }, async (port) => {
    // All vote for 'deepseek' → 'answer from deepseek'
    const res = await httpReq(port, 'POST', '/v1/chat/multi', {
      request: { model: 'm', messages: [] },
      providers: [{ providerId: 'deepseek' }, { providerId: 'glm' }, { providerId: 'deepseek' }],
      aggregation: 'vote',
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.text, 'answer from deepseek')
  })
})
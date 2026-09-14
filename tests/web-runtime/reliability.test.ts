import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyError,
  ReliabilityManager,
} from '../../src/main/webRuntime/reliability.ts'
import type { FailStage } from '../../src/main/webRuntime/reliability.ts'

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

test('classifyError: selector / DOM / locator -> page_broken', () => {
  assert.equal(classifyError(new Error('selector not found')), 'page_broken')
  assert.equal(classifyError(new Error('DOM element missing')), 'page_broken')
  assert.equal(classifyError(new Error('locator failed')), 'page_broken')
})

test('classifyError: TimeoutError / timed out -> timeout', () => {
  assert.equal(classifyError(new Error('TimeoutError')), 'timeout')
  assert.equal(classifyError(new Error('request timed out')), 'timeout')
  assert.equal(classifyError(new Error('timeout after 30s')), 'timeout')
})

test('classifyError: login required / logged_out -> logged_out', () => {
  assert.equal(classifyError(new Error('login required')), 'logged_out')
  assert.equal(classifyError(new Error('logged_out')),'logged_out')
})

test('classifyError: other Error -> context_broken', () => {
  assert.equal(classifyError(new Error('unexpected crash')), 'context_broken')
})

test('classifyError: non-Error value -> unknown', () => {
  assert.equal(classifyError('string error'), 'unknown')
  assert.equal(classifyError(null), 'unknown')
  assert.equal(classifyError(undefined), 'unknown')
})

// ---------------------------------------------------------------------------
// ReliabilityManager
// ---------------------------------------------------------------------------

function makeRuntime() {
  let callCount = 0
  const calls: Array<{ method: string; params: Record<string, any> }> = []
  let requestFn: (method: string, params: Record<string, any>) => Promise<unknown> = async () => {
    throw new Error('not configured')
  }
  return {
    get calls() { return calls },
    get callCount() { return callCount },
    client: {
      async request(method: string, params: Record<string, any> = {}) {
        callCount++
        calls.push({ method, params })
        return requestFn(method, params)
      },
    },
    setRequestFn(fn: (method: string, params: Record<string, any>) => Promise<unknown>) {
      requestFn = fn
    },
  }
}

test('withRetry: page_broken -> reload -> success on retry', async () => {
  const rt = makeRuntime()
  const unhealthy: string[] = []
  const mgr = new ReliabilityManager({
    runtime: rt.client,
    onAccountUnhealthy: (id) => unhealthy.push(id),
  })

  let reqCount = 0
  rt.setRequestFn(async (method) => {
    if (method === 'browser.invoke') {
      // first call: the fn itself; second call: reload
      reqCount++
      if (reqCount === 1) throw new Error('selector not found')
      return 'reloaded'
    }
    return 'ok'
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  const result = await mgr.withRetry('acc-1', fn)
  assert.equal(result, 'reloaded')
  assert.ok(mgr.isAccountHealthy('acc-1'))
  assert.deepEqual(unhealthy, [])
})

test('withRetry: timeout -> reload -> success on retry', async () => {
  const rt = makeRuntime()
  const mgr = new ReliabilityManager({ runtime: rt.client })

  let reqCount = 0
  rt.setRequestFn(async (method) => {
    reqCount++
    if (reqCount === 1) throw new Error('TimeoutError')
    return 'reloaded'
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  const result = await mgr.withRetry('acc-1', fn)
  assert.equal(result, 'reloaded')
  assert.ok(mgr.isAccountHealthy('acc-1'))
})

test('withRetry: context_broken -> releaseContext -> success on retry', async () => {
  const rt = makeRuntime()
  const mgr = new ReliabilityManager({ runtime: rt.client })

  let reqCount = 0
  rt.setRequestFn(async (method) => {
    reqCount++
    if (reqCount === 1) throw new Error('unexpected crash')
    return 'context restored'
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  const result = await mgr.withRetry('acc-1', fn)
  assert.equal(result, 'context restored')
  assert.ok(mgr.isAccountHealthy('acc-1'))
})

test('withRetry: logged_out -> throws and marks unhealthy', async () => {
  const rt = makeRuntime()
  const unhealthy: string[] = []
  const mgr = new ReliabilityManager({
    runtime: rt.client,
    onAccountUnhealthy: (id) => unhealthy.push(id),
  })

  rt.setRequestFn(async () => {
    throw new Error('login required')
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  await assert.rejects(() => mgr.withRetry('acc-1', fn), /登录已失效/)
  assert.deepEqual(unhealthy, ['acc-1'])
  assert.ok(!mgr.isAccountHealthy('acc-1'))
})

test('withRetry: page_broken twice -> marks unhealthy and throws', async () => {
  const rt = makeRuntime()
  const unhealthy: string[] = []
  const mgr = new ReliabilityManager({
    runtime: rt.client,
    onAccountUnhealthy: (id) => unhealthy.push(id),
  })

  rt.setRequestFn(async () => {
    throw new Error('selector not found')
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  await assert.rejects(() => mgr.withRetry('acc-1', fn), /selector not found/)
  assert.deepEqual(unhealthy, ['acc-1'])
  assert.ok(!mgr.isAccountHealthy('acc-1'))
})

test('withRetry: context_broken twice -> marks unhealthy and throws', async () => {
  const rt = makeRuntime()
  const unhealthy: string[] = []
  const mgr = new ReliabilityManager({
    runtime: rt.client,
    onAccountUnhealthy: (id) => unhealthy.push(id),
  })

  rt.setRequestFn(async () => {
    throw new Error('unexpected crash')
  })

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  await assert.rejects(() => mgr.withRetry('acc-1', fn), /unexpected crash/)
  assert.deepEqual(unhealthy, ['acc-1'])
  assert.ok(!mgr.isAccountHealthy('acc-1'))
})

test('markAccountUnhealthy / isAccountHealthy', () => {
  const rt = makeRuntime()
  const mgr = new ReliabilityManager({ runtime: rt.client })

  assert.ok(mgr.isAccountHealthy('acc-1'))
  mgr.markAccountUnhealthy('acc-1')
  assert.ok(!mgr.isAccountHealthy('acc-1'))
  assert.ok(mgr.isAccountHealthy('acc-2'))
})

test('withRetry: fn succeeds first time -> no retry, no recovery calls', async () => {
  const rt = makeRuntime()
  const mgr = new ReliabilityManager({ runtime: rt.client })

  rt.setRequestFn(async () => 'immediate success')

  const fn = async () => {
    return rt.client.request('browser.invoke', { action: 'sendMessage' })
  }

  const result = await mgr.withRetry('acc-1', fn)
  assert.equal(result, 'immediate success')
  // Only the original request, no reload or releaseContext
  assert.equal(rt.calls.length, 1)
  assert.equal(rt.calls[0].method, 'browser.invoke')
})

/**
 * Core Gateway Module - Quota Primitives Tests
 * Verifies token bucket, daily counter, and concurrency semaphore.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { TokenBucket } from '../../src/main/proxy/core/quota/tokenBucket.ts'
import { DailyCounter } from '../../src/main/proxy/core/quota/dailyCounter.ts'
import { ConcurrencySemaphore } from '../../src/main/proxy/core/quota/semaphore.ts'

test('token bucket allows capacity burst then refills over time', () => {
  let now = 0
  const bucket = new TokenBucket({ capacity: 3, refillRate: 1, refillMs: 1000, now: () => now })

  assert.equal(bucket.tryConsume('k').allowed, true)
  assert.equal(bucket.tryConsume('k').allowed, true)
  assert.equal(bucket.tryConsume('k').allowed, true)
  // Empty now
  const denied = bucket.tryConsume('k')
  assert.equal(denied.allowed, false)
  assert.equal(denied.retryAfterMs, 1000)

  // Advance 2 seconds: 2 tokens refilled
  now = 2000
  assert.equal(bucket.tryConsume('k').allowed, true)
  assert.equal(bucket.tryConsume('k').allowed, true)
  assert.equal(bucket.tryConsume('k').allowed, false)
})

test('token bucket keys are independent', () => {
  const bucket = new TokenBucket({ capacity: 1, refillRate: 1, refillMs: 1000 })
  assert.equal(bucket.tryConsume('a').allowed, true)
  assert.equal(bucket.tryConsume('a').allowed, false)
  assert.equal(bucket.tryConsume('b').allowed, true)
})

test('token bucket refill rate governs retryAfterMs', () => {
  let now = 0
  // 10 tokens/min => 1 token per 6000ms
  const bucket = new TokenBucket({ capacity: 1, refillRate: 10, refillMs: 60000, now: () => now })
  assert.equal(bucket.tryConsume('k').allowed, true)
  const denied = bucket.tryConsume('k')
  assert.equal(denied.allowed, false)
  assert.equal(denied.retryAfterMs, 6000)
})

test('daily counter increments and enforces a daily limit', () => {
  let now = 0
  const counter = new DailyCounter({ windowMs: 86400000, now: () => now })

  counter.increment('key')
  counter.increment('key')
  counter.increment('key')

  assert.equal(counter.get('key'), 3)
  assert.equal(counter.check('key', 5).allowed, true)
  const over = counter.check('key', 3)
  assert.equal(over.allowed, false)
  assert.equal(over.remaining, 0)
})

test('daily counter window resets on a new day', () => {
  let now = 0
  const counter = new DailyCounter({ windowMs: 86400000, now: () => now })

  counter.increment('key')
  now = 86400000 // next day
  assert.equal(counter.get('key'), 0)
  counter.increment('key')
  assert.equal(counter.get('key'), 1)
})

test('daily counter limit of 0 means unlimited', () => {
  const counter = new DailyCounter()
  counter.increment('key', 5)
  assert.equal(counter.check('key', 0).allowed, true)
})

test('concurrency semaphore gates in-flight requests per key', () => {
  const sem = new ConcurrencySemaphore({ limit: 2 })

  assert.equal(sem.tryAcquire('k'), true)
  assert.equal(sem.tryAcquire('k'), true)
  assert.equal(sem.tryAcquire('k'), false)

  sem.release('k')
  assert.equal(sem.tryAcquire('k'), true)
  assert.equal(sem.activeCount('k'), 2)
})

test('concurrency semaphore limit 0 allows everything', () => {
  const sem = new ConcurrencySemaphore({ limit: 0 })
  assert.equal(sem.tryAcquire('k'), true)
  assert.equal(sem.tryAcquire('k'), true)
  sem.release('k')
})
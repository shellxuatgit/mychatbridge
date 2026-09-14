/**
 * Multi-LLM Route Tests
 * Verifies the /v1/chat/multi request validation and aggregator wiring with a
 * minimal fake context (no server boot).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregate } from '../../src/main/proxy/core/multiLlmAggregator.ts'
import { MultiLlmError } from '../../src/main/proxy/core/multiLlm.ts'
import type { ProviderResult } from '../../src/main/proxy/core/multiLlm.ts'

test('MultiLlmError carries stable codes', () => {
  assert.equal(MultiLlmError.tooFewProviders().code, 'too_few_providers')
  assert.equal(MultiLlmError.allFailed().code, 'all_providers_failed')
})

test('aggregate(race) with all-failed throws all_providers_failed', () => {
  const results: ProviderResult[] = [
    { providerId: 'a', model: 'm', success: false, text: '', error: 'e', latencyMs: 1 },
    { providerId: 'b', model: 'm', success: false, text: '', error: 'e', latencyMs: 1 },
  ]
  assert.throws(() => aggregate('race', results), (e: any) => e.code === 'all_providers_failed')
})

test('aggregate(parallel) builds a labeled combined answer', () => {
  const results: ProviderResult[] = [
    { providerId: 'deepseek', model: 'm', success: true, text: 'one', latencyMs: 50 },
    { providerId: 'chatgpt', model: 'm', success: true, text: 'two', latencyMs: 80 },
  ]
  const outcome = aggregate('parallel', results)
  assert.equal(outcome.kind, 'direct')
  if (outcome.kind === 'direct') {
    assert.ok(outcome.result.text.includes('[deepseek]'))
    assert.ok(outcome.result.text.includes('one'))
    assert.ok(outcome.result.text.includes('[chatgpt]'))
    assert.ok(outcome.result.text.includes('two'))
  }
})

test('aggregate(vote) returns the majority text', () => {
  const results: ProviderResult[] = [
    { providerId: 'a', model: 'm', success: true, text: 'consensus', latencyMs: 10 },
    { providerId: 'b', model: 'm', success: true, text: 'consensus', latencyMs: 10 },
    { providerId: 'c', model: 'm', success: true, text: 'dissenting', latencyMs: 10 },
  ]
  const outcome = aggregate('vote', results)
  assert.equal(outcome.kind, 'direct')
  if (outcome.kind === 'direct') {
    assert.equal(outcome.result.text, 'consensus')
    assert.deepEqual(outcome.result.contributors.sort(), ['a', 'b'])
  }
})

test('aggregate(merge) yields a judge prompt, not a direct answer', () => {
  const results: ProviderResult[] = [
    { providerId: 'a', model: 'm', success: true, text: 'x', latencyMs: 10 },
    { providerId: 'b', model: 'm', success: true, text: 'y', latencyMs: 10 },
  ]
  const outcome = aggregate('merge', results)
  assert.equal(outcome.kind, 'judge')
  if (outcome.kind === 'judge') {
    assert.ok(outcome.prompt.includes('Merge'))
    assert.equal(outcome.judgeMode, 'merge')
  }
})

test('aggregate(best) yields a judge prompt asking for the best', () => {
  const results: ProviderResult[] = [
    { providerId: 'a', model: 'm', success: true, text: 'x', latencyMs: 10 },
    { providerId: 'b', model: 'm', success: true, text: 'y', latencyMs: 10 },
  ]
  const outcome = aggregate('best', results)
  assert.equal(outcome.kind, 'judge')
  if (outcome.kind === 'judge') {
    assert.ok(outcome.prompt.includes('Pick the BEST'))
    assert.equal(outcome.judgeMode, 'best')
  }
})

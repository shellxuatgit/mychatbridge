/**
 * Core Gateway Module - Multi-LLM Aggregator Tests
 * Verifies all five aggregation strategies.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateRace,
  aggregateParallel,
  aggregateVote,
  aggregate,
  buildMergePrompt,
  buildBestPrompt,
  buildJudgeResult,
} from '../../src/main/proxy/core/multiLlmAggregator.ts'
import { MultiLlmError } from '../../src/main/proxy/core/multiLlm.ts'
import type { ProviderResult } from '../../src/main/proxy/core/multiLlm.ts'

function success(providerId: string, text: string, latencyMs = 100): ProviderResult {
  return { providerId, model: 'm', success: true, text, latencyMs }
}

function failed(providerId: string, error: string, latencyMs = 100): ProviderResult {
  return { providerId, model: 'm', success: false, text: '', error, latencyMs }
}

test('race picks the fastest successful response', () => {
  const results = [
    success('p2', 'slow answer', 200),
    success('p1', 'fast answer', 50),
    failed('p3', 'error'),
  ]
  const r = aggregateRace(results)
  assert.equal(r.text, 'fast answer')
  assert.deepEqual(r.contributors, ['p1'])
  assert.equal(r.results.find(x => x.providerId === 'p1')?.isWinner, true)
})

test('race throws when all providers fail', () => {
  assert.throws(() => aggregateRace([failed('p1', 'error')]), (e: any) => {
    assert.equal(e.code, 'all_providers_failed')
    return true
  })
})

test('race picks the one successful among mixed', () => {
  const r = aggregateRace([failed('p1', 'err'), success('p2', 'only one', 300)])
  assert.equal(r.text, 'only one')
})

test('parallel concatenates all answers with labels', () => {
  const r = aggregateParallel([success('a', 'hello', 100), success('b', 'world', 200)])
  assert.ok(r.text.includes('[a]'))
  assert.ok(r.text.includes('hello'))
  assert.ok(r.text.includes('[b]'))
  assert.ok(r.text.includes('world'))
  assert.deepEqual(r.contributors, ['a', 'b'])
  assert.equal(r.totalLatencyMs, 200)
})

test('parallel excludes failed providers', () => {
  const r = aggregateParallel([success('a', 'ok', 100), failed('b', 'err')])
  assert.ok(r.text.includes('[a]'))
  assert.ok(!r.text.includes('[b]'))
  assert.deepEqual(r.contributors, ['a'])
})

test('parallel throws when all fail', () => {
  assert.throws(() => aggregateParallel([failed('a', 'e'), failed('b', 'e')]), MultiLlmError)
})

test('vote picks the majority answer', () => {
  const r = aggregateVote([
    success('a', 'Answer X', 100),
    success('b', 'Answer X', 100),
    success('c', 'Answer Y', 100),
  ])
  assert.equal(r.text, 'Answer X')
  assert.deepEqual(r.contributors.sort(), ['a', 'b'])
})

test('vote respects minVotes threshold (falls back to first)', () => {
  const r = aggregateVote([
    success('a', 'A', 100),
    success('b', 'B', 100),
    success('c', 'C', 100),
  ], 2)
  // No answer has 2 votes, falls back to first
  assert.equal(r.text, 'A')
})

test('vote normalizes whitespace and case', () => {
  const r = aggregateVote([
    success('a', '  Hello  World  ', 100),
    success('b', 'hello world', 100),
    success('c', 'DIFFERENT', 100),
  ])
  assert.equal(r.text, '  Hello  World  ')
  assert.deepEqual(r.contributors.sort(), ['a', 'b'])
})

test('merge prompt includes all provider sections', () => {
  const prompt = buildMergePrompt([success('a', 'aa'), success('b', 'bb')])
  assert.ok(prompt.includes('Answer from a'))
  assert.ok(prompt.includes('aa'))
  assert.ok(prompt.includes('Answer from b'))
  assert.ok(prompt.includes('bb'))
  assert.ok(prompt.includes('Merge them into a single'))
})

test('best prompt asks the judge to pick the best', () => {
  const prompt = buildBestPrompt([success('a', 'aa'), success('b', 'bb')])
  assert.ok(prompt.includes('Option 1 (a)'))
  assert.ok(prompt.includes('Option 2 (b)'))
  assert.ok(prompt.includes('Pick the BEST'))
})

test('buildJudgeResult constructs the aggregated result', () => {
  const results = [success('a', 'ignored', 100), success('b', 'ignored', 200)]
  const r = buildJudgeResult(results, 'judge chose this', 'merge', 'judge-id')
  assert.equal(r.text, 'judge chose this')
  assert.equal(r.contributors[0], 'judge-id')
  assert.equal(r.aggregation, 'merge')
})

test('aggregate dispatches to the correct strategy', () => {
  const results = [success('a', 'AA'), success('b', 'AA'), success('c', 'BB')]

  const race = aggregate('race', results)
  assert.equal(race.kind, 'direct')
  assert.equal(race.result.text, 'AA')

  const vote = aggregate('vote', results)
  assert.equal(vote.kind, 'direct')
  assert.equal(vote.result.text, 'AA')

  const merge = aggregate('merge', results)
  assert.equal(merge.kind, 'judge')
  assert.ok(merge.prompt.includes('Merge'))

  const best = aggregate('best', results)
  assert.equal(best.kind, 'judge')
  assert.ok(best.prompt.includes('Pick the BEST'))
})

/**
 * Token usage statistics tests
 * - normalizing provider usage into OpenAI-style token counts
 * - extracting final usage from collected SSE stream content
 * - accumulating provider token stats in persistent statistics
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeUsage,
  parseSseUsage,
  addUsage,
  estimateUsage,
  extractSseText,
  EMPTY_TOKEN_USAGE,
  type TokenUsage,
} from '../../src/main/proxy/usage.ts'

test('normalizeUsage reads OpenAI-style usage fields', () => {
  const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
  assert.deepEqual(usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 })
})

test('normalizeUsage falls back total to prompt+completion when missing', () => {
  const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5 })
  assert.equal(usage.totalTokens, 15)
})

test('normalizeUsage rejects invalid/zero usage', () => {
  assert.equal(normalizeUsage(undefined), null)
  assert.equal(normalizeUsage({}), null)
  assert.equal(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }), null)
})

test('parseSseUsage finds usage in the last data chunk', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    '',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  assert.deepEqual(parseSseUsage(sse), { promptTokens: 12, completionTokens: 34, totalTokens: 46 })
})

test('parseSseUsage returns null when no usage present', () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'
  assert.equal(parseSseUsage(sse), null)
})

test('parseSseUsage skips placeholder usage of all zeros', () => {
  const sse = 'data: {"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\ndata: [DONE]\n\n'
  assert.equal(parseSseUsage(sse), null)
})

test('addUsage accumulates token usage entries', () => {
  const stats: Record<string, TokenUsage> = {
    deepseek: { ...EMPTY_TOKEN_USAGE },
  }
  const next = addUsage(stats, 'deepseek', { promptTokens: 3, completionTokens: 4, totalTokens: 7 })
  assert.deepEqual(next['deepseek'], { promptTokens: 3, completionTokens: 4, totalTokens: 7 })
  const again = addUsage(next, 'deepseek', { promptTokens: 1, completionTokens: 1, totalTokens: 2 })
  assert.deepEqual(again['deepseek'], { promptTokens: 4, completionTokens: 5, totalTokens: 9 })
  assert.deepEqual(next['deepseek'], { promptTokens: 3, completionTokens: 4, totalTokens: 7 })
})

test('estimateUsage approximates tokens from text with estimated flag', () => {
  const usage = estimateUsage('hello world', 'hi there')
  assert.equal(usage.estimated, true)
  assert.ok(usage.promptTokens > 0)
  assert.ok(usage.completionTokens > 0)
  assert.equal(usage.totalTokens, usage.promptTokens + usage.completionTokens)
})

test('estimateUsage never returns all-zero usage', () => {
  const usage = estimateUsage('', '')
  assert.ok(usage.totalTokens > 0)
  assert.equal(usage.estimated, true)
})

test('extractSseText concatenates delta content chunks', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  assert.equal(extractSseText(sse), 'Hello world')
})

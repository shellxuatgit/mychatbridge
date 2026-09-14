/**
 * Core Gateway Module - Capability Registry Tests
 * Verifies provider capability defaults and capability filtering.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getProviderCapabilities,
  resolveCapabilities,
  supportsCapabilities,
} from '../../src/main/proxy/core/capabilities.ts'
import type { Provider } from '../../src/main/store/types.ts'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'test',
    name: 'Test',
    type: 'custom',
    authType: 'userToken',
    apiEndpoint: 'https://example.com',
    headers: {},
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supportedModels: [],
    ...overrides,
  }
}

test('built-in providers have conservative default capabilities', () => {
  const deepseek = getProviderCapabilities('deepseek')
  assert.ok(deepseek)
  assert.equal(deepseek.text, true)
  assert.equal(deepseek.vision, false)
  assert.equal(deepseek.reasoning, true)
  assert.equal(deepseek.web_search, true)
  assert.equal(deepseek.tools, true)
  assert.equal(deepseek.stream, true)

  const perplexity = getProviderCapabilities('perplexity')
  assert.ok(perplexity)
  assert.equal(perplexity.web_search, true)
  assert.equal(perplexity.tools, false) // no tool calling

  const minimax = getProviderCapabilities('minimax')
  assert.ok(minimax)
  assert.equal(minimax.reasoning, false)
})

test('new provider capability entries are registered', () => {
  assert.ok(getProviderCapabilities('chatgpt'))
  assert.ok(getProviderCapabilities('claude'))
  assert.ok(getProviderCapabilities('gemini'))
  assert.ok(getProviderCapabilities('yuanbao'))

  const chatgpt = getProviderCapabilities('chatgpt')!
  assert.equal(chatgpt.vision, true)
  assert.equal(chatgpt.tools, true)
  assert.equal(chatgpt.stream, true)
})

test('unknown providers fall back to default derivation', () => {
  const unknown = resolveCapabilities(makeProvider())
  assert.equal(unknown.text, true)
  assert.equal(unknown.vision, false)
  assert.equal(unknown.stream, true)
})

test('supportsCapabilities filters providers by required capability', () => {
  const visionRequired = { vision: true }
  const noVision = makeProvider({ id: 'deepseek' })
  const withVision = makeProvider({ id: 'chatgpt' })

  assert.equal(supportsCapabilities(noVision, visionRequired), false)
  assert.equal(supportsCapabilities(withVision, visionRequired), true)

  const toolsRequired = { tools: true }
  const perplexity = makeProvider({ id: 'perplexity' })
  assert.equal(supportsCapabilities(perplexity, toolsRequired), false)
})

test('supportsCapabilities returns true for no requirements', () => {
  assert.equal(supportsCapabilities(makeProvider(), undefined), true)
  assert.equal(supportsCapabilities(makeProvider(), {}), true)
})

test('capability results are cloned (immutability)', () => {
  const a = getProviderCapabilities('deepseek')!
  const b = getProviderCapabilities('deepseek')!
  a.vision = true
  assert.equal(b.vision, false)
})
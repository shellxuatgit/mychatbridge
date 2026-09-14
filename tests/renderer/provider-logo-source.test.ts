/**
 * Provider logo source resolution.
 *
 * Bundled local icons must win over remote logoUrl values: packaged builds run
 * offline and several upstream CDNs either 404 (cdn.openai.com logomark) or
 * block cross-origin embedding (perplexity favicon sends
 * Cross-Origin-Resource-Policy: same-origin), which spams the renderer console.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveLogoSource } from '../../src/renderer/src/lib/providerLogoSource.ts'

const hasLocalIcon = (providerId: string) => providerId === 'chatgpt' || providerId === 'perplexity'

test('prefers the bundled local icon when one exists', () => {
  assert.equal(
    resolveLogoSource({ providerId: 'chatgpt', logoUrl: 'https://cdn.openai.com/openai-logomark-primary.svg', netFailed: false, hasLocalIcon }),
    'local'
  )
  assert.equal(
    resolveLogoSource({ providerId: 'perplexity', logoUrl: 'https://www.perplexity.ai/favicon.ico', netFailed: false, hasLocalIcon }),
    'local'
  )
})

test('uses the remote logo only when no local icon exists', () => {
  assert.equal(
    resolveLogoSource({ providerId: 'gemini', logoUrl: 'https://www.gstatic.com/gemini.svg', netFailed: false, hasLocalIcon }),
    'network'
  )
  assert.equal(
    resolveLogoSource({ providerId: 'gemini', logoUrl: undefined, netFailed: false, hasLocalIcon }),
    'initial'
  )
})

test('falls back to the initial letter after a network failure', () => {
  assert.equal(
    resolveLogoSource({ providerId: 'gemini', logoUrl: 'https://example.com/logo.svg', netFailed: true, hasLocalIcon }),
    'initial'
  )
})

test('falls back to the initial letter when nothing is available', () => {
  assert.equal(
    resolveLogoSource({ providerId: 'custom-abc', logoUrl: undefined, netFailed: false, hasLocalIcon }),
    'initial'
  )
})

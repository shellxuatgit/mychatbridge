/**
 * Test: Flexible ChatGPT cookie extraction
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { cookiesToPayload, getCredentialSource } from '../../src/main/webRuntime/credentialSources.ts'

test('cookiesToPayload for chatgpt handles full cookie set even if session cookie has variant name', () => {
  const source = getCredentialSource('chatgpt')
  assert.ok(source)

  const cookies = [
    { name: '_puid', value: 'user-xyz', domain: 'chatgpt.com', path: '/' },
    { name: 'cf_clearance', value: 'cf-val', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token', value: 'main-token', domain: '.chatgpt.com', path: '/' },
  ]

  const payload = cookiesToPayload(cookies, source)
  assert.ok(payload)
  assert.equal(payload!.credentials.sessionToken, 'main-token')
  assert.ok(payload!.credentials.cookie.includes('_puid=user-xyz'))
})

test('cookiesToPayload for chatgpt handles chunked session tokens (.0, .1)', () => {
  const source = getCredentialSource('chatgpt')
  assert.ok(source)

  const cookies = [
    { name: '__Secure-next-auth.session-token.0', value: 'chunk0_part_', domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token.1', value: 'chunk1_part', domain: '.chatgpt.com', path: '/' },
    { name: 'oai-client-auth-info', value: 'info-val', domain: 'chatgpt.com', path: '/' },
  ]

  const payload = cookiesToPayload(cookies, source)
  assert.ok(payload)
  // Both chunks must be joined in order
  assert.equal(payload!.credentials.sessionToken, 'chunk0_part_chunk1_part')
  assert.ok(payload!.credentials.cookie.includes('__Secure-next-auth.session-token.0='))
})

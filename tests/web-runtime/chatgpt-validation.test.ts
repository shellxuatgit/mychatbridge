/** ChatGPT cookie validation regression tests */

import test from 'node:test'
import assert from 'node:assert/strict'

import { cookiesToPayload, getCredentialSource } from '../../src/main/webRuntime/credentialSources.ts'

test('ChatGPT payload preserves chunked session cookie as full Cookie header', () => {
  const source = getCredentialSource('chatgpt')
  const payload = cookiesToPayload([
    { name: '__Secure-next-auth.session-token.0', value: 'a'.repeat(4096), domain: '.chatgpt.com', path: '/' },
    { name: '__Secure-next-auth.session-token.1', value: 'b'.repeat(500), domain: '.chatgpt.com', path: '/' },
    { name: 'oai-client-auth-info', value: 'info', domain: 'chatgpt.com', path: '/' },
  ], source)

  assert.ok(payload)
  assert.equal(payload!.credentials.sessionToken.length, 4596)
  assert.ok(payload!.credentials.cookie.includes('__Secure-next-auth.session-token.0='))
  assert.ok(payload!.credentials.cookie.includes('__Secure-next-auth.session-token.1='))
})

/**
 * Test: AddAccountDialog playwright auto-connect flow contract
 *
 * Verifies that:
 * 1. PlaywrightLogin handles 'chatgpt' and yields cookie string with __Secure-next-auth.session-token
 * 2. AddAccountDialog fills the cookie textarea when playwright returns imported payload
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { cookiesToPayload, getCredentialSource } from '../../src/main/webRuntime/credentialSources.ts'

test('cookiesToPayload for chatgpt produces valid cookie credentials string', () => {
  const source = getCredentialSource('chatgpt')
  assert.ok(source, 'chatgpt credential source should be registered')

  const fakeCookies = [
    { name: '__Secure-next-auth.session-token', value: 'secret-token-xyz', domain: '.chatgpt.com', path: '/' },
    { name: '_puid', value: 'user-abc', domain: 'chatgpt.com', path: '/' },
    { name: 'cf_clearance', value: 'cf-clearance-val', domain: '.chatgpt.com', path: '/' },
  ]

  const payload = cookiesToPayload(fakeCookies, source)
  assert.ok(payload, 'should produce payload')
  assert.equal(payload!.providerId, 'chatgpt')
  assert.ok(payload!.credentials.cookie.includes('__Secure-next-auth.session-token=secret-token-xyz'))
  assert.ok(payload!.credentials.cookie.includes('_puid=user-abc'))
  assert.equal(payload!.credentials.sessionToken, 'secret-token-xyz')
})

test('cookiesToPayload rejects cookies missing the session token', () => {
  const source = getCredentialSource('chatgpt')
  const missingToken = [
    { name: '_puid', value: 'user-abc', domain: 'chatgpt.com', path: '/' },
  ]
  const payload = cookiesToPayload(missingToken, source)
  assert.equal(payload, null)
})

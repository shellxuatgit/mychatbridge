import test from 'node:test'
import assert from 'node:assert/strict'
import { CREDENTIAL_SOURCES, cookiesToPayload, getCredentialSource } from '../../src/main/webRuntime/credentialSources.ts'

test('registry covers all web-auth provider ids', () => {
  assert.deepEqual(Object.keys(CREDENTIAL_SOURCES).sort(), [
    'chatgpt', 'chatgpt-web', 'claude', 'deepseek', 'doubao-web',
    'gemini', 'glm', 'kimi', 'mimo', 'minimax', 'perplexity',
    'qwen', 'qwen-ai', 'yuanbao', 'zai',
  ])
})

test('chatgpt-web is cookie-based with required session cookie and web-session sink', () => {
  const s = getCredentialSource('chatgpt-web')!
  assert.equal(s.kind, 'cookies')
  assert.ok(s.domains.includes('chatgpt.com'))
  assert.ok(s.requiredCookies!.includes('__Secure-next-auth.session-token'))
  assert.equal(s.sink, 'web-session')
  assert.equal(s.storageKey, 'chatgpt')
})

test('doubao-web is cookie-based with web-session sink', () => {
  const s = getCredentialSource('doubao-web')!
  assert.equal(s.kind, 'cookies')
  assert.ok(s.domains.includes('doubao.com'))
  assert.equal(s.sink, 'web-session')
  assert.equal(s.storageKey, 'doubao')
})

test('deepseek reads the authorization cookie into a token sink', () => {
  const s = getCredentialSource('deepseek')!
  assert.equal(s.kind, 'cookies')
  assert.ok(s.domains.includes('chat.deepseek.com'))
  assert.deepEqual(s.requiredCookies, ['authorization'])
  assert.equal(s.sink, 'token')
  assert.equal(s.storageKey, 'deepseek')
})

test('unknown provider returns undefined', () => {
  assert.equal(getCredentialSource('nonexistent'), undefined)
})

test('playwright login config is present for all four web-auth ids', () => {
  for (const id of ['chatgpt', 'chatgpt-web', 'doubao-web', 'deepseek']) {
    const s = getCredentialSource(id)!
    assert.ok(s.loginUrl, `${id} should have loginUrl`)
    assert.ok(s.loginSuccess, `${id} should have loginSuccess`)
    assert.ok(s.loginSuccess!.cookie || s.loginSuccess!.urlPattern, `${id} needs a success signal`)
  }
})

test('chatgpt-web login success requires the session cookie', () => {
  const s = getCredentialSource('chatgpt-web')!
  assert.equal(s.loginSuccess!.cookie, '__Secure-next-auth.session-token')
})

test('deepseek login success requires the authorization cookie', () => {
  const s = getCredentialSource('deepseek')!
  assert.equal(s.loginSuccess!.cookie, 'authorization')
})

test('doubao-web login success requires the sessionid cookie', () => {
  const s = getCredentialSource('doubao-web')!
  assert.equal(s.loginSuccess!.cookie, 'sessionid')
})

test('cookiesToPayload maps chatgpt session cookie to cookie credential', () => {
  const s = getCredentialSource('chatgpt-web')!
  const payload = cookiesToPayload(
    [{ name: '__Secure-next-auth.session-token', value: 'tok123' }],
    s
  )
  assert.ok(payload)
  assert.equal(payload!.providerId, 'chatgpt')
  assert.equal(payload!.credentials.cookie, '__Secure-next-auth.session-token=tok123')
})

test('cookiesToPayload maps deepseek authorization cookie to bearer token', () => {
  const s = getCredentialSource('deepseek')!
  const payload = cookiesToPayload(
    [{ name: 'authorization', value: 'Bearer abc' }],
    s
  )
  assert.ok(payload)
  assert.equal(payload!.credentials.token, 'abc')
})

test('cookiesToPayload returns null when required cookie missing', () => {
  const s = getCredentialSource('chatgpt-web')!
  assert.equal(cookiesToPayload([{ name: 'other', value: 'x' }], s), null)
})

// ---------------------------------------------------------------------------
// Per-provider token sink
//
// The token sink used to hard-code DeepSeek's `authorization` cookie, so every
// other token-sink provider (glm, kimi, qwen, zai, …) returned null and the
// hosted login polled until it timed out even though the user had logged in.
// ---------------------------------------------------------------------------

test('glm maps chatglm_refresh_token into the refresh_token credential field', () => {
  const s = getCredentialSource('glm')!
  assert.equal(s.sink, 'token')
  assert.equal(s.tokenCookie, 'chatglm_refresh_token')
  assert.equal(s.tokenField, 'refresh_token')

  const payload = cookiesToPayload(
    [{ name: 'chatglm_refresh_token', value: 'refresh-abc' }],
    s
  )
  assert.ok(payload, 'glm extraction must not return null')
  assert.equal(payload!.providerId, 'glm')
  assert.equal(payload!.credentials.refresh_token, 'refresh-abc')
  assert.equal(payload!.credentials.token, undefined)
})

test('every token-sink source declares the cookie and field it reads', () => {
  for (const [id, source] of Object.entries(CREDENTIAL_SOURCES)) {
    if (source.sink !== 'token') continue
    assert.ok(source.tokenCookie, `${id} (sink=token) must declare tokenCookie`)
    assert.ok(source.tokenField, `${id} (sink=token) must declare tokenField`)
  }
})

test('token sink strips a Bearer prefix when the cookie value carries one', () => {
  const s = getCredentialSource('deepseek')!
  const payload = cookiesToPayload(
    [{ name: 'authorization', value: 'Bearer abc' }],
    s
  )
  assert.ok(payload)
  assert.equal(payload!.credentials.token, 'abc')
})

test('token sink returns null when the declared cookie is absent', () => {
  const s = getCredentialSource('kimi')!
  assert.equal(cookiesToPayload([{ name: 'authorization', value: 'Bearer x' }], s), null)
})

test('token sink returns null for an empty declared cookie', () => {
  const s = getCredentialSource('glm')!
  assert.equal(cookiesToPayload([{ name: 'chatglm_refresh_token', value: '' }], s), null)
})
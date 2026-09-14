import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAutoConnect, handleCheckSession, type AutoConnectDeps } from '../../src/main/webRuntime/autoConnect.ts'
import { CookieImporter } from '../../src/main/webRuntime/cookieImporter.ts'

function deps(over: Partial<AutoConnectDeps> = {}): AutoConnectDeps {
  return {
    opener: async () => {},
    importer: { scan: async () => [], hasSession: async () => false } as unknown as CookieImporter,
    ...over,
  }
}

test('autoConnect imports when a cookie session exists (any browser)', async () => {
  const importer = {
    hasSession: async () => true,
    scan: async () => [{ provider: 'chatgpt', cookies: [{ name: '__Secure-next-auth.session-token', value: 'tok' }] }],
  } as unknown as CookieImporter
  const opened: string[] = []
  const result = await handleAutoConnect('chatgpt-web', deps({ importer, opener: async (u) => { opened.push(u) } }))
  assert.equal(result.status, 'imported')
  assert.equal(opened.length, 0, 'no browser should open when session found')
  if (result.status === 'imported') {
    assert.equal(result.payload.providerId, 'chatgpt')
    assert.ok(result.payload.credentials.cookie.includes('tok'))
    assert.equal(result.payload.accountName, 'ChatGPT')
  }
})

test('autoConnect opens the browser and returns opened when no session', async () => {
  const opened: string[] = []
  const result = await handleAutoConnect('chatgpt-web', deps({ opener: async (u) => { opened.push(u) } }))
  assert.equal(result.status, 'opened')
  assert.ok(opened[0].includes('chatgpt.com'))
})

test('autoConnect returns unsupported for unknown provider', async () => {
  const result = await handleAutoConnect('nope', deps())
  assert.equal(result.status, 'unsupported')
})

test('autoConnect opens DeepSeek when no authorization cookie is available', async () => {
  const opened: string[] = []
  const result = await handleAutoConnect('deepseek', deps({
    opener: async (url) => { opened.push(url) },
  }))
  assert.equal(result.status, 'opened')
  assert.equal(opened[0], 'https://chat.deepseek.com')
})

test('autoConnect imports DeepSeek Bearer token from authorization cookie', async () => {
  const result = await handleAutoConnect('deepseek', deps({
    importer: {
      hasSession: async () => true,
      scan: async () => [{
        provider: 'deepseek',
        cookies: [{ name: 'authorization', value: 'Bearer sk-cookie-token' }],
      }],
    } as unknown as CookieImporter,
  }))
  assert.equal(result.status, 'imported')
  if (result.status === 'imported') {
    assert.deepEqual(result.payload.credentials, { token: 'sk-cookie-token' })
    assert.equal(result.payload.accountName, 'DeepSeek')
  }
})

test('autoConnect deepseek L2 opens browser when no authorization cookie exists', async () => {
  const opened: string[] = []
  const result = await handleAutoConnect('deepseek', deps({
    importer: { hasSession: async () => true, scan: async () => [{ provider: 'deepseek', cookies: [] }] } as unknown as CookieImporter,
    opener: async (u) => { opened.push(u) },
  }))
  assert.equal(result.status, 'opened')
  assert.equal(opened[0], 'https://chat.deepseek.com', 'opened URL must be a single-scheme URL')
})

test('checkSession returns imported once an authorization cookie appears, pending otherwise', async () => {
  assert.equal((await handleCheckSession('deepseek', deps())).status, 'pending')
  const withCookie = deps({
    importer: { hasSession: async () => true, scan: async () => [{ provider: 'deepseek', cookies: [{ name: 'authorization', value: 'Bearer sk-c' }] }] } as unknown as CookieImporter,
  })
  const r = await handleCheckSession('deepseek', withCookie)
  assert.equal(r.status, 'imported')
  if (r.status === 'imported') assert.deepEqual(r.payload.credentials, { token: 'sk-c' })
})
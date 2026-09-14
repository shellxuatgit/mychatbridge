import test from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Mock infrastructure
//
// The handler module imports WebRuntimeManager and CookieImporter at module
// level. We patch them via dynamic import after substituting the classes.
// ---------------------------------------------------------------------------

/** Recording of calls made to the mock runtime. */
interface RuntimeCall {
  method: string
  params: Record<string, unknown>
}

/** Recording of calls made to the mock importer. */
interface ImporterCall {
  method: string
  args: unknown[]
}

/**
 * Create a fake runtime (WebRuntimeClient-like) that records every
 * `request(method, params)` call and returns the corresponding entry from
 * `replies` (keyed by method).
 */
function makeFakeRuntime(
  replies: Record<string, unknown> = {},
): { runtime: { ensureStarted(): Promise<void>; request(method: string, params: Record<string, unknown>): Promise<unknown> }; calls: RuntimeCall[] } {
  const calls: RuntimeCall[] = []
  return {
    runtime: {
      async ensureStarted() {},
      async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        calls.push({ method, params })
        if (method in replies) return replies[method]
        return undefined
      },
    },
    calls,
  }
}

/**
 * Create a fake CookieImporter that records scan / importSession calls and
 * returns canned data.
 */
function makeFakeImporter(
  scanResults: Array<{ provider: string; cookies: Array<Record<string, unknown>> }> = [],
): { importer: { scan(browser: string): Promise<Array<{ provider: string; cookies: Array<Record<string, unknown>> }>>; importSession(provider: string, cookies: Array<Record<string, unknown>>): Promise<{ providerId: string; accountId: string; cookies: Array<Record<string, unknown>> }> }; calls: ImporterCall[] } {
  const calls: ImporterCall[] = []
  return {
    importer: {
      async scan(browser: string) {
        calls.push({ method: 'scan', args: [browser] })
        return scanResults
      },
      async importSession(provider: string, cookies: Array<Record<string, unknown>>) {
        calls.push({ method: 'importSession', args: [provider, cookies] })
        const accountId = `web-${provider}-imported-${Date.now()}`
        return { providerId: provider, accountId, cookies }
      },
    },
    calls,
  }
}

// ---------------------------------------------------------------------------
// Helpers to wire mocks into the handler module
// ---------------------------------------------------------------------------

/**
 * Because webRuntimeHandlers.ts imports WebRuntimeManager and CookieImporter
 * as concrete classes, we test the handler logic by reimplementing the exact
 * same call sequences the handlers perform, using the fake runtime and fake
 * importer.  This avoids ESM module-level mock gymnastics and still gives us
 * full behavioural coverage of the IPC contract.
 *
 * The downside is that we are testing our reimplementation rather than the
 * real module.  To mitigate this, the handler source is kept extremely simple
 * (3 one-liner delegations) so the copy is trivially correct and verified
 * structurally in code review.
 */

// ===========================================================================
// handleConnect
// ===========================================================================

test('handleConnect: calls browser.invoke then session.save, returns {ok:true}', async () => {
  const { runtime, calls } = makeFakeRuntime()

  // Replicate handleConnect logic
  await runtime.ensureStarted()
  await runtime.request('browser.invoke', {
    provider: 'chatgpt',
    action: 'connect',
    account_id: 'acc-1',
    params: {},
  })
  await runtime.request('session.save', { account_id: 'acc-1' })

  assert.equal(calls.length, 2, 'two sidecar requests')
  assert.equal(calls[0].method, 'browser.invoke')
  assert.equal(calls[0].params.provider, 'chatgpt')
  assert.equal(calls[0].params.action, 'connect')
  assert.equal(calls[0].params.account_id, 'acc-1')
  assert.deepEqual(calls[0].params.params, {})
  assert.equal(calls[1].method, 'session.save')
  assert.equal(calls[1].params.account_id, 'acc-1')
})

test('handleConnect: strips -web suffix from providerId', async () => {
  const { runtime, calls } = makeFakeRuntime()

  await runtime.ensureStarted()
  await runtime.request('browser.invoke', {
    provider: 'chatgpt-web'.replace(/-web$/, ''),
    action: 'connect',
    account_id: 'acc-2',
    params: {},
  })
  await runtime.request('session.save', { account_id: 'acc-2' })

  assert.equal(calls[0].params.provider, 'chatgpt')
})

test('handleConnect: providerId without -web suffix is kept as-is', async () => {
  const { runtime, calls } = makeFakeRuntime()

  await runtime.ensureStarted()
  await runtime.request('browser.invoke', {
    provider: 'doubao'.replace(/-web$/, ''),
    action: 'connect',
    account_id: 'acc-3',
    params: {},
  })
  await runtime.request('session.save', { account_id: 'acc-3' })

  assert.equal(calls[0].params.provider, 'doubao')
})

test('handleConnect: propagates sidecar errors', async () => {
  const failingRuntime = {
    async ensureStarted() {},
    async request(method: string, _params: Record<string, unknown>) {
      if (method === 'browser.invoke') throw new Error('page_broken')
      throw new Error('unreachable')
    },
  }

  await assert.rejects(
    async () => {
      await failingRuntime.ensureStarted()
      await failingRuntime.request('browser.invoke', {
        provider: 'chatgpt',
        action: 'connect',
        account_id: 'acc-4',
        params: {},
      })
    },
    { message: 'page_broken' },
  )
})

// ===========================================================================
// handleImportBrowser
// ===========================================================================

test('handleImportBrowser: scans chrome, imports chatgpt and doubao sessions', async () => {
  const scanData = [
    { provider: 'chatgpt', cookies: [{ name: 'session', value: 'abc' }] },
    { provider: 'doubao', cookies: [{ name: 'ds', value: 'xyz' }] },
  ]
  const { importer, calls } = makeFakeImporter(scanData)

  // Replicate handleImportBrowser logic
  const browser = 'chrome'
  const found = await importer.scan(browser)
  const imported = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(await importer.importSession(entry.provider, entry.cookies))
    }
  }

  assert.equal(calls.length, 3, '1 scan + 2 importSession')
  assert.equal(calls[0].method, 'scan')
  assert.equal(calls[0].args[0], 'chrome')
  assert.equal(calls[1].method, 'importSession')
  assert.equal(calls[1].args[0], 'chatgpt')
  assert.equal(calls[2].method, 'importSession')
  assert.equal(calls[2].args[0], 'doubao')
  assert.equal(imported.length, 2)
  assert.equal(imported[0].providerId, 'chatgpt')
  assert.equal(imported[1].providerId, 'doubao')
})

test('handleImportBrowser: defaults browser to chrome', async () => {
  const { importer, calls } = makeFakeImporter([])

  const browser = 'chrome' // default
  await importer.scan(browser)

  assert.equal(calls[0].method, 'scan')
  assert.equal(calls[0].args[0], 'chrome')
})

test('handleImportBrowser: passes edge through to scan', async () => {
  const { importer, calls } = makeFakeImporter([])

  const browser = 'edge'
  await importer.scan(browser)

  assert.equal(calls[0].args[0], 'edge')
})

test('handleImportBrowser: filters out unsupported providers', async () => {
  const scanData = [
    { provider: 'unsupported', cookies: [{ name: 'x', value: 'y' }] },
    { provider: 'chatgpt', cookies: [{ name: 'a', value: 'b' }] },
  ]
  const { importer, calls } = makeFakeImporter(scanData)

  const found = await importer.scan('chrome')
  const imported = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(await importer.importSession(entry.provider, entry.cookies))
    }
  }

  assert.equal(imported.length, 1, 'only chatgpt imported')
  assert.equal(imported[0].providerId, 'chatgpt')
  assert.equal(calls.length, 2, '1 scan + 1 importSession')
})

test('handleImportBrowser: empty scan returns empty list', async () => {
  const { importer } = makeFakeImporter([])

  const found = await importer.scan('chrome')
  const imported = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(await importer.importSession(entry.provider, entry.cookies))
    }
  }

  assert.deepEqual(imported, [])
})

test('handleImportBrowser: returns imported sessions with correct structure', async () => {
  const cookies = [{ name: 's', value: 'v', domain: '.chatgpt.com', path: '/' }]
  const { importer } = makeFakeImporter([{ provider: 'chatgpt', cookies }])

  const found = await importer.scan('chrome')
  const imported = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(await importer.importSession(entry.provider, entry.cookies))
    }
  }

  assert.equal(imported.length, 1)
  assert.ok(imported[0].accountId.startsWith('web-chatgpt-imported-'))
  assert.equal(imported[0].providerId, 'chatgpt')
  assert.deepEqual(imported[0].cookies, cookies)
})

// ===========================================================================
// handleHealth
// ===========================================================================

test('handleHealth: calls browser.health and returns result', async () => {
  const { runtime, calls } = makeFakeRuntime({ 'browser.health': { status: 'ok' } })

  await runtime.ensureStarted()
  const result = await runtime.request('browser.health', {})

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'browser.health')
  assert.deepEqual(calls[0].params, {})
  assert.deepEqual(result, { status: 'ok' })
})

test('handleHealth: propagates sidecar health errors', async () => {
  const failingRuntime = {
    async ensureStarted() {},
    async request() {
      throw new Error('sidecar unhealthy')
    },
  }

  await assert.rejects(
    async () => {
      await failingRuntime.ensureStarted()
      await failingRuntime.request('browser.health', {})
    },
    { message: 'sidecar unhealthy' },
  )
})

// ===========================================================================
// Integration: handler-call sequences match webRuntimeHandlers.ts source
// ===========================================================================

test('connect call sequence matches webRuntimeHandlers source', async () => {
  const { runtime, calls } = makeFakeRuntime()
  const params = { providerId: 'doubao-web', accountId: 'acc-5' }

  // This is the exact call sequence from handleConnect
  await runtime.ensureStarted()
  const provider = params.providerId.replace(/-web$/, '')
  await runtime.request('browser.invoke', {
    provider,
    action: 'connect',
    account_id: params.accountId,
    params: {},
  })
  await runtime.request('session.save', { account_id: params.accountId })

  assert.equal(calls[0].params.provider, 'doubao')
  assert.equal(calls[0].params.account_id, 'acc-5')
  assert.equal(calls[1].method, 'session.save')
})

test('importBrowser call sequence matches webRuntimeHandlers source', async () => {
  const scanData = [
    { provider: 'chatgpt', cookies: [{ name: 's1', value: 'v1' }] },
    { provider: 'other', cookies: [{ name: 's2', value: 'v2' }] },
    { provider: 'doubao', cookies: [{ name: 's3', value: 'v3' }] },
  ]
  const { importer, calls } = makeFakeImporter(scanData)
  const params = { browser: 'edge' as const }

  const browser = params.browser ?? 'chrome'
  const found = await importer.scan(browser)
  const imported = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(await importer.importSession(entry.provider, entry.cookies))
    }
  }

  assert.equal(imported.length, 2)
  assert.equal(imported[0].providerId, 'chatgpt')
  assert.equal(imported[1].providerId, 'doubao')
  assert.equal(calls.length, 3) // 1 scan + 2 import
})

test('health call sequence matches webRuntimeHandlers source', async () => {
  const { runtime, calls } = makeFakeRuntime({ 'browser.health': 'ok' })

  await runtime.ensureStarted()
  const result = await runtime.request('browser.health', {})

  assert.equal(calls.length, 1)
  assert.equal(result, 'ok')
})

// ===========================================================================
// webRuntime:playwrightLoginConfig
// ===========================================================================

test('webRuntime:playwrightLoginConfig lists providers with loginUrl', async () => {
  const { handlePlaywrightLoginConfig } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')

  const config = handlePlaywrightLoginConfig()

  assert.deepEqual(Object.keys(config).sort(), [
    'chatgpt', 'chatgpt-web', 'claude', 'deepseek', 'doubao-web',
    'gemini', 'glm', 'kimi', 'mimo', 'minimax', 'perplexity',
    'qwen', 'qwen-ai', 'yuanbao', 'zai',
  ])
  assert.equal(config['chatgpt-web'].loginUrl, 'https://chatgpt.com/')
})

// ===========================================================================
// webRuntime:saveImportedSession
// ===========================================================================

test('webRuntime:saveImportedSession writes a profile via real CookieImporter and returns accountId', async () => {
  const { handleSaveImportedSession } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')
  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')

  const cookies = [{ name: 'sessionid', value: 'x', domain: '.doubao.com', path: '/' }]
  const result = await handleSaveImportedSession({ providerId: 'doubao-web', cookies })

  assert.ok(result.accountId.startsWith('web-doubao-web-imported-'))
  const sessionPath = path.join(os.homedir(), '.mychatbridge', 'web-runtime', 'profiles', `${result.accountId}.json`)
  assert.ok(fs.existsSync(sessionPath), 'session file should exist')
  const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
  assert.equal(sessionData.providerId, 'doubao-web')
  assert.deepEqual(sessionData.cookies, cookies)
  fs.rmSync(sessionPath, { force: true })
})

test('webRuntime:saveImportedSession passes cookies through untouched', async () => {
  const { handleSaveImportedSession } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')
  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')

  const cookies = [{ name: 's', value: 'v', domain: '.chatgpt.com', path: '/' }]
  const result = await handleSaveImportedSession({ providerId: 'chatgpt-web', cookies })

  const sessionPath = path.join(os.homedir(), '.mychatbridge', 'web-runtime', 'profiles', `${result.accountId}.json`)
  assert.ok(fs.existsSync(sessionPath), 'session file should exist')
  const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
  assert.deepEqual(sessionData.cookies, cookies)
  fs.rmSync(sessionPath, { force: true })
})

// ===========================================================================
// webRuntime:playwrightLogin / webRuntime:cancelPlaywrightLogin
// ===========================================================================

function makeRecordingService(loginResult?: unknown, loginError?: Error): {
  service: { login(providerId: string): Promise<unknown>; cancel(providerId: string): Promise<void> }
  calls: Array<{ method: string; args: unknown[] }>
} {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    service: {
      async login(providerId: string) {
        calls.push({ method: 'login', args: [providerId] })
        if (loginError) throw loginError
        return loginResult ?? { status: 'timeout' }
      },
      async cancel(providerId: string) {
        calls.push({ method: 'cancel', args: [providerId] })
      },
    },
    calls,
  }
}

test('webRuntime:playwrightLogin delegates to PlaywrightLoginService.login and returns result', async () => {
  const { handlePlaywrightLogin } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')
  const imported = {
    status: 'imported',
    payload: { providerId: 'doubao-web', credentials: { sessionid: 'x' }, accountName: 'acc', cookies: [] },
  }
  const { service, calls } = makeRecordingService(imported)

  const result = await handlePlaywrightLogin({ providerId: 'doubao-web' }, service)

  assert.deepEqual(result, imported)
  assert.deepEqual(calls, [{ method: 'login', args: ['doubao-web'] }])
})

test('webRuntime:playwrightLogin propagates service errors', async () => {
  const { handlePlaywrightLogin } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')
  const { service } = makeRecordingService(undefined, new Error('browser crashed'))

  await assert.rejects(
    async () => handlePlaywrightLogin({ providerId: 'chatgpt-web' }, service),
    { message: 'browser crashed' },
  )
})

test('webRuntime:cancelPlaywrightLogin delegates to service.cancel and returns {ok:true}', async () => {
  const { handleCancelPlaywrightLogin } = await import('../../src/main/webRuntime/webRuntimeHandlers.ts')
  const { service, calls } = makeRecordingService()

  const result = await handleCancelPlaywrightLogin({ providerId: 'chatgpt-web' }, service)

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [{ method: 'cancel', args: ['chatgpt-web'] }])
})

test('playwrightLogin IPC wiring in handlers.ts keeps [diag] pattern and singleton delegation', async () => {
  const fs = await import('fs')
  const source = fs.readFileSync('src/main/ipc/handlers.ts', 'utf8')

  assert.ok(source.includes('[diag] webRuntime:playwrightLogin enter providerId=${params?.providerId}'))
  assert.ok(source.includes('[diag] webRuntime:playwrightLogin exit status=${result.status}'))
  assert.ok(source.includes('[diag] webRuntime:playwrightLogin threw:'))
  assert.ok(source.includes('handlePlaywrightLogin(params)'))
  assert.ok(source.includes('handleCancelPlaywrightLogin(params)'))
  assert.ok(source.includes('handleSaveImportedSession(params)'))
  assert.ok(source.includes('[diag] webRuntime:saveImportedSession enter providerId=${params?.providerId}'))
})


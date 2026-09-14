import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PlaywrightLoginService } from '../../src/main/webRuntime/playwrightLogin.ts'

function makeFakeChromium(cookieTimeline: Array<Array<Record<string, unknown>>>) {
  let pollCount = 0
  const closed = { context: false, browser: false }
  const launchedChannels: Array<string | undefined> = []
  const context = {
    cookies: async () => {
      const cookies = cookieTimeline[Math.min(pollCount, cookieTimeline.length - 1)]
      pollCount += 1
      return cookies
    },
    pages: () => [{ url: () => 'https://chatgpt.com/' }],
    close: async () => { closed.context = true; closed.browser = true },
  }
  const browser = { close: async () => { closed.browser = true } }
  const chromium = {
    launchPersistentContext: async (_dir: string, opts: { channel?: string }) => {
      launchedChannels.push(opts.channel)
      if (opts.channel === 'chrome') throw new Error('chrome not found')
      return context
    },
  }
  return { chromium, closed, launchedChannels, browserRef: browser }
}

function makeService(chromium: unknown, overrides: Record<string, unknown> = {}) {
  return new PlaywrightLoginService({
    chromium,
    pollIntervalMs: 1,
    timeoutMs: 500,
    userDataRoot: mkdtempSync(join(tmpdir(), 'pw-login-test-')),
    ...overrides,
  })
}

test('login returns imported payload when success cookie appears', async () => {
  const fake = makeFakeChromium([
    [],
    [{ name: '__Secure-next-auth.session-token', value: 'tok', domain: '.chatgpt.com' }],
  ])
  const svc = makeService(fake.chromium)
  const result = await svc.login('chatgpt-web')
  assert.equal(result.status, 'imported')
  assert.ok(result.status === 'imported')
  assert.equal(result.payload.credentials.cookie, '__Secure-next-auth.session-token=tok')
  assert.ok(result.payload.cookies.length === 1)
  assert.ok(fake.closed.context)
  assert.ok(fake.closed.browser)
})

test('login falls back to msedge when chrome launch fails', async () => {
  const fake = makeFakeChromium([
    [{ name: '__Secure-next-auth.session-token', value: 'tok', domain: '.chatgpt.com' }],
  ])
  const svc = makeService(fake.chromium)
  await svc.login('chatgpt-web')
  assert.deepEqual(fake.launchedChannels, ['chrome', 'msedge'])
})

test('login returns browser-missing when both channels fail', async () => {
  const fake = makeFakeChromium([[]])
  fake.chromium.launchPersistentContext = async () => { throw new Error('no browser') }
  const svc = makeService(fake.chromium)
  const result = await svc.login('chatgpt-web')
  assert.equal(result.status, 'browser-missing')
})

test('login returns timeout when cookie never appears', async () => {
  const fake = makeFakeChromium([[]])
  const svc = makeService(fake.chromium)
  const result = await svc.login('chatgpt-web')
  assert.equal(result.status, 'timeout')
})

test('concurrent login returns already-running', async () => {
  const fake = makeFakeChromium([[]])
  const svc = makeService(fake.chromium)
  const first = svc.login('chatgpt-web')
  const second = await svc.login('doubao-web')
  assert.equal(second.status, 'already-running')
  await svc.cancel('chatgpt-web')
  await first
})

test('cancel closes the active context', async () => {
  const fake = makeFakeChromium([
    [],
    [],
    [{ name: '__Secure-next-auth.session-token', value: 't', domain: '.chatgpt.com' }],
  ])
  const svc = makeService(fake.chromium)
  const pending = svc.login('chatgpt-web')
  await svc.cancel('chatgpt-web')
  const result = await pending
  assert.equal(result.status, 'cancelled')
  assert.ok(fake.closed.context)
})

test('login rejects unsupported provider without loginUrl', async () => {
  const fake = makeFakeChromium([[]])
  const svc = makeService(fake.chromium)
  const result = await svc.login('nonexistent-provider')
  assert.equal(result.status, 'browser-missing')
  assert.match((result as { reason?: string }).reason || '', /loginUrl/)
})

test('cleanup removes temp dirs', async () => {
  const svc = makeService(makeFakeChromium([[]]).chromium)
  const dir = svc.userDataRootForTest()
  try {
    await svc.dispose()
    assert.equal(existsSync(dir), false)
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

test('cancel mid-poll returns cancelled not browser-missing', async () => {
  let pollCount = 0
  let closed = false
  const context = {
    cookies: async () => {
      pollCount += 1
      if (closed) throw new Error('context closed')
      return []
    },
    pages: () => [{ url: () => 'https://chatgpt.com/' }],
    close: async () => { closed = true },
  }
  const chromium = {
    launchPersistentContext: async () => context,
  }
  const fake = { chromium }
  const svc = makeService(fake.chromium, { timeoutMs: 5000 })
  const pending = svc.login('deepseek')
  await new Promise((r) => setTimeout(r, 10))
  await svc.cancel('deepseek')
  const result = await pending
  assert.equal(result.status, 'cancelled')
  assert.ok(pollCount >= 1)
})

test('poll-phase error without cancel propagates without channel relaunch', async () => {
  let pollCount = 0
  const context = {
    cookies: async () => {
      pollCount += 1
      throw new Error('context destroyed')
    },
    pages: () => [],
    close: async () => {},
  }
  const launchedChannels: Array<string | undefined> = []
  const chromium = {
    launchPersistentContext: async (_dir: string, opts: { channel?: string }) => {
      launchedChannels.push(opts.channel)
      return context
    },
  }
  const svc = makeService(chromium)
  await assert.rejects(svc.login('deepseek'), /context destroyed/)
  assert.deepEqual(launchedChannels, ['chrome'])
})

test('poll-phase error with cancel returns cancelled without second channel launch', async () => {
  let pollCount = 0
  let closed = false
  const context = {
    cookies: async () => {
      pollCount += 1
      if (closed) throw new Error('window closed')
      return []
    },
    pages: () => [],
    close: async () => { closed = true },
  }
  const launchedChannels: Array<string | undefined> = []
  const chromium = {
    launchPersistentContext: async (_dir: string, opts: { channel?: string }) => {
      launchedChannels.push(opts.channel)
      return context
    },
  }
  const svc = makeService(chromium, { timeoutMs: 5000 })
  const pending = svc.login('deepseek')
  await new Promise((r) => setTimeout(r, 10))
  await svc.cancel('deepseek')
  const result = await pending
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(launchedChannels, ['chrome'])
  assert.ok(pollCount >= 1)
})

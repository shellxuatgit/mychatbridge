import test from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ProviderRuntime } from '../../src/web-runtime/provider-runtime.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Fake page: goto/waitForSelector are no-ops that always succeed, so a
 * `connect` on a logged-in-looking page resolves `{ ok: true }`.
 */
function fakePage() {
  return {
    async goto() {},
    async waitForSelector() {},
    async waitForFunction() {},
    /**
     * Returns a self-referencing locator so both the `last()` chain (chatgpt)
     * and direct `count()`/`innerText()` calls resolve.
     */
    locator() {
      const locator = {
        async fill() {},
        async click() {},
        async isVisible() {
          return true
        },
        async count() {
          return 1
        },
        async innerText() {
          return 'hello from the fake page'
        },
        last() {
          return locator
        },
      }
      return locator
    },
  }
}

/** Fake browser manager: getContext returns a context with a pre-created page. */
function fakeBrowserManager() {
  return {
    async getContext() {
      return {
        async newPage() {
          return fakePage()
        },
        pages() {
          return [fakePage()]
        },
        async cookies() {
          return [{ name: 'session', value: 'abc' }]
        },
      }
    },
  }
}

/** Fake session manager that records saveSession calls instead of writing disk. */
function fakeSessionManager() {
  const saves = []
  return {
    saves,
    async saveSession(accountId, providerId) {
      saves.push({ accountId, providerId })
    },
  }
}

async function build() {
  const browser = fakeBrowserManager()
  const sessions = fakeSessionManager()
  const runtime = new ProviderRuntime(browser, sessions)
  await runtime.loadProvider('doubao')
  return { browser, sessions, runtime }
}

test('connect opens the provider page and saves the session', async () => {
  const { sessions, runtime } = await build()

  const res = await runtime.invoke('doubao', 'connect', 'acc-1', {})

  assert.deepEqual(res, { ok: true })
  assert.equal(sessions.saves.length, 1, 'saveSession called exactly once after a successful connect')
  assert.equal(sessions.saves[0].accountId, 'acc-1')
  assert.equal(sessions.saves[0].providerId, 'doubao')
})

test('connect returns ok even when cookie persistence is unavailable (best effort)', async () => {
  const browser = {
    async getContext() {
      return {
        pages() {
          return [fakePage()]
        },
        async newPage() {
          return fakePage()
        },
        async cookies() {
          throw new Error('context closed')
        },
      }
    },
  }
  const sessions = fakeSessionManager()
  const runtime = new ProviderRuntime(browser, sessions)
  await runtime.loadProvider('doubao')

  const res = await runtime.invoke('doubao', 'connect', 'acc-1', {})
  assert.deepEqual(res, { ok: true })
})

test('healthCheck returns ok when composer is visible', async () => {
  const { runtime } = await build()

  const res = await runtime.invoke('doubao', 'healthCheck', 'acc-1', {})
  assert.deepEqual(res, { status: 'ok' })
})

test('sendMessage returns ok with content and finishReason stop', async () => {
  const { runtime } = await build()

  const res = await runtime.invoke('doubao', 'sendMessage', 'acc-1', { message: 'hi' })
  assert.deepEqual(res, {
    ok: true,
    content: 'hello from the fake page',
    finishReason: 'stop',
  })
})

test('chatgpt runtime also supports connect/healthCheck/sendMessage', async () => {
  const browser = fakeBrowserManager()
  const sessions = fakeSessionManager()
  const runtime = new ProviderRuntime(browser, sessions)
  await runtime.loadProvider('chatgpt')

  assert.deepEqual(await runtime.invoke('chatgpt', 'connect', 'acc-2', {}), { ok: true })
  assert.equal(sessions.saves.length, 1)
  assert.equal(sessions.saves[0].providerId, 'chatgpt')

  assert.deepEqual(await runtime.invoke('chatgpt', 'healthCheck', 'acc-2', {}), { status: 'ok' })
  assert.deepEqual(await runtime.invoke('chatgpt', 'sendMessage', 'acc-2', { message: 'hey' }), {
    ok: true,
    content: 'hello from the fake page',
    finishReason: 'stop',
  })
})

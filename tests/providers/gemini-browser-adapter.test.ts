/**
 * GeminiBrowserAdapter — drives the managed Playwright browser (gemini.google.com)
 * to send a chat message through the live web UI.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { GeminiBrowserAdapter } from '../../src/main/proxy/adapters/geminiBrowser.ts'

function fakePage(opts: { composerVisible?: boolean; replyText?: string; replyFound?: boolean } = {}) {
  const composerVisible = opts.composerVisible ?? true
  const replyText = opts.replyText ?? 'Gemini 协议探测成功。'
  const replyFound = opts.replyFound ?? true
  const calls: string[] = []
  const locator = {
    async isVisible() {
      return composerVisible
    },
    async fill(value: string) {
      calls.push(`fill:${value}`)
    },
    async click() {
      calls.push('click')
    },
    async count() {
      return 1
    },
    async innerText() {
      return replyText
    },
    last() {
      return locator
    },
    first() {
      return locator
    },
  }
  return {
    calls,
    page: {
      async goto() {},
      async waitForSelector() {},
      async waitForFunction() {},
      async waitForTimeout() {},
      keyboard: {
        press: async () => { calls.push('press:Enter') },
        type: async (text: string) => { calls.push(`type:${text}`) },
      },
      locator() {
        return locator
      },
      async evaluate() {
        // Simulate Gemini's DOM returning the reply text
        return replyFound ? replyText : ''
      },
    },
  }
}

function fakeContext(page: ReturnType<typeof fakePage>['page']) {
  return {
    pages: () => [page],
    async newPage() {
      return page
    },
  }
}

const MESSAGES = [{ role: 'user', content: '你好 Gemini' }]

test('sends the last user message via keyboard and returns the assistant reply', async () => {
  const fake = fakePage({ replyText: 'Gemini 协议探测成功。' })
  const adapter = new GeminiBrowserAdapter(fakeContext(fake.page), 'gemini-2.5-flash')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, true)
  assert.equal(res.content, 'Gemini 协议探测成功。')
  assert.equal(res.finishReason, 'stop')
  assert.ok(fake.calls.some((c) => c === 'type:你好 Gemini'), 'keyboard should type the user message')
  assert.ok(fake.calls.includes('press:Enter'), 'Enter should be pressed to send')
})

test('returns a structured failure when the composer is not visible (not logged in)', async () => {
  const fake = fakePage({ composerVisible: false })
  const adapter = new GeminiBrowserAdapter(fakeContext(fake.page), 'gemini-2.5-flash')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.equal(res.content, '')
  assert.match(res.error || '', /composer|logged/i)
})

test('returns a structured failure when no reply text is found', async () => {
  const fake = fakePage({ replyFound: false, replyText: '' })
  const adapter = new GeminiBrowserAdapter(fakeContext(fake.page), 'gemini-2.5-flash')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.match(res.error || '', /reply not detected/i)
})

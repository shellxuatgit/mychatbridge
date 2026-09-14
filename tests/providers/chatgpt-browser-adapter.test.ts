/**
 * ChatGPTBrowserAdapter — sends a chat message through the managed Playwright
 * browser (chatgpt.com UI) instead of the retired direct backend-api endpoint.
 *
 * The fake page mirrors provider-runtime-connect.test.ts: locator calls are
 * self-chaining so both the `last()` chain and direct calls resolve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ChatGPTBrowserAdapter } from '../../src/main/proxy/adapters/chatgptBrowser.ts'

const ASSISTANT_SELECTOR = 'div[data-message-author-role="assistant"]'

function fakePage(opts: { composerVisible?: boolean; replyText?: string; requestModel?: string } = {}) {
  const composerVisible = opts.composerVisible ?? true
  const replyText = opts.replyText ?? 'fake reply'
  const requestModel = opts.requestModel
  const calls: string[] = []
  const requestHandlers: Array<(request: unknown) => void> = []
  const locator = {
    async isVisible() {
      return composerVisible
    },
    async fill(value: string) {
      calls.push(`fill:${value}`)
    },
    async click() {
      calls.push('click')
      // Simulate the page firing its conversation request when sent.
      if (requestModel) {
        for (const handler of requestHandlers) {
          handler({
            method: () => 'POST',
            url: () => 'https://chatgpt.com/backend-api/f/conversation',
            postData: () => JSON.stringify({ model: requestModel, messages: [] }),
          })
        }
      }
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
  }
  return {
    calls,
    page: {
      async goto() {},
      async waitForSelector() {},
      async waitForFunction() {},
      locator() {
        return locator
      },
      on(event: string, handler: (request: unknown) => void) {
        if (event === 'request') requestHandlers.push(handler)
      },
      off() {},
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

const MESSAGES = [{ role: 'user', content: '你好' }]

test('sends the last user message via the composer and returns the assistant reply', async () => {
  const fake = fakePage({ replyText: '模型回复内容' })
  const adapter = new ChatGPTBrowserAdapter(fakeContext(fake.page), 'chatgpt-auto')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, true)
  assert.equal(res.content, '模型回复内容')
  assert.equal(res.finishReason, 'stop')
  assert.ok(fake.calls.includes('fill:你好'), 'composer should receive the user message')
  assert.ok(fake.calls.includes('click'), 'send button should be clicked')
})

test('captures the real model slug from the conversation request', async () => {
  const fake = fakePage({ requestModel: 'gpt-5.2-turbo', replyText: 'ok' })
  const adapter = new ChatGPTBrowserAdapter(fakeContext(fake.page), 'chatgpt-auto')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, true)
  assert.equal(res.model, 'gpt-5.2-turbo')
})

test('returns undefined model when no conversation request is observed', async () => {
  const fake = fakePage({ replyText: 'ok' })
  const adapter = new ChatGPTBrowserAdapter(fakeContext(fake.page), 'chatgpt-auto')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.model, undefined)
})

test('returns a structured failure when the composer is not visible (not logged in)', async () => {
  const fake = fakePage({ composerVisible: false })
  const adapter = new ChatGPTBrowserAdapter(fakeContext(fake.page), 'chatgpt-auto')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.equal(res.content, '')
  assert.match(res.error || '', /composer|logged/i)
})

test('returns a structured failure when no assistant reply arrives', async () => {
  const fake = fakePage()
  // Simulate waitForFunction timing out.
  ;(fake.page as any).waitForFunction = async () => {
    throw new Error('timeout')
  }
  const adapter = new ChatGPTBrowserAdapter(fakeContext(fake.page), 'chatgpt-auto')

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.match(res.error || '', /reply not detected/i)
})

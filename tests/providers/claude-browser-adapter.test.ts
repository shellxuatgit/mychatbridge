/**
 * ClaudeBrowserAdapter — drives the managed Playwright browser (claude.ai UI)
 * and parses the intercepted `/completion` SSE stream for text and token usage.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ClaudeBrowserAdapter } from '../../src/main/proxy/adapters/claudeBrowser.ts'

const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"chatcompl_1","type":"message","role":"assistant","model":"claude-sonnet-5","content":[]}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"4"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"2"}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

function fakePage(opts: { status?: number; sse?: string; onEnter?: boolean } = {}) {
  const status = opts.status ?? 200
  const sse = opts.sse ?? SSE
  const fireOnEnter = opts.onEnter ?? true
  const calls: string[] = []
  const responseHandlers: Array<(res: unknown) => void> = []
  const editor = {
    first() {
      return editor
    },
    async waitFor() {},
    async click() {
      calls.push('click')
    },
  }
  return {
    calls,
    page: {
      async goto() {},
      locator() {
        return editor
      },
      keyboard: {
        async type(v: string) {
          calls.push(`type:${v}`)
        },
        async press(k: string) {
          calls.push(`press:${k}`)
          if (k === 'Enter' && fireOnEnter) {
            for (const handler of responseHandlers) {
              handler({
                url: () => 'https://claude.ai/api/organizations/org/chat_conversations/cid/completion',
                status: () => status,
                request: () => ({ method: () => 'POST' }),
                text: async () => sse,
              })
            }
          }
        },
      },
      async waitForTimeout() {},
      on(event: string, handler: (res: unknown) => void) {
        if (event === 'response') responseHandlers.push(handler)
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

const MESSAGES = [{ role: 'user', content: '15+27?' }]

test('parses the completion SSE into assistant text and detected model', async () => {
  const fake = fakePage()
  const adapter = new ClaudeBrowserAdapter(fakeContext(fake.page), 'claude-3-5-sonnet-20241022')

  const res = await adapter.chatCompletion(MESSAGES, false)

  assert.equal(res.ok, true)
  assert.equal(res.content, '42')
  assert.equal(res.model, 'claude-sonnet-5')
  assert.equal(res.finishReason, 'stop')
  assert.ok(fake.calls.includes('type:15+27?'))
  assert.ok(fake.calls.includes('press:Enter'))
})

test('estimates token usage from prompt and completion lengths', async () => {
  const fake = fakePage()
  const adapter = new ClaudeBrowserAdapter(fakeContext(fake.page), 'claude-3-5-sonnet-20241022')

  const res = await adapter.chatCompletion(MESSAGES, false)

  assert.ok(res.usage, 'usage should be present')
  assert.equal(res.usage!.totalTokens, res.usage!.promptTokens + res.usage!.completionTokens)
  assert.ok(res.usage!.promptTokens > 0)
  assert.ok(res.usage!.completionTokens > 0)
})

test('returns a non-streaming response when stream is false', async () => {
  const fake = fakePage()
  const adapter = new ClaudeBrowserAdapter(fakeContext(fake.page), 'claude-3-5-sonnet-20241022')

  const res = await adapter.chatCompletion(MESSAGES, false)

  assert.equal(res.stream, undefined)
})

test('returns a structured failure when the upstream completion is not 200', async () => {
  const fake = fakePage({ status: 500 })
  const adapter = new ClaudeBrowserAdapter(fakeContext(fake.page), 'claude-3-5-sonnet-20241022')

  const res = await adapter.chatCompletion(MESSAGES, false)

  assert.equal(res.ok, false)
  assert.equal(res.content, '')
  assert.match(res.error || '', /non-200/i)
})

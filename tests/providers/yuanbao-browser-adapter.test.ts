/**
 * YuanbaoBrowserAdapter — drives the managed Playwright browser (yuanbao UI) and
 * parses the intercepted `/api/chat/<id>` SSE stream for assistant text and the
 * authoritative token usage carried on the final `meta` event.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { YuanbaoBrowserAdapter } from '../../src/main/proxy/adapters/yuanbaoBrowser.ts'

const SSE = [
  'data: {"type":"text"}',
  '',
  'data: {"type":"deepSearchAgent","contents":[{"cmpid":"2","type":"think","cat":"think","text":"thinking..."}]}',
  '',
  'data: {"type":"deepSearchAgent","contents":[{"cmpid":"3","type":"text","text":"4"}]}',
  '',
  'data: {"type":"deepSearchAgent","contents":[{"cmpid":"3","type":"text","text":"2"}]}',
  '',
  'data: {"type":"meta","stopReason":"stop","tokenUsageInfo":{"promptTokens":6691,"completionTokens":104,"totalTokens":6795}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

function fakePage(opts: { status?: number; sse?: string; fireOnEnter?: boolean } = {}) {
  const status = opts.status ?? 200
  const sse = opts.sse ?? SSE
  const fireOnEnter = opts.fireOnEnter ?? true
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
                url: () => 'https://yuanbao.tencent.com/api/chat/0QPFxxxx',
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

const MESSAGES = [{ role: 'user', content: '请只回复数字 42' }]

test('concatenates assistant text and ignores reasoning chunks', async () => {
  const fake = fakePage()
  const adapter = new YuanbaoBrowserAdapter(fakeContext(fake.page))

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, true)
  assert.equal(res.content, '42')
  assert.equal(res.finishReason, 'stop')
  assert.ok(!res.content.includes('thinking'))
})

test('surfaces the authoritative tokenUsageInfo from the meta event', async () => {
  const fake = fakePage()
  const adapter = new YuanbaoBrowserAdapter(fakeContext(fake.page))

  const res = await adapter.chatCompletion(MESSAGES)

  assert.deepEqual(res.usage, { promptTokens: 6691, completionTokens: 104, totalTokens: 6795 })
})

test('types the last user message and submits with Enter', async () => {
  const fake = fakePage()
  const adapter = new YuanbaoBrowserAdapter(fakeContext(fake.page))

  await adapter.chatCompletion(MESSAGES)

  assert.ok(fake.calls.includes('type:请只回复数字 42'))
  assert.ok(fake.calls.includes('press:Enter'))
})

test('returns a structured failure when no assistant text is present', async () => {
  const fake = fakePage({ sse: 'data: {"type":"text"}\n\n' })
  const adapter = new YuanbaoBrowserAdapter(fakeContext(fake.page))

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.match(res.error || '', /no assistant text/i)
})

test('returns a structured failure when upstream is not 200', async () => {
  const fake = fakePage({ status: 500 })
  const adapter = new YuanbaoBrowserAdapter(fakeContext(fake.page))

  const res = await adapter.chatCompletion(MESSAGES)

  assert.equal(res.ok, false)
  assert.match(res.error || '', /non-200/i)
})

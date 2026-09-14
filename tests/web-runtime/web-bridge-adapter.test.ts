import test from 'node:test'
import assert from 'node:assert/strict'

import { WebBridgeAdapter } from '../../src/main/proxy/adapters/webBridge.ts'
import type { Account, Provider } from '../../src/main/store/types.ts'

/**
 * Minimal mock of the WebRuntimeClient surface actually used by
 * WebBridgeAdapter — a single `request(method, params)` JSON-RPC call.
 */
function makeRuntime(res: { content: string; finishReason: string }) {
  const calls: Array<{ method: string; params: Record<string, any> }> = []
  return {
    calls,
    client: {
      async request(method: string, params: Record<string, any>) {
        calls.push({ method, params })
        return res
      },
    },
  }
}

const webProvider: Provider = {
  id: 'chatgpt-web',
  name: 'ChatGPT',
  type: 'web',
  authType: 'browser',
  apiEndpoint: '',
  headers: {},
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
}

const webAccount: Account = {
  id: 'acc-1',
  providerId: 'chatgpt-web',
  name: 'ChatGPT Web',
  credentials: {},
  status: 'active',
  createdAt: 0,
  updatedAt: 0,
}

test('chatCompletion returns normalized {content, finishReason} from sidecar', async () => {
  const { client, calls } = makeRuntime({ content: 'ok', finishReason: 'stop' })
  const adapter = new WebBridgeAdapter(webProvider, webAccount, client)

  const res = await adapter.chatCompletion({
    model: 'chatgpt-web',
    messages: [{ role: 'user', content: 'hi' }],
  })

  assert.deepEqual(res, { content: 'ok', finishReason: 'stop' })
  assert.equal(calls.length, 1)
})

test('chatCompletion invokes browser.invoke with provider id minus -web suffix and user message', async () => {
  const { client, calls } = makeRuntime({ content: 'ok', finishReason: 'stop' })
  const adapter = new WebBridgeAdapter(webProvider, webAccount, client)

  await adapter.chatCompletion({
    model: 'chatgpt-web',
    messages: [{ role: 'user', content: 'hi' }],
  })

  assert.equal(calls.length, 1, 'runtime.request called exactly once')
  assert.equal(calls[0].method, 'browser.invoke')

  const params = calls[0].params
  // id `chatgpt-web` loses the `-web` suffix -> `chatgpt`
  assert.equal(params.provider, 'chatgpt')
  assert.equal(params.action, 'sendMessage')
  assert.equal(params.account_id, 'acc-1')
  // last message content forwarded verbatim; conversation starts fresh
  assert.equal(params.params.message, 'hi')
  assert.equal(params.params.conversation_id, null)
})

test('chatCompletion tolerates missing last message content (empty string fallback)', async () => {
  const { client, calls } = makeRuntime({ content: 'noop', finishReason: 'stop' })
  const adapter = new WebBridgeAdapter(webProvider, webAccount, client)

  const res = await adapter.chatCompletion({
    model: 'chatgpt-web',
    messages: [{ role: 'user', content: '' }],
  })

  assert.equal(res.content, 'noop')
  assert.equal(calls[0].params.params.message, '')
})

test('chatCompletion falls back to empty content / stop when sidecar reply omits fields', async () => {
  const { client } = makeRuntime({} as { content: string; finishReason: string })
  const adapter = new WebBridgeAdapter(webProvider, webAccount, client)

  const res = await adapter.chatCompletion({
    model: 'chatgpt-web',
    messages: [{ role: 'user', content: 'hi' }],
  })

  assert.deepEqual(res, { content: '', finishReason: 'stop' })
})
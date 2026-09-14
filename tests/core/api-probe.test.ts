import test from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'http'
import Koa from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { probeOpenAiApi, type ProbeResult } from '../../src/main/proxy/apiProbe.ts'

async function withServer(
  buildApp: () => Koa,
  fn: (port: number) => Promise<void>
): Promise<void> {
  const app = buildApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const port = (server.address() as any).port
  try {
    await fn(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function openAiServer(over: {
  modelsBody?: unknown
  chatBody?: unknown
  chatStatus?: number
} = {}) {
  return () => {
    const app = new Koa()
    app.use(bodyParser())
    const r = new Router()
    r.get('/v1/models', async (ctx) => {
      ctx.body = over.modelsBody ?? {
        object: 'list',
        data: [{ id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' }],
      }
    })
    r.post('/v1/chat/completions', async (ctx) => {
      const { model, messages } = ctx.request.body as any
      assert.equal(typeof model, 'string')
      assert.ok(Array.isArray(messages))
      assert.equal(messages[0].role, 'user')
      ctx.status = over.chatStatus ?? 200
      ctx.body = over.chatBody ?? {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })
    app.use(r.routes())
    return app
  }
}

test('probeOpenAiApi returns ok with model list and reply when the server is OpenAI-compliant', async () => {
  await withServer(openAiServer(), async (port) => {
    const result = await probeOpenAiApi({ host: '127.0.0.1', port, model: 'gpt-4o' })
    assert.equal(result.ok, true)
    assert.ok(Array.isArray(result.models))
    assert.ok(result.models!.some((m) => m === 'gpt-4o'))
    assert.equal(result.reply, 'Hi there')
    assert.ok(result.latencyMs >= 0)
    assert.equal(result.error, undefined)
  })
})

test('probeOpenAiApi fails when /v1/chat/completions response lacks choices[0].message.content', async () => {
  await withServer(openAiServer({
    chatBody: { id: 'x', object: 'chat.completion', model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant' } }] },
  }), async (port) => {
    const result = await probeOpenAiApi({ host: '127.0.0.1', port, model: 'gpt-4o' })
    assert.equal(result.ok, false)
    assert.match(result.error!, /choices/i)
  })
})

test('probeOpenAiApi fails when /v1/models response is not an OpenAI list', async () => {
  await withServer(openAiServer({ modelsBody: { data: 'not-an-array' } }), async (port) => {
    const result = await probeOpenAiApi({ host: '127.0.0.1', port, model: 'gpt-4o' })
    assert.equal(result.ok, false)
    assert.match(result.error!, /models/i)
  })
})

test('probeOpenAiApi fails on non-200 chat response', async () => {
  await withServer(openAiServer({ chatStatus: 401, chatBody: { error: { message: 'unauthorized' } } }), async (port) => {
    const result = await probeOpenAiApi({ host: '127.0.0.1', port, model: 'gpt-4o' })
    assert.equal(result.ok, false)
    assert.match(result.error!, /401/i)
  })
})

test('probeOpenAiApi fails when the endpoint is unreachable', async () => {
  const result = await probeOpenAiApi({ host: '127.0.0.1', port: 1, model: 'gpt-4o', timeoutMs: 500 })
  assert.equal(result.ok, false)
  assert.ok(result.error && result.error.length > 0)
})

test('probeOpenAiApi reads chat reply from choices[0].message.content', async () => {
  await withServer(openAiServer({
    chatBody: {
      id: 'chatcmpl-2',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Second reply' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  }), async (port) => {
    const result = await probeOpenAiApi({ host: '127.0.0.1', port, model: 'gpt-4o' })
    assert.equal(result.ok, true)
    assert.equal(result.reply, 'Second reply')
  })
})

test('probeOpenAiApi uses an available model from the models response', async () => {
  let received: { model?: string; messages?: Array<{ role?: string; content?: string }> } | null = null
  const app = new Koa()
  app.use(bodyParser())
  const r = new Router()
  r.get('/v1/models', async (ctx) => {
    ctx.body = { object: 'list', data: [{ id: 'custom-model', object: 'model', created: 0, owned_by: 'test' }] }
  })
  r.post('/v1/chat/completions', async (ctx) => {
    received = ctx.request.body as any
    ctx.body = { choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }] }
  })
  app.use(r.routes())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const port = (server.address() as any).port
  try {
    await probeOpenAiApi({ host: '127.0.0.1', port, model: 'custom-model' })
    assert.equal(received!.model, 'custom-model')
    assert.equal(received!.messages![0].role, 'user')
    assert.equal(typeof received!.messages![0].content, 'string')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

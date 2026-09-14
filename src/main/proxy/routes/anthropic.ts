import Router from '@koa/router'
import type { Context } from 'koa'
import chatRouter from './chat.ts'
import {
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
  createAnthropicStreamTransform,
} from '../protocol/anthropic.ts'

/**
 * Anthropic Messages API compatibility route.
 * The request is normalized to the existing OpenAI-compatible internal route,
 * so provider routing/failover remains shared by both protocols.
 */
const router = new Router()

router.post('/v1/messages', async (ctx: Context) => {
  const originalPath = ctx.path
  const originalBody = ctx.request.body
  const originalAccept = ctx.get('Accept')

  if (!originalBody || typeof originalBody !== 'object') {
    ctx.status = 400
    ctx.body = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Invalid request body' },
    }
    return
  }

  if (!originalBody.model) {
    ctx.status = 400
    ctx.body = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'model is required' },
    }
    return
  }

  if (!Array.isArray(originalBody.messages) || originalBody.messages.length === 0) {
    ctx.status = 400
    ctx.body = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages is required' },
    }
    return
  }

  // Reuse the existing /v1/chat/completions handler. This avoids maintaining
  // a second copy of routing, account selection, failover, logging, etc.
  ctx.path = '/v1/chat/completions'
  ctx.request.body = anthropicRequestToOpenAI(originalBody)

  try {
    const chatMiddleware = chatRouter.routes()
    await chatMiddleware(ctx, async () => {})
  } finally {
    ctx.path = originalPath
    ctx.request.body = originalBody
  }

  if (ctx.status >= 400) {
    // Convert the internal OpenAI-style error envelope to Anthropic's envelope.
    const internal = ctx.body as any
    ctx.body = {
      type: 'error',
      error: {
        type: internal?.error?.code || internal?.error?.type || 'api_error',
        message: internal?.error?.message || 'Request failed',
      },
    }
    return
  }

  const body = ctx.body
  const model = originalBody.model

  if (originalBody.stream === true && body && typeof (body as any).pipe === 'function') {
    ctx.set('Content-Type', 'text/event-stream')
    ctx.set('Cache-Control', 'no-cache')
    ctx.set('Connection', 'keep-alive')
    ctx.set('X-Accel-Buffering', 'no')
    if (originalAccept) ctx.set('Accept', originalAccept)
    ctx.body = (body as any).pipe(createAnthropicStreamTransform(model))
    return
  }

  ctx.body = openAIResponseToAnthropic(body, model)
  ctx.set('Content-Type', 'application/json')
})

export default router

/**
 * Proxy Service Module - Multi-LLM Route
 * Implements POST /v1/chat/multi
 *
 * Sends the same request to multiple providers concurrently, then aggregates
 * the results via the selected aggregation mode (parallel/race/vote/merge/best).
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { loadBalancer } from '../loadbalancer'
import { requestForwarder } from '../forwarder'
import { proxyStatusManager } from '../status'
import { storeManager } from '../../store/store'
import { modelMapper } from '../modelMapper'
import type { ProxyContext } from '../types'
import type {
  MultiLlmRequest,
  ProviderResult,
  AggregationMode,
} from '../core/multiLlm.ts'
import { MultiLlmError } from '../core/multiLlm.ts'
import {
  aggregate,
  buildJudgeResult,
} from '../core/multiLlmAggregator.ts'

const router = new Router({ prefix: '/v1/chat' })

function generateRequestId(): string {
  return `chatcmpl-multi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * POST /v1/chat/multi
 *
 * Accepts a MultiLlmRequest body and aggregates results from multiple providers.
 */
router.post('/multi', async (ctx: Context) => {
  const startTime = Date.now()
  const requestId = generateRequestId()
  let body: MultiLlmRequest

  try {
    body = ctx.request.body as MultiLlmRequest
  } catch {
    ctx.status = 400
    ctx.body = { error: { message: 'Invalid request body', type: 'invalid_request_error' } }
    return
  }

  if (!body.request?.model || !body.request?.messages) {
    ctx.status = 400
    ctx.body = { error: { message: 'Missing required fields: request.model and request.messages', type: 'invalid_request_error' } }
    return
  }

  if (!body.providers || body.providers.length < 2) {
    ctx.status = 400
    ctx.body = { error: { message: 'Multi-LLM requires at least 2 providers', type: 'invalid_request_error', code: 'too_few_providers' } }
    return
  }

  const aggregation: AggregationMode = body.aggregation || 'race'
  const config = storeManager.getConfig()
  const timeoutMs = body.timeoutMs || 120000

  // Fire requests to all providers concurrently (with timeout).
  const providerPromises: Promise<ProviderResult>[] = body.providers.map(
    (target) => fireProvider(body, target.providerId, target.model, config, timeoutMs)
  )

  // Wait for all providers to respond (don't short-circuit on race — we need
  // all results for vote/merge/best even if one comes back fast).
  const allResults = await Promise.allSettled(providerPromises)
  const results: ProviderResult[] = allResults.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value
    }
    return {
      providerId: body.providers[i].providerId,
      model: body.request.model,
      success: false,
      text: '',
      error: r.reason?.message || 'Provider request failed',
      latencyMs: 0,
    }
  })

  // Aggregate results.
  const outcome = aggregate(aggregation, results, {
    minVotes: body.minVotes,
    judgeProviderId: body.judgeProviderId,
  })

  // For merge/best: send the judge prompt to the judge provider.
  if (outcome.kind === 'judge') {
    const judgeId = body.judgeProviderId || body.providers[0].providerId
    const judgeModel = body.judgeModel || body.request.model
    try {
      const judgeBody: MultiLlmRequest = {
        request: {
          ...body.request,
          messages: [{ role: 'user', content: outcome.prompt }],
          model: judgeModel,
        },
        providers: [{ providerId: judgeId }],
        aggregation: 'race',
      }
      const judgeResult = await fireProvider(judgeBody, judgeId, judgeModel, config, timeoutMs)
      if (judgeResult.success) {
        const final = buildJudgeResult(outcome.results, judgeResult.text, outcome.judgeMode, judgeId)
        ctx.status = 200
        ctx.body = { ...final, id: requestId }
        return
      }
      // Judge failed: fall back to first successful direct result.
      const first = results.find(r => r.success && r.text)
      if (first) {
        ctx.status = 200
        ctx.body = {
          text: first.text,
          results,
          contributors: [first.providerId],
          totalLatencyMs: Date.now() - startTime,
          aggregation,
          id: requestId,
        }
        return
      }
    } catch (err) {
      // Judge failed: fall through.
    }
  }

  ctx.status = 200
  ctx.body = {
    text: outcome.kind === 'direct' ? outcome.result.text : '',
    results,
    contributors: outcome.kind === 'direct' ? outcome.result.contributors : [],
    totalLatencyMs: Date.now() - startTime,
    aggregation,
    id: requestId,
  }
})

/**
 * Fire a single provider request. Returns a ProviderResult.
 */
async function fireProvider(
  body: MultiLlmRequest,
  providerId: string,
  modelOverride: string | undefined,
  config: any,
  timeoutMs: number
): Promise<ProviderResult> {
  const startTime = Date.now()
  const model = modelOverride || body.request.model

  try {
    const selection = loadBalancer.selectAccount(model, config.loadBalanceStrategy, providerId)
    if (!selection) {
      return {
        providerId,
        model,
        success: false,
        text: '',
        error: `No available account for provider ${providerId}`,
        latencyMs: Date.now() - startTime,
      }
    }

    const context: ProxyContext = {
      requestId: `${generateRequestId()}-${providerId}`,
      providerId: selection.provider.id,
      accountId: selection.account.id,
      model,
      actualModel: selection.actualModel,
      startTime,
      isStream: false,
      clientIP: undefined,
    }

    // Temporarily override the model for this provider.
    const providerRequest = { ...body.request, model: selection.actualModel }

    const result = await Promise.race([
      requestForwarder.forwardChatCompletion(
        providerRequest,
        selection.account,
        selection.provider,
        selection.actualModel,
        context
      ),
      new Promise<{ success: false; error: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Provider timeout')), timeoutMs)
      ),
    ])

    const latency = Date.now() - startTime

    if (!result.success) {
      return {
        providerId,
        model,
        success: false,
        text: '',
        error: result.error || 'Request failed',
        latencyMs: latency,
      }
    }

    // Extract text from the result body.
    let text = ''
    if (result.body?.choices?.[0]?.message?.content) {
      text = result.body.choices[0].message.content
    } else if (result.body?.choices?.[0]?.text) {
      text = result.body.choices[0].text
    } else if (typeof result.body === 'string') {
      text = result.body
    }

    return {
      providerId,
      model,
      success: true,
      text,
      latencyMs: latency,
    }
  } catch (error) {
    return {
      providerId,
      model,
      success: false,
      text: '',
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - startTime,
    }
  }
}

export default router

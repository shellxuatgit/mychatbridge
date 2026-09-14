/**
 * Proxy Service Module - Chat Completions Route
 * Implements /v1/chat/completions route
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { PassThrough } from 'stream'
import { ChatCompletionRequest, ChatCompletionResponse, ProxyContext } from '../types'
import { loadBalancer } from '../loadbalancer'
import { requestForwarder } from '../forwarder'
import { streamHandler } from '../stream'
import { proxyStatusManager } from '../status'
import { modelMapper } from '../modelMapper'
import { normalizeUsage, parseSseUsage, estimateUsage, extractSseText, type TokenUsage } from '../usage'
import { storeManager } from '../../store/store'
import { sessionManager } from '../sessionManager'
import { classifyError } from '../core/errorClassification.ts'
import { FallbackGraph, resolveFallback } from '../core/fallbackGraph.ts'
import {
  isAnthropicToolFormat,
  transformResponseToAnthropic,
  transformChunkToAnthropic
} from '../utils/toolFormatConverter'

const router = new Router({ prefix: '/v1/chat' })

/**
 * Generate Request ID
 */
function generateRequestId(): string {
  return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get Client IP
 */
function getClientIP(ctx: Context): string {
  return ctx.headers['x-real-ip'] as string ||
    ctx.headers['x-forwarded-for'] as string ||
    ctx.ip ||
    'unknown'
}

/**
 * Extract user input from messages (last user message, full content)
 */
function extractUserInput(messages: Array<{ role: string; content?: string | any[] | null }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content) {
      let content = ''
      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p: any) => p.type === 'text')
        if (textParts.length > 0) {
          content = textParts.map((p: any) => p.text || '').join(' ')
        }
      }
      if (content) {
        return content
      }
    }
  }
  return undefined
}

/**
 * Handle Chat Completions Request
 */
router.post('/completions', async (ctx: Context) => {
  const startTime = Date.now()
  const requestId = generateRequestId()
  const clientIP = getClientIP(ctx)

  let request: ChatCompletionRequest
  try {
    request = ctx.request.body as ChatCompletionRequest
  } catch (error) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    }
    return
  }

  if (!request.model) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: model',
        type: 'invalid_request_error',
        param: 'model',
        code: null,
      },
    }
    return
  }

  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: messages',
        type: 'invalid_request_error',
        param: 'messages',
        code: null,
      },
    }
    return
  }

  // Read feature parameters from Headers (lower priority than request body)
  const webSearchFromHeader = ctx.headers['x-web-search'] === 'true'
  const reasoningEffortFromHeader = ctx.headers['x-reasoning-effort'] as 'low' | 'medium' | 'high' | undefined
  const deepResearchFromHeader = ctx.headers['x-deep-research'] === 'true'

  // Handle reasoningEffort (camelCase) from AI SDK - convert to reasoning_effort (snake_case)
  const requestAny = request as any
  if (requestAny.reasoningEffort && !request.reasoning_effort) {
    request.reasoning_effort = requestAny.reasoningEffort
    console.log('[Chat] Reasoning effort set via reasoningEffort (camelCase):', requestAny.reasoningEffort)
    delete requestAny.reasoningEffort
  }

  // Merge into request (request body parameters take priority)
  if (webSearchFromHeader && request.web_search === undefined) {
    request.web_search = true
    console.log('[Chat] Web search enabled via X-Web-Search header')
  }
  if (reasoningEffortFromHeader && request.reasoning_effort === undefined) {
    request.reasoning_effort = reasoningEffortFromHeader
    console.log('[Chat] Reasoning effort set via X-Reasoning-Effort header:', reasoningEffortFromHeader)
  }
  if (deepResearchFromHeader && request.deep_research === undefined) {
    request.deep_research = true
    console.log('[Chat] Deep research enabled via X-Deep-Research header')
  }

  // Capability-aware routing: clients can declare required capabilities via
  // the X-Required-Capabilities header (comma-separated keys like "vision,tools").
  // Only providers satisfying ALL listed capabilities will be selected.
  const requiredCaps = ctx.headers['x-required-capabilities'] as string | undefined
  const requiredCapabilities = requiredCaps
    ? Object.fromEntries(
        requiredCaps.split(',').map(k => [k.trim().toLowerCase(), true])
      )
    : undefined

  const config = storeManager.getConfig()
  const fallbackGraph = new FallbackGraph(config.fallbackGraph)
  let preferredProviderId = modelMapper.getPreferredProvider(request.model)
  let preferredAccountId = modelMapper.getPreferredAccount(request.model)

  // Sticky session: a client-provided session_id pins the request to the
  // provider+account the session is bound to, so multi-turn conversations stay
  // on the same instance. Falls back to normal routing when unknown/expired.
  const sessionId = (request as any).session_id as string | undefined
  if (sessionId) {
    const sticky = sessionManager.resolveStickySession(sessionId)
    if (sticky) {
      preferredAccountId = sticky.accountId
      if (!preferredProviderId) {
        preferredProviderId = sticky.providerId
      }
      console.log(`[Chat] Sticky session ${sessionId} -> provider=${sticky.providerId} account=${sticky.accountId}`)
    }
  }

  // Cross-instance failover: tracks instances that failed during this request so
  // a reroute excludes them and picks a different provider/account instance.
  const excludedInstanceIds: string[] = []

  const selectInstance = (exclude: string[] = []) => loadBalancer.selectAccount(
    request.model,
    config.loadBalanceStrategy,
    preferredProviderId,
    preferredAccountId,
    requiredCapabilities,
    { excludeInstanceIds: [...excludedInstanceIds, ...exclude] }
  )

  let selection = selectInstance()

  if (!selection) {
    ctx.status = 503
    ctx.body = {
      error: {
        message: `No available account for model: ${request.model}`,
        type: 'service_unavailable_error',
        param: null,
        code: 'no_available_account',
      },
    }
    return
  }

  let { account, provider, actualModel } = selection

  const context: ProxyContext = {
    requestId,
    providerId: provider.id,
    accountId: account.id,
    model: request.model,
    actualModel,
    startTime,
    isStream: request.stream || false,
    clientIP,
  }

  proxyStatusManager.recordRequestStart(request.model, provider.id, account.id)

  try {
    const result = await requestForwarder.forwardChatCompletion(
      request,
      account,
      provider,
      actualModel,
      context,
      {
        excludeInstanceIds: excludedInstanceIds,
        onInstanceFailure: (failedInstanceId, error) => {
          // Record the circuit-breaker failure for the failed instance.
          loadBalancer.recordInstanceFailure(failedInstanceId)
        },
        // After a retryable failure, pick a DIFFERENT instance excluding the
        // failed one(s) so the next attempt runs against another account.
        // The fallback graph decides whether to switch account (same provider)
        // or clear the preferred provider entirely (switch provider).
        selectFallback: (failedInstanceId, error) => {
          excludedInstanceIds.push(failedInstanceId)

          // Consult the fallback graph for the next routing decision.
          const errorClass = classifyError(error).errorClass
          const decision = resolveFallback(fallbackGraph, {
            failedProviderId: provider.id,
            failedAccountId: account.id,
            errorClass,
            totalAttempts: excludedInstanceIds.length,
            alreadySwitchedAccount: excludedInstanceIds.some(id => id.startsWith(`${provider.id}:`) && id !== failedInstanceId),
          })

          if (decision.abort) {
            return null
          }

          // next_provider → clear the preferred provider so the router can pick
          // a different provider that supports the model.
          if (decision.clearPreferredProvider) {
            preferredProviderId = undefined
          }

          const rerouted = loadBalancer.selectAccount(
            request.model,
            config.loadBalanceStrategy,
            preferredProviderId,
            undefined,
            requiredCapabilities,
            { excludeInstanceIds: excludedInstanceIds }
          )
          if (rerouted) {
            console.log(`[Chat] Fallback ${errorClass} -> ${rerouted.provider.id}:${rerouted.account.id}`)
            return {
              account: rerouted.account,
              provider: rerouted.provider,
              actualModel: rerouted.actualModel,
            }
          }
          return null
        },
        onSelection: (selection) => {
          account = selection.account
          provider = selection.provider
          actualModel = selection.actualModel
        },
      }
    )

    const latency = Date.now() - startTime

    if (!result.success) {
      proxyStatusManager.recordRequestFailure(latency)

      if (result.status && result.status >= 400 && result.status !== 429) {
        loadBalancer.markAccountFailed(account.id, provider.id)
      }

      const failureMessage = typeof result.error === 'string'
        ? result.error
        : JSON.stringify(result.error) || 'Request failed'

      ctx.status = result.status || 500
      ctx.body = {
        error: {
          message: failureMessage || 'Request failed',
          type: 'api_error',
          param: null,
          code: null,
        },
      }

      storeManager.addLog('error', `Request failed: ${failureMessage}`, {
        requestId,
        providerId: provider.id,
        accountId: account.id,
        model: request.model,
        latency,
      })

      const userInput = extractUserInput(request.messages)
      const errorResponseBody = JSON.stringify({
        error: {
          message: failureMessage || 'Request failed',
          type: 'api_error',
          param: null,
          code: null,
        },
      })
      storeManager.addRequestLog({
        timestamp: startTime,
        status: 'error',
        statusCode: result.status || 500,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        responseStatus: result.status || 500,
        responseBody: errorResponseBody,
        latency,
        isStream: request.stream || false,
        errorMessage: failureMessage,
      })

      storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)

      return
    }

    loadBalancer.clearAccountFailure(account.id, provider.id)

    proxyStatusManager.recordRequestSuccess(latency)

    storeManager.updateAccount(account.id, {
      lastUsed: Date.now(),
      requestCount: (account.requestCount || 0) + 1,
      todayUsed: (account.todayUsed || 0) + 1,
    })

    // Persist the conversation transcript into the session for sticky routing:
    // creates (or reuses) a session bound to this provider+account and appends
    // the user/assistant messages. Provider-side conversation ids remain owned
    // by each adapter; the session only stores the sticky binding + transcript.
    if (sessionId) {
      const session = sessionManager.getSession(sessionId)
      if (!session || session.status !== 'active') {
        sessionManager.createSession({
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
        })
      }
      const transcript = request.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content : '',
          timestamp: Date.now(),
        }))
      sessionManager.appendMessages(sessionId, transcript as any)
    }

    storeManager.addLog('debug', `Request succeeded`, {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      model: request.model,
      actualModel,
      latency,
      isStream: request.stream,
    })

    const userInput = extractUserInput(request.messages)
    // Prepare response body for logging (only for non-stream requests)
    const responseBodyForLog = !request.stream && result.body
      ? JSON.stringify(result.body)
      : undefined

    const promptText = request.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ')
    const completionText = !request.stream && result.body
      ? ((result.body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content ?? '')
      : ''
    const realUsage = !request.stream && result.body
      ? normalizeUsage((result.body as { usage?: unknown }).usage)
      : undefined
    const tokenUsage: TokenUsage | undefined = realUsage
      ?? (result.body ? estimateUsage(promptText, typeof completionText === 'string' ? completionText : '') : undefined)

    // For streaming requests, we'll collect content and update the log later
    let logEntryId: string | undefined

    if (!request.stream) {
      // Non-streaming: record log with response body now
      const logEntry = storeManager.addRequestLog({
        timestamp: startTime,
        status: 'success',
        statusCode: 200,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        responseStatus: 200,
        responseBody: responseBodyForLog,
        latency,
        isStream: false,
        usage: tokenUsage,
      })
      logEntryId = logEntry.id
    } else {
      // Streaming: record log now, will update response body later
      const logEntry = storeManager.addRequestLog({
        timestamp: startTime,
        status: 'success',
        statusCode: 200,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        responseStatus: 200,
        latency,
        isStream: true,
      })
      logEntryId = logEntry.id
    }

    storeManager.recordRequestInStats(true, latency, request.model, provider.id, account.id, tokenUsage)

    if (request.stream === true && result.stream) {
      ctx.set('Content-Type', 'text/event-stream')
      ctx.set('Cache-Control', 'no-cache')
      ctx.set('Connection', 'keep-alive')
      ctx.set('X-Accel-Buffering', 'no')

      // Create a wrapper stream to handle errors and collect content
      const wrapperStream = new PassThrough()

      // Collect stream content for logging (raw SSE output)
      let collectedContent = ''

      // Handle stream errors
      result.stream.once('error', (err: Error) => {
        console.error('[Chat] Stream error:', err.message)

        // Send error as SSE event
        const errorEvent = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: actualModel,
          choices: [{
            index: 0,
            delta: {
              content: `\n\n[Error: ${err.message}]`,
            },
            finish_reason: 'stop',
          }],
        }

        wrapperStream.write(`data: ${JSON.stringify(errorEvent)}\n\n`)
        wrapperStream.write('data: [DONE]\n\n')
        wrapperStream.end()

        storeManager.addLog('error', `Stream error: ${err.message}`, {
          requestId,
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
        })
      })

      // Check if stream is already in correct SSE format (from adapters like Kimi, GLM, DeepSeek)
      if (result.skipTransform) {
        // Stream is already formatted, pipe through wrapper and collect
        result.stream.on('data', (chunk: Buffer) => {
          collectedContent += chunk.toString()
        })

        result.stream.pipe(wrapperStream, { end: false })

        // When source stream ends normally, update log and end wrapper
        result.stream.once('end', () => {
          const usage = parseSseUsage(collectedContent)
            ?? estimateUsage(promptText, extractSseText(collectedContent))
          storeManager.recordProviderTokenUsage(provider.id, usage)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, {
              responseBody: collectedContent || undefined,
              usage,
            })
          }
          wrapperStream.end()
        })
      } else {
        // Need to transform the stream
        const transformStream = streamHandler.createTransformStream(
          actualModel,
          requestId,
          () => {
            storeManager.addLog('debug', `Stream response completed`, { requestId })
          }
        )

        // Collect from transform stream output
        transformStream.on('data', (chunk: Buffer) => {
          collectedContent += chunk.toString()
        })

        result.stream.pipe(transformStream)
        transformStream.pipe(wrapperStream, { end: false })

        transformStream.once('end', () => {
          const usage = parseSseUsage(collectedContent)
            ?? estimateUsage(promptText, extractSseText(collectedContent))
          storeManager.recordProviderTokenUsage(provider.id, usage)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, {
              responseBody: collectedContent || undefined,
              usage,
            })
          }
          wrapperStream.end()
        })
      }

      ctx.body = wrapperStream
    } else {
      ctx.set('Content-Type', 'application/json')

      if (result.body) {
        // Ensure non-zero usage when the adapter returned placeholders
        const bodyObj = result.body as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
        if (bodyObj && (!bodyObj.usage || (bodyObj.usage.prompt_tokens === 0 && bodyObj.usage.completion_tokens === 0 && (bodyObj.usage.total_tokens ?? 0) <= 0))) {
          if (tokenUsage) {
            bodyObj.usage = {
              prompt_tokens: tokenUsage.promptTokens,
              completion_tokens: tokenUsage.completionTokens,
              total_tokens: tokenUsage.totalTokens,
            }
          }
        }
        // Check if we need to transform to Anthropic format
        if (isAnthropicToolFormat(request.tool_format)) {
          ctx.body = transformResponseToAnthropic(result.body)
          console.log('[Chat] Transformed response to Anthropic tool format')
        } else {
          ctx.body = result.body
        }
      } else {
        ctx.body = {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: actualModel,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '',
            },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        }
      }
    }
  } catch (error) {
    const latency = Date.now() - startTime
    proxyStatusManager.recordRequestFailure(latency)

    const rawMessage = error instanceof Error ? error.message : undefined
    const errorMessage = rawMessage
      ? (typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage))
      : (error instanceof Error ? 'Unknown error' : JSON.stringify(error) ?? 'Unknown error')
    const errorStack = error instanceof Error ? error.stack : undefined

    ctx.status = 500
    ctx.body = {
      error: {
        message: errorMessage,
        type: 'internal_error',
        param: null,
        code: null,
      },
    }

    storeManager.addLog('error', `Request exception: ${errorMessage}`, {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      model: request.model,
      latency,
      error: errorMessage,
    })

    const userInput = extractUserInput(request.messages)
    const exceptionResponseBody = JSON.stringify({
      error: {
        message: errorMessage,
        type: 'internal_error',
        param: null,
        code: null,
      },
    })
    storeManager.addRequestLog({
      timestamp: startTime,
      status: 'error',
      statusCode: 500,
      method: 'POST',
      url: '/v1/chat/completions',
      model: request.model,
      actualModel,
      providerId: provider.id,
      providerName: provider.name,
      accountId: account.id,
      accountName: account.name,
      requestBody: JSON.stringify(request),
      userInput,
      webSearch: request.web_search,
      reasoningEffort: request.reasoning_effort,
      responseStatus: 500,
      responseBody: exceptionResponseBody,
      latency,
      isStream: request.stream || false,
      errorMessage,
      errorStack,
    })

    storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)
  }
})

export default router

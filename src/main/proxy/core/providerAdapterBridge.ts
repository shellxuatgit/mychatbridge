/**
 * Core Gateway Module - Provider Adapter Bridge
 *
 * Wraps existing per-provider adapters (`XxxAdapter` in `src/main/proxy/adapters/`)
 * behind the unified `WebProviderRuntime` contract, WITHOUT changing their
 * protocol translation logic. New providers can implement `WebProviderRuntime`
 * directly and skip the bridge.
 */

import type { Account, Provider } from '../../store/types.ts'
import type { ChatCompletionRequest, ForwardResult } from '../types.ts'
import { WebProviderError, toWebProviderError } from './providerContract.ts'
import type { WebProviderChatResult, WebProviderRuntime } from './providerContract.ts'
import { resolveCapabilities } from './capabilities.ts'

/**
 * Shape shared by all legacy adapters (`XxxAdapter`).
 * `forward` is how legacy providers are invoked: it performs the request and
 * returns a ForwardResult carrying either a stream or a parsed body.
 */
export interface LegacyAdapterLike {
  chatCompletion(request: ChatCompletionRequest): Promise<{ response: any; sessionId?: string }>
  deleteSession?(sessionId: string): Promise<boolean>
}

/**
 * A forward function morphing a legacy adapter call into the current forwarder
 * path. Signature mirrors `RequestForwarder.forwardXxx(request, account, provider, actualModel, startTime)`.
 */
export type LegacyForwardFn = (
  request: ChatCompletionRequest,
  account: Account,
  provider: Provider,
  actualModel: string,
  startTime: number
) => Promise<ForwardResult>

/**
 * Bridge that adapts a legacy adapter (or a plain forward function) to the
 * unified WebProviderRuntime contract.
 */
export class ProviderAdapterBridge implements WebProviderRuntime {
  readonly id: string
  readonly provider: Provider
  readonly account: Account

  private readonly forward: LegacyForwardFn | null
  private readonly adapter: LegacyAdapterLike | null

  constructor(options: {
    id: string
    provider: Provider
    account: Account
    forward?: LegacyForwardFn
    adapter?: LegacyAdapterLike
  }) {
    this.id = options.id
    this.provider = options.provider
    this.account = options.account
    this.forward = options.forward ?? null
    this.adapter = options.adapter ?? null
  }

  capabilities() {
    // Registry override wins; unknown providers fall back to contract default
    // derivation (handled inside resolveCapabilities).
    return resolveCapabilities(this.provider)
  }

  async chat(request: ChatCompletionRequest): Promise<WebProviderChatResult> {
    try {
      if (this.forward) {
        const result = await this.forward(request, this.account, this.provider, request.model, Date.now())
        return this.toChatResult(result)
      }
      if (this.adapter) {
        const { response, sessionId } = await this.adapter.chatCompletion(request)
        return {
          sessionId,
          response: {
            status: response?.status ?? 200,
            headers: response?.headers ?? undefined,
            body: response?.data ?? response,
            stream: response?.data && typeof (response as any)?.pipe === 'function' ? response.data : undefined,
          },
        }
      }
      throw WebProviderError.capabilityUnsupported(`${this.id}: no forward path configured`)
    } catch (error) {
      throw toWebProviderError(error)
    }
  }

  async refreshAuth(): Promise<boolean> {
    // Legacy adapters manage token refresh internally; the bridge reports that
    // there is no separate refresh entry point.
    return false
  }

  async listModels(): Promise<string[]> {
    return this.provider.supportedModels ?? []
  }

  async createSession(): Promise<{ sessionId: string }> {
    // Provider-side conversation ids are managed by each adapter internally;
    // the bridge does not pre-create sessions. Return an empty placeholder.
    return { sessionId: `${this.id}-session-${Date.now()}` }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (this.adapter?.deleteSession) {
      return this.adapter.deleteSession(sessionId)
    }
    return true
  }

  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    // Account token validation is performed by ProviderChecker / AccountManager;
    // bridge-level health = credentials present + account active.
    const creds = this.account.credentials ?? {}
    const hasCredentials = Object.values(creds).some(v => typeof v === 'string' && v.length > 0)
    if (!hasCredentials) {
      return { healthy: false, error: 'no credentials configured' }
    }
    if (this.account.status === 'error' || this.account.status === 'expired') {
      return { healthy: false, error: `account status: ${this.account.status}` }
    }
    return { healthy: true }
  }

  async getUsage(): Promise<{ used?: number; limit?: number }> {
    return {
      used: this.account.todayUsed,
      limit: this.account.dailyLimit,
    }
  }

  /**
   * Morph a ForwardResult into the unified chat result shape while preserving
   * stream passthrough semantics (skipTransform etc.).
   */
  private toChatResult(result: ForwardResult): WebProviderChatResult {
    if (!result.success) {
      const status = result.status
      const error = result.error || 'Request failed'
      throw toWebProviderError(new WebProviderError('provider_upstream_error', error, { retryable: true, status }))
    }
    return {
      sessionId: result.providerSessionId,
      response: {
        status: result.status ?? 200,
        headers: result.headers,
        body: result.body,
        stream: result.stream,
        skipTransform: result.skipTransform,
      },
    }
  }
}
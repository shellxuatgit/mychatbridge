/**
 * Core Gateway Module - Provider Runtime Contract
 * Defines a unified runtime interface for Web LLM providers.
 *
 * This is the foundation of the "Provider → Account → Instance → Session → Router"
 * abstraction. Existing provider adapters (DeepSeek, GLM, Kimi, ...) are wrapped
 * into this contract by the adapter bridge; new providers implement it directly.
 */

import type { Account, Provider } from '../../store/types.ts'
import type { ChatCompletionRequest } from '../types.ts'

/**
 * Provider capability flags. Used by the capability registry for
 * capability-aware routing (the basis for "capability routing").
 */
export interface WebProviderCapabilities {
  /** Plain text chat */
  text: boolean
  /** Image understanding */
  vision: boolean
  /** Chain-of-thought / thinking mode */
  reasoning: boolean
  /** Web search integration */
  web_search: boolean
  /** Function calling / tool use */
  tools: boolean
  /** File attachments */
  file: boolean
  /** Long context window */
  long_context: boolean
  /** Streaming responses */
  stream: boolean
}

/**
 * Unified result of a provider chat request (non-streaming view).
 */
export interface WebProviderChatResult {
  /** Provider-side conversation/session identifier (if any) */
  sessionId?: string
  /** Normalized assistant text (streaming=false) */
  text?: string
  /** Normalized response object (OpenAI compatible shape) */
  response: {
    status: number
    headers?: Record<string, string>
    body?: unknown
    stream?: NodeJS.ReadableStream
    skipTransform?: boolean
  }
  /** Raw error text when the provider call failed */
  error?: string
}

/**
 * Unified runtime contract every Web LLM provider must satisfy.
 *
 * Providers do NOT have to implement every optional method; the default
 * implementation in the adapter bridge provides reasonable fallbacks so that
 * existing adapters keep working unchanged.
 */
export interface WebProviderRuntime {
  /** Provider id (matches `Provider.id`) */
  readonly id: string
  /** Declared capability set */
  capabilities(): WebProviderCapabilities
  /**
   * Perform a chat completion against the upstream web API.
   * Returns the normalized response plus optional provider session id.
   * Should throw a WebProviderError for structured failures.
   */
  chat(request: ChatCompletionRequest): Promise<WebProviderChatResult>
  /** Refresh authentication (token/cookie); returns false if refresh is unsupported */
  refreshAuth?(): Promise<boolean>
  /** List models available to this provider instance */
  listModels?(): Promise<string[]>
  /** Create a provider-side conversation/session */
  createSession?(): Promise<{ sessionId: string }>
  /** Delete a provider-side conversation/session */
  deleteSession?(sessionId: string): Promise<boolean>
  /** Check provider/account health (online + auth valid) */
  healthCheck?(): Promise<{ healthy: boolean; error?: string }>
  /** Get usage/quota information for this provider instance */
  getUsage?(): Promise<{ used?: number; limit?: number }>
}

/**
 * Structured provider error with a stable error code.
 * Error codes align with the Web LLM Gateway error taxonomy.
 */
export class WebProviderError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status?: number

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; status?: number } = {}
  ) {
    super(message)
    this.name = 'WebProviderError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
  }

  /** Provider session is not authenticated / token expired */
  static notLoggedIn(message = 'Provider session is not authenticated'): WebProviderError {
    return new WebProviderError('provider_not_logged_in', message)
  }

  /** Request timed out against the upstream */
  static timeout(message = 'Provider request timed out'): WebProviderError {
    return new WebProviderError('provider_timeout', message, { retryable: true })
  }

  /** Upstream blocked / rate limited the request */
  static blocked(message = 'Provider request was blocked or rate limited'): WebProviderError {
    return new WebProviderError('provider_blocked', message, { retryable: true, status: 429 })
  }

  /** Upstream returned an error response */
  static upstream(message = 'Provider upstream error', status?: number): WebProviderError {
    return new WebProviderError('provider_upstream_error', message, { retryable: true, status })
  }

  /** Provider returned an unparseable / malformed response */
  static invalidResponse(message = 'Provider returned an invalid response'): WebProviderError {
    return new WebProviderError('provider_invalid_response', message, { retryable: false })
  }

  /** A requested capability is not supported by this provider */
  static capabilityUnsupported(message = 'Capability is not supported by this provider'): WebProviderError {
    return new WebProviderError('capability_not_supported', message)
  }

  /** Request was cancelled by the caller */
  static cancelled(message = 'Request was cancelled'): WebProviderError {
    return new WebProviderError('request_cancelled', message)
  }
}

/**
 * Convert an arbitrary thrown value into a WebProviderError (best effort),
 * preserving the original message and wrapping unknown errors.
 */
export function toWebProviderError(error: unknown): WebProviderError {
  if (error instanceof WebProviderError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return new WebProviderError('provider_upstream_error', message, { retryable: true })
}

/**
 * Create the default capability set used by legacy/custom providers.
 * Capabilities are derived from provider configuration hints; the capability
 * registry (`capabilities.ts`) refines this per known provider id.
 */
export function createDefaultCapabilities(provider?: Provider): WebProviderCapabilities {
  const modelNames = provider?.supportedModels?.map(m => m.toLowerCase()) ?? []
  const apiEndpoint = provider?.apiEndpoint?.toLowerCase() ?? ''

  return {
    text: true,
    vision: modelNames.some(m => m.includes('vision') || m.includes('vl') || m.includes('omni')),
    reasoning: modelNames.some(m => m.includes('think') || m.includes('reason')),
    web_search: modelNames.some(m => m.includes('search')) || apiEndpoint.includes('deepseek.com'),
    tools: true, // tool calling is provided via prompt injection for web models
    file: modelNames.some(m => m.includes('file') || m.includes('multimodal')),
    long_context: modelNames.some(m => m.includes('long') || m.includes('128k') || m.includes('1m')),
    stream: true,
  }
}

/**
 * Provider + Account pair that a GatewayInstance wraps at runtime.
 * Kept as a plain interface so the instance layer stays store-agnostic.
 */
export interface ProviderAccountPair {
  provider: Provider
  account: Account
}

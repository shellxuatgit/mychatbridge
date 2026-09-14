/**
 * Core Gateway Module - Multi-LLM Types
 * Defines the request/response shapes for multi-provider aggregation
 * (parallel, race, vote, merge, best).
 */

import type { ChatCompletionRequest, ChatMessage } from '../../proxy/types.ts'

/** Aggregation mode: how to combine results from multiple providers. */
export type AggregationMode =
  | 'parallel'   // fire all, merge into one combined answer
  | 'race'       // first response wins, cancel others
  | 'vote'       // multiple models vote, majority wins
  | 'merge'      // combine all answers into a single coherent response
  | 'best'       // judge model picks the best answer

/** A single provider target in a multi-LLM request. */
export interface MultiProviderTarget {
  /** Provider id to target (e.g. 'deepseek', 'chatgpt') */
  providerId: string
  /** Optional model override (otherwise use the request model) */
  model?: string
}

/** Request shape for the multi-LLM endpoint. */
export interface MultiLlmRequest {
  /** The original chat request (messages, temperature, etc.) */
  request: ChatCompletionRequest
  /** Provider targets (at least 2 for vote/merge; 1 is equivalent to normal routing) */
  providers: MultiProviderTarget[]
  /** Aggregation strategy (default: 'race') */
  aggregation: AggregationMode
  /** Timeout per provider in ms (default: 120000) */
  timeoutMs?: number
  /** For vote mode: minimum number of providers that must agree (default: 1) */
  minVotes?: number
  /** For best mode: provider id of the judge model (default: first provider) */
  judgeProviderId?: string
  /** For best mode: model id of the judge model (default: provider's default) */
  judgeModel?: string
}

/** Result from a single provider before aggregation. */
export interface ProviderResult {
  providerId: string
  model: string
  /** Whether this provider succeeded */
  success: boolean
  /** The assistant text (if successful) */
  text: string
  /** Error message (if failed) */
  error?: string
  /** Latency in ms */
  latencyMs: number
  /** Whether this was the first response (race mode) */
  isWinner?: boolean
}

/** Aggregated result. */
export interface MultiLlmResult {
  /** The aggregated assistant text */
  text: string
  /** All provider results (before aggregation) */
  results: ProviderResult[]
  /** Which providers contributed to the final answer */
  contributors: string[]
  /** Total wall-clock latency */
  totalLatencyMs: number
  /** Aggregation mode used */
  aggregation: AggregationMode
}

/** Errors specific to multi-LLM. */
export class MultiLlmError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MultiLlmError'
    this.code = code
  }

  static tooFewProviders(): MultiLlmError {
    return new MultiLlmError('too_few_providers', 'Multi-LLM requires at least 2 providers')
  }

  static allFailed(): MultiLlmError {
    return new MultiLlmError('all_providers_failed', 'All providers failed')
  }

  static noAggregationTarget(): MultiLlmError {
    return new MultiLlmError('no_aggregation_target', 'No valid aggregation target')
  }
}

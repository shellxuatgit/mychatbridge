/**
 * Core Gateway Module - Fallback Graph
 *
 * Maps upstream error types to the next routing action: which provider /
 * strategy to try on retry, or whether to abort entirely.
 *
 * Default graph:
 *   401  → try next provider (auth may be expired on this one)
 *   429  → try next provider (rate limited)
 *   502/503/5xx → try another account on the SAME provider first, then next provider
 *   timeout → try next provider
 *   blocked → try next provider
 *   invalid_request → abort (don't retry)
 */

import type { ErrorClass } from './errorClassification.ts'
import type {
  FallbackAction,
  FallbackGraphConfig,
} from '../../store/types.ts'

export type { FallbackAction, FallbackGraphConfig }

/** The default fallback graph. */
export const DEFAULT_FALLBACK_GRAPH: Record<ErrorClass, FallbackAction> = {
  auth_error: 'next_provider',
  rate_limited: 'next_provider',
  server_error: 'next_account_then_provider',
  timeout: 'next_provider',
  blocked: 'next_provider',
  invalid_request: 'abort',
  unknown: 'next_account_then_provider',
}

/** Default config (re-exported from store/types for convenience). */
export { DEFAULT_FALLBACK_CONFIG } from '../../store/types.ts'

/**
 * Runtime fallback graph resolved from config.
 */
export class FallbackGraph {
  private readonly nodes: Record<ErrorClass, FallbackAction>
  private readonly maxTotalRetries: number
  private readonly enabled: boolean

  constructor(config: FallbackGraphConfig = { enabled: true, maxTotalRetries: 3 }) {
    this.nodes = { ...DEFAULT_FALLBACK_GRAPH, ...config.nodes }
    this.maxTotalRetries = config.maxTotalRetries
    this.enabled = config.enabled
  }

  /** Whether the graph is active. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Resolve the action for a given error class. */
  resolve(errorClass: ErrorClass): FallbackAction {
    return this.nodes[errorClass] ?? 'next_account_then_provider'
  }

  /** Whether the total retry budget is exhausted. */
  isExhausted(totalAttempts: number): boolean {
    return totalAttempts >= this.maxTotalRetries
  }

  /** Whether the action is terminal (don't try anything else). */
  isTerminal(action: FallbackAction): boolean {
    return action === 'abort'
  }
}

/**
 * Apply a fallback graph to determine the next routing decision.
 * Returns the (possibly modified) selection parameters for the next attempt.
 */
export interface FallbackContext {
  /** Previous provider id that failed */
  failedProviderId: string
  /** Previous account id that failed */
  failedAccountId: string
  /** Error class from classifyError */
  errorClass: ErrorClass
  /** Total attempts so far (including the failed one) */
  totalAttempts: number
  /** Whether the previous attempt already retried on a different account */
  alreadySwitchedAccount: boolean
}

export interface FallbackDecision {
  /** Action to take */
  action: FallbackAction
  /** If action is next_provider: clear preferredProviderId and let router pick */
  clearPreferredProvider: boolean
  /** If action is next_account_then_provider: exclude the current instance */
  excludeInstance: boolean
  /** Whether to stop retrying altogether */
  abort: boolean
}

export function resolveFallback(
  graph: FallbackGraph,
  ctx: FallbackContext
): FallbackDecision {
  if (graph.isExhausted(ctx.totalAttempts)) {
    return { action: 'abort', clearPreferredProvider: false, excludeInstance: true, abort: true }
  }

  const action = graph.resolve(ctx.errorClass)

  if (graph.isTerminal(action)) {
    return { action, clearPreferredProvider: false, excludeInstance: false, abort: true }
  }

  switch (action) {
    case 'next_provider':
      return { action, clearPreferredProvider: true, excludeInstance: true, abort: false }

    case 'next_account_then_provider':
      if (ctx.alreadySwitchedAccount) {
        // Already tried another account on this provider → move to next provider.
        return { action: 'next_provider', clearPreferredProvider: true, excludeInstance: true, abort: false }
      }
      return { action, clearPreferredProvider: false, excludeInstance: true, abort: false }

    case 'cooldown_and_retry':
      return { action, clearPreferredProvider: false, excludeInstance: true, abort: false }

    default:
      return { action, clearPreferredProvider: false, excludeInstance: true, abort: false }
  }
}

/**
 * Core Gateway Module - Cost-Aware Router Strategy
 * Prefers the instance with the lowest relative cost (`account.costPerRequest ?? 1`).
 * Ties are broken by the fewest in-flight requests, then by EWMA latency.
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'

export class CostAwareStrategy implements RoutingStrategy {
  readonly id = 'cost-aware'
  readonly name = 'Cost Aware'

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }
    if (candidates.length === 1) {
      return candidates[0]
    }

    return [...candidates].sort((a, b) => {
      const costDiff = a.instance.cost - b.instance.cost
      if (costDiff !== 0) {
        return costDiff
      }
      const concurrencyDiff = a.instance.concurrency - b.instance.concurrency
      if (concurrencyDiff !== 0) {
        return concurrencyDiff
      }
      return a.instance.ewmaLatencyMs - b.instance.ewmaLatencyMs
    })[0]
  }
}

export default CostAwareStrategy
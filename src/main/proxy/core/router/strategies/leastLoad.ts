/**
 * Core Gateway Module - Least-Load Router Strategy
 * Prefers the instance with the fewest in-flight requests, then the lowest
 * EWMA latency (the "load = concurrency + recent latency" heuristic).
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'

export class LeastLoadStrategy implements RoutingStrategy {
  readonly id = 'least-load'
  readonly name = 'Least Load'

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }
    if (candidates.length === 1) {
      return candidates[0]
    }

    return [...candidates].sort((a, b) => {
      const concurrencyDiff = a.instance.concurrency - b.instance.concurrency
      if (concurrencyDiff !== 0) {
        return concurrencyDiff
      }
      return a.instance.ewmaLatencyMs - b.instance.ewmaLatencyMs
    })[0]
  }
}

export default LeastLoadStrategy
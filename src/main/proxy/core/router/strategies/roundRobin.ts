/**
 * Core Gateway Module - Round Robin Router Strategy
 * Mirrors the legacy `selectRoundRobin` behavior (index modulo candidates).
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'

export class RoundRobinStrategy implements RoutingStrategy {
  readonly id = 'round-robin'
  readonly name = 'Round Robin'

  private readonly index: Map<string, number> = new Map()

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }

    const providerIds = [...new Set(candidates.map(c => c.instance.provider.id))]
    const key = providerIds.join(',')

    const currentIndex = this.index.get(key) || 0
    const selected = candidates[currentIndex % candidates.length]

    this.index.set(key, (currentIndex + 1) % candidates.length)

    return selected
  }

  reset(): void {
    this.index.clear()
  }
}

export default RoundRobinStrategy
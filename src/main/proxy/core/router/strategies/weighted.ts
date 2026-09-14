/**
 * Core Gateway Module - Weighted Router Strategy
 * Selects candidates proportionally to their routing weight
 * (`account.weight ?? 1`). Higher weight ⇒ higher selection probability.
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'

export class WeightedStrategy implements RoutingStrategy {
  readonly id = 'weighted'
  readonly name = 'Weighted'

  /** Deterministic pseudo-random generator for testability (default Math.random). */
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }

    if (candidates.length === 1) {
      return candidates[0]
    }

    const weights = candidates.map(c => {
      const w = c.instance.weight
      return Number.isFinite(w) && w > 0 ? w : 1
    })

    const totalWeight = weights.reduce((sum, w) => sum + w, 0)
    if (totalWeight <= 0) {
      return candidates[0]
    }

    let roll = this.random() * totalWeight
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]
      if (roll < 0) {
        return candidates[i]
      }
    }

    // Floating point guard: return the last candidate.
    return candidates[candidates.length - 1]
  }
}

export default WeightedStrategy
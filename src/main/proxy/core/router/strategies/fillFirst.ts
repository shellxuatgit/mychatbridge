/**
 * Core Gateway Module - Fill First Router Strategy
 * Mirrors the legacy `selectFillFirst`: use the account with the least usage,
 * then the least recently used, which "fills" each account before others.
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'

export class FillFirstStrategy implements RoutingStrategy {
  readonly id = 'fill-first'
  readonly name = 'Fill First'

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }

    // Mirror legacy behavior: reduce returns the first (best) or last best.
    return candidates.reduce<RoutableCandidate | null>((best, current) => {
      if (!best) {
        return current
      }

      const bestUsed = best.instance.account.todayUsed || 0
      const currentUsed = current.instance.account.todayUsed || 0

      if (currentUsed < bestUsed) {
        return current
      }

      if (currentUsed === bestUsed) {
        const bestLastUsed = best.instance.account.lastUsed || 0
        const currentLastUsed = current.instance.account.lastUsed || 0

        if (currentLastUsed < bestLastUsed) {
          return current
        }
      }

      return best
    }, null)
  }
}

export default FillFirstStrategy
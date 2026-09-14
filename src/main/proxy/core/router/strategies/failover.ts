/**
 * Core Gateway Module - Failover Router Strategy
 * Mirrors the legacy `selectFailover`: prefer healthy instances, otherwise sort
 * by failure count (least failures first) and then earliest failure time.
 */

import type { RouterContext, RoutingStrategy } from '../types.ts'
import type { RoutableCandidate } from '../../instancePool.ts'
import { isInstanceRoutable, recordInstanceFailure, tickInstance } from '../../instance.ts'

export class FailoverStrategy implements RoutingStrategy {
  readonly id = 'failover'
  readonly name = 'Failover'

  /** Instance-level failure accounting, keyed by instance id. */
  private readonly failures: Map<string, { count: number; lastFailTime: number }> = new Map()

  recordFailure(instanceId: string): void {
    const current = this.failures.get(instanceId) || { count: 0, lastFailTime: 0 }
    this.failures.set(instanceId, { count: current.count + 1, lastFailTime: Date.now() })
  }

  clearFailure(instanceId: string): void {
    this.failures.delete(instanceId)
  }

  private failureCountOf(instanceId: string): number {
    return this.failures.get(instanceId)?.count ?? 0
  }

  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null {
    if (candidates.length === 0) {
      return null
    }

    // Prefer healthy (routable) candidates, mirroring legacy behavior.
    const healthyCandidates = candidates.filter(c => isInstanceRoutable(c.instance))
    const pool = healthyCandidates.length > 0 ? healthyCandidates : candidates

    const sorted = [...pool].sort((a, b) => {
      const countA = this.failureCountOf(a.instance.id)
      const countB = this.failureCountOf(b.instance.id)

      if (countA !== countB) {
        return countA - countB
      }

      const timeA = this.failures.get(a.instance.id)?.lastFailTime ?? 0
      const timeB = this.failures.get(b.instance.id)?.lastFailTime ?? 0

      return timeA - timeB
    })

    return sorted[0]
  }
}

export default FailoverStrategy
/**
 * Core Gateway Module - Router
 * Pluggable routing strategy registry. Resolves a strategy by id and delegates
 * candidate selection. Unknown strategy ids fall back to round-robin for
 * backward compatibility with `config.loadBalanceStrategy`.
 */

import type { LoadBalanceStrategy } from '../../../store/types.ts'
import type { RouterContext, RouteSelection, RoutingStrategy } from './types.ts'
import type { RoutableCandidate } from '../instancePool.ts'
import { RoundRobinStrategy } from './strategies/roundRobin.ts'
import { FillFirstStrategy } from './strategies/fillFirst.ts'
import { FailoverStrategy } from './strategies/failover.ts'
import { WeightedStrategy } from './strategies/weighted.ts'
import { CostAwareStrategy } from './strategies/costAware.ts'
import { LeastLoadStrategy } from './strategies/leastLoad.ts'

/** Canonical strategy ids. Gateway adds weighted/cost-aware/least-load. */
export type RouterStrategyId = LoadBalanceStrategy | 'weighted' | 'cost-aware' | 'least-load'

class Router {
  private readonly strategies: Map<string, RoutingStrategy> = new Map()

  constructor() {
    this.register(new RoundRobinStrategy())
    this.register(new FillFirstStrategy())
    this.register(new FailoverStrategy())
    this.register(new WeightedStrategy())
    this.register(new CostAwareStrategy())
    this.register(new LeastLoadStrategy())
  }

  register(strategy: RoutingStrategy): void {
    this.strategies.set(strategy.id, strategy)
  }

  /** Resolve a strategy by id; unknown ids fall back to round-robin. */
  resolve(id?: string): RoutingStrategy {
    if (id && this.strategies.has(id)) {
      return this.strategies.get(id)!
    }
    return this.strategies.get('round-robin')!
  }

  list(): string[] {
    return [...this.strategies.keys()]
  }

  /**
   * Route a request: resolve strategy by id, then select an instance.
   * Returns null when no candidate satisfies the context.
   */
  route(id: string | undefined, candidates: RoutableCandidate[], context: RouterContext): RouteSelection | null {
    const strategy = this.resolve(id)
    const selected = strategy.select(candidates, context)
    if (!selected) {
      return null
    }
    return {
      instance: selected.instance,
      actualModel: selected.actualModel,
      strategy: strategy.id,
    }
  }
}

export const router = new Router()
export { Router }
export default router
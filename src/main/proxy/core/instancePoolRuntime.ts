/**
 * Core Gateway Module - Runtime Instance Pool
 *
 * Runtime health tracking for GatewayInstances. Unlike the pure candidate
 * generation in `instancePool.ts`, this keeps a live in-memory registry of
 * instance health so that a failed instance (cooldown) is excluded from
 * subsequent candidate generation until it recovers — the circuit-breaker
 * half of smart failover.
 */

import type { Account, Provider } from '../../store/types.ts'
import {
  createInstance,
  isInstanceRoutable,
  recordInstanceFailure,
  recordInstanceSuccess,
  tickInstance,
} from './instance.ts'
import type { GatewayInstance, HealthStateMachineOptions } from './instance.ts'

/** Tracks live instance health keyed by `providerId:accountId`. */
export class InstancePoolRuntime {
  private readonly instances: Map<string, GatewayInstance> = new Map()
  private readonly healthOptions: HealthStateMachineOptions

  constructor(healthOptions: HealthStateMachineOptions = {}) {
    this.healthOptions = healthOptions
  }

  private key(providerId: string, accountId: string): string {
    return `${providerId}:${accountId}`
  }

  /** Get (or create on first sight) the live instance for a pair. */
  getOrCreate(provider: Provider, account: Account): GatewayInstance {
    const key = this.key(provider.id, account.id)
    let instance = this.instances.get(key)
    if (!instance) {
      instance = createInstance({ provider, account })
      this.instances.set(key, instance)
    }
    return instance
  }

  /** Get the live instance if it exists. */
  get(providerId: string, accountId: string): GatewayInstance | undefined {
    return this.instances.get(this.key(providerId, accountId))
  }

  /** Record a failure, ticking the circuit breaker. Returns the new state. */
  recordFailure(providerId: string, accountId: string): GatewayInstance | undefined {
    const instance = this.instances.get(this.key(providerId, accountId))
    if (!instance) {
      return undefined
    }
    const updated = recordInstanceFailure(instance, this.healthOptions)
    this.instances.set(this.key(providerId, accountId), updated)
    return updated
  }

  /** Record a success, resetting the circuit breaker. */
  recordSuccess(providerId: string, accountId: string): GatewayInstance | undefined {
    const instance = this.instances.get(this.key(providerId, accountId))
    if (!instance) {
      return undefined
    }
    const updated = recordInstanceSuccess(instance)
    this.instances.set(this.key(providerId, accountId), updated)
    return updated
  }

  /** Apply time-based transitions (cooldown expiry) to all instances. */
  tickAll(now: number = this.healthOptions.now?.() ?? Date.now()): void {
    for (const [key, instance] of this.instances) {
      this.instances.set(key, tickInstance(instance, now, this.healthOptions))
    }
  }

  /** Instances currently NOT routable (cooldown/unhealthy) by instance id. */
  unhealthyInstanceIds(): string[] {
    this.tickAll()
    return [...this.instances.values()]
      .filter(i => !isInstanceRoutable(i))
      .map(i => i.id)
  }

  /** Instance ids for all live instances (diagnostics). */
  allInstanceIds(): string[] {
    return [...this.instances.keys()]
  }

  /** Instance health snapshot (diagnostics/observability). */
  healthSnapshot(): Array<{ id: string; status: string; failureCount: number }> {
    this.tickAll()
    return [...this.instances.values()].map(i => ({
      id: i.id,
      status: i.health.status,
      failureCount: i.health.failureCount,
    }))
  }

  reset(): void {
    this.instances.clear()
  }
}

export const instancePoolRuntime = new InstancePoolRuntime({
  failureThreshold: 3,
  recoveryTimeMs: 60000,
  degradedThreshold: 1,
})
export default instancePoolRuntime
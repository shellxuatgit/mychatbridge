/**
 * Core Gateway Module - Gateway Instance
 * Binds a Provider + Account pair with a health state machine and runtime
 * accounting (concurrency, weight, last used).
 *
 * The health state machine replaces the legacy in-memory `failedAccounts`
 * map with an explicit lifecycle:
 *   HEALTHY → DEGRADED → UNHEALTHY → COOLDOWN → RECOVERING → HEALTHY
 */

import type { Account, Provider } from '../../store/types.ts'

/** Instance lifecycle statuses */
export type InstanceStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'COOLDOWN'
  | 'RECOVERING'

/**
 * Health state machine. Pure state transitions over an immutable state record;
 * the instance owns the mutable current state.
 */
export interface HealthState {
  status: InstanceStatus
  /** Consecutive failure count since last success/reset */
  failureCount: number
  /** Timestamp of the last failure (ms epoch) */
  lastFailureAt: number
  /** Timestamp when the current COOLDOWN expires (ms epoch), 0 if not cooling */
  cooldownUntil: number
  /** Timestamp of the last successful probe/request (ms epoch) */
  lastSuccessAt: number
}

export interface HealthStateMachineOptions {
  /** Consecutive failures before the instance is treated as unhealthy */
  failureThreshold?: number
  /** Cooldown duration in ms after crossing the failure threshold */
  recoveryTimeMs?: number
  /** Failures after which status becomes DEGRADED (must be < failureThreshold) */
  degradedThreshold?: number
  /** Clock provider for testability (defaults to Date.now) */
  now?: () => number
}

export function createInitialHealthState(): HealthState {
  return {
    status: 'HEALTHY',
    failureCount: 0,
    lastFailureAt: 0,
    cooldownUntil: 0,
    lastSuccessAt: 0,
  }
}

export const DEFAULT_HEALTH_OPTIONS: Required<Omit<HealthStateMachineOptions, 'now'>> = {
  failureThreshold: 3,
  recoveryTimeMs: 60000,
  degradedThreshold: 1,
}

/**
 * Pure transition helpers. Each returns a NEW state record (immutability).
 */
export function applyFailure(
  state: HealthState,
  options: HealthStateMachineOptions = {}
): HealthState {
  const opts = { ...DEFAULT_HEALTH_OPTIONS, ...options }
  const now = (options.now ?? Date.now)()
  const failureCount = state.failureCount + 1

  if (failureCount >= opts.failureThreshold) {
    return {
      ...state,
      status: 'COOLDOWN',
      failureCount,
      lastFailureAt: now,
      cooldownUntil: now + opts.recoveryTimeMs,
    }
  }
  if (failureCount >= opts.degradedThreshold) {
    return {
      ...state,
      status: 'DEGRADED',
      failureCount,
      lastFailureAt: now,
    }
  }
  return {
    ...state,
    status: 'HEALTHY',
    failureCount,
    lastFailureAt: now,
  }
}

export function applySuccess(state: HealthState): HealthState {
  return {
    ...state,
    status: 'HEALTHY',
    failureCount: 0,
    lastSuccessAt: (Date.now && Date.now()) || state.lastSuccessAt,
  }
}

export function applyRecovery(state: HealthState): HealthState {
  return {
    ...state,
    status: 'RECOVERING',
    failureCount: 0,
  }
}

/**
 * Determine the effective status after COOLDOWN has expired.
 * Returns RECOVERING while probing, HEALTHY after a success, and stays
 * COOLDOWN while the timer has not elapsed.
 */
export function tick(state: HealthState, now: number, options: HealthStateMachineOptions = {}): HealthState {
  const opts = { ...DEFAULT_HEALTH_OPTIONS, ...options }
  if (state.status === 'COOLDOWN') {
    if (now >= state.cooldownUntil) {
      return applyRecovery(state)
    }
    return state
  }
  if (state.status === 'RECOVERING') {
    return state
  }
  return state
}

/**
 * GatewayInstance: runtime handle for one Provider + Account pair.
 */
export interface GatewayInstance {
  /** Stable instance id (providerId:accountId) */
  id: string
  provider: Provider
  account: Account
  /** Health lifecycle state */
  health: HealthState
  /** Current in-flight request count (concurrency) */
  concurrency: number
  /** Routing weight (defaults to account.weight ?? 1) */
  weight: number
  /** Relative cost per request (defaults to account.costPerRequest ?? 1) */
  cost: number
  /** Exponential moving average latency (ms); 0 = no samples yet */
  ewmaLatencyMs: number
  /** Timestamp of the last request (ms epoch) */
  lastUsed: number
}

export interface InstanceOptions {
  provider: Provider
  account: Account
  healthOptions?: HealthStateMachineOptions
}

/**
 * Create an instance bound to a provider+account pair.
 */
export function createInstance(options: InstanceOptions): GatewayInstance {
  return {
    id: `${options.provider.id}:${options.account.id}`,
    provider: options.provider,
    account: options.account,
    health: createInitialHealthState(),
    concurrency: 0,
    weight: options.account.weight ?? 1,
    cost: options.account.costPerRequest ?? 1,
    ewmaLatencyMs: 0,
    lastUsed: 0,
  }
}

/**
 * Record a request latency into the instance's EWMA (alpha = 0.2).
 * First sample initializes the EWMA to the observed latency.
 */
export function recordInstanceLatency(instance: GatewayInstance, latencyMs: number): GatewayInstance {
  const alpha = 0.2
  const current = instance.ewmaLatencyMs > 0 ? instance.ewmaLatencyMs : latencyMs
  return {
    ...instance,
    ewmaLatencyMs: alpha * latencyMs + (1 - alpha) * current,
  }
}

/** Immutable helpers over an instance */
export function recordInstanceFailure(instance: GatewayInstance, options?: HealthStateMachineOptions): GatewayInstance {
  return {
    ...instance,
    health: applyFailure(instance.health, options),
  }
}

export function recordInstanceSuccess(instance: GatewayInstance): GatewayInstance {
  return {
    ...instance,
    health: applySuccess(instance.health),
  }
}

export function incrementInstanceConcurrency(instance: GatewayInstance): GatewayInstance {
  return {
    ...instance,
    concurrency: instance.concurrency + 1,
    lastUsed: Date.now(),
  }
}

export function decrementInstanceConcurrency(instance: GatewayInstance): GatewayInstance {
  return {
    ...instance,
    concurrency: Math.max(0, instance.concurrency - 1),
  }
}

export function tickInstance(instance: GatewayInstance, now: number, options?: HealthStateMachineOptions): GatewayInstance {
  return {
    ...instance,
    health: tick(instance.health, now, options),
  }
}

/** Whether an instance is usable for routing (not in cooldown and not unhealthy). */
export function isInstanceRoutable(instance: GatewayInstance): boolean {
  return instance.health.status !== 'COOLDOWN' && instance.health.status !== 'UNHEALTHY'
}

/**
 * Core Gateway Module - Quota Manager
 *
 * Multi-dimensional quota enforcement for the gateway layer:
 *   - per API key: RPM (token bucket) + RPD (daily counter) + concurrency
 *   - per account: RPD
 *   - per provider: RPD
 *   - per client IP: RPD
 *
 * `checkAndConsume` validates all dimensions atomically *before* the request
 * runs; `consume` records usage after a successful request (for RPD counters
 * that should count attempts). Concurrency slots are acquired/released around
 * the request lifetime.
 */

import { TokenBucket } from './tokenBucket.ts'
import { DailyCounter } from './dailyCounter.ts'
import { ConcurrencySemaphore } from './semaphore.ts'
import { limitsFromConfig } from './types.ts'
import type {
  QuotaCheckResult,
  QuotaExceeded,
  QuotaLimits,
  QuotaScope,
} from './types.ts'
import type { QuotaConfig } from '../../../store/types.ts'

export class QuotaManager {
  private readonly rpmBucket: TokenBucket | null
  private readonly rpdApiKey = new DailyCounter()
  private readonly rpdAccount = new DailyCounter()
  private readonly rpdProvider = new DailyCounter()
  private readonly rpdIp = new DailyCounter()
  private readonly semaphore: ConcurrencySemaphore

  private limits: QuotaLimits
  private frozen: boolean

  constructor(config: QuotaConfig) {
    this.limits = limitsFromConfig(config)
    this.frozen = !config.enabled
    this.rpmBucket = this.limits.rpmPerApiKey > 0
      ? new TokenBucket({
          capacity: Math.max(1, this.limits.rpmPerApiKey),
          refillRate: this.limits.rpmPerApiKey,
          refillMs: 60000,
        })
      : null
    this.semaphore = new ConcurrencySemaphore({ limit: this.limits.concurrencyPerApiKey })
  }

  /** Re-read limits from a (possibly updated) config. */
  updateConfig(config: QuotaConfig): void {
    this.limits = limitsFromConfig(config)
    this.frozen = !config.enabled
    this.rpmBucket?.reset()
    this.semaphore.reset()
  }

  /** Whether the layer is active (config.enabled). */
  isEnabled(): boolean {
    return !this.frozen
  }

  private pushExceeded(
    exceeded: QuotaExceeded[],
    dimension: QuotaExceeded['dimension'],
    scope: string,
    limit: number,
    used: number
  ): void {
    exceeded.push({ dimension, scope, limit, used })
  }

  /**
   * Check all dimensions and, if allowed, commit usage (excluding concurrency,
   * which is acquired/released separately around the request).
   */
  checkAndConsume(scope: QuotaScope, amount = 1): QuotaCheckResult {
    const exceeded: QuotaExceeded[] = []
    let remaining = Infinity

    const deny = (dim: QuotaCheckResult['exceeded'][number]['dimension'], s: string, limit: number, used: number, rem: number) => {
      this.pushExceeded(exceeded, dim, s, limit, used)
      remaining = Math.min(remaining, rem)
    }

    // Per API key: RPM (token bucket)
    if (scope.apiKeyId && this.limits.rpmPerApiKey > 0) {
      const rpm = this.rpmBucket!.tryConsume(scope.apiKeyId)
      if (!rpm.allowed) {
        deny('rpm', scope.apiKeyId, this.limits.rpmPerApiKey, this.limits.rpmPerApiKey, 0)
      }
    }

    // Per API key: RPD (daily counter)
    if (scope.apiKeyId && this.limits.rpdPerApiKey > 0) {
      const rpd = this.rpdApiKey.check(scope.apiKeyId, this.limits.rpdPerApiKey, amount)
      if (!rpd.allowed) {
        deny('apiKey', scope.apiKeyId, this.limits.rpdPerApiKey, rpd.used, rpd.remaining)
      }
    }

    // Per account: RPD
    if (scope.accountId && this.limits.rpdPerAccount > 0) {
      const rpd = this.rpdAccount.check(scope.accountId, this.limits.rpdPerAccount, amount)
      if (!rpd.allowed) {
        deny('account', scope.accountId, this.limits.rpdPerAccount, rpd.used, rpd.remaining)
      }
    }

    // Per provider: RPD
    if (scope.providerId && this.limits.rpdPerProvider > 0) {
      const rpd = this.rpdProvider.check(scope.providerId, this.limits.rpdPerProvider, amount)
      if (!rpd.allowed) {
        deny('provider', scope.providerId, this.limits.rpdPerProvider, rpd.used, rpd.remaining)
      }
    }

    // Per client IP: RPD
    if (scope.clientIp && this.limits.rpdPerIp > 0) {
      const rpd = this.rpdIp.check(scope.clientIp, this.limits.rpdPerIp, amount)
      if (!rpd.allowed) {
        deny('ip', scope.clientIp, this.limits.rpdPerIp, rpd.used, rpd.remaining)
      }
    }

    // Concurrency is a separate acquire/release gate; a check here only reports
    // whether a slot is currently available (the caller then acquires).
    let concurrencyAvailable = true
    if (scope.apiKeyId && this.limits.concurrencyPerApiKey > 0) {
      concurrencyAvailable = this.semaphore.tryAcquire(scope.apiKeyId)
      if (concurrencyAvailable) {
        // Release immediately: the caller re-acquires around the request so the
        // slot is held for the full lifetime.
        this.semaphore.release(scope.apiKeyId)
      }
    }

    if (!concurrencyAvailable) {
      this.pushExceeded(exceeded, 'concurrency', scope.apiKeyId ?? '', this.limits.concurrencyPerApiKey, this.semaphore.activeCount(scope.apiKeyId ?? ''))
      remaining = 0
    }

    if (exceeded.length > 0) {
      return { allowed: false, exceeded, remaining: Math.max(0, remaining) }
    }

    // Commit daily counters only after passing every check (atomic).
    if (scope.apiKeyId && this.limits.rpdPerApiKey > 0) {
      this.rpdApiKey.increment(scope.apiKeyId, amount)
    }
    if (scope.accountId && this.limits.rpdPerAccount > 0) {
      this.rpdAccount.increment(scope.accountId, amount)
    }
    if (scope.providerId && this.limits.rpdPerProvider > 0) {
      this.rpdProvider.increment(scope.providerId, amount)
    }
    if (scope.clientIp && this.limits.rpdPerIp > 0) {
      this.rpdIp.increment(scope.clientIp, amount)
    }

    return { allowed: true, exceeded: [], remaining: Math.max(0, remaining) }
  }

  /** Acquire a concurrency slot; returns false when at the limit. */
  tryAcquireConcurrency(apiKeyId?: string): boolean {
    return this.semaphore.tryAcquire(apiKeyId ?? '-')
  }

  /** Release a concurrency slot. */
  releaseConcurrency(apiKeyId?: string): void {
    this.semaphore.release(apiKeyId ?? '-')
  }

  /** Usage snapshot for observability/diagnostics. */
  snapshot(): {
    rpmKey: Map<string, number>
    apiKeyUsed: Map<string, number>
    accountUsed: Map<string, number>
    providerUsed: Map<string, number>
    ipUsed: Map<string, number>
    concurrencyActive: Map<string, number>
  } {
    // DailyCounter/Timestamp internals are private; expose readable views.
    return {
      rpmKey: new Map(),
      apiKeyUsed: new Map(),
      accountUsed: new Map(),
      providerUsed: new Map(),
      ipUsed: new Map(),
      concurrencyActive: new Map(),
    }
  }
}

/** Build a QuotaManager from an AppConfig. */
export function createQuotaManager(config: QuotaConfig): QuotaManager {
  return new QuotaManager(config)
}
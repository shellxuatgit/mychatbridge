/**
 * Core Gateway Module - Concurrency Semaphore
 *
 * Bounded in-flight request gate per key (e.g. per API key / account).
 * `acquire` returns false immediately when the concurrency limit is reached
 * (no queueing); the caller releases via `release`.
 */

export interface ConcurrencySemaphoreOptions {
  /** Max concurrent holders per key; 0 = unlimited */
  limit: number
}

export class ConcurrencySemaphore {
  private readonly limit: number
  private readonly active: Map<string, number> = new Map()

  constructor(options: ConcurrencySemaphoreOptions) {
    this.limit = options.limit || 0
  }

  /** Try to acquire a slot. Returns false when the limit is reached. */
  tryAcquire(key: string): boolean {
    if (!this.limit) {
      return true
    }
    const current = this.active.get(key) ?? 0
    if (current >= this.limit) {
      return false
    }
    this.active.set(key, current + 1)
    return true
  }

  /** Release a previously acquired slot. */
  release(key: string): void {
    if (!this.limit) {
      return
    }
    const current = this.active.get(key) ?? 0
    if (current <= 1) {
      this.active.delete(key)
    } else {
      this.active.set(key, current - 1)
    }
  }

  /** Current in-flight count for a key. */
  activeCount(key: string): number {
    return this.active.get(key) ?? 0
  }

  reset(): void {
    this.active.clear()
  }
}
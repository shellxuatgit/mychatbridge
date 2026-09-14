/**
 * Core Gateway Module - Sliding Window Counter
 *
 * Fixed-window daily counter (RPD). A 24h window keyed by day is sufficient
 * for daily quotas; an optional configurable windowMs enables shorter windows
 * (e.g. per-hour) without extra machinery. Counts are kept in memory.
 */

export interface SlidingWindowOptions {
  /** Window length in ms (default 24h) */
  windowMs?: number
  /** Clock for testability */
  now?: () => number
}

export class DailyCounter {
  private readonly windowMs: number
  private readonly now: () => number
  private readonly windows: Map<string, { windowStart: number; count: number }> = new Map()

  constructor(options: SlidingWindowOptions = {}) {
    this.windowMs = options.windowMs ?? 24 * 60 * 60 * 1000
    this.now = options.now ?? Date.now
  }

  private windowStart(now: number): number {
    return Math.floor(now / this.windowMs) * this.windowMs
  }

  /** Current count for the key in the active window. */
  get(key: string): number {
    const now = this.now()
    const start = this.windowStart(now)
    const entry = this.windows.get(key)
    if (!entry || entry.windowStart !== start) {
      return 0
    }
    return entry.count
  }

  /** Increment the counter for the key in the active window. Returns new count. */
  increment(key: string, amount = 1): number {
    const now = this.now()
    const start = this.windowStart(now)
    const entry = this.windows.get(key)
    if (!entry || entry.windowStart !== start) {
      this.windows.set(key, { windowStart: start, count: amount })
      return amount
    }
    entry.count += amount
    return entry.count
  }

  /** Check whether adding `amount` would exceed `limit` (0 = unlimited). */
  check(key: string, limit: number, amount = 1): { allowed: boolean; used: number; remaining: number } {
    if (!limit || limit <= 0) {
      return { allowed: true, used: this.get(key), remaining: Infinity }
    }
    const used = this.get(key)
    return {
      allowed: used + amount <= limit,
      used,
      remaining: Math.max(0, limit - used),
    }
  }

  /** Reset all windows (test helper / config change). */
  reset(): void {
    this.windows.clear()
  }
}
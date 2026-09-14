/**
 * Core Gateway Module - Token Bucket Rate Limiter
 *
 * Classic token bucket with per-key buckets and configurable capacity/refill.
 * Used for RPM (requests per minute) enforcement. Thread-safe for the Node
 * single-threaded event loop (all mutations are synchronous).
 */

export interface TokenBucketOptions {
  /** Bucket capacity (max burst) */
  capacity: number
  /** Refill rate: tokens added per refillMs window */
  refillRate: number
  /** Refill window in ms (e.g. 60000 = per minute) */
  refillMs: number
  /** Clock for testability */
  now?: () => number
}

export interface TokenBucketResult {
  allowed: boolean
  /** Tokens remaining after this check (for the caller) */
  remaining: number
  /** Time in ms until the next token is available (when denied) */
  retryAfterMs: number
}

interface Bucket {
  tokens: number
  lastRefillAt: number
}

export class TokenBucket {
  private readonly capacity: number
  private readonly refillRate: number
  private readonly refillMs: number
  private readonly now: () => number
  private readonly buckets: Map<string, Bucket> = new Map()

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) {
      throw new Error('TokenBucket capacity must be > 0')
    }
    this.capacity = options.capacity
    this.refillRate = options.refillRate
    this.refillMs = options.refillMs
    this.now = options.now ?? Date.now
  }

  private getOrCreate(key: string): Bucket {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillAt: this.now() }
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private refill(bucket: Bucket, now: number): void {
    const elapsed = now - bucket.lastRefillAt
    if (elapsed <= 0) {
      return
    }
    const tokensAdded = (elapsed / this.refillMs) * this.refillRate
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensAdded)
    bucket.lastRefillAt = now
  }

  /**
   * Try to consume one token. Returns allowed + remaining / retryAfterMs.
   */
  tryConsume(key: string): TokenBucketResult {
    const now = this.now()
    const bucket = this.getOrCreate(key)
    this.refill(bucket, now)

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 }
    }

    const tokenGap = 1 - bucket.tokens
    const retryAfterMs = Math.ceil((tokenGap / this.refillRate) * this.refillMs)
    return { allowed: false, remaining: 0, retryAfterMs }
  }

  /** Reset all buckets (test helper / config change). */
  reset(): void {
    this.buckets.clear()
  }
}

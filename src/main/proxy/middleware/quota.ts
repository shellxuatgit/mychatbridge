/**
 * Core Gateway Module - Quota / Rate Limit Middleware
 *
 * Koa middleware that enforces the multi-dimensional quota layer:
 *   - Before the request: `checkAndConsume` on all daily/RPM dimensions;
 *     denied → 429 (RPM/RPD/concurrency) or 503 (service disabled).
 *   - Around the request: acquires a concurrency slot for the API key,
 *     released when the response finishes.
 *
 * Only `/v1/*` chat routes are rate limited; `/health`, `/stats` and
 * `/v0/management` stay untouched.
 */

import type { Context, Next } from 'koa'
import { QuotaManager, createQuotaManager } from '../core/quota/quotaManager.ts'
import type { QuotaScope } from '../core/quota/types.ts'
import type { QuotaConfig } from '../../store/types.ts'

/** Extract the quota scope from a Koa context. */
export function extractQuotaScope(ctx: Context): QuotaScope {
  const apiKey = (ctx.state as any)?.apiKey
  return {
    apiKeyId: apiKey?.id,
    apiKeyName: apiKey?.name,
    clientIp: ctx.headers['x-real-ip'] as string || ctx.ip || undefined,
  }
}

export class QuotaMiddleware {
  private manager: QuotaManager

  constructor(config: QuotaConfig) {
    this.manager = createQuotaManager(config)
  }

  /** Re-read config (called on config change / server restart). */
  updateConfig(config: QuotaConfig): void {
    this.manager.updateConfig(config)
  }

  /** Whether the middleware should gate the given path. */
  private static shouldRateLimit(ctx: Context): boolean {
    if (!ctx.method || ctx.method !== 'POST') {
      return false
    }
    return (
      ctx.path.startsWith('/v1/chat') ||
      ctx.path.startsWith('/v1/completions') ||
      ctx.path === '/v1/responses'
    )
  }

  middleware() {
    return async (ctx: Context, next: Next) => {
      if (!QuotaMiddleware.shouldRateLimit(ctx)) {
        await next()
        return
      }

      const scope = extractQuotaScope(ctx)

      // Lazily read config on each request so we don't depend on
      // storeManager being initialized at server construction time.
      try {
        const config = (await import('../../store/store')).storeManager.getConfig()
        if (!config.quotaConfig?.enabled) {
          await next()
          return
        }
        this.manager.updateConfig(config.quotaConfig)
      } catch {
        // Store not ready yet — pass through
        await next()
        return
      }

      const result = this.manager.checkAndConsume(scope)

      if (!result.allowed) {
        const first = result.exceeded[0]
        const isConcurrency = first?.dimension === 'concurrency'
        ctx.status = 429
        ctx.set('Retry-After', isConcurrency ? '1' : '60')
        ctx.body = {
          error: {
            message: isConcurrency
              ? 'Concurrency limit reached'
              : `Quota exceeded (${result.exceeded.map(e => e.dimension).join(',')})`,
            type: 'rate_limit_error',
            param: null,
            code: isConcurrency ? 'concurrency_limit_exceeded' : 'rate_limit_exceeded',
            detail: first,
          },
        }
        return
      }

      // Hold a concurrency slot for the request lifetime.
      const acquired = this.manager.tryAcquireConcurrency(scope.apiKeyId)
      if (!acquired) {
        ctx.status = 429
        ctx.set('Retry-After', '1')
        ctx.body = {
          error: {
            message: 'Concurrency limit reached',
            type: 'rate_limit_error',
            param: null,
            code: 'concurrency_limit_exceeded',
          },
        }
        return
      }

      try {
        await next()
      } finally {
        this.manager.releaseConcurrency(scope.apiKeyId)
      }
    }
  }
}

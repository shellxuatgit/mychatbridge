/**
 * Reliability state machine for WebLLM browser-side requests.
 *
 * Wraps any `fn` that talks to the sidecar and, on failure, classifies the
 * error, attempts the appropriate recovery (reload / context restart), and
 * retries once. If recovery fails or the account is logged out, the account
 * is marked unhealthy and an error is thrown.
 *
 * Lives in `src/main/webRuntime/` because it depends on the main-process
 * sidecar client (Task 2), not on the renderer / web-runtime module.
 */
import type { FailStage } from './reliability.ts'

export type { FailStage }

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Lower-cased substrings that identify a `page_broken` error. */
const PAGE_BROKEN_KEYWORDS = ['selector', 'dom', 'locator']
/** Lower-cased substrings that identify a `timeout` error. */
const TIMEOUT_KEYWORDS = ['timeout', 'timed out']
/** Lower-cased substrings that identify a `logged_out` error. */
const LOGGED_OUT_KEYWORDS = ['login required', 'logged_out']

/**
 * Classify an arbitrary caught value into a recovery stage.
 *
 * The check order is: `page_broken` > `timeout` > `logged_out` > `context_broken`
 * > `unknown`. First match wins.
 */
export function classifyError(err: unknown): FailStage {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const lower = msg.toLowerCase()

  if (PAGE_BROKEN_KEYWORDS.some((kw) => lower.includes(kw))) return 'page_broken'
  if (TIMEOUT_KEYWORDS.some((kw) => lower.includes(kw))) return 'timeout'
  if (LOGGED_OUT_KEYWORDS.some((kw) => lower.includes(kw))) return 'logged_out'

  return err instanceof Error ? 'context_broken' : 'unknown'
}

// ---------------------------------------------------------------------------
// ReliabilityManager
// ---------------------------------------------------------------------------

export interface ReliabilityManagerOptions {
  /** The main-process sidecar client (WebRuntimeClient or compatible mock). */
  runtime: { request(method: string, params?: Record<string, unknown>): Promise<unknown> }
  /** Optional callback invoked when an account is marked unhealthy. */
  onAccountUnhealthy?: (accountId: string) => void
}

export class ReliabilityManager {
  private readonly runtime: ReliabilityManagerOptions['runtime']
  private readonly onAccountUnhealthy?: (accountId: string) => void
  private readonly unhealthy = new Set<string>()

  constructor(opts: ReliabilityManagerOptions) {
    this.runtime = opts.runtime
    this.onAccountUnhealthy = opts.onAccountUnhealthy
  }

  // -- public API ----------------------------------------------------------

  /**
   * Run `fn` with automatic recovery on failure.
   *
   * Recovery sequence (one attempt per stage):
   * 1. `page_broken` / `timeout` -> `browser.invoke(reload)` -> retry `fn`
   * 2. `context_broken` -> `browser.invoke(releaseContext)` -> retry `fn`
   * 3. `logged_out` -> immediately throw with a user-facing message and mark
   *    the account unhealthy.
   *
   * If the retried `fn` still fails, the account is marked unhealthy and the
   * original error is thrown.
   */
  async withRetry(accountId: string, fn: () => Promise<unknown>): Promise<unknown> {
    try {
      return await fn()
    } catch (firstErr) {
      const stage = classifyError(firstErr)

      // logged_out is terminal -- no recovery attempt
      if (stage === 'logged_out') {
        this.markAccountUnhealthy(accountId)
        throw new Error('登录已失效，请重新 Connect')
      }

      // unknown: mark unhealthy and re-throw immediately
      if (stage === 'unknown') {
        this.markAccountUnhealthy(accountId)
        throw firstErr instanceof Error ? firstErr : new Error(String(firstErr))
      }

      // page_broken / timeout -> reload
      if (stage === 'page_broken' || stage === 'timeout') {
        try {
          await this.runtime.request('browser.invoke', { action: 'reload' })
        } catch {
          // Reload itself failed -- still attempt the retry; the retry will
          // likely fail and mark the account unhealthy.
        }
      }

      // context_broken -> releaseContext
      if (stage === 'context_broken') {
        try {
          await this.runtime.request('browser.invoke', { action: 'releaseContext' })
        } catch {
          // Release failed -- still attempt the retry.
        }
      }

      // Retry once
      try {
        return await fn()
      } catch (secondErr) {
        this.markAccountUnhealthy(accountId)
        throw secondErr instanceof Error ? secondErr : new Error(String(secondErr))
      }
    }
  }

  /** Mark an account as unhealthy (will not be retried). */
  markAccountUnhealthy(accountId: string): void {
    this.unhealthy.add(accountId)
    this.onAccountUnhealthy?.(accountId)
  }

  /** Check whether an account is still considered healthy. */
  isAccountHealthy(accountId: string): boolean {
    return !this.unhealthy.has(accountId)
  }
}

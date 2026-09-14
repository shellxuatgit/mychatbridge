// browser/src/context-manager.ts
import { BrowserContext } from 'playwright';
import { BrowserPool } from './browser-pool';

export class ContextManager {
  private contexts: Map<string, { context: BrowserContext; lastUsedAt: number }> = new Map();
  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  /** Get or create a context for an account */
  async getContext(providerId: string, accountId: string, sessionCookies?: unknown[]): Promise<BrowserContext> {
    const key = `${providerId}-${accountId}`;
    const existing = this.contexts.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.context;
    }

    const browser = await this.pool.acquireBrowser();
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1280, height: 800 },
    });

    // Restore session cookies if available
    if (sessionCookies && sessionCookies.length > 0) {
      await context.addCookies(sessionCookies as any[]);
    }

    this.contexts.set(key, { context, lastUsedAt: Date.now() });
    return context;
  }

  /** Release a context (mark idle for sweep) */
  releaseContext(providerId: string, accountId: string) {
    const key = `${providerId}-${accountId}`;
    const entry = this.contexts.get(key);
    if (entry) {
      entry.lastUsedAt = Date.now() - 10 * 60 * 1000; // Prefer sweep
    }
  }

  /** Sweep idle contexts and close them */
  async sweepIdle(timeoutMs: number): Promise<number> {
    const now = Date.now();
    let closed = 0;

    for (const [key, entry] of this.contexts) {
      if (now - entry.lastUsedAt > timeoutMs) {
        await entry.context.close().catch(() => {});
        this.contexts.delete(key);
        closed++;
      }
    }
    return closed;
  }

  get count(): number {
    return this.contexts.size;
  }

  async closeAll(): Promise<void> {
    for (const { context } of this.contexts.values()) {
      await context.close().catch(() => {});
    }
    this.contexts.clear();
  }
}
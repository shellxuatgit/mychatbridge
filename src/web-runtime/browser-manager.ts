// browser/src/browser-manager.ts
import { BrowserContext } from 'playwright';
import { BrowserPool } from './browser-pool';
import { ContextManager } from './context-manager';
import { MemoryPressureMonitor } from './memory-monitor';

export interface BrowserPoolConfig {
  minBrowsers: number;
  maxBrowsers: number;
  idleTimeoutMs: number;
  lazyStart: boolean;
  headless: boolean;
  memoryThresholds: { warningMb: number; criticalMb: number };
}

export class BrowserManager {
  private pool: BrowserPool;
  private contexts: ContextManager;
  private memory: MemoryPressureMonitor;

  constructor(configOverride?: Partial<BrowserPoolConfig>) {
    const config = {
      minBrowsers: 0,
      maxBrowsers: 4,
      idleTimeoutMs: 30 * 60 * 1000,
      lazyStart: true,
      headless: process.env.WEBLLM_HEADLESS === 'true',
      memoryThresholds: { warningMb: 1024, criticalMb: 512 },
      ...configOverride,
    } as BrowserPoolConfig;

    this.pool = new BrowserPool({ maxBrowsers: config.maxBrowsers, idleTimeoutMs: config.idleTimeoutMs });
    this.contexts = new ContextManager(this.pool);
    this.memory = new MemoryPressureMonitor(config.memoryThresholds);

    // React to memory pressure
    this.memory.on('warning', () => {
      console.error('[browser-manager] memory warning: sweeping idle contexts');
      this.contexts.sweepIdle(0).catch(() => {});
    });

    this.memory.on('critical', () => {
      console.error('[browser-manager] memory critical: closing all browsers');
      this.pool.sweepIdle(0, true);
    });
  }

  async initialize() {
    this.memory.start();
    console.error('[browser-manager] initialized (lazy start mode)');
  }

  /** Get a browser context for the given account */
  async getContext(providerId: string, accountId: string, cookies?: unknown[]): Promise<BrowserContext> {
    return this.contexts.getContext(providerId, accountId, cookies);
  }

  async health() {
    return {
      status: 'ok',
      browsers: this.pool.contextCount, // includes contexts count info
      contexts: this.contexts.count,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      memory_level: this.memory.currentLevel,
    };
  }

  async stop() {
    this.memory.stop();
    await this.contexts.closeAll();
    await this.pool.closeAll();
  }
}
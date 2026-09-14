// browser/src/health-monitor.ts
import { BrowserManager } from './browser-manager';
import { ProviderRuntime } from './provider-runtime';

interface CheckSchedule {
  session: number;    // ms
  provider: number;   // ms
  browser: number;    // ms
}

export class HealthMonitor {
  private interval: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(
    private browserManager: BrowserManager,
    private providerRuntime: ProviderRuntime,
    private schedule: CheckSchedule = {
      session: 5 * 60 * 1000,
      provider: 15 * 60 * 1000,
      browser: 60 * 1000,
    },
  ) {}

  start() {
    this.runCheck(); // immediate
    this.interval = setInterval(() => this.runCheck(), Math.min(
      this.schedule.session,
      this.schedule.provider,
      this.schedule.browser,
    ));
    this.interval.unref();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async runCheck() {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.checkAll();
    } catch (err) {
      console.error('[health] check failed:', err);
    } finally {
      this.checking = false;
    }
  }

  private async checkAll() {
    const health = await this.browserManager.health();
    const providers = await this.providerRuntime.health();

    // Situational: if memory critical, browsers already swept by monitor
    // Log summary at debug level
    console.error(`[health] browsers=${health.browsers} contexts=${health.contexts} mem=${health.memory_mb}MB providers=${Object.keys(providers.loaded_providers ?? {}).length}`);
  }
}
// browser/src/browser-pool.ts
import { Browser, chromium } from 'playwright';

const PERFORMANCE_BROWSER_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-extensions',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=TranslateUI',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-default-apps',
  '--disable-hang-monitor',
  '--disable-infobars',
  '--disable-preconnect',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
];

export class BrowserPool {
  private browsers: Array<{ browser: Browser; lastUsedAt: number; contextCount: number }> = [];
  private maxBrowsers: number;
  private idleTimeoutMs: number;

  constructor(opts: { maxBrowsers: number; idleTimeoutMs: number }) {
    this.maxBrowsers = opts.maxBrowsers;
    this.idleTimeoutMs = opts.idleTimeoutMs;
  }

  /** Get an existing browser with capacity, or launch a new one */
  async acquireBrowser(): Promise<Browser> {
    // Find a browser with capacity
    const available = this.browsers.find((b) => b.contextCount < 5);
    if (available) {
      available.lastUsedAt = Date.now();
      return available.browser;
    }

    // Launch a new browser (lazy)
    const browser = await chromium.launch({
      headless: process.env.WEBLLM_HEADLESS === 'true',
      args: PERFORMANCE_BROWSER_ARGS,
    });

    this.browsers.push({
      browser,
      lastUsedAt: Date.now(),
      contextCount: 0,
    });

    if (this.browsers.length > this.maxBrowsers) {
      // Independent: browsers will be pruned by sweepIdle
      this.sweepIdle();
    }

    return browser;
  }

  /** Release a browser (decrement context count) */
  releaseBrowser(browser: Browser) {
    const entry = this.browsers.find((b) => b.browser === browser);
    if (entry) {
      entry.contextCount = Math.max(0, entry.contextCount - 1);
      entry.lastUsedAt = Date.now();
    }
  }

  /** Close idle browsers beyond min, or all if memory-critical */
  sweepIdle(minKeep: number = 0, memoryCritical: boolean = false) {
    const now = Date.now();
    const toRemove = [];

    for (const entry of this.browsers) {
      const idle = now - entry.lastUsedAt;
      const isIdle = idle > this.idleTimeoutMs || memoryCritical;
      const canRemove = this.browsers.length - toRemove.length > minKeep;

      if (isIdle && canRemove) {
        toRemove.push(entry);
      }
    }

    for (const entry of toRemove) {
      entry.browser.close().catch(() => {});
      const idx = this.browsers.indexOf(entry);
      if (idx >= 0) this.browsers.splice(idx, 1);
    }
  }

  /** Total context count across all browsers */
  get contextCount(): number {
    return this.browsers.reduce((sum, b) => sum + b.contextCount, 0);
  }

  /** Close all browsers */
  async closeAll(): Promise<void> {
    await Promise.all(this.browsers.map((b) => b.browser.close().catch(() => {})));
    this.browsers = [];
  }
}
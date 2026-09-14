// browser/src/shutdown.ts
import { BrowserManager } from './browser-manager';

export function setupShutdown(browserManager: BrowserManager) {
  const shutdown = async (signal: string) => {
    console.error(`[sidecar] received ${signal}, shutting down...`);
    try {
      // Save all sessions would happen here (via Rust calling session.save)
      await browserManager.stop();
    } catch (err) {
      console.error('[sidecar] shutdown error:', err);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
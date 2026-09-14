// browser/src/index.ts
import { BrowserManager } from './browser-manager';
import { IpcServer } from './ipc-server';
import { Methods } from './ipc-protocol';
import { ProviderRuntime } from './provider-runtime';
import { SessionManager } from './session-manager';
import { HealthMonitor } from './health-monitor';
import { setupShutdown } from './shutdown';

async function main() {
  const browserManager = new BrowserManager();
  await browserManager.initialize();

  const sessionManager = new SessionManager(browserManager);
  const providerRuntime = new ProviderRuntime(browserManager, sessionManager);
  const healthMonitor = new HealthMonitor(browserManager, providerRuntime);

  const ipc = new IpcServer(browserManager);

  // Register methods
  ipc.register(Methods.BROWSER_INVOKE, (params) => providerRuntime.invoke(
    String(params.provider),
    String(params.action),
    String(params.account_id),
    (params.params ?? {}) as Record<string, unknown>,
  ));

  ipc.register(Methods.BROWSER_HEALTH, async () => browserManager.health());
  ipc.register(Methods.SESSION_SAVE, (params) => sessionManager.saveSession(String(params.account_id), String(params.provider_id)));
  ipc.register(Methods.SESSION_RESTORE, (params) => sessionManager.restoreSession(String(params.account_id)));
  ipc.register(Methods.PROVIDER_LOAD, (params) => providerRuntime.loadProvider(String(params.provider_id)));
  ipc.register(Methods.PROVIDER_RELOAD, (params) => providerRuntime.reloadProvider(String(params.provider_id)));

  // Start health monitor
  healthMonitor.start();

  // Ready signal to parent (stdout)
  console.log('WebLLM Browser Sidecar ready');
  console.error('[sidecar] listening for IPC on stdin/fd3');

  // Setup graceful shutdown
  setupShutdown(browserManager);

  ipc.start();
}

main().catch((err) => {
  console.error('[sidecar] fatal error:', err);
  process.exit(1);
});
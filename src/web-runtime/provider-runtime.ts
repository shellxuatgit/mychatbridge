import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserManager } from './browser-manager';
import { SessionManager } from './session-manager';
import { ProviderManifest, ProviderManifestSchema } from './provider-schema';

export interface ProviderModule {
  name: string;
  version: string;
  initialize?: (context: { page: any; browserContext: any; config: any }) => Promise<void>;
  connect?: (params: any) => Promise<{ ok: boolean; account_id?: string }>;
  sendMessage?: (params: any) => Promise<any>;
  sendMessageStream?: (params: any, onChunk: (chunk: any) => void) => Promise<any>;
  createConversation?: (title: string) => Promise<any>;
  uploadFile?: (filePath: string) => Promise<any>;
  healthCheck?: (params: { page: any; browserContext: any }) => Promise<any>;
  cleanup?: () => Promise<void>;
}

export class ProviderRuntime {
  private providersDir: string;
  private loaded: Map<string, { manifest: ProviderManifest; module: ProviderModule }> = new Map();

  constructor(
    private browserManager: BrowserManager,
    private sessionManager: SessionManager,
  ) {
    // Look in app dir first, then user data dir
    this.providersDir = path.resolve(__dirname, 'providers');
  }

  /** Load and validate a provider from disk */
  async loadProvider(providerId: string): Promise<void> {
    const providerDir = path.join(this.providersDir, providerId);
    const manifestPath = path.join(providerDir, 'manifest.json');

    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    // Strict schema validation
    const parsed = ProviderManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      throw new Error(`Invalid manifest for ${providerId}: ${JSON.stringify(parsed.error.issues)}`);
    }

    // Load runtime.js
    const runtimePath = path.join(providerDir, parsed.data.scripts.runtime);
    const module = require(runtimePath) as ProviderModule;

    // Verify exports
    if (typeof module.sendMessage !== 'function' && typeof module.sendMessageStream !== 'function') {
      throw new Error(`Provider ${providerId} must export sendMessage or sendMessageStream`);
    }

    this.loaded.set(providerId, { manifest: parsed.data, module });
    console.error(`[provider] loaded ${providerId} v${parsed.data.version}`);
  }

  /** Reload provider (hot update) */
  async reloadProvider(providerId: string): Promise<void> {
    this.loaded.delete(providerId);
    delete require.cache[require.resolve(path.join(this.providersDir, providerId, 'runtime.js'))];
    await this.loadProvider(providerId);
  }

  /** Main dispatch: invoke a provider action */
  async invoke(
    providerId: string,
    action: string,
    accountId: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const provider = this.loaded.get(providerId);
    if (!provider) {
      await this.loadProvider(providerId);
    }
    const entry = this.loaded.get(providerId)!;
    const module = entry.module;

    // Get browser context for this account
    const context = await this.browserManager.getContext(providerId, accountId);

    // Lazy page creation
    const page = context.pages()[0] ?? await context.newPage();

    // Initialize provider runtime if needed (flag lives on the module so the
    // loaded Map entry stays a plain { manifest, module } record)
    if (module.initialize && !(module as any)._initialized) {
      await module.initialize({
        page,
        browserContext: context,
        config: entry.manifest,
      });
      (module as any)._initialized = true;
    }

    switch (action) {
      case 'connect': {
        if (!module.connect) throw new Error(`Provider ${providerId} does not support connect`);
        const connectResult = await module.connect({ ...params, page, browserContext: context });
        // A successful connect means the user is signed in: persist the session
        // so future requests can restore it without re-authenticating.
        if (connectResult?.ok) {
          await this.sessionManager.saveSession(accountId, providerId, context);
        }
        return connectResult;
      }
      case 'sendMessage':
        if (!module.sendMessage) throw new Error(`Provider ${providerId} does not support sendMessage`);
        return await module.sendMessage({ ...params, page, browserContext: context });
      case 'sendMessageStream':
        if (!module.sendMessageStream) {
          throw new Error(`Provider ${providerId} does not support streaming`);
        }
        return await module.sendMessageStream(
          { ...params, page, browserContext: context },
          (chunk) => { /* chunks forwarded via IpcServer.streamChunk */ },
        );
      case 'createConversation':
        if (!module.createConversation) throw new Error('Not supported');
        return await module.createConversation(String(params.title ?? ''));
      case 'uploadFile':
        if (!module.uploadFile) throw new Error('Not supported');
        return await module.uploadFile(String(params.filePath ?? ''));
      case 'healthCheck':
        if (!module.healthCheck) return { status: 'unknown' };
        return await module.healthCheck({ page, browserContext: context });
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async health() {
    const providers: Record<string, string> = {};
    for (const [id, { manifest }] of this.loaded) {
      providers[id] = manifest.version;
    }
    return { loaded_providers: providers };
  }
}
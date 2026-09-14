import { BrowserContext } from 'playwright';
import { BrowserManager } from './browser-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SessionData {
  accountId: string;
  providerId: string;
  cookies: Array<Record<string, unknown>>;
  localStorage?: Record<string, string>;
  userAgent?: string;
  createdAt: number;
  lastValidatedAt: number;
}

export class SessionManager {
  private sessionsDir: string;

  constructor(private browserManager: BrowserManager) {
    // Platform data dir: {data_dir}/profiles/{provider}/{account}/
    this.sessionsDir = path.join(this.getDataDir(), 'profiles');
  }

  private getDataDir(): string {
    if (process.env.WEBLLM_DATA_DIR) return process.env.WEBLLM_DATA_DIR;
    const base = process.env.APPDATA || require('os').homedir();
    return require('path').join(base, '.mychatbridge', 'web-runtime');
  }

  private sessionPath(accountId: string): string {
    return path.join(this.sessionsDir, `${accountId}.json`);
  }

  /** Save cookies from a context for the account */
  async saveSession(accountId: string, providerId: string, context?: BrowserContext): Promise<void> {
    try {
      const ctx = context;
      if (!ctx) return;
      const cookies = await ctx.cookies();
      const data: SessionData = {
        accountId,
        providerId,
        cookies: cookies as unknown as Array<Record<string, unknown>>,
        createdAt: Date.now(),
        lastValidatedAt: Date.now(),
      };
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await fs.writeFile(this.sessionPath(accountId), JSON.stringify(data), { mode: 0o600 });
    } catch (err) {
      console.error(`[session] save failed for ${accountId}:`, err);
    }
  }

  /** Load session for an account */
  async loadSession(accountId: string): Promise<SessionData | null> {
    try {
      const content = await fs.readFile(this.sessionPath(accountId), 'utf8');
      return JSON.parse(content) as SessionData;
    } catch {
      return null;
    }
  }

  /** Restore a saved session into a browser context */
  async restoreSession(accountId: string): Promise<SessionData | null> {
    const session = await this.loadSession(accountId);
    if (!session) return null;
    // Apply saved cookies to the account's browser context
    await this.browserManager.getContext(session.providerId, accountId, session.cookies);
    return session;
  }

  /** Validate if session is still valid (not expired) */
  isValidSession(session: SessionData | null): boolean {
    if (!session) return false;
    const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    return Date.now() - session.lastValidatedAt < COOKIE_MAX_AGE_MS;
  }
}
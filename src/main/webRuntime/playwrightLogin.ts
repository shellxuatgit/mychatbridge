import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getCredentialSource, cookiesToPayload, type SessionPayload } from './credentialSources.ts'

export type ImportedPayload = SessionPayload & { cookies: Array<Record<string, unknown>> }

export type PlaywrightLoginResult =
  | { status: 'imported'; payload: ImportedPayload }
  | { status: 'cancelled' }
  | { status: 'timeout' }
  | { status: 'browser-missing'; reason: string }
  | { status: 'already-running' }

interface ChromiumLike {
  launchPersistentContext: (
    userDataDir: string,
    options: Record<string, unknown>
  ) => Promise<ContextLike>
}

interface ContextLike {
  cookies: () => Promise<Array<Record<string, unknown>>>
  pages: () => Array<{ url: () => string; evaluate?: (fn: () => unknown) => Promise<unknown> }>
  close: () => Promise<void>
}

interface ActiveLogin {
  providerId: string
  context: ContextLike
  cancelRequested: boolean
}

const CHANNELS = ['chrome', 'msedge'] as const
const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_TIMEOUT_MS = 180_000

const NOOP_CONTEXT: ContextLike = {
  cookies: async () => [],
  pages: () => [],
  close: async () => {},
}

class LoginLaunchError extends Error {}

export class PlaywrightLoginService {
  private static singleton: PlaywrightLoginService | null = null

  static getInstance(): PlaywrightLoginService {
    if (!PlaywrightLoginService.singleton) {
      PlaywrightLoginService.singleton = new PlaywrightLoginService()
    }
    return PlaywrightLoginService.singleton
  }

  static resetSingleton(): void {
    PlaywrightLoginService.singleton = null
  }

  private chromium: ChromiumLike | null
  private pollIntervalMs: number
  private timeoutMs: number
  private userDataRoot: string
  private ownsUserDataRoot: boolean
  private active: ActiveLogin | null = null
  private pendingCancel = new Set<string>()

  constructor(deps: {
    chromium?: ChromiumLike
    pollIntervalMs?: number
    timeoutMs?: number
    userDataRoot?: string
  } = {}) {
    this.chromium = deps.chromium ?? null
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.userDataRoot = deps.userDataRoot ?? join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users')
    this.ownsUserDataRoot = Boolean(deps.userDataRoot)
  }

  userDataRootForTest(): string {
    return this.userDataRoot
  }

  async dispose(): Promise<void> {
    if (this.active) await this.cancel(this.active.providerId)
    if (this.ownsUserDataRoot) {
      try {
        rmSync(this.userDataRoot, { recursive: true, force: true })
      } catch {
      }
    }
  }

  private loadChromium(): ChromiumLike {
    if (this.chromium) return this.chromium
    if (this.isPackagedBuild()) {
      const resources = process.resourcesPath || ''
      return require(join(resources, 'web-runtime', 'node_modules', 'playwright')).chromium as ChromiumLike
    }
    return require('playwright').chromium as ChromiumLike
  }

  private isPackagedBuild(): boolean {
    try {
      const electron = require('electron') as { app?: { isPackaged?: boolean } }
      return typeof electron.app?.isPackaged === 'boolean' ? electron.app.isPackaged : false
    } catch {
      return false
    }
  }

  private getUserDataDir(providerId: string): string {
    const sharedDir = join(this.userDataRoot, 'shared')
    const providerDir = join(this.userDataRoot, providerId)
    // Use provider-specific directory if it exists and shared doesn't exist yet, else use shared profile
    return existsSync(providerDir) && !existsSync(sharedDir) ? providerDir : sharedDir
  }

  /**
   * Check headlessly if the user's isolated profile already has valid cookies.
   * If yes, return immediately without popping up any browser window!
   */
  async checkSavedSession(providerId: string): Promise<PlaywrightLoginResult | null> {
    const source = getCredentialSource(providerId)
    if (!source) return null
    const userDataDir = this.getUserDataDir(providerId)
    const chromium = this.loadChromium()

    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
      }).catch(async () => {
        // Fallback with channel if default headless launch needs binary
        return await chromium.launchPersistentContext(userDataDir, {
          headless: true,
          channel: 'chrome',
        })
      })

      const cookies = await context.cookies()
      await context.close().catch(() => {})

      const filtered = cookies.filter((c) => source.domains.some((d) => String(c.domain).includes(d)))
      const payload = cookiesToPayload(filtered, source)
      if (payload) {
        console.error(`[PlaywrightLogin] Headless check succeeded for ${providerId}: found session without popup!`)
        return { status: 'imported', payload: { ...payload, cookies: filtered } }
      }
    } catch (e) {
      console.error(`[PlaywrightLogin] Headless session check failed (will fallback to popup):`, (e as Error).message)
    }
    return null
  }

  async login(providerId: string): Promise<PlaywrightLoginResult> {
    if (this.active) return { status: 'already-running' }

    // 1. Silent Headless Check first: if profile already has valid cookies, return directly!
    const saved = await this.checkSavedSession(providerId)
    if (saved) return saved

    // 2. If not logged in yet, pop up the browser window for user to log in
    const source = getCredentialSource(providerId)
    if (!source?.loginUrl || !source.loginSuccess) {
      return { status: 'browser-missing', reason: `no loginUrl configured for ${providerId}` }
    }

    const channels = source.loginChannel && source.loginChannel !== 'auto'
      ? [source.loginChannel]
      : [...CHANNELS]

    const chromium = this.loadChromium()
    let lastError = ''
    for (const channel of channels) {
      try {
        return await this.runLogin(chromium, channel, providerId, source)
      } catch (error) {
        if (error instanceof LoginLaunchError) {
          lastError = error.message
          continue
        }
        if (this.pendingCancel.has(providerId)) {
          this.pendingCancel.delete(providerId)
          return { status: 'cancelled' }
        }
        throw error
      }
    }
    return { status: 'browser-missing', reason: lastError }
  }

  private async runLogin(
    chromium: ChromiumLike,
    channel: string,
    providerId: string,
    source: NonNullable<ReturnType<typeof getCredentialSource>>
  ): Promise<PlaywrightLoginResult> {
    const userDataDir = this.getUserDataDir(providerId)
    this.active = { providerId, context: NOOP_CONTEXT, cancelRequested: false }
    let context: ContextLike
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel,
        viewport: { width: 1280, height: 800 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      })
      // If a loginUrl is configured, ensure at least one page opens it
      if (source.loginUrl) {
        const pages = context.pages()
        const page = pages.length > 0 ? pages[0] : await (context as any).newPage?.()
        if (page && typeof page.goto === 'function') {
          page.goto(source.loginUrl).catch(() => {})
        }
      }
    } catch (error) {
      if (this.active.providerId === providerId) this.active = null
      throw new LoginLaunchError(error instanceof Error ? error.message : String(error))
    }
    if (this.active?.providerId !== providerId || this.active.cancelRequested || this.pendingCancel.has(providerId)) {
      this.pendingCancel.delete(providerId)
      await context.close().catch(() => {})
      if (this.active?.providerId === providerId) this.active = null
      return { status: 'cancelled' }
    }
    this.active = { providerId, context, cancelRequested: false }

    const deadline = Date.now() + (source.loginTimeoutMs ?? this.timeoutMs)
    try {
      while (Date.now() < deadline) {
        if (this.active.cancelRequested) return { status: 'cancelled' }

        // If the user manually closed the Playwright browser window, treat as cancelled
        const pages = context.pages()
        if (pages.length === 0) {
          console.error(`[PlaywrightLogin] All pages closed by user, treating as cancelled`)
          return { status: 'cancelled' }
        }

        let cookies: Array<Record<string, unknown>>
        try {
          cookies = await context.cookies()
        } catch (error) {
          if (this.active.cancelRequested || this.pendingCancel.has(providerId)) {
            return { status: 'cancelled' }
          }
          throw error
        }

        // Diagnostic log every ~6s
        const now = Date.now()
        const required = source.loginSuccess?.cookie
        const filtered = cookies.filter((c) => source.domains.some((d) => String(c.domain).includes(d)))
        const hasRequired = Boolean(required && filtered.some((c) => c.name === required && Boolean(c.value)))
        const currentUrls = pages.map((p) => p.url()).filter((u) => u && u !== 'about:blank')

        // Case A: target cookie detected (__Secure-next-auth.session-token)
        if (hasRequired) {
          console.error(`[PlaywrightLogin] Success: found required cookie ${required} (${filtered.length} domain cookies)`)
          const payload = cookiesToPayload(filtered, source)
          if (payload) return { status: 'imported', payload: { ...payload, cookies: filtered } }
        }

        // Case B: URL pattern matched AND we have at least some auth cookies
        const urlPattern = source.loginSuccess?.urlPattern
        const matchesUrl = urlPattern && pages.some((p) => {
          const u = p.url()
          return u.startsWith(urlPattern.replace(/\*\*.*$/, '')) && !u.includes('/auth/') && !u.includes('/login')
        })
        if (matchesUrl && filtered.length >= 2) {
          console.error(`[PlaywrightLogin] Success: URL matched ${urlPattern}, extracting ${filtered.length} cookies`)
          const payload = cookiesToPayload(filtered, source)
          if (payload) return { status: 'imported', payload: { ...payload, cookies: filtered } }
        }

        // Case C: Try inspecting localStorage on active chatgpt page for session token
        for (const p of pages) {
          if (p.url().includes('chatgpt.com') && typeof p.evaluate === 'function') {
            try {
              const ls = (await p.evaluate(() => {
                const keys = Object.keys(window.localStorage || {})
                const sessionKey = keys.find((k) => /token|session|auth/i.test(k))
                return sessionKey ? { key: sessionKey, val: window.localStorage.getItem(sessionKey) } : null
              })) as { key: string; val: string | null } | null
              if (ls && ls.val && ls.val.length > 20) {
                console.error(`[PlaywrightLogin] LocalStorage found session key: ${ls.key}`)
              }
            } catch { /* page might be navigating */ }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
      }
      return { status: 'timeout' }
    } finally {
      this.pendingCancel.delete(providerId)
      await context.close().catch(() => {})
      if (this.active?.providerId === providerId) this.active = null
    }
  }

  async cancel(providerId: string): Promise<void> {
    if (this.active?.providerId === providerId) {
      this.active.cancelRequested = true
      this.pendingCancel.add(providerId)
      await this.active.context.close().catch(() => {})
    }
  }
}

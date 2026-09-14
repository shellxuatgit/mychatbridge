/**
 * WebRuntime sidecar lifecycle manager (Electron main process).
 *
 * Owns the single main-process `WebRuntimeClient` for the WebLLM browser
 * sidecar. The sidecar is spawned lazily on the first `ensureStarted()`, with
 * a startup timeout and automatic restart on failure. `stop()` tears the
 * sidecar down; a later `ensureStarted()` spawns a fresh one. Callers outside
 * this module should use the singleton via `WebRuntimeManager.getInstance()`.
 *
 * Spawn-command resolution lives in `resolveSidecarEntry()`, which covers the
 * dev path (`WEBLLM_DEV_ENTRY` override or a reserved default pointing at the
 * compiled web-runtime dist) and the packaged path (`process.resourcesPath`).
 */
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { WebRuntimeClient } from './client.ts'
import type { SidecarLaunchSpec } from './client.ts'
import { Methods } from '../../web-runtime/ipc-protocol.ts'

/** Default per-attempt startup timeout when waiting for the sidecar. */
const DEFAULT_START_TIMEOUT_MS = 30_000
/** Total spawn attempts (first attempt + up to 2 retries). */
const DEFAULT_MAX_ATTEMPTS = 3

export interface WebRuntimeManagerOptions {
  /** Per-attempt startup timeout in ms (default 30s). */
  startTimeoutMs?: number
  /** Total spawn attempts: first try + retries (default 3, i.e. up to 2 retries). */
  maxAttempts?: number
  /** Forced spawn spec; tests inject a fake sidecar here. */
  entryOverride?: SidecarLaunchSpec | null
  /** Override `app.isPackaged` for tests run outside Electron (default: real value). */
  isPackagedOverride?: boolean
}

export class WebRuntimeManager {
  private static singleton: WebRuntimeManager | null = null

  /** App-facing singleton. Tests may construct an instance directly instead. */
  static getInstance(): WebRuntimeManager {
    if (!WebRuntimeManager.singleton) {
      WebRuntimeManager.singleton = new WebRuntimeManager()
    }
    return WebRuntimeManager.singleton
  }

  /** Test helper: drop the singleton so a fresh one is built next time. */
  static resetSingleton(): void {
    WebRuntimeManager.singleton = null
  }

  private client: WebRuntimeClient | null = null
  private startPromise: Promise<WebRuntimeClient> | null = null
  private readonly startTimeoutMs: number
  private readonly maxAttempts: number
  private readonly entryOverride: SidecarLaunchSpec | null
  private readonly isPackagedOverride?: boolean

  constructor(opts: WebRuntimeManagerOptions = {}) {
    this.startTimeoutMs = opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.entryOverride = opts.entryOverride ?? null
    this.isPackagedOverride = opts.isPackagedOverride
  }

  /**
   * Return the started sidecar client, spawning one on first call.
   * Concurrent callers share a single start; a failed start is retried up to
   * `maxAttempts - 1` times after the per-attempt timeout.
   */
  async ensureStarted(): Promise<WebRuntimeClient> {
    if (this.client) return this.client
    if (!this.startPromise) {
      this.startPromise = this.spawnWithRetry().then(
        (client) => {
          this.client = client
          return client
        },
        (err) => {
          this.startPromise = null
          throw err
        },
      )
    }
    return this.startPromise
  }

  private async spawnWithRetry(): Promise<WebRuntimeClient> {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.spawnOnce(attempt)
      } catch (err) {
        lastError = err as Error
        console.error(
          `[WebRuntime] sidecar start attempt ${attempt}/${this.maxAttempts} failed: ${err}`,
        )
      }
    }
    throw lastError ?? new Error(`web runtime sidecar failed to start after ${this.maxAttempts} attempts`)
  }

  private async spawnOnce(attempt: number): Promise<WebRuntimeClient> {
    const client = new WebRuntimeClient(this.resolveSidecarEntry())
    try {
      await client.start()
      // `request()` internally waits for the `Sidecar ready` line, so this
      // both gates on readiness and doubles as a liveness probe: on the real
      // sidecar it resolves via the health handler registered in the sidecar.
      await withTimeout(
        client.request(Methods.BROWSER_HEALTH, {}),
        this.startTimeoutMs,
        `sidecar startup (attempt ${attempt}/${this.maxAttempts})`,
      )
      return client
    } catch (err) {
      await client.stop().catch(() => {})
      throw err
    }
  }

  /**
   * Ensure the Playwright Chromium browser is available before the sidecar
   * tries to launch it. In the packaged build the browser is NOT bundled
   * (keeps the installer ~80MB); if the revision is missing we run
   * `playwright install chromium` once. In dev this is a no-op when the
   * browser is already present.
   */
  async ensureBrowser(): Promise<void> {
    const { chromium } = this.loadPlaywright()

    try {
      const probe = await chromium.launch({ headless: true })
      await probe.close()
      return
    } catch {
      // Browser missing — install once.
    }

    const cli = this.playwrightCli()
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout?.on('data', (d) => { out += d })
    child.stderr?.on('data', (d) => { out += d })
    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`chromium install failed (code ${code}): ${out.slice(-400)}`))
      })
    })
  }

  /**
   * Resolve the playwright module from the sidecar-adjacent node_modules.
   * Dev: repo node_modules. Packaged: <resources>/web-runtime/node_modules
   * (copied by build-web-runtime.mjs). Uses an absolute require so no runtime
   * NODE_PATH mutation is needed.
   */
  private loadPlaywright(): typeof import('playwright') {
    const base = this.isPackagedOverride ?? this.isPackagedBuild()
    if (base) {
      const resources = process.resourcesPath || ''
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(path.join(resources, 'web-runtime', 'node_modules', 'playwright')) as typeof import('playwright')
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('playwright') as typeof import('playwright')
  }

  private playwrightCli(): string {
    const base = this.isPackagedOverride ?? this.isPackagedBuild()
    if (base) {
      const resources = process.resourcesPath || ''
      const nodeModules = path.join(resources, 'web-runtime', 'node_modules')
      return path.join(nodeModules, 'playwright', 'cli.js')
    }
    return path.join(moduleDir(), '..', '..', 'node_modules', 'playwright', 'cli.js')
  }

  private isPackagedBuild(): boolean {
    try {
      const electron = require('electron') as { app?: { isPackaged?: boolean } }
      return typeof electron.app?.isPackaged === 'boolean' ? electron.app.isPackaged : false
    } catch {
      return false
    }
  }

  /** Run a health probe against the (ensured) sidecar. */
  async health(): Promise<unknown> {
    const client = await this.ensureStarted()
    return client.request(Methods.BROWSER_HEALTH, {})
  }

  /**
   * Stop the sidecar and forget it. Safe to call before `ensureStarted()` or
   * repeatedly; a subsequent `ensureStarted()` spawns a fresh client. If a
   * start is still in flight it is awaited and then killed.
   */
  async stop(): Promise<void> {
    const spawning = this.startPromise
    this.startPromise = null
    if (spawning) {
      try {
        await spawning
      } catch {
        // A failed start already cleaned up its own child process.
      }
    }
    // Read and null `this.client` only after any in-flight start has settled:
    // a successful `ensureStarted()` assigns `this.client` as its promise
    // resolves, so nulling it up front would leak the spawned sidecar child.
    const client = this.client
    this.client = null
    if (client) await client.stop()
  }

  /**
   * Resolve the command + args used to spawn the WebLLM sidecar.
   *
   * Packaged: the sidecar shipped via `build.extraResources` lives under
   * `process.resourcesPath/web-runtime/`; spawn `node <resources>/web-runtime/index.js`.
   * Dev: `WEBLLM_DEV_ENTRY` if set, otherwise a reserved default pointing at
   * the compiled web-runtime dist (the TS source under src/web-runtime/ is not
   * directly runnable by Node yet).
   *
   * `app` is read lazily via `require('electron')` so this module stays
   * importable (and testable) under a bare Node process where the electron
   * module is unavailable.
   */
  resolveSidecarEntry(): SidecarLaunchSpec {
    if (this.entryOverride) return this.entryOverride
    const packaged = this.isPackagedOverride ?? (() => {
      try {
        const electron = require('electron') as { app?: { isPackaged?: boolean } }
        return typeof electron.app?.isPackaged === 'boolean' ? electron.app.isPackaged : false
      } catch {
        return false
      }
    })()
    if (packaged) {
      // The sidecar is shipped under <resources>/web-runtime with its own
      // node_modules (playwright + playwright-core) copied by
      // build-web-runtime.mjs. Because the sidecar files live OUTSIDE app.asar,
      // Node's default module resolution cannot find playwright from the
      // sidecar's __dirname; point NODE_PATH at the bundled deps so
      // `require('playwright')` resolves in the packaged build.
      const resources = process.resourcesPath || ''
      return {
        command: 'node',
        args: [path.join(resources, 'web-runtime', 'index.js')],
        env: {
          NODE_PATH: path.join(resources, 'web-runtime', 'node_modules'),
        },
      }
    }
    const devEntry =
      process.env.WEBLLM_DEV_ENTRY ||
      path.resolve(moduleDir(), '../../web-runtime/dist/index.js')
    return { command: 'node', args: [devEntry] }
  }
}

/**
 * Directory of this module. `__dirname` exists when this file runs as
 * CommonJS (the electron-vite bundled main build); under native ESM (Node
 * running the raw .ts directly in tests, strip-only mode) it does not, so
 * fall back to deriving it from `import.meta.url`. `typeof` guard keeps the
 * ESM path from throwing on the unbound identifier.
 */
function moduleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname
  return path.dirname(fileURLToPath(import.meta.url))
}

/** Reject `promise` after `ms` unless it settles first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: Error) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
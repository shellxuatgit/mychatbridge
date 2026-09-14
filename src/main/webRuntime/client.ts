import { spawn, ChildProcess } from 'child_process'
import * as readline from 'readline'

/** How to launch the WebLLM sidecar process. */
export interface SidecarLaunchSpec {
  command: string
  args: string[]
  /** Extra env vars merged over process.env for the sidecar child. */
  env?: Record<string, string>
}

/**
 * Main-process JSON-RPC client for the WebLLM (browser) sidecar.
 *
 * Spawns `node <web-runtime entry>` and talks newline-delimited JSON-RPC over
 * stdin/stdout. The sidecar prints `WebLLM Browser Sidecar ready` to stdout as
 * its readiness signal; `request()` waits for it before sending.
 *
 * Logic mirrors the design in the Task 2 brief (reviewed final). The only
 * divergence: `spawnSpec` is stored via an explicit field instead of a
 * TypeScript parameter property, because Node's native TS support (strip-only
 * mode, Node 24) cannot parse parameter properties.
 */
export class WebRuntimeClient {
  private proc: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private ready = false
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []
  private eventCb: ((evt: { event: string; data: Record<string, unknown> }) => void) | null = null
  private spawnSpec: SidecarLaunchSpec

  constructor(spawnSpec: SidecarLaunchSpec) {
    this.spawnSpec = spawnSpec
  }

  async start(): Promise<void> {
    // stdio: stdin/stdout JSON-RPC + stderr inherited. Note: NOT allocating
    // fd 3 — V0.1 is non-streaming and the compiled sidecar's `createReadStream(3)`
    // crashes on Windows when fd 3 is a spawn-allocated pipe. fd 3 binary
    // frames are a V0.2 streaming optimization.
    this.proc = spawn(this.spawnSpec.command, this.spawnSpec.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...(this.spawnSpec.env || {}) },
    })
    this.rl = readline.createInterface({ input: this.proc.stdout! })
    this.rl.on('line', (line) => {
      if (line.includes('Sidecar ready')) { this.ready = true; this.readyWaiters.forEach((w) => w.resolve()); this.readyWaiters = []; return }
      if (line.trim().startsWith('{')) {
        try {
          this.dispatch(JSON.parse(line))
        } catch {
          // Ignore non-JSON noise on stdout (sidecar internal prints); never
          // let a malformed line become an uncaughtException in main.
        }
      }
    })
    this.proc.on('exit', (code) => { this.ready = false; for (const [, p] of this.pending) p.reject(new Error(`sidecar exited ${code}`)); this.pending.clear(); for (const w of this.readyWaiters) w.reject(new Error(`sidecar exited ${code} before ready`)); this.readyWaiters = [] })
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.proc) {
      throw new Error('WebRuntimeClient.request() called before start(); call start() first')
    }
    if (!this.ready) {
      await new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin!.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  onEvent(cb: (evt: { event: string; data: Record<string, unknown> }) => void) { this.eventCb = cb }

  /**
   * Whether the sidecar has signalled readiness and not yet exited.
   * Lets lifecycle code (manager) distinguish "sidecar replied with a
   * protocol error" (still healthy) from "sidecar died / never became ready"
   * without reaching into private state.
   */
  isReady(): boolean {
    return this.ready
  }

  private dispatch(msg: { id?: number; result?: unknown; error?: { code: string; message: string }; event?: string; data?: Record<string, unknown> }) {
    if (msg.event) { this.eventCb?.(msg as any); return }
    const p = this.pending.get(msg.id!)
    if (!p) return
    this.pending.delete(msg.id!)
    if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
    else p.resolve(msg.result)
  }

  async stop() { this.proc?.kill(); this.proc = null }
}
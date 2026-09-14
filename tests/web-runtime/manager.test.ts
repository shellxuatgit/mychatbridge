import test from 'node:test'
import assert from 'node:assert/strict'

import { WebRuntimeManager } from '../../src/main/webRuntime/manager.ts'
import { WebRuntimeClient } from '../../src/main/webRuntime/client.ts'

/**
 * Build a fake-sidecar script for manager tests. Reads newline-delimited
 * JSON-RPC on stdin and replies on stdout.
 *   - echo     : reply `ok:<method>:<seq>` (seq increments per request)
 *   - fail     : reply with a JSON-RPC error (sidecar stays alive)
 *   - exit     : reply ok, then exit the process (dies mid-session)
 *
 * Needs the `ready` flag, otherwise the client's `request()` never resolves
 * and tests would hang until the manager's 30s timeout.
 *
 * `opts` (e.g. `{ delayReadyMs, dieBeforeReady: true }`) tunes startup
 * behavior. Note: opts are inlined into the script, not passed via env,
 * because the client spawns with `{ stdio }` only.
 */
function sidecarScript(opts: Record<string, any> = {}): string {
  return `
const readline = require('readline')
const opts = ${JSON.stringify(opts)}
let seq = 0
const rl = readline.createInterface({ input: process.stdin })
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n')
rl.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  if (req.method === 'browser.health') { send({ id: req.id, result: 'ok:health' }); return }
  if (req.method === 'exit') { send({ id: req.id, result: 'bye' }); process.exit(0); return }
  send({ id: req.id, error: { code: 'METHOD_NOT_FOUND', message: 'no handler: ' + req.method } })
})
if (opts.dieBeforeReady) {
  process.exit(3)
} else {
  setTimeout(() => process.stdout.write('WebLLM Browser Sidecar ready\\n'), opts.delayReadyMs || 0)
}
`
}

function fakeEntry(opts: Record<string, any> = {}) {
  return { command: process.execPath, args: ['-e', sidecarScript(opts)] }
}

async function withManager(
  opts: Record<string, any>,
  fn: (m: WebRuntimeManager, client: WebRuntimeClient) => Promise<void>,
) {
  const m = new WebRuntimeManager({
    startTimeoutMs: opts.startTimeoutMs ?? 2000,
    maxAttempts: opts.maxAttempts ?? 1,
    entryOverride: fakeEntry(opts),
  })
  try {
    await fn(m, await m.ensureStarted())
  } finally {
    await m.stop()
  }
}

test('ensureStarted spawns the sidecar and health returns its reply', async () => {
  await withManager({}, async (m, client) => {
    assert.ok(client instanceof WebRuntimeClient)
    assert.ok(client.isReady())
    assert.equal(await m.health(), 'ok:health')
  })
})

test('ensureStarted is idempotent: concurrent callers share one client', async () => {
  const m = new WebRuntimeManager({ entryOverride: fakeEntry(), maxAttempts: 1 })
  try {
    const [c1, c2] = await Promise.all([m.ensureStarted(), m.ensureStarted()])
    assert.equal(c1, c2)
    assert.equal(await m.health(), 'ok:health')
  } finally {
    await m.stop()
  }
})

test('stop kills the sidecar and a later ensureStarted respawns it', async () => {
  const m = new WebRuntimeManager({ entryOverride: fakeEntry(), maxAttempts: 1 })
  try {
    const c1 = await m.ensureStarted()
    assert.equal(await m.health(), 'ok:health')
    await m.stop()
    const c2 = await m.ensureStarted()
    assert.notEqual(c2, c1)
    assert.equal(await m.health(), 'ok:health')
  } finally {
    await m.stop()
  }
})

test('manager is a true singleton', () => {
  const a = WebRuntimeManager.getInstance()
  const b = WebRuntimeManager.getInstance()
  assert.equal(a, b)
  WebRuntimeManager.resetSingleton()
  assert.notEqual(WebRuntimeManager.getInstance(), a)
})

test('a sidecar that dies before signalling ready surfaces an exit error', async () => {
  const m = new WebRuntimeManager({ entryOverride: fakeEntry({ dieBeforeReady: true }), maxAttempts: 1 })
  try {
    await assert.rejects(m.ensureStarted(), /sidecar exited 3/)
  } finally {
    await m.stop()
  }
})

test('retries after an unresponsive start (health probe never answers)', { timeout: 20000 }, async () => {
  const m = new WebRuntimeManager({
    // Each failed attempt waits out startTimeoutMs before the next spawn.
    startTimeoutMs: 500,
    maxAttempts: 3,
    entryOverride: { command: 'node', args: ['-e', 'process.stdin.resume()'] },
  })
  try {
    await assert.rejects(m.ensureStarted(), /sidecar startup .* timed out after 500ms/)
  } finally {
    await m.stop()
  }
})
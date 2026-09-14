import test from 'node:test'
import assert from 'node:assert/strict'

import { WebRuntimeClient } from '../../src/main/webRuntime/client.ts'

/**
 * Build a fake-sidecar script. Reads newline-delimited JSON-RPC requests on
 * stdin and replies on stdout. Test methods:
 *   - echo     : reply `ok:<method>:<seq>` where seq increments per request
 *   - reversed : reply after a fixed delay, so responses arrive out of order
 *   - fail     : reply with a JSON-RPC error
 *
 * `opts.byMethod` allows per-method `delayMs`/`result`/`error`/`events` for
 * deterministic delay and event tests.
 *
 * Prints `WebLLM Browser Sidecar ready` after bootstrap (readiness signal).
 * Note: opts are inlined into the script (not an env var) because the client
 * spawns with `{ stdio }` only and does not forward a custom env.
 */
function sidecarScript(opts: Record<string, any> = {}): string {
  return `
const readline = require('readline')
const opts = ${JSON.stringify(opts)}
let seq = 0
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n')
  const spec = opts.byMethod && opts.byMethod[req.method]
  if (spec) {
    const respond = () => {
      if (spec.error) send({ id: req.id, error: spec.error })
      else send({ id: req.id, result: spec.result })
    }
    if (spec.events && spec.events.length) {
      spec.events.forEach((e, i) => setTimeout(() => send(e), 5 + i * 5))
    }
    if (spec.delayMs) setTimeout(respond, spec.delayMs)
    else respond()
    return
  }
  if (req.method === 'fail') { send({ id: req.id, error: { code: 'TEST_ERROR', message: 'boom' } }); return }
  if (req.method === 'echo') { send({ id: req.id, result: 'ok:' + req.method + ':' + (++seq) }); return }
  if (req.method === 'reversed') { setTimeout(() => send({ id: req.id, result: 'ok:' + req.method + ':' + (++seq) }), 15); return }
  send({ id: req.id, error: { code: 'METHOD_NOT_FOUND', message: 'no handler: ' + req.method } })
})
process.stdout.write('WebLLM Browser Sidecar ready\\n')
`
}

function spawnSpec(opts: Record<string, any> = {}) {
  return { command: process.execPath, args: ['-e', sidecarScript(opts)] }
}

async function withClient(
  opts: Record<string, any>,
  fn: (client: WebRuntimeClient) => Promise<void>,
) {
  const client = new WebRuntimeClient(spawnSpec(opts))
  await client.start()
  try {
    await fn(client)
  } finally {
    await client.stop()
  }
}

test('request resolves with the sidecar result (id match)', async () => {
  await withClient({}, async (c) => {
    const res = await c.request('echo', { a: 1 })
    assert.equal(res, 'ok:echo:1')
  })
})

test('concurrent requests resolve in order without cross-talk', async () => {
  await withClient({}, async (c) => {
    const [r1, r2, r3] = await Promise.all([
      c.request('echo'),
      c.request('echo'),
      c.request('echo'),
    ])
    assert.deepEqual([r1, r2, r3], ['ok:echo:1', 'ok:echo:2', 'ok:echo:3'])
  })
})

test('out-of-order responses are matched to the right request', async () => {
  await withClient({}, async (c) => {
    const fast = c.request('echo')
    const slow = c.request('reversed')
    const [fastRes, slowRes] = await Promise.all([fast, slow])
    // reversed replies arrive 15ms later than echo, so a naive FIFO mapping
    // would cross the ids; the client must resolve each promise by id.
    assert.equal(fastRes, 'ok:echo:1')
    assert.equal(slowRes, 'ok:reversed:2')
  })
})

test('methods can reply with different delays (ordering under delay)', async () => {
  const opts = {
    byMethod: {
      fast: { delayMs: 5, result: 'fast-result' },
      slow: { delayMs: 30, result: 'slow-result' },
    },
  }
  await withClient(opts, async (c) => {
    const results = await Promise.all([c.request('fast'), c.request('slow')])
    assert.deepEqual(results, ['fast-result', 'slow-result'])
  })
})

test('error replies reject with code + message', async () => {
  await withClient({}, async (c) => {
    await assert.rejects(c.request('fail'), /TEST_ERROR: boom/)
  })
})

test('events are delivered to the onEvent callback', async () => {
  const opts = {
    byMethod: {
      stream: {
        delayMs: 50,
        result: 'done',
        events: [
          { event: 'chunk', data: { delta: 'a' } },
          { event: 'chunk', data: { delta: 'b' } },
        ],
      },
    },
  }
  await withClient(opts, async (c) => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    c.onEvent((evt) => events.push(evt))
    const pending = c.request('stream')
    // Event emission races with the delayed reply and with child-process
    // bootstrap latency, so poll instead of sleeping a fixed amount - a fixed
    // sleep is deterministic only on the machine it was tuned on.
    const deadline = Date.now() + 2000
    while (events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.deepEqual(events, [
      { event: 'chunk', data: { delta: 'a' } },
      { event: 'chunk', data: { delta: 'b' } },
    ])
    assert.equal(await pending, 'done')
  })
})
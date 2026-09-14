import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import readline from 'node:readline'

const repoRoot = join(import.meta.dirname, '..', '..')
const sidecarEntry = join(repoRoot, 'out', 'web-runtime', 'index.js')

type RpcResponse = { id: number; result?: any; error?: { code: string; message: string } }

function waitForLine(child: ChildProcessWithoutNullStreams, predicate: (line: string) => boolean, timeoutMs = 30_000) {
  return new Promise<string>((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout })
    const timer = setTimeout(() => { rl.close(); reject(new Error(`timed out waiting for sidecar output after ${timeoutMs}ms`)) }, timeoutMs)
    rl.on('line', (line) => {
      if (!predicate(line)) return
      clearTimeout(timer)
      rl.close()
      resolve(line)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      rl.close()
      reject(new Error(`sidecar exited before expected output (code=${code}, signal=${signal})`))
    })
  })
}

async function request(child: ChildProcessWithoutNullStreams, id: number, method: string, params: Record<string, unknown> = {}) {
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  const line = await waitForLine(child, (candidate) => {
    try { return JSON.parse(candidate).id === id } catch { return false }
  })
  const response = JSON.parse(line) as RpcResponse
  assert.equal(response.id, id)
  if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`)
  return response.result
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await once(child, 'exit').catch(() => undefined)
}

test('real compiled sidecar: health and provider.load for chatgpt and doubao', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mychatbridge-webllm-e2e-'))
  const child = spawn(process.execPath, [sidecarEntry], {
    cwd: repoRoot,
    env: { ...process.env, WEBLLM_DATA_DIR: dataDir, WEBLLM_HEADLESS: 'true' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  t.after(async () => {
    await stop(child)
    await rm(dataDir, { recursive: true, force: true })
  })

  await waitForLine(child, (line) => line.includes('Sidecar ready'))
  const health = await request(child, 1, 'browser.health')
  assert.equal(health.status, 'ok')

  for (const [id, provider] of [[2, 'chatgpt'], [3, 'doubao']] as const) {
    // provider.load intentionally has no result payload; success means no RPC error.
    await request(child, id, 'provider.load', { provider_id: provider })
  }
})

test('fake browser layer: connect, sendMessage, session save/restore preserve JSON-RPC IPC shape', async (t) => {
  const script = `
    const readline = require('node:readline')
    const sessions = new Set()
    const rl = readline.createInterface({ input: process.stdin })
    const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\\n')
    rl.on('line', line => {
      const req = JSON.parse(line)
      if (req.method === 'browser.invoke' && req.params.action === 'connect') { sessions.add(req.params.account_id); send(req.id, { ok: true, account_id: req.params.account_id }); return }
      if (req.method === 'browser.invoke' && req.params.action === 'sendMessage') { send(req.id, { ok: true, content: 'fake reply', finishReason: 'stop' }); return }
      if (req.method === 'session.save') { send(req.id, { saved: true, account_id: req.params.account_id }); return }
      if (req.method === 'session.restore') { send(req.id, { restored: sessions.has(req.params.account_id), account_id: req.params.account_id }); return }
      process.stdout.write(JSON.stringify({ id: req.id, error: { code: 'METHOD_NOT_FOUND', message: req.method } }) + '\\n')
    })
    process.stdout.write('WebLLM Browser Sidecar ready\\n')
  `
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'inherit'] })
  t.after(() => stop(child))
  await waitForLine(child, (line) => line.includes('Sidecar ready'))

  const account = 'e2e-fake-account'
  const connected = await request(child, 1, 'browser.invoke', { provider: 'chatgpt', action: 'connect', account_id: account, params: {} })
  assert.deepEqual(connected, { ok: true, account_id: account })
  const sent = await request(child, 2, 'browser.invoke', { provider: 'chatgpt', action: 'sendMessage', account_id: account, params: { message: 'hello' } })
  assert.deepEqual(sent, { ok: true, content: 'fake reply', finishReason: 'stop' })
  assert.deepEqual(await request(child, 3, 'session.save', { account_id: account }), { saved: true, account_id: account })
  assert.deepEqual(await request(child, 4, 'session.restore', { account_id: account }), { restored: true, account_id: account })
})
